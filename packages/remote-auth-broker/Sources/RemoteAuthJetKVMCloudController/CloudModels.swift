import Foundation

public enum JetKVMCloudContract {

    public static let vendoredFrontendCommit = "fe77acd5f00300a4ab9acd5da57d7bb0916351d9"
    public static let vendoredFrontendDigest = "0ad51887f89bd16da9cec1931e9f3a982091881abdb7648e8de944f8306258d7"

    public static let defaultLaunchTimeoutSeconds = 30.0
    public static let defaultCDPTimeoutSeconds = 10.0
    public static let defaultReadinessTimeoutSeconds = 45.0
    public static let defaultReplacementGraceSeconds = 1.25
    public static let defaultKeyIntervalSeconds = 0.035
    public static let defaultMaximumCDPMessageBytes = 1_048_576
    public static let defaultMaximumCDPJSONDepth = 64
    public static let defaultMaximumCDPJSONNodes = 100_000
    public static let defaultMaximumCDPJSONStringBytes = 262_144
    public static let defaultMaximumQueuedEvents = 256
    public static let defaultMaximumQueuedEventBytes = 2_097_152
}

public enum JetKVMCloudError: String, Error, Codable, CaseIterable, Equatable, Sendable, CustomStringConvertible {
    case configurationInvalid = "configuration-invalid"
    case unavailable
    case timeout
    case cancelled
    case operationInProgress = "operation-in-progress"
    case transportRejected = "transport-rejected"
    case responseTooLarge = "response-too-large"
    case invalidJSON = "invalid-json"
    case cdpCommandRejected = "cdp-command-rejected"
    case cdpEvaluationRejected = "cdp-evaluation-rejected"
    case targetRejected = "target-rejected"
    case tlsIdentityRejected = "tls-identity-rejected"
    case frontendAttestationRejected = "frontend-attestation-rejected"
    case frontendNotReady = "frontend-not-ready"
    case loginRequired = "login-required"
    case takeoverRequired = "takeover-required"
    case leaseActive = "lease-active"
    case staleLease = "stale-lease"
    case recoveryRequired = "recovery-required"
    case invalidStateTransition = "invalid-state-transition"
    case sentinelInvalid = "sentinel-invalid"
    case inputDispatchRejected = "input-dispatch-rejected"
    case shutdown

    public var description: String { rawValue }
}

public struct JetKVMCloudConfiguration: Codable, Equatable, Sendable {
    public let chromeExecutablePath: String
    public let profileDirectoryPath: String
    public let deviceId: String
    public let tlsSPKISHA256: String
    public let frontendAssetManifestSHA256: String
    public let vendoredFrontendCommit: String
    public let vendoredFrontendDigest: String
    public let launchTimeoutSeconds: Double
    public let cdpTimeoutSeconds: Double
    public let readinessTimeoutSeconds: Double
    public let replacementGraceSeconds: Double
    public let keyIntervalSeconds: Double
    public let maximumCDPMessageBytes: Int
    public let maximumCDPJSONDepth: Int
    public let maximumCDPJSONNodes: Int
    public let maximumCDPJSONStringBytes: Int
    public let maximumQueuedEvents: Int
    public let maximumQueuedEventBytes: Int

    public var deviceURL: URL {
        URL(string: "https://app.jetkvm.com/devices/\(deviceId)")!
    }

