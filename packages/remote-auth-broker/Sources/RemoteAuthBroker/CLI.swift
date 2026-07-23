import Darwin
import Foundation
import RemoteAuthJetKVMCloudController
import RemoteAuthProtocol
import Dispatch

public enum LocalAdministrationCommand: Equatable, Sendable {
    case migrateLegacyCredential
    case legacyMigrationStatus
    case finalizeCredentialCutover
    case gdmPrepare(inputPath: String)
    case gdmBootstrapCloud(
        ubuntuExportPath: String,
        endpoint: String,
        approveObservedAttestation: Bool
    )
    case gdmStatus
    case gdmActivate
    case gdmDeactivate
}

public struct LegacyMigrationMetadata: Codable, Equatable, Sendable {
    public let phase: String
    public let destination: String

    public init(status: LegacyCredentialMigrationStatus) {
        switch status {
        case .notPrepared(let destination):
            phase = "not-prepared"
            self.destination = Self.destinationName(destination)
        case .ready(let destination):
            phase = "ready"
            self.destination = Self.destinationName(destination)
        case .finalizationPending(let destination):
            phase = "finalization-pending"
            self.destination = Self.destinationName(destination)
        case .finalized(let destination):
            phase = "finalized"
            self.destination = Self.destinationName(destination)
        }
    }

    private static func destinationName(_ status: LegacyMigrationDestinationStatus) -> String {
        switch status {
        case .absent: return "absent"
        case .presentUnverified: return "present-unverified"
        case .verified: return "verified"
        }
    }
}

public enum RemoteAuthCLI {
    public static let help = """
    Usage: remote-authd <command>

    Commands:
      status
      request submit --file <owner-only-json>
      request state --request-id <id>
      request cancel --request-id <id>
      control --file <owner-only-json>
      grant create --spec-file <owner-only-json>
      grant expand --grant-id <id> --spec-file <owner-only-json>
      grant list
      grant revoke --grant-id <id>
      grant expire --grant-id <id>
      enroll credential --kind <jetkvm|bitwarden> --credential-id <id>
      forget credential --credential-id <id>
      credential migrate-legacy
      credential migration-status
      credential finalize-cutover
      gdm prepare --file <owner-only-json>
      gdm bootstrap-cloud --ubuntu-export <json> --endpoint <endpoint> --approve-observed-attestation
      gdm status
      gdm activate
      gdm deactivate
      browser google-login [--list] [--account <email> ...]
      serve
      --help
    """

    public static func run(arguments: [String] = CommandLine.arguments) -> Int32 {
        do {
            guard arguments.count >= 2 else {
                try write(help, to: .standardOutput)
                return 2
            }
            let tail = Array(arguments.dropFirst())
            if let command = try parseLocalAdministration(tail) {
                return try localAdministrationCommand(command)
            }
            switch tail[0] {
            case "--help", "-h", "help":
                guard tail.count == 1 else { throw CLIError.usage }
                try write(help, to: .standardOutput)
                return 0
            case "status":
                guard tail.count == 1 else { throw CLIError.usage }
                return try exchange(.control(.status))
            case "request":
                return try requestCommand(Array(tail.dropFirst()))
            case "control":
                return try controlCommand(Array(tail.dropFirst()))
            case "grant":
                return try grantCommand(Array(tail.dropFirst()))
            case "enroll":
                return try enrollCommand(Array(tail.dropFirst()))
            case "forget":
                return try forgetCommand(Array(tail.dropFirst()))
            case "browser":
                return try browserCommand(Array(tail.dropFirst()))
            case "serve":
                guard tail.count == 1 else { throw CLIError.usage }
                try BrokerDaemon().serve()
            default:
                throw CLIError.usage
            }
        } catch let error as CLIError {
            try? writeError(error)
            return error.exitCode
        } catch let error as RemoteAuthProtocolError {
            try? writePublicError(error.publicError)
            return exitCode(for: error.publicError)
        } catch let error as BrokerSocketError {
            let publicError: PublicError = error == .peerRejected ? .peerMismatch : .unavailable
            try? writePublicError(publicError)
            return exitCode(for: publicError)
        } catch let error as BrowserGoogleLoginError {
            try? write("browser error: \(error.description)\n", to: .standardError)
            return error == .usage ? 2 : 7
        } catch let error as KeychainAuthorityError {
            try? write("keychain error: \(String(describing: error))\n", to: .standardError)
            return 7
        } catch let error as JetKVMCloudError {
            try? write("jetkvm cloud error: \(error.rawValue)\n", to: .standardError)
            return 7
        } catch {
            try? writePublicError(.internal)
            return 7
        }
    }

