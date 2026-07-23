import CryptoKit
import Darwin
import Foundation
import RemoteAuthBrowserController
import RemoteAuthJetKVMCloudController
import RemoteAuthProtocol
import Security

public enum RuntimeBootstrapError: Error, Equatable, Sendable {
    case unsafePath
    case unsafePolicy
    case invalidPolicyState
    case runtimeIdentityUnavailable
    case runtimeIdentityMismatch
    case invalidBuildDigest
    case browserConfigurationMissing
    case browserConfigurationMismatch
    case ioFailure
}

public struct BrokerRuntimePaths: Equatable, Sendable {
    public static let installedSupportRoot = URL(
        fileURLWithPath: "/Users/arthur/Library/Application Support/RemoteAuthBroker",
        isDirectory: true
    )

    public let supportRootURL: URL
    public let policyURL: URL
    public let stateDirectoryURL: URL
    public let knownHostsURL: URL
    public let browserConfigurationURL: URL
    public let browserRuntimeDirectoryURL: URL
    public let sourceBuildDigestURL: URL
    public let gdmPreparedPolicyURL: URL
    public let gdmActivationBundleURL: URL
    public let gdmPreparationStateURL: URL

    public init(supportRootURL: URL = BrokerRuntimePaths.installedSupportRoot) {
        self.supportRootURL = supportRootURL
        policyURL = supportRootURL.appendingPathComponent("config/policy.json", isDirectory: false)
        stateDirectoryURL = supportRootURL.appendingPathComponent("state", isDirectory: true)
        knownHostsURL = supportRootURL.appendingPathComponent("config/known_hosts", isDirectory: false)
        browserConfigurationURL = supportRootURL.appendingPathComponent(
            "config/browser-controller.json",
            isDirectory: false
        )
        browserRuntimeDirectoryURL = supportRootURL.appendingPathComponent("run/browser", isDirectory: true)
        sourceBuildDigestURL = supportRootURL.appendingPathComponent(
            "current/source-build-digest",
            isDirectory: false
        )
        gdmPreparedPolicyURL = supportRootURL.appendingPathComponent(
            "config/gdm-prepared-policy.json",
            isDirectory: false
        )
        gdmActivationBundleURL = supportRootURL.appendingPathComponent(
            "config/gdm-activation-bundle.json",
            isDirectory: false
        )
        gdmPreparationStateURL = supportRootURL.appendingPathComponent(
            "state/gdm-preparation.json",
            isDirectory: false
        )
    }
}

public final class PolicyConfigurationStore: @unchecked Sendable {
    private let paths: BrokerRuntimePaths

    public init(paths: BrokerRuntimePaths = BrokerRuntimePaths()) {
        self.paths = paths
    }

    public func load() throws -> LoadedPolicy {
        try validateSupportRoot()
        return try PolicyLoader.load(OwnerOnlyRuntimeFile.readPolicy(at: paths.policyURL))
    }

    @discardableResult
    public func installReviewedPolicy(
        _ sourceData: Data,
        evidence: BiometricEvidence
    ) throws -> LoadedPolicy {
        let candidate = try PolicyLoader.load(sourceData)
        guard candidate.document.permitsEffects else {
            throw RuntimeBootstrapError.invalidPolicyState
        }
        _ = try load()
        let context = try evidence.consumeAuthenticatedContext(allowing: [.reEnable])
        defer { context.invalidate() }
        try replacePolicy(with: candidate.canonicalData)
        return candidate
    }

    @discardableResult
    public func deactivate(evidence: BiometricEvidence) throws -> LoadedPolicy {
        let current = try load()
        let inactive = try Self.inactivePolicy(from: current.document)
        let context = try evidence.consumeAuthenticatedContext(allowing: [.destructiveOneShot])
        defer { context.invalidate() }
        try replacePolicy(with: inactive.canonicalData)
        return inactive
    }

