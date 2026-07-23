import Foundation
import RemoteAuthProtocol
import RemoteAuthJetKVMCloudController

public enum PolicyLoadError: Error, Equatable, Sendable {
    case empty
    case tooLarge
    case invalidSchemaVersion
    case invalidActivationState
    case digestMismatch
    case invalidValue(String)
    case duplicateOperation
    case duplicateAction
    case duplicateCaller
    case duplicateCredentialTarget
    case missingOperation
}

public enum PolicySchemaVersion: String, Codable, Sendable {
    case policyV1 = "policy-v1"
}

public enum PolicyDigestState: String, Codable, Sendable {
    case inactivePlaceholder = "inactive-placeholder"
    case reviewed

    // Source compatibility for callers written before the schema named this state.
    public static let published = PolicyDigestState.reviewed
}

public enum BiometricPolicy: String, Codable, Sendable {
    case standingGrantOrOneShot = "grant-issuance"
    case freshOneShotRequired = "destructive-one-shot"
}

public struct BrokerIdentityPolicy: Codable, Sendable {
    public var signingIdentifier: String
    public var teamIdentifier: String
    public var designatedRequirement: String
    public var executableSHA256: String
    public var buildDigest: String

    public init(
        signingIdentifier: String,
        teamIdentifier: String,
        designatedRequirement: String = "INACTIVE-NO-REQUIREMENT",
        executableSHA256: String,
        buildDigest: String? = nil
    ) {
        self.signingIdentifier = signingIdentifier
        self.teamIdentifier = teamIdentifier
        self.designatedRequirement = designatedRequirement
        self.executableSHA256 = executableSHA256
        self.buildDigest = buildDigest ?? executableSHA256
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case signingIdentifier, teamIdentifier, designatedRequirement, executableSHA256, buildDigest
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        signingIdentifier = try container.decode(String.self, forKey: .signingIdentifier)
        teamIdentifier = try container.decode(String.self, forKey: .teamIdentifier)
        designatedRequirement = try container.decode(String.self, forKey: .designatedRequirement)
        executableSHA256 = try container.decode(String.self, forKey: .executableSHA256)
        buildDigest = try container.decode(String.self, forKey: .buildDigest)
    }
}

public struct CallerPolicy: Codable, Sendable {
    public var uid: UInt32
    public var codeIdentity: String
    public var buildDigest: String

    public init(uid: UInt32, codeIdentity: String, buildDigest: String) {
        self.uid = uid
        self.codeIdentity = codeIdentity
        self.buildDigest = buildDigest
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case uid, codeIdentity, buildDigest }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uid = try container.decode(UInt32.self, forKey: .uid)
        codeIdentity = try container.decode(String.self, forKey: .codeIdentity)
        buildDigest = try container.decode(String.self, forKey: .buildDigest)
    }
}

public struct SocketPolicy: Codable, Sendable {
    public static let canonicalBrokerSocketPath = "/Users/arthur/Library/Application Support/RemoteAuthBroker/run/remote-authd.sock"
    public static let canonicalBrowserControllerSocketPath = "/Users/arthur/Library/Application Support/RemoteAuthBroker/run/browser-controller.sock"

    public var brokerSocketPath: String
    public var browserControllerSocketPath: String

    public init(brokerSocketPath: String, browserControllerSocketPath: String) {
        self.brokerSocketPath = brokerSocketPath
        self.browserControllerSocketPath = browserControllerSocketPath
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case brokerSocketPath, browserControllerSocketPath }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        brokerSocketPath = try container.decode(String.self, forKey: .brokerSocketPath)
        browserControllerSocketPath = try container.decode(String.self, forKey: .browserControllerSocketPath)
    }
}

public struct OperationPolicy: Codable, Sendable {
    public var domain: AuthorizationDomain
    public var operation: AuthorizationOperation
    public var risk: RiskLevel
    public var biometricPolicy: BiometricPolicy
    public var maximumGrantLifetimeMilliseconds: UInt64

    public init(domain: AuthorizationDomain, operation: AuthorizationOperation, risk: RiskLevel, biometricPolicy: BiometricPolicy, maximumGrantLifetimeMilliseconds: UInt64) {
        self.domain = domain
        self.operation = operation
        self.risk = risk
        self.biometricPolicy = biometricPolicy
        self.maximumGrantLifetimeMilliseconds = maximumGrantLifetimeMilliseconds
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case domain, operation, risk, biometricPolicy, maximumGrantLifetimeMilliseconds
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        domain = try container.decode(AuthorizationDomain.self, forKey: .domain)
        operation = try container.decode(AuthorizationOperation.self, forKey: .operation)
        risk = try container.decode(RiskLevel.self, forKey: .risk)
        biometricPolicy = try container.decode(BiometricPolicy.self, forKey: .biometricPolicy)
        maximumGrantLifetimeMilliseconds = try container.decode(UInt64.self, forKey: .maximumGrantLifetimeMilliseconds)
    }
}

public struct RegisteredAction: Codable, Sendable {
    public var actionId: String
    public var verifierId: String
    public var executable: String
    public var argv: [String]
    public var argvDigest: String
    public var risk: RiskLevel
    public var biometricPolicy: BiometricPolicy
    public var reversible: Bool

    public init(actionId: String, executable: String, argv: [String], argvDigest: String, verifierId: String, reversible: Bool, risk: RiskLevel, biometricPolicy: BiometricPolicy) {
        self.actionId = actionId
        self.verifierId = verifierId
        self.executable = executable
        self.argv = argv
        self.argvDigest = argvDigest
        self.risk = risk
        self.biometricPolicy = biometricPolicy
        self.reversible = reversible
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case actionId, verifierId, executable, argv, argvDigest, risk, biometricPolicy, reversible
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        actionId = try container.decode(String.self, forKey: .actionId)
        verifierId = try container.decode(String.self, forKey: .verifierId)
        executable = try container.decode(String.self, forKey: .executable)
        argv = try container.decode([String].self, forKey: .argv)
        argvDigest = try container.decode(String.self, forKey: .argvDigest)
        risk = try container.decode(RiskLevel.self, forKey: .risk)
        biometricPolicy = try container.decode(BiometricPolicy.self, forKey: .biometricPolicy)
        reversible = try container.decode(Bool.self, forKey: .reversible)
    }
}

public struct ReviewerEnvironment: Codable, Sendable {
    public var home: String
    public var temporaryDirectory: String
    public var locale: String
    public var lcAll: String
    public var path: String
    public var noColor: String
    public var term: String

    public init(
        home: String,
        temporaryDirectory: String,
        locale: String,
        lcAll: String = "C.UTF-8",
        path: String = "/usr/bin:/bin",
        noColor: String = "1",
        term: String = "dumb"
    ) {
        self.home = home
        self.temporaryDirectory = temporaryDirectory
        self.locale = locale
        self.lcAll = lcAll
        self.path = path
        self.noColor = noColor
        self.term = term
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case home = "HOME"
        case temporaryDirectory = "TMPDIR"
        case locale = "LANG"
        case lcAll = "LC_ALL"
        case path = "PATH"
        case noColor = "NO_COLOR"
        case term = "TERM"
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        home = try container.decode(String.self, forKey: .home)
        temporaryDirectory = try container.decode(String.self, forKey: .temporaryDirectory)
        locale = try container.decode(String.self, forKey: .locale)
        lcAll = try container.decode(String.self, forKey: .lcAll)
        path = try container.decode(String.self, forKey: .path)
        noColor = try container.decode(String.self, forKey: .noColor)
        term = try container.decode(String.self, forKey: .term)
    }
}

public struct ReviewerPolicy: Codable, Sendable {
    public var ompPath: String
    public var reviewedPolicyModel: String
    public var fixedPrompt: String
    public var promptPolicyDigest: String
    public var reviewerBuildDigest: String
    public var reviewedWorkingDirectory: String
    public var exactEnvironment: ReviewerEnvironment
    public var deadlineMilliseconds: UInt64
    public var maximumAttempts: UInt32
    public var retryBackoffMilliseconds: [UInt64]
    public var breakerConsecutiveThreshold: UInt32
    public var breakerRollingThreshold: UInt32
    public var breakerRollingWindow: UInt32