    private static func requestCommand(_ arguments: [String]) throws -> Int32 {
        guard let command = arguments.first else { throw CLIError.usage }
        switch command {
        case "submit":
            let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--file"])
            guard let path = options["--file"] else { throw CLIError.usage }
            let payload = try OwnerOnlyInputFile.read(path: path)
            let request = try ProtocolJSON.decode(ExecutionRequest.self, from: payload)
            return try exchange(.execution(request))
        case "state":
            let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--request-id"])
            guard let requestId = options["--request-id"] else { throw CLIError.usage }
            return try exchange(.control(.requestState(requestId: requestId)))
        case "cancel":
            let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--request-id"])
            guard let requestId = options["--request-id"] else { throw CLIError.usage }
            return try exchange(.control(.cancel(requestId: requestId)))
        default:
            throw CLIError.usage
        }
    }

    private static func controlCommand(_ arguments: [String]) throws -> Int32 {
        let options = try parseOptions(arguments, allowed: ["--file"])
        guard let path = options["--file"] else { throw CLIError.usage }
        let payload = try OwnerOnlyInputFile.read(path: path)
        let control = try JSONDecoder().decode(BrokerControlRequest.self, from: payload)
        if case .credentialEnroll = control {
            throw CLIError.secretFileForbidden
        }
        return try exchange(.control(control))
    }

    private static func grantCommand(_ arguments: [String]) throws -> Int32 {
        guard let command = arguments.first else { throw CLIError.usage }
        switch command {
        case "create":
            let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--spec-file"])
            guard let path = options["--spec-file"] else { throw CLIError.usage }
            let proposal = try decodeGrantProposal(path: path)
            return try exchange(.control(.grantCreate(proposal: proposal)))
        case "expand":
            let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--grant-id", "--spec-file"])
            guard let grantId = options["--grant-id"], let path = options["--spec-file"] else {
                throw CLIError.usage
            }
            let proposal = try decodeGrantProposal(path: path)
            return try exchange(.control(.grantExpand(grantId: grantId, proposal: proposal)))
        case "list":
            guard arguments.count == 1 else { throw CLIError.usage }
            return try exchange(.control(.grantList))
        case "revoke":
            let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--grant-id"])
            guard let grantId = options["--grant-id"] else { throw CLIError.usage }
            return try exchange(.control(.grantRevoke(grantId: grantId)))
        case "expire":
            let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--grant-id"])
            guard let grantId = options["--grant-id"] else { throw CLIError.usage }
            return try exchange(.control(.grantExpire(grantId: grantId)))
        default:
            throw CLIError.usage
        }
    }

    private static func enrollCommand(_ arguments: [String]) throws -> Int32 {
        guard arguments.first == "credential" else { throw CLIError.usage }
        let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--kind", "--credential-id"])
        guard let rawKind = options["--kind"],
              let kind = BrokerCredentialKind(rawValue: rawKind),
              let credentialId = options["--credential-id"]
        else {
            throw CLIError.usage
        }
        var bytes = try TerminalSecretReader.readCredential()
        let secret = try BrokerSecret(taking: &bytes)
        return try exchange(.control(.credentialEnroll(kind: kind, credentialId: credentialId, secret: secret)))
    }

    private static func forgetCommand(_ arguments: [String]) throws -> Int32 {
        guard arguments.first == "credential" else { throw CLIError.usage }
        let options = try parseOptions(Array(arguments.dropFirst()), allowed: ["--credential-id"])
        guard let credentialId = options["--credential-id"] else { throw CLIError.usage }
        return try exchange(.control(.credentialForget(credentialId: credentialId)))
    }
    private static func browserCommand(_ arguments: [String]) throws -> Int32 {
        guard arguments.first == "google-login" else { throw CLIError.usage }
        return try RemoteBrowserGoogleLogin.run(arguments: Array(arguments.dropFirst()))
    }