    public static func inactivePolicy(from current: BrokerPolicy) throws -> LoadedPolicy {
        var document = current
        document.canonicalStatus = .designInactive
        document.active = false
        document.policyDigest = BrokerPolicy.inactiveDigestPlaceholder
        document.policyDigestState = .inactivePlaceholder
        document.maximumBiometricAgeMilliseconds = 0
        document.brokerIdentity = BrokerIdentityPolicy(
            signingIdentifier: "INACTIVE",
            teamIdentifier: "INACTIVE",
            designatedRequirement: "INACTIVE-NO-REQUIREMENT",
            executableSHA256: BrokerPolicy.inactiveDigestPlaceholder,
            buildDigest: BrokerPolicy.inactiveDigestPlaceholder
        )
        document.caller = CallerPolicy(
            uid: UInt32.max,
            codeIdentity: "INACTIVE-NO-CALLER",
            buildDigest: BrokerPolicy.inactiveDigestPlaceholder
        )
        document.reviewer.reviewedPolicyModel = "INACTIVE"
        document.reviewer.promptPolicyDigest = BrokerPolicy.inactiveDigestPlaceholder
        document.reviewer.reviewerBuildDigest = BrokerPolicy.inactiveDigestPlaceholder
        document.jetKVM.chromeExecutablePath = nil
        document.jetKVM.profileDirectoryPath = nil
        document.jetKVM.deviceId = nil
        document.jetKVM.tlsSPKISHA256 = nil
        document.jetKVM.frontendAssetManifestSHA256 = nil
        document.jetKVM.vendoredFrontendCommit = nil
        document.jetKVM.vendoredFrontendDigest = nil
        document.jetKVM.launchTimeoutSeconds = nil
        document.jetKVM.cdpTimeoutSeconds = nil
        document.jetKVM.readinessTimeoutSeconds = nil
        document.jetKVM.replacementGraceSeconds = nil
        document.jetKVM.keyIntervalSeconds = nil
        document.jetKVM.maximumCDPMessageBytes = nil
        document.jetKVM.maximumCDPJSONDepth = nil
        document.jetKVM.maximumCDPJSONNodes = nil
        document.jetKVM.maximumCDPJSONStringBytes = nil
        document.jetKVM.maximumQueuedEvents = nil
        document.jetKVM.maximumQueuedEventBytes = nil
        document.verifiers = VerifierPolicy(gdm: nil, sudo: nil)
        document.authorityKeys = AuthorityKeysPolicy(
            desktopBrowserSigningKeyId: nil,
            sudoSigningKeyId: nil
        )
        document.trustedOmpCallers = []
        document.operations = []
        document.actions = []
        document.credentialTargets = []
        return try PolicyLoader.load(document: document)
    }

    private func validateSupportRoot() throws {
        let descriptor = try OwnerOnlyRuntimeFile.openOwnerOnlyDirectory(at: paths.supportRootURL)
        Darwin.close(descriptor)
    }

    private func replacePolicy(with data: Data) throws {
        guard !data.isEmpty, data.count <= PolicyLoader.maximumPolicyBytes else {
            throw RuntimeBootstrapError.unsafePolicy
        }
        try validateSupportRoot()
        let directoryURL = paths.policyURL.deletingLastPathComponent()
        let directory = try OwnerOnlyRuntimeFile.openOwnerOnlyDirectory(at: directoryURL)
        defer { Darwin.close(directory) }

        let fileName = paths.policyURL.lastPathComponent
        guard fileName == "policy.json" else { throw RuntimeBootstrapError.unsafePath }
        let temporaryName = ".policy.\(getpid()).\(UUID().uuidString).tmp"
        let descriptor = Darwin.openat(
            directory,
            temporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            0o600
        )
        guard descriptor >= 0 else { throw RuntimeBootstrapError.ioFailure }

        var committed = false
        defer {
            Darwin.close(descriptor)
            if !committed {
                _ = Darwin.unlinkat(directory, temporaryName, 0)
            }
        }
        guard Darwin.fchmod(descriptor, 0o600) == 0 else {
            throw RuntimeBootstrapError.ioFailure
        }
        try OwnerOnlyRuntimeFile.writeAll(data, to: descriptor)
        guard Darwin.fsync(descriptor) == 0 else { throw RuntimeBootstrapError.ioFailure }

        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              status.st_uid == geteuid(),
              (status.st_mode & 0o7777) == 0o600,
              status.st_nlink == 1,
              status.st_size == off_t(data.count)
        else {
            throw RuntimeBootstrapError.ioFailure
        }
        guard Darwin.renameat(directory, temporaryName, directory, fileName) == 0,
              Darwin.fsync(directory) == 0
        else {
            throw RuntimeBootstrapError.ioFailure
        }
        committed = true
    }