    public init(
        ompPath: String,
        reviewedPolicyModel: String,
        fixedPrompt: String,
        promptPolicyDigest: String,
        reviewerBuildDigest: String,
        reviewedWorkingDirectory: String,
        exactEnvironment: ReviewerEnvironment,
        deadlineMilliseconds: UInt64 = 90_000,
        maximumAttempts: UInt32 = 3,
        retryBackoffMilliseconds: [UInt64],
        breakerConsecutiveThreshold: UInt32,
        breakerRollingThreshold: UInt32,
        breakerRollingWindow: UInt32
    ) {
        self.ompPath = ompPath
        self.reviewedPolicyModel = reviewedPolicyModel
        self.fixedPrompt = fixedPrompt
        self.promptPolicyDigest = promptPolicyDigest
        self.reviewerBuildDigest = reviewerBuildDigest
        self.reviewedWorkingDirectory = reviewedWorkingDirectory
        self.exactEnvironment = exactEnvironment
        self.deadlineMilliseconds = deadlineMilliseconds
        self.maximumAttempts = maximumAttempts
        self.retryBackoffMilliseconds = retryBackoffMilliseconds
        self.breakerConsecutiveThreshold = breakerConsecutiveThreshold
        self.breakerRollingThreshold = breakerRollingThreshold
        self.breakerRollingWindow = breakerRollingWindow
    }

    public init(
        ompPath: String = "omp",
        reviewedPolicyModel: String,
        fixedPrompt: String,
        promptPolicyDigest: String,
        reviewerBuildDigest: String,
        reviewedWorkingDirectory: String,
        exactEnvironment: ReviewerEnvironment,
        deadlineMilliseconds: UInt64 = 90_000,
        maximumAttempts: UInt32 = 3,
        retryBackoffMilliseconds: UInt64,
        breakerConsecutiveThreshold: UInt32,
        breakerRollingThreshold: UInt32,
        breakerRollingWindow: UInt32
    ) {
        self.init(
            ompPath: ompPath,
            reviewedPolicyModel: reviewedPolicyModel,
            fixedPrompt: fixedPrompt,
            promptPolicyDigest: promptPolicyDigest,
            reviewerBuildDigest: reviewerBuildDigest,
            reviewedWorkingDirectory: reviewedWorkingDirectory,
            exactEnvironment: exactEnvironment,
            deadlineMilliseconds: deadlineMilliseconds,
            maximumAttempts: maximumAttempts,
            retryBackoffMilliseconds: [retryBackoffMilliseconds, 1_000],
            breakerConsecutiveThreshold: breakerConsecutiveThreshold,
            breakerRollingThreshold: breakerRollingThreshold,
            breakerRollingWindow: breakerRollingWindow
        )
    }

    public var arguments: [String] { ["-p", "--no-session", "--no-tools", "--model", reviewedPolicyModel] }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case ompPath, reviewedPolicyModel, fixedPrompt, promptPolicyDigest, reviewerBuildDigest
        case reviewedWorkingDirectory, exactEnvironment, deadlineMilliseconds, maximumAttempts
        case retryBackoffMilliseconds, breakerConsecutiveThreshold, breakerRollingThreshold, breakerRollingWindow
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ompPath = try container.decode(String.self, forKey: .ompPath)
        reviewedPolicyModel = try container.decode(String.self, forKey: .reviewedPolicyModel)
        fixedPrompt = try container.decode(String.self, forKey: .fixedPrompt)
        promptPolicyDigest = try container.decode(String.self, forKey: .promptPolicyDigest)
        reviewerBuildDigest = try container.decode(String.self, forKey: .reviewerBuildDigest)
        reviewedWorkingDirectory = try container.decode(String.self, forKey: .reviewedWorkingDirectory)
        exactEnvironment = try container.decode(ReviewerEnvironment.self, forKey: .exactEnvironment)
        deadlineMilliseconds = try container.decode(UInt64.self, forKey: .deadlineMilliseconds)
        maximumAttempts = try container.decode(UInt32.self, forKey: .maximumAttempts)
        retryBackoffMilliseconds = try container.decode([UInt64].self, forKey: .retryBackoffMilliseconds)
        breakerConsecutiveThreshold = try container.decode(UInt32.self, forKey: .breakerConsecutiveThreshold)
        breakerRollingThreshold = try container.decode(UInt32.self, forKey: .breakerRollingThreshold)
        breakerRollingWindow = try container.decode(UInt32.self, forKey: .breakerRollingWindow)
    }
}

public struct JetKVMPolicy: Codable, Sendable {
    public var chromeExecutablePath: String?
    public var profileDirectoryPath: String?
    public var deviceId: String?
    public var tlsSPKISHA256: String?
    public var frontendAssetManifestSHA256: String?
    public var vendoredFrontendCommit: String?
    public var vendoredFrontendDigest: String?
    public var launchTimeoutSeconds: Double?
    public var cdpTimeoutSeconds: Double?
    public var readinessTimeoutSeconds: Double?
    public var replacementGraceSeconds: Double?
    public var keyIntervalSeconds: Double?
    public var maximumCDPMessageBytes: Int?
    public var maximumCDPJSONDepth: Int?
    public var maximumCDPJSONNodes: Int?
    public var maximumCDPJSONStringBytes: Int?
    public var maximumQueuedEvents: Int?
    public var maximumQueuedEventBytes: Int?

    public init(
        chromeExecutablePath: String?,
        profileDirectoryPath: String?,
        deviceId: String?,
        tlsSPKISHA256: String?,
        frontendAssetManifestSHA256: String?,
        vendoredFrontendCommit: String?,
        vendoredFrontendDigest: String?,
        launchTimeoutSeconds: Double?,
        cdpTimeoutSeconds: Double?,
        readinessTimeoutSeconds: Double?,
        replacementGraceSeconds: Double?,
        keyIntervalSeconds: Double?,
        maximumCDPMessageBytes: Int?,
        maximumCDPJSONDepth: Int?,
        maximumCDPJSONNodes: Int?,
        maximumCDPJSONStringBytes: Int?,
        maximumQueuedEvents: Int?,
        maximumQueuedEventBytes: Int?
    ) {
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
    }

    var activeConfiguration: JetKVMCloudConfiguration? {
        guard let chromeExecutablePath,
              let profileDirectoryPath,
              let deviceId,
              let tlsSPKISHA256,
              let frontendAssetManifestSHA256,
              let vendoredFrontendCommit,
              let vendoredFrontendDigest,
              let launchTimeoutSeconds,
              let cdpTimeoutSeconds,
              let readinessTimeoutSeconds,
              let replacementGraceSeconds,
              let keyIntervalSeconds,
              let maximumCDPMessageBytes,
              let maximumCDPJSONDepth,
              let maximumCDPJSONNodes,
              let maximumCDPJSONStringBytes,
              let maximumQueuedEvents,
              let maximumQueuedEventBytes,
              Self.isCanonicalAbsolutePath(chromeExecutablePath),
              Self.isCanonicalAbsolutePath(profileDirectoryPath),
              Self.isLowercaseHex(vendoredFrontendCommit, count: 40),
              Self.isNonzeroLowercaseHex(tlsSPKISHA256, count: 64),
              Self.isNonzeroLowercaseHex(frontendAssetManifestSHA256, count: 64),
              Self.isLowercaseHex(vendoredFrontendDigest, count: 64)
        else { return nil }

        return try? JetKVMCloudConfiguration(
            chromeExecutablePath: chromeExecutablePath,
            profileDirectoryPath: profileDirectoryPath,
            deviceId: deviceId,
            tlsSPKISHA256: tlsSPKISHA256,
            frontendAssetManifestSHA256: frontendAssetManifestSHA256,
            vendoredFrontendCommit: vendoredFrontendCommit,
            vendoredFrontendDigest: vendoredFrontendDigest,
            launchTimeoutSeconds: launchTimeoutSeconds,
            cdpTimeoutSeconds: cdpTimeoutSeconds,
            readinessTimeoutSeconds: readinessTimeoutSeconds,
            replacementGraceSeconds: replacementGraceSeconds,
            keyIntervalSeconds: keyIntervalSeconds,
            maximumCDPMessageBytes: maximumCDPMessageBytes,
            maximumCDPJSONDepth: maximumCDPJSONDepth,
            maximumCDPJSONNodes: maximumCDPJSONNodes,
            maximumCDPJSONStringBytes: maximumCDPJSONStringBytes,
            maximumQueuedEvents: maximumQueuedEvents,
            maximumQueuedEventBytes: maximumQueuedEventBytes
        )
    }