    public static func parseLocalAdministration(
        _ arguments: [String]
    ) throws -> LocalAdministrationCommand? {
        guard let command = arguments.first else { return nil }
        switch command {
        case "credential":
            guard arguments.count == 2 else { throw CLIError.usage }
            switch arguments[1] {
            case "migrate-legacy":
                return .migrateLegacyCredential
            case "migration-status":
                return .legacyMigrationStatus
            case "finalize-cutover":
                return .finalizeCredentialCutover
            default:
                throw CLIError.usage
            }
        case "gdm":
            guard arguments.count >= 2 else { throw CLIError.usage }
            switch arguments[1] {
            case "prepare":
                let options = try parseOptions(
                    Array(arguments.dropFirst(2)),
                    allowed: ["--file"]
                )
                guard let path = options["--file"] else { throw CLIError.usage }
                return .gdmPrepare(inputPath: path)
            case "bootstrap-cloud":
                return try parseGDMCloudBootstrapOptions(Array(arguments.dropFirst(2)))
            case "status":
                guard arguments.count == 2 else { throw CLIError.usage }
                return .gdmStatus
            case "activate":
                guard arguments.count == 2 else { throw CLIError.usage }
                return .gdmActivate
            case "deactivate":
                guard arguments.count == 2 else { throw CLIError.usage }
                return .gdmDeactivate
            default:
                throw CLIError.usage
            }
        default:
            return nil
        }
    }

    private static func localAdministrationCommand(
        _ command: LocalAdministrationCommand
    ) throws -> Int32 {
        switch command {
        case .migrateLegacyCredential:
            let authority = KeychainAuthority()
            let evidence = try authorizeSynchronously(.credentialEnrollment)
            let result = try authority.prepareLegacyCredentialMigration(evidence: evidence)
            let status = try LegacyMigrationMetadata(status: authority.legacyMigrationStatus())
            return try writeMetadata(LocalAdministrationOutput(
                operation: "credential-migrate-legacy",
                status: result == .prepared ? "prepared" : "refreshed",
                destination: status.destination,
                policyDigest: nil
            ))
        case .legacyMigrationStatus:
            let status = try LegacyMigrationMetadata(
                status: KeychainAuthority().legacyMigrationStatus()
            )
            return try writeMetadata(LocalAdministrationOutput(
                operation: "credential-migration-status",
                status: status.phase,
                destination: status.destination,
                policyDigest: nil
            ))
        case .finalizeCredentialCutover:
            let authority = KeychainAuthority()
            let evidence = try authorizeSynchronously(.destructiveOneShot)
            let result = try authority.finalizeCutover(evidence: evidence)
            let status: String
            switch result {
            case .finalized: status = "finalized"
            case .recoveredFinalization: status = "recovered-finalization"
            case .alreadyFinalized: status = "already-finalized"
            }
            let migration = LegacyMigrationMetadata(status: try authority.legacyMigrationStatus())
            return try writeMetadata(LocalAdministrationOutput(
                operation: "credential-finalize-cutover",
                status: status,
                destination: migration.destination,
                policyDigest: nil
            ))
        case .gdmPrepare(let inputPath):
            let data = try OwnerOnlyInputFile.read(path: inputPath)
            let input = try JSONDecoder().decode(GDMPreparationInput.self, from: data)
            let authority = KeychainAuthority()
            let evidence = try authorizeSynchronously(.signingKeyProvisioning)
            let result = try authority.provisionSigningKey(domain: .gdm, evidence: evidence)
            let key: KeychainSigningKeyMetadata
            switch result {
            case .provisioned(let metadata), .alreadyProvisioned(let metadata):
                key = metadata
            }
            return try writeMetadata(
                GDMActivationStore().prepare(input, signingKey: key)
            )
        case .gdmBootstrapCloud(
            let ubuntuExportPath,
            let endpoint,
            let approveObservedAttestation
        ):
            return try gdmBootstrapCloud(
                ubuntuExportPath: ubuntuExportPath,
                endpoint: endpoint,
                approveObservedAttestation: approveObservedAttestation
            )
        case .gdmStatus:

            return try writeMetadata(GDMActivationStore().status())
        case .gdmActivate:
            let evidence = try authorizeSynchronously(.reEnable)
            return try writeMetadata(GDMActivationStore().activate(evidence: evidence))
        case .gdmDeactivate:
            let evidence = try authorizeSynchronously(.destructiveOneShot)
            return try writeMetadata(GDMActivationStore().deactivate(evidence: evidence))
    }
    }