    public init(
        chromeExecutablePath: String,
        profileDirectoryPath: String,
        deviceId: String,
        tlsSPKISHA256: String,
        frontendAssetManifestSHA256: String,
        vendoredFrontendCommit: String = JetKVMCloudContract.vendoredFrontendCommit,
        vendoredFrontendDigest: String = JetKVMCloudContract.vendoredFrontendDigest,
        launchTimeoutSeconds: Double = JetKVMCloudContract.defaultLaunchTimeoutSeconds,
        cdpTimeoutSeconds: Double = JetKVMCloudContract.defaultCDPTimeoutSeconds,
        readinessTimeoutSeconds: Double = JetKVMCloudContract.defaultReadinessTimeoutSeconds,
        replacementGraceSeconds: Double = JetKVMCloudContract.defaultReplacementGraceSeconds,
        keyIntervalSeconds: Double = JetKVMCloudContract.defaultKeyIntervalSeconds,
        maximumCDPMessageBytes: Int = JetKVMCloudContract.defaultMaximumCDPMessageBytes,
        maximumCDPJSONDepth: Int = JetKVMCloudContract.defaultMaximumCDPJSONDepth,
        maximumCDPJSONNodes: Int = JetKVMCloudContract.defaultMaximumCDPJSONNodes,
        maximumCDPJSONStringBytes: Int = JetKVMCloudContract.defaultMaximumCDPJSONStringBytes,
        maximumQueuedEvents: Int = JetKVMCloudContract.defaultMaximumQueuedEvents,
        maximumQueuedEventBytes: Int = JetKVMCloudContract.defaultMaximumQueuedEventBytes
    ) throws {
        self.chromeExecutablePath = chromeExecutablePath
        self.profileDirectoryPath = profileDirectoryPath
        self.deviceId = deviceId
        self.tlsSPKISHA256 = tlsSPKISHA256
        self.frontendAssetManifestSHA256 = frontendAssetManifestSHA256
        self.vendoredFrontendCommit = vendoredFrontendCommit
        self.vendoredFrontendDigest = vendoredFrontendDigest
        self.launchTimeoutSeconds = launchTimeoutSeconds
        self.cdpTimeoutSeconds = cdpTimeoutSeconds
        self.readinessTimeoutSeconds = readinessTimeoutSeconds
        self.replacementGraceSeconds = replacementGraceSeconds
        self.keyIntervalSeconds = keyIntervalSeconds
        self.maximumCDPMessageBytes = maximumCDPMessageBytes
        self.maximumCDPJSONDepth = maximumCDPJSONDepth
        self.maximumCDPJSONNodes = maximumCDPJSONNodes
        self.maximumCDPJSONStringBytes = maximumCDPJSONStringBytes
        self.maximumQueuedEvents = maximumQueuedEvents
        self.maximumQueuedEventBytes = maximumQueuedEventBytes
        try CloudConfigurationValidation.validate(self)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case chromeExecutablePath
        case profileDirectoryPath
        case deviceId
        case tlsSPKISHA256
        case frontendAssetManifestSHA256
        case vendoredFrontendCommit
        case vendoredFrontendDigest
        case launchTimeoutSeconds
        case cdpTimeoutSeconds
        case readinessTimeoutSeconds
        case replacementGraceSeconds
        case keyIntervalSeconds
        case maximumCDPMessageBytes
        case maximumCDPJSONDepth
        case maximumCDPJSONNodes
        case maximumCDPJSONStringBytes
        case maximumQueuedEvents
        case maximumQueuedEventBytes
    }

    public init(from decoder: Decoder) throws {
        try decoder.cloudRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            chromeExecutablePath: container.decode(String.self, forKey: .chromeExecutablePath),
            profileDirectoryPath: container.decode(String.self, forKey: .profileDirectoryPath),
            deviceId: container.decode(String.self, forKey: .deviceId),
            tlsSPKISHA256: container.decode(String.self, forKey: .tlsSPKISHA256),
            frontendAssetManifestSHA256: container.decode(
                String.self,
                forKey: .frontendAssetManifestSHA256
            ),
            vendoredFrontendCommit: container.decode(String.self, forKey: .vendoredFrontendCommit),
            vendoredFrontendDigest: container.decode(String.self, forKey: .vendoredFrontendDigest),
            launchTimeoutSeconds: container.decode(Double.self, forKey: .launchTimeoutSeconds),
            cdpTimeoutSeconds: container.decode(Double.self, forKey: .cdpTimeoutSeconds),
            readinessTimeoutSeconds: container.decode(Double.self, forKey: .readinessTimeoutSeconds),
            replacementGraceSeconds: container.decode(Double.self, forKey: .replacementGraceSeconds),
            keyIntervalSeconds: container.decode(Double.self, forKey: .keyIntervalSeconds),
            maximumCDPMessageBytes: container.decode(Int.self, forKey: .maximumCDPMessageBytes),
            maximumCDPJSONDepth: container.decode(Int.self, forKey: .maximumCDPJSONDepth),
            maximumCDPJSONNodes: container.decode(Int.self, forKey: .maximumCDPJSONNodes),
            maximumCDPJSONStringBytes: container.decode(Int.self, forKey: .maximumCDPJSONStringBytes),
            maximumQueuedEvents: container.decode(Int.self, forKey: .maximumQueuedEvents),
            maximumQueuedEventBytes: container.decode(Int.self, forKey: .maximumQueuedEventBytes)
        )
    }
}

public enum JetKVMCloudPhase: String, Codable, CaseIterable, Equatable, Sendable {
    case idle
    case connecting
    case ready
    case leased
    case recoveryRequired = "recovery-required"
    case shutdown
}

public struct JetKVMCloudLease: Equatable, Sendable {
    public let generation: UInt64