    var hasNoConfiguration: Bool {
        chromeExecutablePath == nil
            && profileDirectoryPath == nil
            && deviceId == nil
            && tlsSPKISHA256 == nil
            && frontendAssetManifestSHA256 == nil
            && vendoredFrontendCommit == nil
            && vendoredFrontendDigest == nil
            && launchTimeoutSeconds == nil
            && cdpTimeoutSeconds == nil
            && readinessTimeoutSeconds == nil
            && replacementGraceSeconds == nil
            && keyIntervalSeconds == nil
            && maximumCDPMessageBytes == nil
            && maximumCDPJSONDepth == nil
            && maximumCDPJSONNodes == nil
            && maximumCDPJSONStringBytes == nil
            && maximumQueuedEvents == nil
            && maximumQueuedEventBytes == nil
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
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard CodingKeys.allCases.allSatisfy({ container.contains($0) }) else {
            throw PolicyLoadError.invalidValue("jetKVM")
        }
        chromeExecutablePath = try container.decodeIfPresent(String.self, forKey: .chromeExecutablePath)
        profileDirectoryPath = try container.decodeIfPresent(String.self, forKey: .profileDirectoryPath)
        deviceId = try container.decodeIfPresent(String.self, forKey: .deviceId)
        tlsSPKISHA256 = try container.decodeIfPresent(String.self, forKey: .tlsSPKISHA256)
        frontendAssetManifestSHA256 = try container.decodeIfPresent(String.self, forKey: .frontendAssetManifestSHA256)
        vendoredFrontendCommit = try container.decodeIfPresent(String.self, forKey: .vendoredFrontendCommit)
        vendoredFrontendDigest = try container.decodeIfPresent(String.self, forKey: .vendoredFrontendDigest)
        launchTimeoutSeconds = try container.decodeIfPresent(Double.self, forKey: .launchTimeoutSeconds)
        cdpTimeoutSeconds = try container.decodeIfPresent(Double.self, forKey: .cdpTimeoutSeconds)
        readinessTimeoutSeconds = try container.decodeIfPresent(Double.self, forKey: .readinessTimeoutSeconds)
        replacementGraceSeconds = try container.decodeIfPresent(Double.self, forKey: .replacementGraceSeconds)
        keyIntervalSeconds = try container.decodeIfPresent(Double.self, forKey: .keyIntervalSeconds)
        maximumCDPMessageBytes = try container.decodeIfPresent(Int.self, forKey: .maximumCDPMessageBytes)
        maximumCDPJSONDepth = try container.decodeIfPresent(Int.self, forKey: .maximumCDPJSONDepth)
        maximumCDPJSONNodes = try container.decodeIfPresent(Int.self, forKey: .maximumCDPJSONNodes)
        maximumCDPJSONStringBytes = try container.decodeIfPresent(Int.self, forKey: .maximumCDPJSONStringBytes)
        maximumQueuedEvents = try container.decodeIfPresent(Int.self, forKey: .maximumQueuedEvents)
        maximumQueuedEventBytes = try container.decodeIfPresent(Int.self, forKey: .maximumQueuedEventBytes)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(chromeExecutablePath, forKey: .chromeExecutablePath)
        try container.encode(profileDirectoryPath, forKey: .profileDirectoryPath)
        try container.encode(deviceId, forKey: .deviceId)
        try container.encode(tlsSPKISHA256, forKey: .tlsSPKISHA256)
        try container.encode(frontendAssetManifestSHA256, forKey: .frontendAssetManifestSHA256)
        try container.encode(vendoredFrontendCommit, forKey: .vendoredFrontendCommit)
        try container.encode(vendoredFrontendDigest, forKey: .vendoredFrontendDigest)
        try container.encode(launchTimeoutSeconds, forKey: .launchTimeoutSeconds)
        try container.encode(cdpTimeoutSeconds, forKey: .cdpTimeoutSeconds)
        try container.encode(readinessTimeoutSeconds, forKey: .readinessTimeoutSeconds)
        try container.encode(replacementGraceSeconds, forKey: .replacementGraceSeconds)
        try container.encode(keyIntervalSeconds, forKey: .keyIntervalSeconds)
        try container.encode(maximumCDPMessageBytes, forKey: .maximumCDPMessageBytes)
        try container.encode(maximumCDPJSONDepth, forKey: .maximumCDPJSONDepth)
        try container.encode(maximumCDPJSONNodes, forKey: .maximumCDPJSONNodes)
        try container.encode(maximumCDPJSONStringBytes, forKey: .maximumCDPJSONStringBytes)
        try container.encode(maximumQueuedEvents, forKey: .maximumQueuedEvents)
        try container.encode(maximumQueuedEventBytes, forKey: .maximumQueuedEventBytes)
    }

    private static func isCanonicalAbsolutePath(_ value: String) -> Bool {
        let bytes = value.utf8
        guard (2...4_096).contains(bytes.count),
              bytes.first == 0x2f,
              bytes.last != 0x2f,
              !bytes.contains(0),
              !bytes.contains(0x0a),
              !bytes.contains(0x0d)
        else { return false }

        return value.split(separator: "/", omittingEmptySubsequences: false).dropFirst().allSatisfy {
            !$0.isEmpty && $0 != "." && $0 != ".."
        }
    }

    private static func isLowercaseHex(_ value: String, count: Int) -> Bool {
        value.utf8.count == count && value.utf8.allSatisfy {
            ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66)
        }
    }

    private static func isNonzeroLowercaseHex(_ value: String, count: Int) -> Bool {
        isLowercaseHex(value, count: count) && value.utf8.contains { $0 != 0x30 }
    }
}

public struct GDMVerifierPolicy: Codable, Sendable {
    public var verifierId: String
    public var sshExecutable: String
    public var endpoint: String
    public var forcedPrincipal: String
    public var pinnedHostKeySHA256: String
    public var recipientKeyId: String
    public var recipientPublicKey: String

    public init(
        verifierId: String = "gdm-verifier-default",
        sshExecutable: String = "/usr/bin/ssh",
        endpoint: String,
        forcedPrincipal: String = "remote-auth-gdm-ingest",
        pinnedHostKeySHA256: String = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        recipientKeyId: String,
        recipientPublicKey: String
    ) {
        self.verifierId = verifierId
        self.sshExecutable = sshExecutable
        self.endpoint = endpoint
        self.forcedPrincipal = forcedPrincipal
        self.pinnedHostKeySHA256 = pinnedHostKeySHA256
        self.recipientKeyId = recipientKeyId
        self.recipientPublicKey = recipientPublicKey
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case verifierId, sshExecutable, endpoint, forcedPrincipal, pinnedHostKeySHA256, recipientKeyId, recipientPublicKey
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        verifierId = try container.decode(String.self, forKey: .verifierId)
        sshExecutable = try container.decode(String.self, forKey: .sshExecutable)
        endpoint = try container.decode(String.self, forKey: .endpoint)
        forcedPrincipal = try container.decode(String.self, forKey: .forcedPrincipal)
        pinnedHostKeySHA256 = try container.decode(String.self, forKey: .pinnedHostKeySHA256)
        recipientKeyId = try container.decode(String.self, forKey: .recipientKeyId)
        recipientPublicKey = try container.decode(String.self, forKey: .recipientPublicKey)
    }
}

public struct SudoVerifierPolicy: Codable, Sendable {
    public var verifierId: String
    public var sshExecutable: String
    public var endpoint: String
    public var forcedPrincipal: String
    public var pinnedHostKeySHA256: String

    public init(
        verifierId: String = "sudo-verifier-default",
        sshExecutable: String = "/usr/bin/ssh",
        endpoint: String,
        forcedPrincipal: String = "remote-auth-sudo-ingest",
        pinnedHostKeySHA256: String = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ) {
        self.verifierId = verifierId
        self.sshExecutable = sshExecutable
        self.endpoint = endpoint
        self.forcedPrincipal = forcedPrincipal
        self.pinnedHostKeySHA256 = pinnedHostKeySHA256
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case verifierId, sshExecutable, endpoint, forcedPrincipal, pinnedHostKeySHA256
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        verifierId = try container.decode(String.self, forKey: .verifierId)
        sshExecutable = try container.decode(String.self, forKey: .sshExecutable)
        endpoint = try container.decode(String.self, forKey: .endpoint)
        forcedPrincipal = try container.decode(String.self, forKey: .forcedPrincipal)
        pinnedHostKeySHA256 = try container.decode(String.self, forKey: .pinnedHostKeySHA256)
    }
}