    private static func gdmBootstrapCloud(
        ubuntuExportPath: String,
        endpoint: String,
        approveObservedAttestation: Bool
    ) throws -> Int32 {
        guard approveObservedAttestation else {
            throw CLIError.attestationAcceptanceRequired
        }
        let verifier = try JSONDecoder().decode(
            UbuntuGDMVerifierMetadata.self,
            from: OwnerOnlyInputFile.read(path: ubuntuExportPath)
        )
        guard verifier.schemaVersion == 1 else {
            throw GDMActivationError.invalidPreparation
        }
        let observed = try preflightCloudBootstrap()
        switch observed {
        case .authenticationRequired:
            _ = try writeMetadata(GDMCloudBootstrapOutput(
                status: "authenticationRequired",
                cloudBootstrap: observed
            ))
            return 5
        case .ambiguousDevices:
            _ = try writeMetadata(GDMCloudBootstrapOutput(
                status: "ambiguousDevices",
                cloudBootstrap: observed
            ))
            return 4
        case .ready(
            device: let device,
            proposedConfiguration: let configuration,
            attestation: let attestation,
            review: _
        ):
            let accepted = JetKVMCloudBootstrapResult.ready(
                device: device,
                proposedConfiguration: configuration,
                attestation: attestation,
                review: .matchesReviewedAttestation
            )
            var reviewedPolicy = try PolicyConfigurationStore().load().document
            let macReleaseDigest = try installedMacReleaseDigest()
            guard reviewedPolicy.brokerIdentity.buildDigest == macReleaseDigest else {
                throw GDMActivationError.invalidPreparation
            }
            reviewedPolicy.jetKVM = JetKVMPolicy(
                chromeExecutablePath: configuration.chromeExecutablePath,
                profileDirectoryPath: configuration.profileDirectoryPath,
                deviceId: configuration.deviceId,
                tlsSPKISHA256: configuration.tlsSPKISHA256,
                frontendAssetManifestSHA256: configuration.frontendAssetManifestSHA256,
                vendoredFrontendCommit: configuration.vendoredFrontendCommit,
                vendoredFrontendDigest: configuration.vendoredFrontendDigest,
                launchTimeoutSeconds: configuration.launchTimeoutSeconds,
                cdpTimeoutSeconds: configuration.cdpTimeoutSeconds,
                readinessTimeoutSeconds: configuration.readinessTimeoutSeconds,
                replacementGraceSeconds: configuration.replacementGraceSeconds,
                keyIntervalSeconds: configuration.keyIntervalSeconds,
                maximumCDPMessageBytes: configuration.maximumCDPMessageBytes,
                maximumCDPJSONDepth: configuration.maximumCDPJSONDepth,
                maximumCDPJSONNodes: configuration.maximumCDPJSONNodes,
                maximumCDPJSONStringBytes: configuration.maximumCDPJSONStringBytes,
                maximumQueuedEvents: configuration.maximumQueuedEvents,
                maximumQueuedEventBytes: configuration.maximumQueuedEventBytes
            )
            let input = GDMPreparationInput(
                verifier: verifier,
                endpoint: endpoint,
                macReleaseDigest: macReleaseDigest,
                reviewedPolicy: reviewedPolicy,
                cloudBootstrap: accepted
            )
            let evidence = try authorizeSynchronously(.signingKeyProvisioning)
            let authority = KeychainAuthority()
            let key: KeychainSigningKeyMetadata
            switch try authority.provisionSigningKey(domain: .gdm, evidence: evidence) {
            case .provisioned(let metadata), .alreadyProvisioned(let metadata):
                key = metadata
            }
            let metadata = try GDMActivationStore().prepare(input, signingKey: key)
            _ = try writeMetadata(GDMCloudBootstrapOutput(
                status: "prepared",
                cloudBootstrap: accepted,
                metadata: metadata,
                preparedPolicyPath: BrokerRuntimePaths().gdmPreparedPolicyURL.path,
                activationBundlePath: BrokerRuntimePaths().gdmActivationBundleURL.path
            ))
            return 0
        }
    }
    private static func preflightCloudBootstrap() throws -> JetKVMCloudBootstrapResult {
        let semaphore = DispatchSemaphore(value: 0)
        let result = BlockingAsyncResult<JetKVMCloudBootstrapResult>()
        Task.detached {
            do {
                let bootstrap = try RemoteAuthJetKVMCloudBootstrap()
                result.store(.success(try await bootstrap.preflight()))
            } catch {
                result.store(.failure(error))
            }
            semaphore.signal()
        }
        semaphore.wait()
        return try result.load().get()
    }