    func restorePolicy(_ sourceData: Data) throws {
        let candidate = try PolicyLoader.load(sourceData)
        try replacePolicy(with: candidate.canonicalData)
    }
}

public final class ActiveRuntimeDependencies: @unchecked Sendable {
    public let policy: LoadedPolicy
    public let runtimeIdentity: RuntimeIdentity
    public let stateStore: SecureStateStore<AuthorityState>
    public let keychainAuthority: KeychainAuthority
    public let biometricAuthority: BiometricAuthority
    public let gdmEndpoint: RemoteEndpointClient
    public let sudoEndpoint: RemoteEndpointClient?
    public let jetKVMController: RemoteAuthJetKVMCloudController

    fileprivate init(
        policy: LoadedPolicy,
        runtimeIdentity: RuntimeIdentity,
        stateStore: SecureStateStore<AuthorityState>,
        keychainAuthority: KeychainAuthority,
        biometricAuthority: BiometricAuthority,
        gdmEndpoint: RemoteEndpointClient,
        sudoEndpoint: RemoteEndpointClient?,
        jetKVMController: RemoteAuthJetKVMCloudController
    ) {
        self.policy = policy
        self.runtimeIdentity = runtimeIdentity
        self.stateStore = stateStore
        self.keychainAuthority = keychainAuthority
        self.biometricAuthority = biometricAuthority
        self.gdmEndpoint = gdmEndpoint
        self.sudoEndpoint = sudoEndpoint
        self.jetKVMController = jetKVMController
    }
}

public struct RuntimeBootstrap: Sendable {
    public let paths: BrokerRuntimePaths
    public let ownershipProvider: any LivePeerOwnershipProviding

    public init(
        paths: BrokerRuntimePaths = BrokerRuntimePaths(),
        ownershipProvider: any LivePeerOwnershipProviding = LiveOwnershipProvider()
    ) {
        self.paths = paths
        self.ownershipProvider = ownershipProvider
    }

    public func makeService() throws -> BrokerService {
        let store = PolicyConfigurationStore(paths: paths)
        let policy = try store.load()
        guard policy.document.permitsEffects else {
            guard !policy.document.active,
                  policy.document.canonicalStatus == .designInactive,
                  policy.document.policyDigestState == .inactivePlaceholder
            else {
                throw RuntimeBootstrapError.invalidPolicyState
            }
            return BrokerService(
                active: false,
                statusProvider: RuntimeStatusProvider(
                    paths: paths,
                    bootPolicy: policy,
                    dependencies: nil
                )
            )
        }

        let runtimeIdentity = try RunningRuntimeAttestor.attest(policy: policy.document)
        let dependencies = try constructActiveDependencies(
            policy: policy,
            runtimeIdentity: runtimeIdentity
        )
        let peerValidator = ExactBrokerPeerValidator(
            policy: policy.document,
            ownership: ownershipProvider
        )
        let jetKVMActuator = CloudJetKVMSentinelActuator(
            controller: dependencies.jetKVMController
        )
        let coordinator = ExecutionCoordinator(
            policy: policy,
            runtime: runtimeIdentity,
            stateStore: dependencies.stateStore,
            keychain: dependencies.keychainAuthority,
            biometric: dependencies.biometricAuthority,
            peerValidator: peerValidator,
            gdmEndpoint: dependencies.gdmEndpoint,
            sudoEndpoint: dependencies.sudoEndpoint,
            jetKVM: jetKVMActuator,
            browser: nil
        )
        return BrokerService(
            active: true,
            executor: coordinator,
            controls: coordinator,
            statusProvider: RuntimeStatusProvider(
                paths: paths,
                bootPolicy: policy,
                dependencies: dependencies,
                jetKVM: jetKVMActuator
            )
        )
    }

