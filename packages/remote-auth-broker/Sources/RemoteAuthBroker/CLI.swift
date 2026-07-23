import Darwin
import Foundation
import RemoteAuthProtocol
import Dispatch

public enum LocalAdministrationCommand: Equatable, Sendable {
    case migrateLegacyCredential
    case legacyMigrationStatus
    case finalizeCredentialCutover
    case activate(policyPath: String)
    case deactivate
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
      activate --policy <owner-only-json>
      deactivate
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
        case "activate":
            let options = try parseOptions(
                Array(arguments.dropFirst()),
                allowed: ["--policy"]
            )
            guard let path = options["--policy"] else { throw CLIError.usage }
            return .activate(policyPath: path)
        case "deactivate":
            guard arguments.count == 1 else { throw CLIError.usage }
            return .deactivate
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
        case .activate(let policyPath):
            let source = try OwnerOnlyInputFile.read(path: policyPath)
            let store = PolicyConfigurationStore()
            _ = try PolicyLoader.load(source)
            let evidence = try authorizeSynchronously(.reEnable)
            let installed = try store.installReviewedPolicy(source, evidence: evidence)
            return try writeMetadata(LocalAdministrationOutput(
                operation: "activate",
                status: "active",
                destination: nil,
                policyDigest: installed.digest
            ))
        case .deactivate:
            let store = PolicyConfigurationStore()
            _ = try store.load()
            let evidence = try authorizeSynchronously(.destructiveOneShot)
            let installed = try store.deactivate(evidence: evidence)
            return try writeMetadata(LocalAdministrationOutput(
                operation: "deactivate",
                status: "design-inactive",
                destination: nil,
                policyDigest: installed.digest
            ))
        }
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

    private static func writeMetadata(_ metadata: LocalAdministrationOutput) throws -> Int32 {
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

    var exitCode: Int32 {
        switch self {
        case .usage: return 2
        case .unsafeInputFile, .secretFileForbidden: return 7
        case .terminalUnavailable: return 5
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