public struct VerifierPolicy: Codable, Sendable {
    public var gdm: GDMVerifierPolicy?
    public var sudo: SudoVerifierPolicy?
    fileprivate var legacyAuthorityKeys: AuthorityKeysPolicy?

    public init(gdm: GDMVerifierPolicy?, sudo: SudoVerifierPolicy?) {
        self.gdm = gdm
        self.sudo = sudo
        legacyAuthorityKeys = nil
    }

    public init(gdm: GDMVerifierPolicy, sudo: SudoVerifierPolicy, desktopBrowserSigningKeyId: String, sudoSigningKeyId: String) {
        self.gdm = gdm
        self.sudo = sudo
        legacyAuthorityKeys = AuthorityKeysPolicy(
            desktopBrowserSigningKeyId: desktopBrowserSigningKeyId,
            sudoSigningKeyId: sudoSigningKeyId
        )
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case gdm, sudo }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard container.contains(.gdm), container.contains(.sudo) else {
            throw PolicyLoadError.invalidValue("verifiers")
        }
        gdm = try container.decodeIfPresent(GDMVerifierPolicy.self, forKey: .gdm)
        sudo = try container.decodeIfPresent(SudoVerifierPolicy.self, forKey: .sudo)
        legacyAuthorityKeys = nil
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(gdm, forKey: .gdm)
        try container.encode(sudo, forKey: .sudo)
    }
}

public struct AuthorityKeysPolicy: Codable, Sendable {
    public var desktopBrowserSigningKeyId: String?
    public var sudoSigningKeyId: String?

    public init(desktopBrowserSigningKeyId: String?, sudoSigningKeyId: String?) {
        self.desktopBrowserSigningKeyId = desktopBrowserSigningKeyId
        self.sudoSigningKeyId = sudoSigningKeyId
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case desktopBrowserSigningKeyId, sudoSigningKeyId }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard container.contains(.desktopBrowserSigningKeyId), container.contains(.sudoSigningKeyId) else {
            throw PolicyLoadError.invalidValue("authorityKeys")
        }
        desktopBrowserSigningKeyId = try container.decodeIfPresent(String.self, forKey: .desktopBrowserSigningKeyId)
        sudoSigningKeyId = try container.decodeIfPresent(String.self, forKey: .sudoSigningKeyId)
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(desktopBrowserSigningKeyId, forKey: .desktopBrowserSigningKeyId)
        try container.encode(sudoSigningKeyId, forKey: .sudoSigningKeyId)
    }

}

public struct TrustedOmpCaller: Codable, Sendable {
    public var uid: UInt32
    public var signingIdentifier: String
    public var teamIdentifier: String
    public var executableSHA256: String
    public var buildDigest: String
    public var designatedRequirement: String

    public init(uid: UInt32, signingIdentifier: String, teamIdentifier: String, executableSHA256: String, buildDigest: String? = nil, designatedRequirement: String) {
        self.uid = uid
        self.signingIdentifier = signingIdentifier
        self.teamIdentifier = teamIdentifier
        self.executableSHA256 = executableSHA256
        self.buildDigest = buildDigest ?? executableSHA256
        self.designatedRequirement = designatedRequirement
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case uid, signingIdentifier, teamIdentifier, executableSHA256, buildDigest, designatedRequirement
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uid = try container.decode(UInt32.self, forKey: .uid)
        signingIdentifier = try container.decode(String.self, forKey: .signingIdentifier)
        teamIdentifier = try container.decode(String.self, forKey: .teamIdentifier)
        executableSHA256 = try container.decode(String.self, forKey: .executableSHA256)
        buildDigest = try container.decode(String.self, forKey: .buildDigest)
        designatedRequirement = try container.decode(String.self, forKey: .designatedRequirement)
    }
}

public struct GDMCredentialTargetPolicy: Codable, Sendable {
    public var credentialId: String
    public var account: String
    public var verifierId: String
    public var machineId: String
    public var username: String
    public var uid: UInt32
    public var pamService: String
    public var seat: String
    public var jetKVMDeviceId: String

    public init(credentialId: String, account: String, verifierId: String, machineId: String, username: String, uid: UInt32, pamService: String = "gdm-password", seat: String, jetKVMDeviceId: String) {
        self.credentialId = credentialId
        self.account = account
        self.verifierId = verifierId
        self.machineId = machineId
        self.username = username
        self.uid = uid
        self.pamService = pamService
        self.seat = seat
        self.jetKVMDeviceId = jetKVMDeviceId
    }

    public init(credentialId: String, machineId: String, username: String, uid: UInt32, jetKVMDeviceId: String) {
        self.init(credentialId: credentialId, account: credentialId, verifierId: "gdm-verifier-default", machineId: machineId, username: username, uid: uid, seat: "seat0", jetKVMDeviceId: jetKVMDeviceId)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, credentialId, account, verifierId, machineId, username, uid, pamService, seat, jetKVMDeviceId
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .kind) == "gdm-password" else {
            throw PolicyLoadError.invalidValue("credentialTargets.kind")
        }
        credentialId = try container.decode(String.self, forKey: .credentialId)
        account = try container.decode(String.self, forKey: .account)
        verifierId = try container.decode(String.self, forKey: .verifierId)
        machineId = try container.decode(String.self, forKey: .machineId)
        username = try container.decode(String.self, forKey: .username)
        uid = try container.decode(UInt32.self, forKey: .uid)
        pamService = try container.decode(String.self, forKey: .pamService)
        seat = try container.decode(String.self, forKey: .seat)
        jetKVMDeviceId = try container.decode(String.self, forKey: .jetKVMDeviceId)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("gdm-password", forKey: .kind)
        try container.encode(credentialId, forKey: .credentialId)
        try container.encode(account, forKey: .account)
        try container.encode(verifierId, forKey: .verifierId)
        try container.encode(machineId, forKey: .machineId)
        try container.encode(username, forKey: .username)
        try container.encode(uid, forKey: .uid)
        try container.encode(pamService, forKey: .pamService)
        try container.encode(seat, forKey: .seat)
        try container.encode(jetKVMDeviceId, forKey: .jetKVMDeviceId)
    }
}

public struct BitwardenCredentialTargetPolicy: Codable, Sendable {
    public var credentialId: String
    public var account: String
    public var browserProfileId: String
    public var extensionId: String
    public var extensionVersion: String
    public var extensionSourceDigest: String
    public var extensionManifestDigest: String

    public init(credentialId: String, account: String, browserProfileId: String, extensionId: String, extensionVersion: String, extensionSourceDigest: String, extensionManifestDigest: String) {
        self.credentialId = credentialId
        self.account = account
        self.browserProfileId = browserProfileId
        self.extensionId = extensionId
        self.extensionVersion = extensionVersion
        self.extensionSourceDigest = extensionSourceDigest
        self.extensionManifestDigest = extensionManifestDigest
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, credentialId, account, browserProfileId, extensionId, extensionVersion
        case extensionSourceDigest, extensionManifestDigest
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .kind) == "bitwarden-unlock" else {
            throw PolicyLoadError.invalidValue("credentialTargets.kind")
        }
        credentialId = try container.decode(String.self, forKey: .credentialId)
        account = try container.decode(String.self, forKey: .account)
        browserProfileId = try container.decode(String.self, forKey: .browserProfileId)
        extensionId = try container.decode(String.self, forKey: .extensionId)
        extensionVersion = try container.decode(String.self, forKey: .extensionVersion)
        extensionSourceDigest = try container.decode(String.self, forKey: .extensionSourceDigest)
        extensionManifestDigest = try container.decode(String.self, forKey: .extensionManifestDigest)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("bitwarden-unlock", forKey: .kind)
        try container.encode(credentialId, forKey: .credentialId)
        try container.encode(account, forKey: .account)
        try container.encode(browserProfileId, forKey: .browserProfileId)
        try container.encode(extensionId, forKey: .extensionId)
        try container.encode(extensionVersion, forKey: .extensionVersion)
        try container.encode(extensionSourceDigest, forKey: .extensionSourceDigest)
        try container.encode(extensionManifestDigest, forKey: .extensionManifestDigest)
    }
}