    private func constructActiveDependencies(
        policy: LoadedPolicy,
        runtimeIdentity: RuntimeIdentity
    ) throws -> ActiveRuntimeDependencies {
        guard let gdm = policy.document.verifiers.gdm,
              gdm.forcedPrincipal == RemoteForcedPrincipal.gdm.rawValue
        else {
            throw RuntimeBootstrapError.invalidPolicyState
        }

        let stateStore = try SecureStateStore<AuthorityState>(
            directoryURL: paths.stateDirectoryURL,
            fileName: "authority-state.json"
        )
        _ = try stateStore.read()


        let gdmEndpoint = RemoteEndpointClient(configuration: try RemoteEndpointConfiguration(
            endpoint: gdm.endpoint,
            forcedPrincipal: .gdm,
            pinnedHostKeySHA256: gdm.pinnedHostKeySHA256,
            knownHostsFile: paths.knownHostsURL.path
        ))
        let sudoEndpoint = try policy.document.verifiers.sudo.map { sudo in
            guard sudo.forcedPrincipal == RemoteForcedPrincipal.sudo.rawValue else {
                throw RuntimeBootstrapError.invalidPolicyState
            }
            return RemoteEndpointClient(configuration: try RemoteEndpointConfiguration(
                endpoint: sudo.endpoint,
                forcedPrincipal: .sudo,
                pinnedHostKeySHA256: sudo.pinnedHostKeySHA256,
                knownHostsFile: paths.knownHostsURL.path
            ))
        }
        guard let jetKVMConfiguration = policy.document.jetKVM.activeConfiguration else {
            throw RuntimeBootstrapError.invalidPolicyState
        }
        let jetKVMController = try RemoteAuthJetKVMCloudController(
            configuration: jetKVMConfiguration
        )

        return ActiveRuntimeDependencies(
            policy: policy,
            runtimeIdentity: runtimeIdentity,
            stateStore: stateStore,
            keychainAuthority: KeychainAuthority(),
            biometricAuthority: BiometricAuthority(),
            gdmEndpoint: gdmEndpoint,
            sudoEndpoint: sudoEndpoint,
            jetKVMController: jetKVMController
        )
    }

}

struct RuntimeGDMReadiness: Equatable, Sendable {
    let endpoint: EndpointStatus
    let controllerGeneration: UInt64?

    var isReady: Bool { endpoint.ready }

    static func evaluate(
        socketPosture: SocketPosture,
        keychainMetadataReady: Bool,
        remoteEndpointReady: Bool,
        controllerGeneration: UInt64?
    ) -> Self {
        guard socketPosture == .ownerOnly,
              keychainMetadataReady,
              remoteEndpointReady,
              let controllerGeneration,
              controllerGeneration > 0
        else {
            return Self(
                endpoint: EndpointStatus(ready: false, errorCode: .unavailable),
                controllerGeneration: nil
            )
        }
        return Self(
            endpoint: EndpointStatus(ready: true, errorCode: nil),
            controllerGeneration: controllerGeneration
        )
    }
}

public final class RuntimeStatusProvider: BrokerPublicStatusProviding, @unchecked Sendable {
    private let paths: BrokerRuntimePaths
    private let bootPolicy: LoadedPolicy
    private let dependencies: ActiveRuntimeDependencies?
    private let jetKVM: CloudJetKVMSentinelActuator?

    public init(
        paths: BrokerRuntimePaths,
        bootPolicy: LoadedPolicy,
        dependencies: ActiveRuntimeDependencies?,
        jetKVM: CloudJetKVMSentinelActuator? = nil
    ) {
        self.paths = paths
        self.bootPolicy = bootPolicy
        self.dependencies = dependencies
        self.jetKVM = jetKVM
    }