    private static func authorizeSynchronously(
        _ operation: BiometricOperation
    ) throws -> BiometricEvidence {
        let semaphore = DispatchSemaphore(value: 0)
        let result = BlockingAsyncResult<BiometricEvidence>()
        Task.detached {
            do {
                result.store(.success(try await BiometricAuthority().authorize(operation)))
            } catch {
                result.store(.failure(error))
            }
            semaphore.signal()
        }
        semaphore.wait()
        return try result.load().get()
    }

    private static func writeMetadata<T: Encodable>(_ metadata: T) throws -> Int32 {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var output = try encoder.encode(metadata)
        output.append(0x0a)
        try FileHandle.standardOutput.write(contentsOf: output)
        return 0
    }

    private static func decodeGrantProposal(path: String) throws -> BrokerGrantProposal {
        let payload = try OwnerOnlyInputFile.read(path: path)
        return try JSONDecoder().decode(BrokerGrantProposal.self, from: payload)
    }

    private static func parseGDMCloudBootstrapOptions(
        _ arguments: [String]
    ) throws -> LocalAdministrationCommand {
        guard arguments.count == 4 || arguments.count == 5 else { throw CLIError.usage }
        var ubuntuExportPath: String?
        var endpoint: String?
        var accepted = false
        var index = 0
        while index < arguments.count {
            let name = arguments[index]
            if name == "--approve-observed-attestation" {
                guard !accepted else { throw CLIError.usage }
                accepted = true
                index += 1
                continue
            }
            guard index + 1 < arguments.count,
                  name == "--ubuntu-export" || name == "--endpoint",
                  !arguments[index + 1].isEmpty,
                  !arguments[index + 1].hasPrefix("--")
            else {
                throw CLIError.usage
            }
            if name == "--ubuntu-export" {
                guard ubuntuExportPath == nil else { throw CLIError.usage }
                ubuntuExportPath = arguments[index + 1]
            } else {
                guard endpoint == nil else { throw CLIError.usage }
                endpoint = arguments[index + 1]
            }
            index += 2
        }
        guard let ubuntuExportPath, let endpoint else {
            throw CLIError.usage
        }
        return .gdmBootstrapCloud(
            ubuntuExportPath: ubuntuExportPath,
            endpoint: endpoint,
            approveObservedAttestation: true
        )
    }
    private static func installedMacReleaseDigest() throws -> String {
        let url = BrokerRuntimePaths().sourceBuildDigestURL
        let descriptor = url.withUnsafeFileSystemRepresentation { path -> Int32 in
            guard let path else { return -1 }
            return Darwin.open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else { throw GDMActivationError.invalidPreparation }
        defer { Darwin.close(descriptor) }

        var information = stat()
        guard Darwin.fstat(descriptor, &information) == 0,
              (information.st_mode & S_IFMT) == S_IFREG,
              information.st_uid == geteuid(),
              (information.st_mode & 0o7777) == 0o444,
              information.st_nlink == 1,
              information.st_size == 65
        else {
            throw GDMActivationError.invalidPreparation
        }
        var bytes = Data(count: 65)
        try bytes.withUnsafeMutableBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.read(
                    descriptor,
                    buffer.baseAddress!.advanced(by: offset),
                    buffer.count - offset
                )
                if count > 0 {
                    offset += count
                    continue
                }
                if count < 0, errno == EINTR { continue }
                throw GDMActivationError.invalidPreparation
            }
        }
        guard bytes.last == 0x0a else { throw GDMActivationError.invalidPreparation }
        bytes.removeLast()
        guard bytes.allSatisfy({
            ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66)
        }), let value = String(data: bytes, encoding: .utf8) else {
            throw GDMActivationError.invalidPreparation
        }
        return value
    }


    private static func parseOptions(_ arguments: [String], allowed: Set<String>) throws -> [String: String] {
        guard arguments.count.isMultiple(of: 2) else { throw CLIError.usage }
        var result: [String: String] = [:]
        var index = 0
        while index < arguments.count {
            let name = arguments[index]
            let value = arguments[index + 1]
            guard allowed.contains(name), result[name] == nil, !value.isEmpty, !value.hasPrefix("--") else {
                throw CLIError.usage
            }
            result[name] = value
            index += 2
        }
        guard Set(result.keys) == allowed else { throw CLIError.usage }
        return result
    }

    private static func exchange(_ request: BrokerWireRequest) throws -> Int32 {
        let requestFrame = try BrokerWireCodec.encode(request)
        let responseFrame = try OwnerOnlyUnixClient.exchange(requestFrame: requestFrame)
        let response = try BrokerWireCodec.decodeResponse(frame: responseFrame)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var output = try encoder.encode(response)
        output.append(0x0A)
        try FileHandle.standardOutput.write(contentsOf: output)
        if case .error(let error) = response {
            return exitCode(for: error.code)
        }
        return 0
    }

    private static func writeError(_ error: CLIError) throws {
        switch error {
        case .usage:
            try write("invalid command; use --help\n", to: .standardError)
        case .unsafeInputFile:
            try write("input file is not an owner-only regular file\n", to: .standardError)
        case .secretFileForbidden:
            try write("credential enrollment is accepted only from /dev/tty\n", to: .standardError)
        case .terminalUnavailable:
            try write("credential terminal is unavailable\n", to: .standardError)
        case .attestationAcceptanceRequired:
            try write(
                "observed attestation must be explicitly accepted for this preparation run\n",
                to: .standardError
            )
        }
    }

    private static func writePublicError(_ error: PublicError) throws {
        try write("remote-auth error: \(error.rawValue)\n", to: .standardError)
    }

    private static func write(_ text: String, to handle: FileHandle) throws {
        try handle.write(contentsOf: Data(text.utf8))
    }

    private static func exitCode(for error: PublicError) -> Int32 {
        switch error {
        case .inactive, .disabled:
            return 3
        case .grantRequired, .grantForbidden, .grantInvalid, .policyMismatch, .domainMismatch,
             .targetMismatch, .reviewBlocked, .principalInvalid, .ownerStale, .peerMismatch:
            return 4
        case .unavailable:
            return 5
        case .timeout:
            return 6
        default:
            return 7
        }
    }
}