public struct WebsiteOriginPolicy: Codable, Sendable {
    public var scheme: String
    public var host: String
    public var port: UInt16

    public init(scheme: String = "https", host: String, port: UInt16) {
        self.scheme = scheme
        self.host = host
        self.port = port
    }

    public var serialized: String { "\(scheme)://\(host):\(port)" }

    private enum CodingKeys: String, CodingKey, CaseIterable { case scheme, host, port }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        scheme = try container.decode(String.self, forKey: .scheme)
        host = try container.decode(String.self, forKey: .host)
        port = try container.decode(UInt16.self, forKey: .port)
    }
}

public struct WebsiteCredentialTargetPolicy: Codable, Sendable {
    public var credentialId: String
    public var unlockCredentialId: String
    public var pairingId: String
    public var browserProfileId: String
    public var extensionId: String
    public var origin: WebsiteOriginPolicy

    public init(credentialId: String, unlockCredentialId: String, pairingId: String, browserProfileId: String, extensionId: String, origin: WebsiteOriginPolicy) {
        self.credentialId = credentialId
        self.unlockCredentialId = unlockCredentialId
        self.pairingId = pairingId
        self.browserProfileId = browserProfileId
        self.extensionId = extensionId
        self.origin = origin
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, credentialId, unlockCredentialId, pairingId, browserProfileId, extensionId, origin
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .kind) == "website-autofill" else {
            throw PolicyLoadError.invalidValue("credentialTargets.kind")
        }
        credentialId = try container.decode(String.self, forKey: .credentialId)
        unlockCredentialId = try container.decode(String.self, forKey: .unlockCredentialId)
        pairingId = try container.decode(String.self, forKey: .pairingId)
        browserProfileId = try container.decode(String.self, forKey: .browserProfileId)
        extensionId = try container.decode(String.self, forKey: .extensionId)
        origin = try container.decode(WebsiteOriginPolicy.self, forKey: .origin)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("website-autofill", forKey: .kind)
        try container.encode(credentialId, forKey: .credentialId)
        try container.encode(unlockCredentialId, forKey: .unlockCredentialId)
        try container.encode(pairingId, forKey: .pairingId)
        try container.encode(browserProfileId, forKey: .browserProfileId)
        try container.encode(extensionId, forKey: .extensionId)
        try container.encode(origin, forKey: .origin)
    }
}

public enum CredentialTargetPolicy: Codable, Sendable {
    case gdm(GDMCredentialTargetPolicy)
    case bitwardenUnlock(BitwardenCredentialTargetPolicy)
    case websiteAutofill(WebsiteCredentialTargetPolicy)

    public var credentialId: String {
        switch self {
        case .gdm(let value): value.credentialId
        case .bitwardenUnlock(let value): value.credentialId
        case .websiteAutofill(let value): value.credentialId
        }
    }

    private enum KindKeys: String, CodingKey { case kind }

    public init(from decoder: Decoder) throws {
        switch try decoder.container(keyedBy: KindKeys.self).decode(String.self, forKey: .kind) {
        case "gdm-password": self = .gdm(try GDMCredentialTargetPolicy(from: decoder))
        case "bitwarden-unlock": self = .bitwardenUnlock(try BitwardenCredentialTargetPolicy(from: decoder))
        case "website-autofill": self = .websiteAutofill(try WebsiteCredentialTargetPolicy(from: decoder))
        default: throw PolicyLoadError.invalidValue("credentialTargets.kind")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .gdm(let value): try value.encode(to: encoder)
        case .bitwardenUnlock(let value): try value.encode(to: encoder)
        case .websiteAutofill(let value): try value.encode(to: encoder)
        }
    }
}

public struct BrokerPolicy: Codable, Sendable {
    public static let inactiveDigestPlaceholder = String(repeating: "0", count: 64)

    public var schemaVersion: UInt32
    public var version: UInt32
    public var canonicalStatus: CanonicalBrokerStatus
    public var active: Bool
    public var policyId: String
    public var policyDigest: String
    public var policyDigestState: PolicyDigestState
    public var maximumBiometricAgeMilliseconds: UInt64
    public var brokerIdentity: BrokerIdentityPolicy
    public var caller: CallerPolicy
    public var sockets: SocketPolicy
    public var reviewer: ReviewerPolicy
    public var jetKVM: JetKVMPolicy
    public var verifiers: VerifierPolicy
    public var authorityKeys: AuthorityKeysPolicy
    public var trustedOmpCallers: [TrustedOmpCaller]
    public var operations: [OperationPolicy]
    public var actions: [RegisteredAction]
    public var credentialTargets: [CredentialTargetPolicy]

    public init(
        version: UInt32 = 1,
        schemaVersion: UInt32 = 1,
        policyId: String,
        policyDigest: String,
        policyDigestState: PolicyDigestState,
        canonicalStatus: CanonicalBrokerStatus,
        active: Bool,
        maximumBiometricAgeMilliseconds: UInt64,
        brokerIdentity: BrokerIdentityPolicy,
        sockets: SocketPolicy,
        reviewer: ReviewerPolicy,
        jetKVM: JetKVMPolicy,
        verifiers: VerifierPolicy,
        trustedOmpCallers: [TrustedOmpCaller],
        credentialTargets: [CredentialTargetPolicy],
        operations: [OperationPolicy],
        actions: [RegisteredAction],
        caller: CallerPolicy? = nil,
        authorityKeys: AuthorityKeysPolicy? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.version = version
        self.canonicalStatus = canonicalStatus
        self.active = active
        self.policyId = policyId
        self.policyDigest = policyDigest
        self.policyDigestState = policyDigestState
        self.maximumBiometricAgeMilliseconds = maximumBiometricAgeMilliseconds
        self.brokerIdentity = brokerIdentity
        self.caller = caller ?? CallerPolicy(
            uid: trustedOmpCallers.first?.uid ?? UInt32.max,
            codeIdentity: trustedOmpCallers.first?.signingIdentifier ?? "INACTIVE-NO-CALLER",
            buildDigest: trustedOmpCallers.first?.buildDigest ?? Self.inactiveDigestPlaceholder
        )
        self.sockets = sockets
        self.reviewer = reviewer
        self.jetKVM = jetKVM
        self.verifiers = verifiers
        self.authorityKeys = authorityKeys ?? verifiers.legacyAuthorityKeys ?? AuthorityKeysPolicy(
            desktopBrowserSigningKeyId: nil,
            sudoSigningKeyId: nil
        )
        self.trustedOmpCallers = trustedOmpCallers
        self.operations = operations
        self.actions = actions
        self.credentialTargets = credentialTargets
    }

    public var permitsEffects: Bool {
        canonicalStatus == .active && active && policyDigestState == .reviewed
    }

    public func operationPolicy(for operation: AuthorizationOperation, domain: AuthorizationDomain) -> OperationPolicy? {
        operations.first { $0.operation == operation && $0.domain == domain }
    }

    public func registeredAction(for target: SudoTarget) -> RegisteredAction? {
        guard let verifier = verifiers.sudo,
              verifier.pinnedHostKeySHA256 == target.sshHostKeyDigest else { return nil }
        let matches = actions.filter {
            $0.actionId == target.actionId
                && $0.executable == target.executable
                && $0.argvDigest == target.argvDigest
                && $0.verifierId == verifier.verifierId
        }
        return matches.count == 1 ? matches[0] : nil
    }

    public func trustedCaller(matching peer: PeerMatchInput) -> TrustedOmpCaller? {
        trustedOmpCallers.first {
            $0.uid == peer.uid
                && $0.signingIdentifier == peer.signingIdentifier
                && $0.teamIdentifier == peer.teamIdentifier
                && $0.executableSHA256 == peer.executableSHA256
                && $0.buildDigest == peer.executableSHA256
                && $0.designatedRequirement == peer.designatedRequirement
        }
    }