    public func status(socketPosture: SocketPosture, pid: UInt32) throws -> PublicStatusMetadata {
        let current: LoadedPolicy
        do {
            current = try PolicyConfigurationStore(paths: paths).load()
        } catch {
            return try makeStatus(
                canonicalStatus: .degraded,
                policyDigest: nil,
                socketPosture: socketPosture,
                pid: pid,
                endpointError: .integrityFailure,
                errors: [.integrityFailure]
            )
        }

        guard current.document.permitsEffects else {
            return try makeStatus(
                canonicalStatus: .designInactive,
                policyDigest: nil,
                socketPosture: socketPosture,
                pid: pid,
                endpointError: .inactive,
                errors: [.inactive]
            )
        }
        guard current.digest == bootPolicy.digest,
              let dependencies,
              dependencies.policy.digest == current.digest
        else {
            return try makeStatus(
                canonicalStatus: .degraded,
                policyDigest: current.digest,
                socketPosture: socketPosture,
                pid: pid,
                endpointError: .integrityFailure,
                errors: [.integrityFailure]
            )
        }

        let state: AuthorityState?
        do {
            state = try dependencies.stateStore.read()
        } catch {
            return try makeStatus(
                canonicalStatus: .degraded,
                policyDigest: current.digest,
                socketPosture: socketPosture,
                pid: pid,
                endpointError: .integrityFailure,
                errors: [.integrityFailure]
            )
        }
        if state?.emergency.disabled == true {
            return try makeStatus(
                canonicalStatus: .disabled,
                policyDigest: current.digest,
                socketPosture: socketPosture,
                pid: pid,
                endpointError: .disabled,
                errors: [.disabled]
            )
        }

        let keychainMetadataReady = Self.keychainMetadataReady(dependencies.keychainAuthority)
        let remoteEndpointReady: Bool
        do {
            try dependencies.gdmEndpoint.probeGDM(policyDigest: current.digest)
            remoteEndpointReady = true
        } catch {
            remoteEndpointReady = false
        }
        let controllerGeneration: UInt64?
        if socketPosture == .ownerOnly, let jetKVM {
            controllerGeneration = try? Self.waitForAsync {
                try await jetKVM.prepare()
            }
        } else {
            controllerGeneration = nil
        }
        let readiness = RuntimeGDMReadiness.evaluate(
            socketPosture: socketPosture,
            keychainMetadataReady: keychainMetadataReady,
            remoteEndpointReady: remoteEndpointReady,
            controllerGeneration: controllerGeneration
        )
        let unavailable = EndpointStatus(ready: false, errorCode: .unavailable)
        let status = PublicStatusMetadata(
            canonicalStatus: readiness.isReady ? .active : .degraded,
            policyDigest: current.digest,
            installedBuildDigest: dependencies.runtimeIdentity.buildDigest,
            runningBuildDigest: dependencies.runtimeIdentity.buildDigest,
            codeIdentity: dependencies.runtimeIdentity.codeIdentity,
            pid: pid,
            socketPosture: socketPosture,
            jetkvmControllerGeneration: readiness.controllerGeneration,
            gdm: readiness.endpoint,
            browser: unavailable,
            sudo: unavailable,
            errors: readiness.isReady ? [] : [.unavailable]
        )
        try status.validate()
        return status
    }

    private static func keychainMetadataReady(_ keychain: KeychainAuthority) -> Bool {
        do {
            guard try keychain.gdmCredentialStatus() == .enrolled(kind: .gdmPassword) else {
                return false
            }
            guard case .provisioned = try keychain.signingKeyStatus(domain: .desktopBrowser) else {
                return false
            }
            return true
        } catch {
            return false
        }
    }

    private static func waitForAsync<T: Sendable>(
        _ operation: @escaping @Sendable () async throws -> T
    ) throws -> T {
        let result = RuntimeAsyncResult<T>()
        let semaphore = DispatchSemaphore(value: 0)
        Task.detached {
            do { result.store(.success(try await operation())) }
            catch { result.store(.failure(error)) }
            semaphore.signal()
        }
        semaphore.wait()
        return try result.take().get()
    }

    private func makeStatus(
        canonicalStatus: CanonicalBrokerStatus,
        policyDigest: String?,
        socketPosture: SocketPosture,
        pid: UInt32,
        endpointError: PublicError,
        errors: [PublicError]
    ) throws -> PublicStatusMetadata {
        let unavailable = EndpointStatus(ready: false, errorCode: endpointError)
        let status = PublicStatusMetadata(
            canonicalStatus: canonicalStatus,
            policyDigest: policyDigest,
            installedBuildDigest: dependencies?.runtimeIdentity.buildDigest,
            runningBuildDigest: dependencies?.runtimeIdentity.buildDigest,
            codeIdentity: dependencies?.runtimeIdentity.codeIdentity,
            pid: pid,
            socketPosture: socketPosture,
            jetkvmControllerGeneration: nil,
            gdm: unavailable,
            browser: unavailable,
            sudo: unavailable,
            errors: errors
        )
        try status.validate()
        return status
    }
}