private struct GDMCloudBootstrapOutput: Encodable {
    let operation = "gdm-bootstrap-cloud"
    let status: String
    let cloudBootstrap: JetKVMCloudBootstrapResult
    let policyDigest: String?
    let bundleDigest: String?
    let ubuntuReleaseDigest: String?
    let macReleaseDigest: String?
    let gdmSigningKeyId: String?
    let preparedPolicyPath: String?
    let activationBundlePath: String?
    let deviceId: String?

    init(
        status: String,
        cloudBootstrap: JetKVMCloudBootstrapResult,
        metadata: GDMActivationMetadata? = nil,
        preparedPolicyPath: String? = nil,
        activationBundlePath: String? = nil
    ) {
        self.status = status
        self.cloudBootstrap = cloudBootstrap
        policyDigest = metadata?.policyDigest
        bundleDigest = metadata?.bundleDigest
        ubuntuReleaseDigest = metadata?.ubuntuReleaseDigest
        macReleaseDigest = metadata?.macReleaseDigest
        gdmSigningKeyId = metadata?.gdmSigningKeyId
        self.preparedPolicyPath = preparedPolicyPath
        self.activationBundlePath = activationBundlePath
        if case .ready(device: let device, proposedConfiguration: _, attestation: _, review: _) = cloudBootstrap {
            deviceId = device.id
        } else {
            deviceId = nil
        }
    }
}

private struct LocalAdministrationOutput: Encodable {
    let operation: String
    let status: String
    let destination: String?
    let policyDigest: String?
}

private final class BlockingAsyncResult<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Result<Value, Error>?

    func store(_ value: Result<Value, Error>) {
        lock.lock()
        self.value = value
        lock.unlock()
    }

    func load() -> Result<Value, Error> {
        lock.lock()
        defer { lock.unlock() }
        return value ?? .failure(RuntimeBootstrapError.ioFailure)
    }
}

private enum CLIError: Error {
    case usage
    case unsafeInputFile
    case secretFileForbidden
    case terminalUnavailable
    case attestationAcceptanceRequired