    public func decision(for request: ExecutionRequest, policyDigest: String) throws -> PolicyDecision {
        guard permitsEffects else { throw RemoteAuthProtocolError(.inactive) }
        guard request.operation == .gdmLogin,
              request.domain == .desktopBrowser,
              case .gdm = request.target
        else {
            throw RemoteAuthProtocolError(.inactive)
        }
        guard policyDigest == self.policyDigest else { throw RemoteAuthProtocolError(.policyMismatch) }
        guard let operation = operationPolicy(for: request.operation, domain: request.domain) else {
            throw RemoteAuthProtocolError(.domainMismatch)
        }

        switch request.target {
        case .sudo(let target):
            guard request.operation == .sudo, request.domain == .sudo else {
                throw RemoteAuthProtocolError(.domainMismatch)
            }
            guard target.sudoPolicyDigest == policyDigest else {
                throw RemoteAuthProtocolError(.policyMismatch)
            }
            guard let action = registeredAction(for: target) else {
                throw RemoteAuthProtocolError(.targetMismatch)
            }
            return PolicyDecision(
                risk: RiskLevel.maximum(operation.risk, action.risk),
                biometricPolicy: operation.biometricPolicy.stricter(than: action.biometricPolicy)
            )
        case .gdm(let target):
            guard request.operation == .gdmLogin, request.domain == .desktopBrowser else {
                throw RemoteAuthProtocolError(.domainMismatch)
            }
            guard gdmCredential(matching: target) != nil else {
                throw RemoteAuthProtocolError(.targetMismatch)
            }
        case .bitwarden(let target):
            guard request.operation == .bitwardenUnlock, request.domain == .desktopBrowser else {
                throw RemoteAuthProtocolError(.domainMismatch)
            }
            guard bitwardenCredential(matching: target) != nil else {
                throw RemoteAuthProtocolError(.targetMismatch)
            }
        case .website(let target):
            guard request.operation == .websiteAutofill, request.domain == .desktopBrowser else {
                throw RemoteAuthProtocolError(.domainMismatch)
            }
            guard websiteCredential(matching: target) != nil else {
                throw RemoteAuthProtocolError(.targetMismatch)
            }
        }
        return PolicyDecision(risk: operation.risk, biometricPolicy: operation.biometricPolicy)
    }

    public func validate() throws {
        guard version == 1, schemaVersion == 1 else { throw PolicyLoadError.invalidSchemaVersion }
        guard Self.isPolicyId(policyId), Self.isDigest(policyDigest) else {
            throw PolicyLoadError.invalidValue("policy identity")
        }
        try validateActivation()
        try validateIdentityAndRuntime()
        try validateRegistries()
    }

    private func validateActivation() throws {
        if active {
            guard canonicalStatus == .active,
                  policyDigestState == .reviewed,
                  policyDigest != Self.inactiveDigestPlaceholder,
                  (1...300_000).contains(maximumBiometricAgeMilliseconds),
                  verifiers.gdm != nil,
                  verifiers.sudo == nil,
                  authorityKeys.desktopBrowserSigningKeyId != nil,
                  authorityKeys.sudoSigningKeyId == nil,
                  !trustedOmpCallers.isEmpty,
                  operations.count == 1,
                  operations[0].domain == .desktopBrowser,
                  operations[0].operation == .gdmLogin,
                  actions.isEmpty,
                  !credentialTargets.isEmpty,
                  credentialTargets.allSatisfy({
                      if case .gdm = $0 { return true }
                      return false
                  }) else {
                throw PolicyLoadError.invalidActivationState
            }
        } else {
            guard canonicalStatus == .designInactive,
                  policyDigestState == .inactivePlaceholder,
                  policyDigest == Self.inactiveDigestPlaceholder,
                  maximumBiometricAgeMilliseconds == 0,
                  brokerIdentity.signingIdentifier == "INACTIVE",
                  brokerIdentity.teamIdentifier == "INACTIVE",
                  brokerIdentity.designatedRequirement == "INACTIVE-NO-REQUIREMENT",
                  brokerIdentity.executableSHA256 == Self.inactiveDigestPlaceholder,
                  brokerIdentity.buildDigest == Self.inactiveDigestPlaceholder,
                  caller.uid == UInt32.max,
                  caller.codeIdentity == "INACTIVE-NO-CALLER",
                  caller.buildDigest == Self.inactiveDigestPlaceholder,
                  reviewer.reviewedPolicyModel == "INACTIVE",
                  reviewer.promptPolicyDigest == Self.inactiveDigestPlaceholder,
                  reviewer.reviewerBuildDigest == Self.inactiveDigestPlaceholder,
                  jetKVM.hasNoConfiguration,
                  verifiers.gdm == nil,
                  verifiers.sudo == nil,
                  authorityKeys.desktopBrowserSigningKeyId == nil,
                  authorityKeys.sudoSigningKeyId == nil,
                  trustedOmpCallers.isEmpty,
                  operations.isEmpty,
                  actions.isEmpty,
                  credentialTargets.isEmpty else {
                throw PolicyLoadError.invalidActivationState
            }
        }
    }