private final class RuntimeAsyncResult<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Result<Value, Error>?

    func store(_ value: Result<Value, Error>) {
        lock.lock()
        self.value = value
        lock.unlock()
    }

    func take() -> Result<Value, Error> {
        lock.lock()
        defer { lock.unlock() }
        return value!
    }
}

enum OwnerOnlyRuntimeFile {
    static func readPolicy(at url: URL) throws -> Data {
        guard url.isFileURL,
              url.path.hasPrefix("/"),
              ["policy.json", "browser-controller.json", "gdm-prepared-policy.json",
               "gdm-activation-bundle.json", "gdm-preparation.json"].contains(url.lastPathComponent)
        else {
            throw RuntimeBootstrapError.unsafePath
        }
        let directory = try openOwnerOnlyDirectory(at: url.deletingLastPathComponent())
        defer { Darwin.close(directory) }
        let descriptor = Darwin.openat(directory, url.lastPathComponent, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw RuntimeBootstrapError.unsafePolicy }
        defer { Darwin.close(descriptor) }

        var before = stat()
        guard Darwin.fstat(descriptor, &before) == 0,
              (before.st_mode & S_IFMT) == S_IFREG,
              before.st_uid == geteuid(),
              (before.st_mode & 0o7777) == 0o600,
              before.st_nlink == 1,
              before.st_size > 0,
              before.st_size <= off_t(PolicyLoader.maximumPolicyBytes)
        else {
            throw RuntimeBootstrapError.unsafePolicy
        }
        let data = try readExactly(Int(before.st_size), from: descriptor)
        var extra: UInt8 = 0
        guard Darwin.read(descriptor, &extra, 1) == 0 else {
            throw RuntimeBootstrapError.unsafePolicy
        }
        var after = stat()
        guard Darwin.fstat(descriptor, &after) == 0,
              FileSnapshot(before) == FileSnapshot(after)
        else {
            throw RuntimeBootstrapError.unsafePolicy
        }
        return data
    }