    init(generation: UInt64) {
        self.generation = generation
    }
}

public struct JetKVMCloudStatus: Codable, Equatable, Sendable {
    public let phase: JetKVMCloudPhase
    public let generation: UInt64
    public let processActive: Bool
    public let targetActive: Bool
    public let frontendAttested: Bool

    init(
        phase: JetKVMCloudPhase,
        generation: UInt64,
        processActive: Bool,
        targetActive: Bool,
        frontendAttested: Bool
    ) {
        self.phase = phase
        self.generation = generation
        self.processActive = processActive
        self.targetActive = targetActive
        self.frontendAttested = frontendAttested
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case phase
        case generation
        case processActive
        case targetActive
        case frontendAttested
    }

    public init(from decoder: Decoder) throws {
        try decoder.cloudRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            phase: try container.decode(JetKVMCloudPhase.self, forKey: .phase),
            generation: try container.decode(UInt64.self, forKey: .generation),
            processActive: try container.decode(Bool.self, forKey: .processActive),
            targetActive: try container.decode(Bool.self, forKey: .targetActive),
            frontendAttested: try container.decode(Bool.self, forKey: .frontendAttested)
        )
    }
}

public enum JetKVMCloudReceiptDisposition: String, Codable, CaseIterable, Equatable, Sendable {
    case sentinelTyped = "sentinel-typed"
    case released
    case staleLease = "stale-lease"
    case interrupted
    case shutdown
}

public struct JetKVMCloudReceipt: Codable, Equatable, Sendable {
    public let disposition: JetKVMCloudReceiptDisposition
    public let generation: UInt64

    init(disposition: JetKVMCloudReceiptDisposition, generation: UInt64) {
        self.disposition = disposition
        self.generation = generation
    }

    static func sentinelTyped(for lease: JetKVMCloudLease) -> Self {
        Self(disposition: .sentinelTyped, generation: lease.generation)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case disposition
        case generation
    }

    public init(from decoder: Decoder) throws {
        try decoder.cloudRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            disposition: try container.decode(JetKVMCloudReceiptDisposition.self, forKey: .disposition),
            generation: try container.decode(UInt64.self, forKey: .generation)
        )
    }
}

struct CloudControllerStateMachine: Equatable, Sendable {
    private(set) var phase: JetKVMCloudPhase = .idle
    private(set) var generation: UInt64 = 0
    private var activeGeneration: UInt64?
    private var lastReleasedGeneration: UInt64?

    var status: JetKVMCloudStatus {
        JetKVMCloudStatus(
            phase: phase,
            generation: generation,
            processActive: false,
            targetActive: false,
            frontendAttested: false
        )
    }

    mutating func beginConnecting() throws {
        guard phase == .idle else {
            if phase == .recoveryRequired { throw JetKVMCloudError.recoveryRequired }
            if phase == .leased { throw JetKVMCloudError.leaseActive }
            if phase == .shutdown { throw JetKVMCloudError.shutdown }
            throw JetKVMCloudError.invalidStateTransition
        }
        phase = .connecting
    }

    mutating func markReady() throws {
        guard phase == .connecting else {
            if phase == .recoveryRequired { throw JetKVMCloudError.recoveryRequired }
            if phase == .shutdown { throw JetKVMCloudError.shutdown }
            throw JetKVMCloudError.invalidStateTransition
        }
        phase = .ready
    }

    mutating func acquireLease() throws -> JetKVMCloudLease {
        guard phase == .ready else {
            if phase == .leased { throw JetKVMCloudError.leaseActive }
            if phase == .recoveryRequired { throw JetKVMCloudError.recoveryRequired }
            if phase == .shutdown { throw JetKVMCloudError.shutdown }
            throw JetKVMCloudError.invalidStateTransition
        }
        guard generation < UInt64.max else {
            phase = .recoveryRequired
            throw JetKVMCloudError.invalidStateTransition
        }
        generation += 1
        activeGeneration = generation
        phase = .leased
        return JetKVMCloudLease(generation: generation)
    }

    func validate(_ lease: JetKVMCloudLease) throws {
        guard phase == .leased, activeGeneration == lease.generation else {
            if phase == .recoveryRequired { throw JetKVMCloudError.recoveryRequired }
            if phase == .shutdown { throw JetKVMCloudError.shutdown }
            throw JetKVMCloudError.staleLease
        }
    }