    private func validateIdentityAndRuntime() throws {
        guard Self.isBoundedText(brokerIdentity.designatedRequirement),
              Self.isDigest(brokerIdentity.executableSHA256),
              Self.isDigest(brokerIdentity.buildDigest),
              !brokerIdentity.signingIdentifier.isEmpty,
              brokerIdentity.signingIdentifier.utf8.count <= 255,
              !brokerIdentity.teamIdentifier.isEmpty,
              brokerIdentity.teamIdentifier.utf8.count <= 64,
              Self.isBoundedText(caller.codeIdentity),
              Self.isDigest(caller.buildDigest),
              sockets.brokerSocketPath == SocketPolicy.canonicalBrokerSocketPath,
              sockets.browserControllerSocketPath == SocketPolicy.canonicalBrowserControllerSocketPath,
              Self.isAbsolutePath(reviewer.ompPath),
              Self.matches(reviewer.reviewedPolicyModel, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$", maximumUTF8Count: 128),
              Self.isBoundedText(reviewer.fixedPrompt),
              Self.isDigest(reviewer.promptPolicyDigest),
              Self.isDigest(reviewer.reviewerBuildDigest),
              Self.isAbsolutePath(reviewer.reviewedWorkingDirectory),
              reviewer.deadlineMilliseconds == 90_000,
              reviewer.maximumAttempts == 3,
              reviewer.retryBackoffMilliseconds == [250, 1_000],
              (1...32).contains(reviewer.breakerConsecutiveThreshold),
              (1...64).contains(reviewer.breakerRollingThreshold),
              (1...256).contains(reviewer.breakerRollingWindow),
              reviewer.exactEnvironment.home == "/Users/arthur",
              reviewer.exactEnvironment.temporaryDirectory == "/tmp",
              reviewer.exactEnvironment.locale == "C.UTF-8",
              reviewer.exactEnvironment.lcAll == "C.UTF-8",
              reviewer.exactEnvironment.path == "/usr/bin:/bin",
              reviewer.exactEnvironment.noColor == "1",
              reviewer.exactEnvironment.term == "dumb" else {
            throw PolicyLoadError.invalidValue("runtime identity")
        }

        if active {
            guard jetKVM.activeConfiguration != nil else {
                throw PolicyLoadError.invalidValue("jetKVM")
            }
            guard caller.uid < UInt32.max,
                  caller.codeIdentity != "INACTIVE-NO-CALLER",
                  Self.isNonzeroDigest(caller.buildDigest),
                  brokerIdentity.signingIdentifier != "INACTIVE",
                  brokerIdentity.teamIdentifier.utf8.count == 10,
                  brokerIdentity.teamIdentifier.utf8.allSatisfy(Self.isUppercaseAlphaNumeric),
                  brokerIdentity.designatedRequirement != "INACTIVE-NO-REQUIREMENT",
                  Self.isNonzeroDigest(brokerIdentity.executableSHA256),
                  Self.isNonzeroDigest(brokerIdentity.buildDigest),
                  let gdm = verifiers.gdm,
                  verifiers.sudo == nil else {
                throw PolicyLoadError.invalidValue("active identity")
            }
            try validate(gdm: gdm)
            guard let desktopKey = authorityKeys.desktopBrowserSigningKeyId,
                  Self.isKeyId(desktopKey),
                  authorityKeys.sudoSigningKeyId == nil else {
                throw PolicyLoadError.invalidValue("authorityKeys")
            }
        }
    }

    private func validate(gdm: GDMVerifierPolicy) throws {
        guard Self.isBoundedIdentifier(gdm.verifierId),
              gdm.sshExecutable == "/usr/bin/ssh",
              Self.isEndpoint(gdm.endpoint),
              gdm.forcedPrincipal == "remote-auth-gdm-ingest",
              Self.isDigest(gdm.pinnedHostKeySHA256),
              Self.isKeyId(gdm.recipientKeyId),
              gdm.recipientPublicKey.utf8.count == 43,
              gdm.recipientPublicKey.utf8.allSatisfy(Self.isURLSafeBase64) else {
            throw PolicyLoadError.invalidValue("verifiers.gdm")
        }
    }

    private func validate(sudo: SudoVerifierPolicy) throws {
        guard Self.isBoundedIdentifier(sudo.verifierId),
              sudo.sshExecutable == "/usr/bin/ssh",
              Self.isEndpoint(sudo.endpoint),
              sudo.forcedPrincipal == "remote-auth-sudo-ingest",
              Self.isDigest(sudo.pinnedHostKeySHA256) else {
            throw PolicyLoadError.invalidValue("verifiers.sudo")
        }
    }

    private func validateRegistries() throws {
        guard trustedOmpCallers.count <= 16,
              operations.count <= 16,
              actions.count <= 128,
              credentialTargets.count <= 128 else {
            throw PolicyLoadError.invalidValue("registry size")
        }
        var callerKeys = Set<String>()
        for trusted in trustedOmpCallers {
            guard trusted.uid < UInt32.max,
                  !trusted.signingIdentifier.isEmpty,
                  trusted.signingIdentifier.utf8.count <= 255,
                  trusted.teamIdentifier.utf8.count == 10,
                  trusted.teamIdentifier.utf8.allSatisfy(Self.isUppercaseAlphaNumeric),
                  Self.isNonzeroDigest(trusted.executableSHA256),
                  Self.isNonzeroDigest(trusted.buildDigest),
                  Self.isBoundedText(trusted.designatedRequirement) else {
                throw PolicyLoadError.invalidValue("trustedOmpCallers")
            }
            let key = "\(trusted.uid):\(trusted.signingIdentifier):\(trusted.executableSHA256):\(trusted.buildDigest)"
            guard callerKeys.insert(key).inserted else { throw PolicyLoadError.duplicateCaller }
        }

        var credentialIds = Set<String>()
        for target in credentialTargets {
            guard Self.isBoundedIdentifier(target.credentialId), credentialIds.insert(target.credentialId).inserted else {
                throw PolicyLoadError.duplicateCredentialTarget
            }
            switch target {
            case .gdm(let value):
                guard Self.isBoundedIdentifier(value.account),
                      Self.isBoundedIdentifier(value.verifierId),
                      Self.isBoundedIdentifier(value.machineId),
                      Self.isUsername(value.username),
                      value.uid > 0,
                      value.uid < UInt32.max,
                      value.pamService == "gdm-password",
                      Self.isBoundedIdentifier(value.seat),
                      Self.isBoundedIdentifier(value.jetKVMDeviceId) else {
                    throw PolicyLoadError.invalidValue("credentialTargets.gdm-password")
                }
            case .bitwardenUnlock(let value):
                guard Self.isBoundedIdentifier(value.account),
                      Self.isBoundedIdentifier(value.browserProfileId),
                      Self.isExtensionId(value.extensionId),
                      Self.isExtensionVersion(value.extensionVersion),
                      Self.isNonzeroDigest(value.extensionSourceDigest),
                      Self.isNonzeroDigest(value.extensionManifestDigest) else {
                    throw PolicyLoadError.invalidValue("credentialTargets.bitwarden-unlock")
                }
            case .websiteAutofill(let value):
                guard Self.isBoundedIdentifier(value.unlockCredentialId),
                      Self.isBoundedIdentifier(value.pairingId),
                      Self.isBoundedIdentifier(value.browserProfileId),
                      Self.isExtensionId(value.extensionId),
                      value.origin.scheme == "https",
                      Self.isHost(value.origin.host),
                      value.origin.port > 0 else {
                    throw PolicyLoadError.invalidValue("credentialTargets.website-autofill")
                }
            }
        }

        var operationKeys = Set<String>()
        for rule in operations {
            guard (1...2_592_000_000).contains(rule.maximumGrantLifetimeMilliseconds) else {
                throw PolicyLoadError.invalidValue("operations")
            }
            guard operationKeys.insert("\(rule.domain.rawValue):\(rule.operation.rawValue)").inserted else {
                throw PolicyLoadError.duplicateOperation
            }
        }

        var actionIds = Set<String>()
        for action in actions {
            guard Self.isBoundedIdentifier(action.actionId),
                  Self.isBoundedIdentifier(action.verifierId),
                  Self.isAbsolutePath(action.executable),
                  !Self.forbiddenExecutables.contains(action.executable),
                  (1...32).contains(action.argv.count),
                  action.argv.allSatisfy(Self.isArgument),
                  Self.isNonzeroDigest(action.argvDigest) else {
                throw PolicyLoadError.invalidValue("actions")
            }
            guard actionIds.insert(action.actionId).inserted else { throw PolicyLoadError.duplicateAction }
        }
    }

    private func gdmCredential(matching target: GDMTarget) -> GDMCredentialTargetPolicy? {
        guard let verifier = verifiers.gdm,
              verifier.pinnedHostKeySHA256 == target.sshHostKeyDigest else { return nil }
        let matches = credentialTargets.compactMap { entry -> GDMCredentialTargetPolicy? in
            guard case .gdm(let value) = entry,
                  value.verifierId == verifier.verifierId,
                  value.machineId == target.machineId,
                  value.username == target.username,
                  value.uid == target.uid,
                  value.pamService == target.pamService,
                  value.seat == target.seat,
                  value.jetKVMDeviceId == target.jetkvmDeviceId else { return nil }
            return value
        }
        return matches.count == 1 ? matches[0] : nil
    }

    private func bitwardenCredential(matching target: BitwardenTarget) -> BitwardenCredentialTargetPolicy? {
        let matches = credentialTargets.compactMap { entry -> BitwardenCredentialTargetPolicy? in
            guard case .bitwardenUnlock(let value) = entry,
                  value.browserProfileId == target.profileIdentity,
                  value.extensionId == target.extensionId,
                  value.extensionVersion == target.extensionVersion,
                  value.extensionSourceDigest == target.chromeExecutableDigest,
                  value.extensionManifestDigest == target.manifestDigest else { return nil }
            return value
        }
        return matches.count == 1 ? matches[0] : nil
    }

    private func websiteCredential(matching target: WebsiteTarget) -> WebsiteCredentialTargetPolicy? {
        let matches = credentialTargets.compactMap { entry -> WebsiteCredentialTargetPolicy? in
            guard case .websiteAutofill(let value) = entry,
                  value.browserProfileId == target.profileIdentity,
                  value.extensionId == target.extensionId,
                  value.pairingId == target.credentialPairingId,
                  target.originSet == [value.origin.serialized],
                  credentialTargets.contains(where: { unlockEntry in
                      guard case .bitwardenUnlock(let unlock) = unlockEntry else { return false }
                      return unlock.credentialId == value.unlockCredentialId
                          && unlock.browserProfileId == target.profileIdentity
                          && unlock.extensionId == target.extensionId
                          && unlock.extensionVersion == target.extensionVersion
                          && unlock.extensionSourceDigest == target.chromeExecutableDigest
                          && unlock.extensionManifestDigest == target.manifestDigest
                  }) else { return nil }
            return value
        }
        return matches.count == 1 ? matches[0] : nil
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, version, canonicalStatus, active, policyId, policyDigest, policyDigestState
        case maximumBiometricAgeMilliseconds, brokerIdentity, caller, sockets, reviewer, jetKVM
        case verifiers, authorityKeys, trustedOmpCallers, operations, actions, credentialTargets
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(UInt32.self, forKey: .schemaVersion)
        version = try container.decode(UInt32.self, forKey: .version)
        canonicalStatus = try container.decode(CanonicalBrokerStatus.self, forKey: .canonicalStatus)
        active = try container.decode(Bool.self, forKey: .active)
        policyId = try container.decode(String.self, forKey: .policyId)
        policyDigest = try container.decode(String.self, forKey: .policyDigest)
        policyDigestState = try container.decode(PolicyDigestState.self, forKey: .policyDigestState)
        maximumBiometricAgeMilliseconds = try container.decode(UInt64.self, forKey: .maximumBiometricAgeMilliseconds)
        brokerIdentity = try container.decode(BrokerIdentityPolicy.self, forKey: .brokerIdentity)
        caller = try container.decode(CallerPolicy.self, forKey: .caller)
        sockets = try container.decode(SocketPolicy.self, forKey: .sockets)
        reviewer = try container.decode(ReviewerPolicy.self, forKey: .reviewer)
        jetKVM = try container.decode(JetKVMPolicy.self, forKey: .jetKVM)
        verifiers = try container.decode(VerifierPolicy.self, forKey: .verifiers)
        authorityKeys = try container.decode(AuthorityKeysPolicy.self, forKey: .authorityKeys)
        trustedOmpCallers = try container.decode([TrustedOmpCaller].self, forKey: .trustedOmpCallers)
        operations = try container.decode([OperationPolicy].self, forKey: .operations)
        actions = try container.decode([RegisteredAction].self, forKey: .actions)
        credentialTargets = try container.decode([CredentialTargetPolicy].self, forKey: .credentialTargets)
    }

    fileprivate func digestMaterial() throws -> Data {
        var normalized = self
        normalized.policyDigest = Self.inactiveDigestPlaceholder
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(normalized)
    }

    static func isDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66)
        }
    }

    private static func isNonzeroDigest(_ value: String) -> Bool {
        isDigest(value) && value != inactiveDigestPlaceholder
    }

    private static func isPolicyId(_ value: String) -> Bool {
        let bytes = value.utf8
        guard (1...96).contains(bytes.count), let first = bytes.first,
              isLowercaseAlphaNumeric(first) else { return false }
        return bytes.dropFirst().allSatisfy {
            isLowercaseAlphaNumeric($0) || $0 == 0x2d || $0 == 0x2e || $0 == 0x5f
        }
    }

    private static func isBoundedIdentifier(_ value: String) -> Bool {
        let bytes = value.utf8
        guard (1...128).contains(bytes.count), let first = bytes.first,
              isAlphaNumeric(first) else { return false }
        return bytes.dropFirst().allSatisfy {
            isAlphaNumeric($0) || $0 == 0x2d || $0 == 0x2e || $0 == 0x3a || $0 == 0x5f
        }
    }

    private static func isAbsolutePath(_ value: String) -> Bool {
        let bytes = value.utf8
        return (2...1_024).contains(bytes.count)
            && bytes.first == 0x2f
            && !bytes.contains(0)
            && !bytes.contains(0x0a)
            && !bytes.contains(0x0d)
    }

    private static func isBoundedText(_ value: String) -> Bool {
        (1...4_096).contains(value.utf8.count) && !value.utf8.contains(0)
    }

    private static func isKeyId(_ value: String) -> Bool {
        (16...86).contains(value.utf8.count) && value.utf8.allSatisfy(isURLSafeBase64)
    }

    private static func isEndpoint(_ value: String) -> Bool {
        let bytes = value.utf8
        guard (1...255).contains(bytes.count), let first = bytes.first, isAlphaNumeric(first) else { return false }
        return bytes.dropFirst().allSatisfy { isAlphaNumeric($0) || $0 == 0x2d || $0 == 0x2e }
    }

    private static func isUsername(_ value: String) -> Bool {
        let bytes = value.utf8
        guard (1...32).contains(bytes.count), let first = bytes.first,
              (first >= 0x61 && first <= 0x7a) || first == 0x5f else { return false }
        return bytes.dropFirst().allSatisfy {
            ($0 >= 0x61 && $0 <= 0x7a) || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x2d || $0 == 0x5f
        }
    }

    private static func isExtensionId(_ value: String) -> Bool {
        value.utf8.count == 32 && value.utf8.allSatisfy { $0 >= 0x61 && $0 <= 0x70 }
    }

    private static func isExtensionVersion(_ value: String) -> Bool {
        matches(value, pattern: "^[0-9]+(\\.[0-9]+){1,3}([._-][A-Za-z0-9]+)*$", maximumUTF8Count: 64)
    }

    private static func isHost(_ value: String) -> Bool {
        matches(value, pattern: "^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$", maximumUTF8Count: 253)
    }

    private static func isArgument(_ value: String) -> Bool {
        (1...1_024).contains(value.utf8.count)
            && !value.utf8.contains(0)
            && !value.utf8.contains(0x0a)
            && !value.utf8.contains(0x0d)
    }

    private static func matches(_ value: String, pattern: String, maximumUTF8Count: Int) -> Bool {
        guard !value.isEmpty, value.utf8.count <= maximumUTF8Count else { return false }
        return value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
    }

    private static func isLowercaseAlphaNumeric(_ byte: UInt8) -> Bool {
        (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x7a)
    }

    private static func isUppercaseAlphaNumeric(_ byte: UInt8) -> Bool {
        (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a)
    }

    private static func isAlphaNumeric(_ byte: UInt8) -> Bool {
        isLowercaseAlphaNumeric(byte) || (byte >= 0x41 && byte <= 0x5a)
    }

    private static func isURLSafeBase64(_ byte: UInt8) -> Bool {
        isAlphaNumeric(byte) || byte == 0x2d || byte == 0x5f
    }

    private static let forbiddenExecutables: Set<String> = [
        "/bin/bash", "/bin/csh", "/bin/dash", "/bin/ksh", "/bin/sh", "/bin/tcsh", "/bin/zsh",
        "/usr/bin/env", "/usr/bin/osascript", "/usr/bin/perl", "/usr/bin/python", "/usr/bin/python3", "/usr/bin/ruby"
    ]
}