    static func openOwnerOnlyDirectory(at url: URL) throws -> Int32 {
        guard url.isFileURL, url.path.hasPrefix("/") else {
            throw RuntimeBootstrapError.unsafePath
        }
        let descriptor = url.withUnsafeFileSystemRepresentation { path -> Int32 in
            guard let path else { return -1 }
            return Darwin.open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else { throw RuntimeBootstrapError.unsafePath }
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFDIR,
              status.st_uid == geteuid(),
              (status.st_mode & 0o7777) == 0o700
        else {
            Darwin.close(descriptor)
            throw RuntimeBootstrapError.unsafePath
        }
        return descriptor
    }

    static func writeAll(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(
                    descriptor,
                    bytes.baseAddress!.advanced(by: offset),
                    bytes.count - offset
                )
                if count > 0 {
                    offset += count
                    continue
                }
                if count < 0, errno == EINTR { continue }
                throw RuntimeBootstrapError.ioFailure
            }
        }
    }

    static func replace(_ data: Data, at url: URL) throws {
        guard !data.isEmpty,
              data.count <= PolicyLoader.maximumPolicyBytes,
              url.isFileURL,
              ["gdm-prepared-policy.json", "gdm-activation-bundle.json",
               "gdm-preparation.json"].contains(url.lastPathComponent)
        else {
            throw RuntimeBootstrapError.unsafePath
        }
        let directory = try openOwnerOnlyDirectory(at: url.deletingLastPathComponent())
        defer { Darwin.close(directory) }
        let temporaryName = ".gdm.\(getpid()).\(UUID().uuidString).tmp"
        let descriptor = Darwin.openat(
            directory,
            temporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            0o600
        )
        guard descriptor >= 0 else { throw RuntimeBootstrapError.ioFailure }
        var committed = false
        defer {
            Darwin.close(descriptor)
            if !committed {
                _ = Darwin.unlinkat(directory, temporaryName, 0)
            }
        }
        guard Darwin.fchmod(descriptor, 0o600) == 0 else {
            throw RuntimeBootstrapError.ioFailure
        }
        try writeAll(data, to: descriptor)
        guard Darwin.fsync(descriptor) == 0,
              Darwin.renameat(directory, temporaryName, directory, url.lastPathComponent) == 0,
              Darwin.fsync(directory) == 0
        else {
            throw RuntimeBootstrapError.ioFailure
        }
        committed = true
    }

    private static func readExactly(_ count: Int, from descriptor: Int32) throws -> Data {
        var data = Data(count: count)
        try data.withUnsafeMutableBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let result = Darwin.read(
                    descriptor,
                    bytes.baseAddress!.advanced(by: offset),
                    bytes.count - offset
                )
                if result > 0 {
                    offset += result
                    continue
                }
                if result < 0, errno == EINTR { continue }
                throw RuntimeBootstrapError.ioFailure
            }
        }
        return data
    }

    private struct FileSnapshot: Equatable {
        let device: UInt64
        let inode: UInt64
        let size: Int64
        let mode: UInt32
        let owner: UInt32
        let links: UInt64
        let modifiedSeconds: Int64
        let modifiedNanoseconds: Int64
        let changedSeconds: Int64
        let changedNanoseconds: Int64

        init(_ status: stat) {
            device = UInt64(truncatingIfNeeded: status.st_dev)
            inode = UInt64(truncatingIfNeeded: status.st_ino)
            size = Int64(status.st_size)
            mode = UInt32(status.st_mode)
            owner = UInt32(status.st_uid)
            links = UInt64(status.st_nlink)
            modifiedSeconds = Int64(status.st_mtimespec.tv_sec)
            modifiedNanoseconds = Int64(status.st_mtimespec.tv_nsec)
            changedSeconds = Int64(status.st_ctimespec.tv_sec)
            changedNanoseconds = Int64(status.st_ctimespec.tv_nsec)
        }
    }
}

private enum RunningRuntimeAttestor {
    static func attest(policy: BrokerPolicy) throws -> RuntimeIdentity {
        var dynamicCode: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &dynamicCode) == errSecSuccess,
              let dynamicCode,
              SecCodeCheckValidity(dynamicCode, SecCSFlags(), nil) == errSecSuccess
        else {
            throw RuntimeBootstrapError.runtimeIdentityUnavailable
        }