    mutating func release(_ lease: JetKVMCloudLease) -> JetKVMCloudReceipt {
        if phase == .shutdown {
            return JetKVMCloudReceipt(disposition: .shutdown, generation: generation)
        }
        if phase == .recoveryRequired {
            return JetKVMCloudReceipt(disposition: .interrupted, generation: generation)
        }
        if phase == .idle, lastReleasedGeneration == lease.generation {
            return JetKVMCloudReceipt(disposition: .released, generation: lease.generation)
        }
        guard phase == .leased, activeGeneration == lease.generation else {
            return JetKVMCloudReceipt(disposition: .staleLease, generation: generation)
        }
        activeGeneration = nil
        lastReleasedGeneration = lease.generation
        phase = .idle
        return JetKVMCloudReceipt(disposition: .released, generation: lease.generation)
    }

    mutating func recordInterruption() {
        guard phase != .idle, phase != .shutdown else { return }
        activeGeneration = nil
        phase = .recoveryRequired
    }

    mutating func beginRecovery() throws {
        guard phase == .recoveryRequired else {
            if phase == .shutdown { throw JetKVMCloudError.shutdown }
            throw JetKVMCloudError.invalidStateTransition
        }
        phase = .connecting
    }

    mutating func shutdown() {
        activeGeneration = nil
        phase = .shutdown
    }
}

internal enum CloudConfigurationValidation {
    static func validate(_ configuration: JetKVMCloudConfiguration) throws {
        guard isAbsoluteNULFreePath(configuration.chromeExecutablePath),
              isAbsoluteNULFreePath(configuration.profileDirectoryPath),
              isConservativeDeviceID(configuration.deviceId),
              configuration.vendoredFrontendCommit == JetKVMCloudContract.vendoredFrontendCommit,
              configuration.vendoredFrontendDigest == JetKVMCloudContract.vendoredFrontendDigest,
              isSHA256Hex(configuration.tlsSPKISHA256),
              isSHA256Hex(configuration.frontendAssetManifestSHA256),
              configuration.launchTimeoutSeconds.isFinite,
              (1.0...120.0).contains(configuration.launchTimeoutSeconds),
              configuration.cdpTimeoutSeconds.isFinite,
              (0.25...60.0).contains(configuration.cdpTimeoutSeconds),
              configuration.readinessTimeoutSeconds.isFinite,
              (1.0...180.0).contains(configuration.readinessTimeoutSeconds),
              configuration.readinessTimeoutSeconds >= configuration.cdpTimeoutSeconds,
              configuration.replacementGraceSeconds.isFinite,
              configuration.replacementGraceSeconds > 1.0,
              configuration.replacementGraceSeconds <= 30.0,
              configuration.keyIntervalSeconds.isFinite,
              (0.02...0.25).contains(configuration.keyIntervalSeconds),
              (4_096...4_194_304).contains(configuration.maximumCDPMessageBytes),
              (4...128).contains(configuration.maximumCDPJSONDepth),
              (256...250_000).contains(configuration.maximumCDPJSONNodes),
              (256...1_048_576).contains(configuration.maximumCDPJSONStringBytes),
              configuration.maximumCDPJSONStringBytes <= configuration.maximumCDPMessageBytes,
              (1...4_096).contains(configuration.maximumQueuedEvents),
              (4_096...16_777_216).contains(configuration.maximumQueuedEventBytes),
              configuration.maximumQueuedEventBytes >= configuration.maximumCDPMessageBytes
        else {
            throw JetKVMCloudError.configurationInvalid
        }
    }

    private static func isAbsoluteNULFreePath(_ value: String) -> Bool {
        let bytes = value.utf8
        return (1...4_096).contains(bytes.count)
            && bytes.first == 0x2f
            && !bytes.contains(0)
    }

    private static func isConservativeDeviceID(_ value: String) -> Bool {
        let bytes = value.utf8
        guard (1...128).contains(bytes.count) else { return false }
        return bytes.allSatisfy {
            ($0 >= 0x41 && $0 <= 0x5a)
                || ($0 >= 0x61 && $0 <= 0x7a)
                || ($0 >= 0x30 && $0 <= 0x39)
                || $0 == 0x2d
                || $0 == 0x5f
        }
    }

    private static func isSHA256Hex(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66)
        }
    }
}


private struct CloudAnyCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private extension Decoder {
    func cloudRejectUnknownKeys<Key>(_ keyType: Key.Type) throws
    where Key: CodingKey & CaseIterable {
        let container = try self.container(keyedBy: CloudAnyCodingKey.self)
        for key in container.allKeys {
            guard Key.allCases.contains(where: { $0.stringValue == key.stringValue }) else {
                throw JetKVMCloudError.invalidJSON
            }
        }
    }
}