public struct PolicyDecision: Sendable {
    public var risk: RiskLevel
    public var biometricPolicy: BiometricPolicy

    public init(risk: RiskLevel, biometricPolicy: BiometricPolicy) {
        self.risk = risk
        self.biometricPolicy = biometricPolicy
    }
}

public struct LoadedPolicy: Sendable {
    public var document: BrokerPolicy
    public var digest: String
    public var canonicalData: Data

    public init(document: BrokerPolicy, digest: String, canonicalData: Data) {
        self.document = document
        self.digest = digest
        self.canonicalData = canonicalData
    }
}

public enum PolicyLoader {
    public static let maximumPolicyBytes = 262_144

    public static func load(_ data: Data) throws -> LoadedPolicy {
        guard !data.isEmpty else { throw PolicyLoadError.empty }
        guard data.count <= maximumPolicyBytes else { throw PolicyLoadError.tooLarge }
        return try load(document: JSONDecoder().decode(BrokerPolicy.self, from: data))
    }

    public static func load(document: BrokerPolicy) throws -> LoadedPolicy {
        try document.validate()
        let digest = ProtocolCrypto.sha256Hex(try document.digestMaterial())
        if document.policyDigestState == .reviewed, document.policyDigest != digest {
            throw PolicyLoadError.digestMismatch
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return LoadedPolicy(document: document, digest: digest, canonicalData: try encoder.encode(document))
    }

    public static func reviewed(document: BrokerPolicy) throws -> LoadedPolicy {
        var reviewed = document
        reviewed.policyDigestState = .reviewed
        reviewed.policyDigest = BrokerPolicy.inactiveDigestPlaceholder
        reviewed.policyDigest = ProtocolCrypto.sha256Hex(try reviewed.digestMaterial())
        return try load(document: reviewed)
    }
}

extension BiometricPolicy {
    fileprivate func stricter(than other: BiometricPolicy) -> BiometricPolicy {
        self == .freshOneShotRequired || other == .freshOneShotRequired
            ? .freshOneShotRequired
            : .standingGrantOrOneShot
    }
}

extension RiskLevel {
    var authorityRank: Int {
        switch self {
        case .low: 0
        case .medium: 1
        case .high: 2
        case .critical: 3
        }
    }

    static func maximum(_ lhs: RiskLevel, _ rhs: RiskLevel) -> RiskLevel {
        lhs.authorityRank >= rhs.authorityRank ? lhs : rhs
    }

    func isAtMost(_ ceiling: RiskLevel) -> Bool { authorityRank <= ceiling.authorityRank }
}

private struct PolicyUnknownCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

extension Decoder {
    func rejectUnknownPolicyKeys<K>(_ keyType: K.Type) throws where K: CodingKey & CaseIterable {
        let container = try self.container(keyedBy: PolicyUnknownCodingKey.self)
        let allowed = Set(K.allCases.map(\.stringValue))
        if let unknown = container.allKeys.first(where: { !allowed.contains($0.stringValue) }) {
            throw PolicyLoadError.invalidValue("unknown key \(unknown.stringValue)")
        }
    }
}