        var reviewedRequirement: SecRequirement?
        guard SecRequirementCreateWithString(
            policy.brokerIdentity.designatedRequirement as CFString,
            SecCSFlags(),
            &reviewedRequirement
        ) == errSecSuccess,
        let reviewedRequirement,
        SecCodeCheckValidity(dynamicCode, SecCSFlags(), reviewedRequirement) == errSecSuccess
        else {
            throw RuntimeBootstrapError.runtimeIdentityMismatch
        }

        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(dynamicCode, SecCSFlags(), &staticCode) == errSecSuccess,
              let staticCode
        else {
            throw RuntimeBootstrapError.runtimeIdentityUnavailable
        }
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation | kSecCSRequirementInformation)
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, flags, &information) == errSecSuccess,
              let values = information as NSDictionary?,
              let signingIdentifier = values[kSecCodeInfoIdentifier] as? String,
              let teamIdentifier = values[kSecCodeInfoTeamIdentifier] as? String,
              let executableURL = values[kSecCodeInfoMainExecutable] as? URL,
              let requirementObject = values[kSecCodeInfoDesignatedRequirement] as AnyObject?,
              CFGetTypeID(requirementObject) == SecRequirementGetTypeID()
        else {
            throw RuntimeBootstrapError.runtimeIdentityUnavailable
        }
        let requirement = unsafeBitCast(requirementObject, to: SecRequirement.self)
        var requirementText: CFString?
        guard SecRequirementCopyString(requirement, SecCSFlags(), &requirementText) == errSecSuccess,
              let designatedRequirement = requirementText as String?
        else {
            throw RuntimeBootstrapError.runtimeIdentityUnavailable
        }

        let executableDigest = try hashInstalledExecutable(at: executableURL)
        let buildDigestURL = executableURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("source-build-digest", isDirectory: false)
        let buildDigest = try readBuildDigest(at: buildDigestURL)
        guard signingIdentifier == policy.brokerIdentity.signingIdentifier,
              teamIdentifier == policy.brokerIdentity.teamIdentifier,
              designatedRequirement == policy.brokerIdentity.designatedRequirement,
              executableDigest == policy.brokerIdentity.executableSHA256,
              buildDigest == policy.brokerIdentity.buildDigest
        else {
            throw RuntimeBootstrapError.runtimeIdentityMismatch
        }
        return RuntimeIdentity(
            buildDigest: buildDigest,
            codeIdentity: signingIdentifier,
            codeDigest: executableDigest,
            teamIdentifier: teamIdentifier
        )
    }

    private static func hashInstalledExecutable(at url: URL) throws -> String {
        let descriptor = url.withUnsafeFileSystemRepresentation { path -> Int32 in
            guard let path else { return -1 }
            return Darwin.open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else { throw RuntimeBootstrapError.runtimeIdentityUnavailable }
        defer { Darwin.close(descriptor) }
        var before = stat()
        guard Darwin.fstat(descriptor, &before) == 0,
              (before.st_mode & S_IFMT) == S_IFREG,
              before.st_uid == geteuid(),
              (before.st_mode & 0o7777) == 0o555,
              before.st_nlink == 1,
              before.st_size > 0
        else {
            throw RuntimeBootstrapError.runtimeIdentityMismatch
        }

        var hasher = SHA256()
        var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
        while true {
            let count = buffer.withUnsafeMutableBytes {
                Darwin.read(descriptor, $0.baseAddress, $0.count)
            }
            if count > 0 {
                buffer.withUnsafeBytes {
                    hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: $0[..<count]))
                }
                continue
            }
            if count == 0 { break }
            if errno == EINTR { continue }
            throw RuntimeBootstrapError.ioFailure
        }
        var after = stat()
        guard Darwin.fstat(descriptor, &after) == 0,
              before.st_dev == after.st_dev,
              before.st_ino == after.st_ino,
              before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
        else {
            throw RuntimeBootstrapError.runtimeIdentityMismatch
        }
        return hexDigest(hasher.finalize())
    }

    private static func readBuildDigest(at url: URL) throws -> String {
        let descriptor = url.withUnsafeFileSystemRepresentation { path -> Int32 in
            guard let path else { return -1 }
            return Darwin.open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else { throw RuntimeBootstrapError.invalidBuildDigest }
        defer { Darwin.close(descriptor) }
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              status.st_uid == geteuid(),
              (status.st_mode & 0o7777) == 0o444,
              status.st_nlink == 1,
              (64...65).contains(Int(status.st_size))
        else {
            throw RuntimeBootstrapError.invalidBuildDigest
        }
        var bytes = [UInt8](repeating: 0, count: Int(status.st_size))
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
                throw RuntimeBootstrapError.invalidBuildDigest
            }
        }
        var after = stat()
        guard Darwin.fstat(descriptor, &after) == 0,
              status.st_dev == after.st_dev,
              status.st_ino == after.st_ino,
              status.st_size == after.st_size,
              status.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              status.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              status.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              status.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
        else {
            throw RuntimeBootstrapError.invalidBuildDigest
        }
        if bytes.last == 0x0a { bytes.removeLast() }
        guard bytes.count == 64,
              bytes.allSatisfy({ (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }),
              let value = String(bytes: bytes, encoding: .utf8)
        else {
            throw RuntimeBootstrapError.invalidBuildDigest
        }
        return value
    }

    private static func hexDigest<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        String(unsafeUninitializedCapacity: 64) { output in
            var index = 0
            for byte in digest {
                let high = byte >> 4
                let low = byte & 0x0f
                output[index] = high < 10 ? high + 0x30 : high + 0x57
                output[index + 1] = low < 10 ? low + 0x30 : low + 0x57
                index += 2
            }
            return index
        }
    }
}