    var exitCode: Int32 {
        switch self {
        case .usage: return 2
        case .unsafeInputFile, .secretFileForbidden: return 7
        case .terminalUnavailable: return 5
        case .attestationAcceptanceRequired: return 4
        }
    }
}

private enum OwnerOnlyInputFile {
    static func read(path: String) throws -> Data {
        let descriptor = path.withCString { Darwin.open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW) }
        guard descriptor >= 0 else { throw CLIError.unsafeInputFile }
        defer { Darwin.close(descriptor) }
        var information = stat()
        guard Darwin.fstat(descriptor, &information) == 0,
              (information.st_mode & S_IFMT) == S_IFREG,
              information.st_uid == geteuid(),
              information.st_mode & (S_IRWXG | S_IRWXO) == 0,
              information.st_size > 0,
              information.st_size <= off_t(remoteAuthMaximumFrameBytes)
        else {
            throw CLIError.unsafeInputFile
        }
        var result = Data(count: Int(information.st_size))
        try result.withUnsafeMutableBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.read(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count > 0 {
                    offset += count
                    continue
                }
                if count < 0, errno == EINTR { continue }
                throw CLIError.unsafeInputFile
            }
        }
        var extra: UInt8 = 0
        guard Darwin.read(descriptor, &extra, 1) == 0 else {
            throw CLIError.unsafeInputFile
        }
        return result
    }
}

private enum TerminalSecretReader {
    static func readCredential() throws -> [UInt8] {
        let descriptor = "/dev/tty".withCString {
            Darwin.open($0, O_RDWR | O_CLOEXEC | O_NOFOLLOW)
        }
        guard descriptor >= 0 else { throw CLIError.terminalUnavailable }
        var original = termios()
        guard tcgetattr(descriptor, &original) == 0 else {
            Darwin.close(descriptor)
            throw CLIError.terminalUnavailable
        }
        var hidden = original
        hidden.c_lflag &= ~tcflag_t(ECHO | ECHONL)
        guard tcsetattr(descriptor, TCSAFLUSH, &hidden) == 0 else {
            Darwin.close(descriptor)
            throw CLIError.terminalUnavailable
        }

        var secret: [UInt8] = []
        secret.reserveCapacity(128)
        var operationError: Error?
        do {
            try writePrompt(to: descriptor)
            var finished = false
            while !finished {
                var buffer = [UInt8](repeating: 0, count: 256)
                let count = buffer.withUnsafeMutableBytes {
                    Darwin.read(descriptor, $0.baseAddress, $0.count)
                }
                if count < 0 {
                    if errno == EINTR { continue }
                    throw CLIError.terminalUnavailable
                }
                if count == 0 { throw CLIError.terminalUnavailable }
                for byte in buffer[..<count] {
                    if byte == 0x0A || byte == 0x0D {
                        finished = true
                        break
                    }
                    guard byte != 0, secret.count < 4_096 else {
                        throw RemoteAuthProtocolError(.protocolInvalid)
                    }
                    secret.append(byte)
                }
                buffer.withUnsafeMutableBytes { bytes in
                    _ = bytes.initializeMemory(as: UInt8.self, repeating: 0)
                }
            }
            guard !secret.isEmpty else { throw RemoteAuthProtocolError(.protocolInvalid) }
        } catch {
            operationError = error
        }

        let restoreResult = tcsetattr(descriptor, TCSAFLUSH, &original)
        var newline: UInt8 = 0x0A
        _ = Darwin.write(descriptor, &newline, 1)
        Darwin.close(descriptor)
        if let operationError {
            secret.withUnsafeMutableBytes { bytes in
                _ = bytes.initializeMemory(as: UInt8.self, repeating: 0)
            }
            throw operationError
        }
        guard restoreResult == 0 else {
            secret.withUnsafeMutableBytes { bytes in
                _ = bytes.initializeMemory(as: UInt8.self, repeating: 0)
            }
            throw CLIError.terminalUnavailable
        }
        return secret
    }

    private static func writePrompt(to descriptor: Int32) throws {
        let prompt = Array("Credential secret: ".utf8)
        let result = prompt.withUnsafeBytes { bytes in
            Darwin.write(descriptor, bytes.baseAddress, bytes.count)
        }
        guard result == prompt.count else { throw CLIError.terminalUnavailable }
    }
}
