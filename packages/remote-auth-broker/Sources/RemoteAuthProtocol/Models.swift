import Foundation

public enum AuthorizationDomain: String, Codable, Sendable {
    case desktopBrowser = "desktop-browser"
    case sudo
}

public enum AuthorizationOperation: String, Codable, Sendable {
    case gdmLogin = "gdm-login"
    case bitwardenUnlock = "bitwarden-unlock"
    case websiteAutofill = "website-autofill"
    case sudo
}

public enum AuthorizationMode: String, Codable, Sendable {
    case delegated
    case biometricOneShot = "biometric-one-shot"
}

public enum RiskLevel: String, Codable, Sendable {
    case low
    case medium
    case high
    case critical
}

public enum RemoteHostPosture: String, Codable, Sendable {
    case empty
    case local
}

public struct Principal: Codable, Sendable {
    public var sessionId: String
    public var ownerEpoch: String
    public var pid: UInt32
    public var uid: UInt32
    public var codeIdentity: String
    public var buildDigest: String
    public var runnerInstanceIdentity: String
    public var ownershipSocketPath: String

    public init(sessionId: String, ownerEpoch: String, pid: UInt32, uid: UInt32, codeIdentity: String, buildDigest: String, runnerInstanceIdentity: String, ownershipSocketPath: String) {
        self.sessionId = sessionId
        self.ownerEpoch = ownerEpoch
        self.pid = pid
        self.uid = uid
        self.codeIdentity = codeIdentity
        self.buildDigest = buildDigest
        self.runnerInstanceIdentity = runnerInstanceIdentity
        self.ownershipSocketPath = ownershipSocketPath
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case sessionId, ownerEpoch, pid, uid, codeIdentity, buildDigest, runnerInstanceIdentity, ownershipSocketPath
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.decode(String.self, forKey: .sessionId)
        ownerEpoch = try container.decode(String.self, forKey: .ownerEpoch)
        pid = try container.decode(UInt32.self, forKey: .pid)
        uid = try container.decode(UInt32.self, forKey: .uid)
        codeIdentity = try container.decode(String.self, forKey: .codeIdentity)
        buildDigest = try container.decode(String.self, forKey: .buildDigest)
        runnerInstanceIdentity = try container.decode(String.self, forKey: .runnerInstanceIdentity)
        ownershipSocketPath = try container.decode(String.self, forKey: .ownershipSocketPath)
    }
}

public struct GDMTarget: Codable, Sendable {
    public var sshHostKeyDigest: String
    public var machineId: String
    public var bootId: String
    public var username: String
    public var uid: UInt32
    public var pamService: String
    public var seat: String
    public var tty: String
    public var rhost: RemoteHostPosture
    public var greeterGeneration: UInt64
    public var jetkvmDeviceId: String
    public var controllerGeneration: UInt64

    public init(sshHostKeyDigest: String, machineId: String, bootId: String, username: String, uid: UInt32, pamService: String = "gdm-password", seat: String, tty: String, rhost: RemoteHostPosture, greeterGeneration: UInt64, jetkvmDeviceId: String, controllerGeneration: UInt64) {
        self.sshHostKeyDigest = sshHostKeyDigest
        self.machineId = machineId
        self.bootId = bootId
        self.username = username
        self.uid = uid
        self.pamService = pamService
        self.seat = seat
        self.tty = tty
        self.rhost = rhost
        self.greeterGeneration = greeterGeneration
        self.jetkvmDeviceId = jetkvmDeviceId
        self.controllerGeneration = controllerGeneration
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, sshHostKeyDigest, machineId, bootId, username, uid, pamService, seat, tty, rhost, greeterGeneration, jetkvmDeviceId, controllerGeneration
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .kind) == "gdm" else { throw RemoteAuthProtocolError(.targetMismatch) }
        sshHostKeyDigest = try container.decode(String.self, forKey: .sshHostKeyDigest)
        machineId = try container.decode(String.self, forKey: .machineId)
        bootId = try container.decode(String.self, forKey: .bootId)
        username = try container.decode(String.self, forKey: .username)
        uid = try container.decode(UInt32.self, forKey: .uid)
        pamService = try container.decode(String.self, forKey: .pamService)
        seat = try container.decode(String.self, forKey: .seat)
        tty = try container.decode(String.self, forKey: .tty)
        rhost = try container.decode(RemoteHostPosture.self, forKey: .rhost)
        greeterGeneration = try container.decodeTime(forKey: .greeterGeneration)
        jetkvmDeviceId = try container.decode(String.self, forKey: .jetkvmDeviceId)
        controllerGeneration = try container.decodeTime(forKey: .controllerGeneration)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("gdm", forKey: .kind)
        try container.encode(sshHostKeyDigest, forKey: .sshHostKeyDigest)
        try container.encode(machineId, forKey: .machineId)
        try container.encode(bootId, forKey: .bootId)
        try container.encode(username, forKey: .username)
        try container.encode(uid, forKey: .uid)
        try container.encode(pamService, forKey: .pamService)
        try container.encode(seat, forKey: .seat)
        try container.encode(tty, forKey: .tty)
        try container.encode(rhost, forKey: .rhost)
        try container.encode(greeterGeneration, forKey: .greeterGeneration)
        try container.encode(jetkvmDeviceId, forKey: .jetkvmDeviceId)
        try container.encode(controllerGeneration, forKey: .controllerGeneration)
    }
}

public struct BitwardenTarget: Codable, Sendable {
    public var hostIdentity: String
    public var graphicalSessionId: String
    public var chromeService: String
    public var chromeExecutableDigest: String
    public var chromePid: UInt32
    public var profileIdentity: String
    public var browserTargetId: String
    public var windowId: String
    public var extensionId: String
    public var extensionVersion: String
    public var extensionSource: String
    public var manifestDigest: String
    public var uiTarget: String

    public init(hostIdentity: String, graphicalSessionId: String, chromeService: String, chromeExecutableDigest: String, chromePid: UInt32, profileIdentity: String, browserTargetId: String, windowId: String, extensionId: String, extensionVersion: String, extensionSource: String = "official-chrome-web-store", manifestDigest: String, uiTarget: String) {
        self.hostIdentity = hostIdentity
        self.graphicalSessionId = graphicalSessionId
        self.chromeService = chromeService
        self.chromeExecutableDigest = chromeExecutableDigest
        self.chromePid = chromePid
        self.profileIdentity = profileIdentity
        self.browserTargetId = browserTargetId
        self.windowId = windowId
        self.extensionId = extensionId
        self.extensionVersion = extensionVersion
        self.extensionSource = extensionSource
        self.manifestDigest = manifestDigest
        self.uiTarget = uiTarget
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, hostIdentity, graphicalSessionId, chromeService, chromeExecutableDigest, chromePid, profileIdentity, browserTargetId, windowId, extensionId, extensionVersion, extensionSource, manifestDigest, uiTarget
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .kind) == "bitwarden" else { throw RemoteAuthProtocolError(.targetMismatch) }
        hostIdentity = try container.decode(String.self, forKey: .hostIdentity)
        graphicalSessionId = try container.decode(String.self, forKey: .graphicalSessionId)
        chromeService = try container.decode(String.self, forKey: .chromeService)
        chromeExecutableDigest = try container.decode(String.self, forKey: .chromeExecutableDigest)
        chromePid = try container.decode(UInt32.self, forKey: .chromePid)
        profileIdentity = try container.decode(String.self, forKey: .profileIdentity)
        browserTargetId = try container.decode(String.self, forKey: .browserTargetId)
        windowId = try container.decode(String.self, forKey: .windowId)
        extensionId = try container.decode(String.self, forKey: .extensionId)
        extensionVersion = try container.decode(String.self, forKey: .extensionVersion)
        extensionSource = try container.decode(String.self, forKey: .extensionSource)
        manifestDigest = try container.decode(String.self, forKey: .manifestDigest)
        uiTarget = try container.decode(String.self, forKey: .uiTarget)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("bitwarden", forKey: .kind)
        try container.encode(hostIdentity, forKey: .hostIdentity)
        try container.encode(graphicalSessionId, forKey: .graphicalSessionId)
        try container.encode(chromeService, forKey: .chromeService)
        try container.encode(chromeExecutableDigest, forKey: .chromeExecutableDigest)
        try container.encode(chromePid, forKey: .chromePid)
        try container.encode(profileIdentity, forKey: .profileIdentity)
        try container.encode(browserTargetId, forKey: .browserTargetId)
        try container.encode(windowId, forKey: .windowId)
        try container.encode(extensionId, forKey: .extensionId)
        try container.encode(extensionVersion, forKey: .extensionVersion)
        try container.encode(extensionSource, forKey: .extensionSource)
        try container.encode(manifestDigest, forKey: .manifestDigest)
        try container.encode(uiTarget, forKey: .uiTarget)
    }
}

public struct WebsiteTarget: Codable, Sendable {
    public var hostIdentity: String
    public var graphicalSessionId: String
    public var chromeService: String
    public var chromeExecutableDigest: String
    public var chromePid: UInt32
    public var profileIdentity: String
    public var browserTargetId: String
    public var windowId: String
    public var extensionId: String
    public var extensionVersion: String
    public var extensionSource: String
    public var manifestDigest: String
    public var uiTarget: String
    public var originSet: [String]
    public var activeTabId: String
    public var frameId: String
    public var formActionOrigin: String
    public var foregroundWindowId: String
    public var credentialPairingId: String

    public init(hostIdentity: String, graphicalSessionId: String, chromeService: String, chromeExecutableDigest: String, chromePid: UInt32, profileIdentity: String, browserTargetId: String, windowId: String, extensionId: String, extensionVersion: String, extensionSource: String = "official-chrome-web-store", manifestDigest: String, uiTarget: String, originSet: [String], activeTabId: String, frameId: String, formActionOrigin: String, foregroundWindowId: String, credentialPairingId: String) {
        self.hostIdentity = hostIdentity
        self.graphicalSessionId = graphicalSessionId
        self.chromeService = chromeService
        self.chromeExecutableDigest = chromeExecutableDigest
        self.chromePid = chromePid
        self.profileIdentity = profileIdentity
        self.browserTargetId = browserTargetId
        self.windowId = windowId
        self.extensionId = extensionId
        self.extensionVersion = extensionVersion
        self.extensionSource = extensionSource
        self.manifestDigest = manifestDigest
        self.uiTarget = uiTarget
        self.originSet = originSet
        self.activeTabId = activeTabId
        self.frameId = frameId
        self.formActionOrigin = formActionOrigin
        self.foregroundWindowId = foregroundWindowId
        self.credentialPairingId = credentialPairingId
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, hostIdentity, graphicalSessionId, chromeService, chromeExecutableDigest, chromePid, profileIdentity, browserTargetId, windowId, extensionId, extensionVersion, extensionSource, manifestDigest, uiTarget, originSet, activeTabId, frameId, formActionOrigin, foregroundWindowId, credentialPairingId
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .kind) == "website" else { throw RemoteAuthProtocolError(.targetMismatch) }
        hostIdentity = try container.decode(String.self, forKey: .hostIdentity)
        graphicalSessionId = try container.decode(String.self, forKey: .graphicalSessionId)
        chromeService = try container.decode(String.self, forKey: .chromeService)
        chromeExecutableDigest = try container.decode(String.self, forKey: .chromeExecutableDigest)
        chromePid = try container.decode(UInt32.self, forKey: .chromePid)
        profileIdentity = try container.decode(String.self, forKey: .profileIdentity)
        browserTargetId = try container.decode(String.self, forKey: .browserTargetId)
        windowId = try container.decode(String.self, forKey: .windowId)
        extensionId = try container.decode(String.self, forKey: .extensionId)
        extensionVersion = try container.decode(String.self, forKey: .extensionVersion)
        extensionSource = try container.decode(String.self, forKey: .extensionSource)
        manifestDigest = try container.decode(String.self, forKey: .manifestDigest)
        uiTarget = try container.decode(String.self, forKey: .uiTarget)
        originSet = try container.decode([String].self, forKey: .originSet)
        activeTabId = try container.decode(String.self, forKey: .activeTabId)
        frameId = try container.decode(String.self, forKey: .frameId)
        formActionOrigin = try container.decode(String.self, forKey: .formActionOrigin)
        foregroundWindowId = try container.decode(String.self, forKey: .foregroundWindowId)
        credentialPairingId = try container.decode(String.self, forKey: .credentialPairingId)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("website", forKey: .kind)
        try container.encode(hostIdentity, forKey: .hostIdentity)
        try container.encode(graphicalSessionId, forKey: .graphicalSessionId)
        try container.encode(chromeService, forKey: .chromeService)
        try container.encode(chromeExecutableDigest, forKey: .chromeExecutableDigest)
        try container.encode(chromePid, forKey: .chromePid)
        try container.encode(profileIdentity, forKey: .profileIdentity)
        try container.encode(browserTargetId, forKey: .browserTargetId)
        try container.encode(windowId, forKey: .windowId)
        try container.encode(extensionId, forKey: .extensionId)
        try container.encode(extensionVersion, forKey: .extensionVersion)
        try container.encode(extensionSource, forKey: .extensionSource)
        try container.encode(manifestDigest, forKey: .manifestDigest)
        try container.encode(uiTarget, forKey: .uiTarget)
        try container.encode(originSet, forKey: .originSet)
        try container.encode(activeTabId, forKey: .activeTabId)
        try container.encode(frameId, forKey: .frameId)
        try container.encode(formActionOrigin, forKey: .formActionOrigin)
        try container.encode(foregroundWindowId, forKey: .foregroundWindowId)
        try container.encode(credentialPairingId, forKey: .credentialPairingId)
    }
}

public struct SudoTarget: Codable, Sendable {
    public var sshHostKeyDigest: String
    public var machineId: String
    public var bootId: String
    public var username: String
    public var uid: UInt32
    public var sudoPolicyDigest: String
    public var actionId: String
    public var executable: String
    public var argvDigest: String

    public init(sshHostKeyDigest: String, machineId: String, bootId: String, username: String, uid: UInt32, sudoPolicyDigest: String, actionId: String, executable: String, argvDigest: String) {
        self.sshHostKeyDigest = sshHostKeyDigest
        self.machineId = machineId
        self.bootId = bootId
        self.username = username
        self.uid = uid
        self.sudoPolicyDigest = sudoPolicyDigest
        self.actionId = actionId
        self.executable = executable
        self.argvDigest = argvDigest
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, sshHostKeyDigest, machineId, bootId, username, uid, sudoPolicyDigest, actionId, executable, argvDigest
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .kind) == "sudo" else { throw RemoteAuthProtocolError(.targetMismatch) }
        sshHostKeyDigest = try container.decode(String.self, forKey: .sshHostKeyDigest)
        machineId = try container.decode(String.self, forKey: .machineId)
        bootId = try container.decode(String.self, forKey: .bootId)
        username = try container.decode(String.self, forKey: .username)
        uid = try container.decode(UInt32.self, forKey: .uid)
        sudoPolicyDigest = try container.decode(String.self, forKey: .sudoPolicyDigest)
        actionId = try container.decode(String.self, forKey: .actionId)
        executable = try container.decode(String.self, forKey: .executable)
        argvDigest = try container.decode(String.self, forKey: .argvDigest)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("sudo", forKey: .kind)
        try container.encode(sshHostKeyDigest, forKey: .sshHostKeyDigest)
        try container.encode(machineId, forKey: .machineId)
        try container.encode(bootId, forKey: .bootId)
        try container.encode(username, forKey: .username)
        try container.encode(uid, forKey: .uid)
        try container.encode(sudoPolicyDigest, forKey: .sudoPolicyDigest)
        try container.encode(actionId, forKey: .actionId)
        try container.encode(executable, forKey: .executable)
        try container.encode(argvDigest, forKey: .argvDigest)
    }
}

public enum ExecutionTarget: Codable, Sendable {
    case gdm(GDMTarget)
    case bitwarden(BitwardenTarget)
    case website(WebsiteTarget)
    case sudo(SudoTarget)

    private enum KindKeys: String, CodingKey { case kind }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: KindKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "gdm": self = .gdm(try GDMTarget(from: decoder))
        case "bitwarden": self = .bitwarden(try BitwardenTarget(from: decoder))
        case "website": self = .website(try WebsiteTarget(from: decoder))
        case "sudo": self = .sudo(try SudoTarget(from: decoder))
        default: throw RemoteAuthProtocolError(.targetMismatch)
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .gdm(let target): try target.encode(to: encoder)
        case .bitwarden(let target): try target.encode(to: encoder)
        case .website(let target): try target.encode(to: encoder)
        case .sudo(let target): try target.encode(to: encoder)
        }
    }
}

public struct ExecutionRequest: WireMessage {
    public var protocolVersion: UInt32
    public var requestId: String
    public var nonce: String
    public var createdAt: UInt64
    public var expiresAt: UInt64
    public var principal: Principal
    public var authorizationModeRequested: AuthorizationMode
    public var domain: AuthorizationDomain
    public var operation: AuthorizationOperation
    public var target: ExecutionTarget
    public var purpose: String
    public var grantId: String?

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, requestId: String, nonce: String, createdAt: UInt64, expiresAt: UInt64, principal: Principal, authorizationModeRequested: AuthorizationMode, domain: AuthorizationDomain, operation: AuthorizationOperation, target: ExecutionTarget, purpose: String, grantId: String?) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.nonce = nonce
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.principal = principal
        self.authorizationModeRequested = authorizationModeRequested
        self.domain = domain
        self.operation = operation
        self.target = target
        self.purpose = purpose
        self.grantId = grantId
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, requestId, nonce, createdAt, expiresAt, principal, authorizationModeRequested, domain, operation, target, purpose, grantId
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        requestId = try container.decode(String.self, forKey: .requestId)
        nonce = try container.decode(String.self, forKey: .nonce)
        createdAt = try container.decodeTime(forKey: .createdAt)
        expiresAt = try container.decodeTime(forKey: .expiresAt)
        principal = try container.decode(Principal.self, forKey: .principal)
        authorizationModeRequested = try container.decode(AuthorizationMode.self, forKey: .authorizationModeRequested)
        domain = try container.decode(AuthorizationDomain.self, forKey: .domain)
        operation = try container.decode(AuthorizationOperation.self, forKey: .operation)
        target = try container.decode(ExecutionTarget.self, forKey: .target)
        purpose = try container.decode(String.self, forKey: .purpose)
        grantId = try container.decodeRequiredNullable(String.self, forKey: .grantId)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(nonce, forKey: .nonce)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(expiresAt, forKey: .expiresAt)
        try container.encode(principal, forKey: .principal)
        try container.encode(authorizationModeRequested, forKey: .authorizationModeRequested)
        try container.encode(domain, forKey: .domain)
        try container.encode(operation, forKey: .operation)
        try container.encode(target, forKey: .target)
        try container.encode(purpose, forKey: .purpose)
        try container.encodeRequiredNullable(grantId, forKey: .grantId)
    }
}

public struct PrincipalSelector: Codable, Sendable {
    public var sessionId: String
    public var ownerEpoch: String
    public var uid: UInt32
    public var codeIdentity: String
    public var buildDigest: String

    public init(sessionId: String, ownerEpoch: String, uid: UInt32, codeIdentity: String, buildDigest: String) {
        self.sessionId = sessionId
        self.ownerEpoch = ownerEpoch
        self.uid = uid
        self.codeIdentity = codeIdentity
        self.buildDigest = buildDigest
    }

    enum CodingKeys: String, CodingKey, CaseIterable { case sessionId, ownerEpoch, uid, codeIdentity, buildDigest }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.decode(String.self, forKey: .sessionId)
        ownerEpoch = try container.decode(String.self, forKey: .ownerEpoch)
        uid = try container.decode(UInt32.self, forKey: .uid)
        codeIdentity = try container.decode(String.self, forKey: .codeIdentity)
        buildDigest = try container.decode(String.self, forKey: .buildDigest)
    }
}

public enum GrantLifecycleState: String, Codable, Sendable {
    case active, consumed, expired, revoked, invalidated
}

public struct Grant: WireMessage {
    public var protocolVersion: UInt32
    public var grantId: String
    public var principalSelector: PrincipalSelector
    public var domain: AuthorizationDomain
    public var operation: AuthorizationOperation
    public var targetPredicate: ExecutionTarget
    public var riskCeiling: RiskLevel
    public var issuedAt: UInt64
    public var expiresAt: UInt64
    public var revokedAt: UInt64?
    public var consumedAt: UInt64?
    public var policyDigest: String
    public var brokerBuildDigest: String
    public var brokerCodeIdentity: String
    public var biometricEvidenceId: String
    public var biometricIssuedAt: UInt64
    public var lifecycleState: GrantLifecycleState

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, grantId: String, principalSelector: PrincipalSelector, domain: AuthorizationDomain, operation: AuthorizationOperation, targetPredicate: ExecutionTarget, riskCeiling: RiskLevel, issuedAt: UInt64, expiresAt: UInt64, revokedAt: UInt64?, consumedAt: UInt64?, policyDigest: String, brokerBuildDigest: String, brokerCodeIdentity: String, biometricEvidenceId: String, biometricIssuedAt: UInt64, lifecycleState: GrantLifecycleState) {
        self.protocolVersion = protocolVersion
        self.grantId = grantId
        self.principalSelector = principalSelector
        self.domain = domain
        self.operation = operation
        self.targetPredicate = targetPredicate
        self.riskCeiling = riskCeiling
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
        self.revokedAt = revokedAt
        self.consumedAt = consumedAt
        self.policyDigest = policyDigest
        self.brokerBuildDigest = brokerBuildDigest
        self.brokerCodeIdentity = brokerCodeIdentity
        self.biometricEvidenceId = biometricEvidenceId
        self.biometricIssuedAt = biometricIssuedAt
        self.lifecycleState = lifecycleState
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, grantId, principalSelector, domain, operation, targetPredicate, riskCeiling, issuedAt, expiresAt, revokedAt, consumedAt, policyDigest, brokerBuildDigest, brokerCodeIdentity, biometricEvidenceId, biometricIssuedAt, lifecycleState
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        grantId = try container.decode(String.self, forKey: .grantId)
        principalSelector = try container.decode(PrincipalSelector.self, forKey: .principalSelector)
        domain = try container.decode(AuthorizationDomain.self, forKey: .domain)
        operation = try container.decode(AuthorizationOperation.self, forKey: .operation)
        targetPredicate = try container.decode(ExecutionTarget.self, forKey: .targetPredicate)
        riskCeiling = try container.decode(RiskLevel.self, forKey: .riskCeiling)
        issuedAt = try container.decodeTime(forKey: .issuedAt)
        expiresAt = try container.decodeTime(forKey: .expiresAt)
        revokedAt = try container.decodeOptionalTime(forKey: .revokedAt)
        consumedAt = try container.decodeOptionalTime(forKey: .consumedAt)
        policyDigest = try container.decode(String.self, forKey: .policyDigest)
        brokerBuildDigest = try container.decode(String.self, forKey: .brokerBuildDigest)
        brokerCodeIdentity = try container.decode(String.self, forKey: .brokerCodeIdentity)
        biometricEvidenceId = try container.decode(String.self, forKey: .biometricEvidenceId)
        biometricIssuedAt = try container.decodeTime(forKey: .biometricIssuedAt)
        lifecycleState = try container.decode(GrantLifecycleState.self, forKey: .lifecycleState)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(grantId, forKey: .grantId)
        try container.encode(principalSelector, forKey: .principalSelector)
        try container.encode(domain, forKey: .domain)
        try container.encode(operation, forKey: .operation)
        try container.encode(targetPredicate, forKey: .targetPredicate)
        try container.encode(riskCeiling, forKey: .riskCeiling)
        try container.encode(issuedAt, forKey: .issuedAt)
        try container.encode(expiresAt, forKey: .expiresAt)
        try container.encodeRequiredNullable(revokedAt, forKey: .revokedAt)
        try container.encodeRequiredNullable(consumedAt, forKey: .consumedAt)
        try container.encode(policyDigest, forKey: .policyDigest)
        try container.encode(brokerBuildDigest, forKey: .brokerBuildDigest)
        try container.encode(brokerCodeIdentity, forKey: .brokerCodeIdentity)
        try container.encode(biometricEvidenceId, forKey: .biometricEvidenceId)
        try container.encode(biometricIssuedAt, forKey: .biometricIssuedAt)
        try container.encode(lifecycleState, forKey: .lifecycleState)
    }
}

public struct ReceiptEvents: Codable, Sendable {
    public var requestedAt: UInt64
    public var authorizedAt: UInt64?
    public var executingAt: UInt64?
    public var terminalAt: UInt64?

    public init(requestedAt: UInt64, authorizedAt: UInt64?, executingAt: UInt64?, terminalAt: UInt64?) {
        self.requestedAt = requestedAt
        self.authorizedAt = authorizedAt
        self.executingAt = executingAt
        self.terminalAt = terminalAt
    }

    enum CodingKeys: String, CodingKey, CaseIterable { case requestedAt, authorizedAt, executingAt, terminalAt }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        requestedAt = try container.decodeTime(forKey: .requestedAt)
        authorizedAt = try container.decodeOptionalTime(forKey: .authorizedAt)
        executingAt = try container.decodeOptionalTime(forKey: .executingAt)
        terminalAt = try container.decodeOptionalTime(forKey: .terminalAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(requestedAt, forKey: .requestedAt)
        try container.encodeRequiredNullable(authorizedAt, forKey: .authorizedAt)
        try container.encodeRequiredNullable(executingAt, forKey: .executingAt)
        try container.encodeRequiredNullable(terminalAt, forKey: .terminalAt)
    }
}

public enum ReceiptState: String, Codable, Sendable {
    case requested, authorized, executing, succeeded, failed, cancelled, expired, revoked, disabled
}

public enum TargetReleaseDisposition: String, Codable, Sendable {
    case notApplicable = "not-applicable"
    case quarantined, destroyed, closed
}

public struct ReceiptMetadata: WireMessage {
    public var protocolVersion: UInt32
    public var receiptId: String
    public var requestId: String
    public var grantId: String?
    public var domain: AuthorizationDomain
    public var operation: AuthorizationOperation
    public var authorizationModeUsed: AuthorizationMode
    public var targetFingerprint: String
    public var state: ReceiptState
    public var errorCode: PublicError?
    public var events: ReceiptEvents
    public var policyDigest: String
    public var brokerBuildDigest: String
    public var brokerCodeDigest: String
    public var targetReleaseDisposition: TargetReleaseDisposition
    public var browserTargetGeneration: UInt64?

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, receiptId: String, requestId: String, grantId: String?, domain: AuthorizationDomain, operation: AuthorizationOperation, authorizationModeUsed: AuthorizationMode, targetFingerprint: String, state: ReceiptState, errorCode: PublicError?, events: ReceiptEvents, policyDigest: String, brokerBuildDigest: String, brokerCodeDigest: String, targetReleaseDisposition: TargetReleaseDisposition, browserTargetGeneration: UInt64?) {
        self.protocolVersion = protocolVersion
        self.receiptId = receiptId
        self.requestId = requestId
        self.grantId = grantId
        self.domain = domain
        self.operation = operation
        self.authorizationModeUsed = authorizationModeUsed
        self.targetFingerprint = targetFingerprint
        self.state = state
        self.errorCode = errorCode
        self.events = events
        self.policyDigest = policyDigest
        self.brokerBuildDigest = brokerBuildDigest
        self.brokerCodeDigest = brokerCodeDigest
        self.targetReleaseDisposition = targetReleaseDisposition
        self.browserTargetGeneration = browserTargetGeneration
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, receiptId, requestId, grantId, domain, operation, authorizationModeUsed, targetFingerprint, state, errorCode, events, policyDigest, brokerBuildDigest, brokerCodeDigest, targetReleaseDisposition, browserTargetGeneration
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        receiptId = try container.decode(String.self, forKey: .receiptId)
        requestId = try container.decode(String.self, forKey: .requestId)
        grantId = try container.decodeRequiredNullable(String.self, forKey: .grantId)
        domain = try container.decode(AuthorizationDomain.self, forKey: .domain)
        operation = try container.decode(AuthorizationOperation.self, forKey: .operation)
        authorizationModeUsed = try container.decode(AuthorizationMode.self, forKey: .authorizationModeUsed)
        targetFingerprint = try container.decode(String.self, forKey: .targetFingerprint)
        state = try container.decode(ReceiptState.self, forKey: .state)
        errorCode = try container.decodeRequiredNullable(PublicError.self, forKey: .errorCode)
        events = try container.decode(ReceiptEvents.self, forKey: .events)
        policyDigest = try container.decode(String.self, forKey: .policyDigest)
        brokerBuildDigest = try container.decode(String.self, forKey: .brokerBuildDigest)
        brokerCodeDigest = try container.decode(String.self, forKey: .brokerCodeDigest)
        targetReleaseDisposition = try container.decode(TargetReleaseDisposition.self, forKey: .targetReleaseDisposition)
        browserTargetGeneration = try container.decodeOptionalTime(forKey: .browserTargetGeneration)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(receiptId, forKey: .receiptId)
        try container.encode(requestId, forKey: .requestId)
        try container.encodeRequiredNullable(grantId, forKey: .grantId)
        try container.encode(domain, forKey: .domain)
        try container.encode(operation, forKey: .operation)
        try container.encode(authorizationModeUsed, forKey: .authorizationModeUsed)
        try container.encode(targetFingerprint, forKey: .targetFingerprint)
        try container.encode(state, forKey: .state)
        try container.encodeRequiredNullable(errorCode, forKey: .errorCode)
        try container.encode(events, forKey: .events)
        try container.encode(policyDigest, forKey: .policyDigest)
        try container.encode(brokerBuildDigest, forKey: .brokerBuildDigest)
        try container.encode(brokerCodeDigest, forKey: .brokerCodeDigest)
        try container.encode(targetReleaseDisposition, forKey: .targetReleaseDisposition)
        try container.encodeRequiredNullable(browserTargetGeneration, forKey: .browserTargetGeneration)
    }
}

public struct EndpointStatus: Codable, Equatable, Sendable {
    public var ready: Bool
    public var errorCode: PublicError?

    public init(ready: Bool, errorCode: PublicError?) {
        self.ready = ready
        self.errorCode = errorCode
    }

    enum CodingKeys: String, CodingKey, CaseIterable { case ready, errorCode }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ready = try container.decode(Bool.self, forKey: .ready)
        errorCode = try container.decodeRequiredNullable(PublicError.self, forKey: .errorCode)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ready, forKey: .ready)
        try container.encodeRequiredNullable(errorCode, forKey: .errorCode)
    }
}

public enum CanonicalBrokerStatus: String, Codable, Sendable {
    case designInactive = "DESIGN/INACTIVE"
    case active = "ACTIVE"
    case disabled = "DISABLED"
    case degraded = "DEGRADED"
}

public enum SocketPosture: String, Codable, Sendable {
    case absent
    case ownerOnly = "owner-only"
    case invalid
}

public struct PublicStatusMetadata: WireMessage {
    public var protocolVersion: UInt32
    public var canonicalStatus: CanonicalBrokerStatus
    public var policyDigest: String?
    public var installedBuildDigest: String?
    public var runningBuildDigest: String?
    public var codeIdentity: String?
    public var pid: UInt32?
    public var socketPosture: SocketPosture
    public var jetkvmControllerGeneration: UInt64?
    public var gdm: EndpointStatus
    public var browser: EndpointStatus
    public var sudo: EndpointStatus
    public var errors: [PublicError]

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, canonicalStatus: CanonicalBrokerStatus, policyDigest: String?, installedBuildDigest: String?, runningBuildDigest: String?, codeIdentity: String?, pid: UInt32?, socketPosture: SocketPosture, jetkvmControllerGeneration: UInt64?, gdm: EndpointStatus, browser: EndpointStatus, sudo: EndpointStatus, errors: [PublicError]) {
        self.protocolVersion = protocolVersion
        self.canonicalStatus = canonicalStatus
        self.policyDigest = policyDigest
        self.installedBuildDigest = installedBuildDigest
        self.runningBuildDigest = runningBuildDigest
        self.codeIdentity = codeIdentity
        self.pid = pid
        self.socketPosture = socketPosture
        self.jetkvmControllerGeneration = jetkvmControllerGeneration
        self.gdm = gdm
        self.browser = browser
        self.sudo = sudo
        self.errors = errors
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, canonicalStatus, policyDigest, installedBuildDigest, runningBuildDigest, codeIdentity, pid, socketPosture, jetkvmControllerGeneration, gdm, browser, sudo, errors
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        canonicalStatus = try container.decode(CanonicalBrokerStatus.self, forKey: .canonicalStatus)
        policyDigest = try container.decodeRequiredNullable(String.self, forKey: .policyDigest)
        installedBuildDigest = try container.decodeRequiredNullable(String.self, forKey: .installedBuildDigest)
        runningBuildDigest = try container.decodeRequiredNullable(String.self, forKey: .runningBuildDigest)
        codeIdentity = try container.decodeRequiredNullable(String.self, forKey: .codeIdentity)
        pid = try container.decodeRequiredNullable(UInt32.self, forKey: .pid)
        socketPosture = try container.decode(SocketPosture.self, forKey: .socketPosture)
        jetkvmControllerGeneration = try container.decodeOptionalTime(forKey: .jetkvmControllerGeneration)
        gdm = try container.decode(EndpointStatus.self, forKey: .gdm)
        browser = try container.decode(EndpointStatus.self, forKey: .browser)
        sudo = try container.decode(EndpointStatus.self, forKey: .sudo)
        errors = try container.decode([PublicError].self, forKey: .errors)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(canonicalStatus, forKey: .canonicalStatus)
        try container.encodeRequiredNullable(policyDigest, forKey: .policyDigest)
        try container.encodeRequiredNullable(installedBuildDigest, forKey: .installedBuildDigest)
        try container.encodeRequiredNullable(runningBuildDigest, forKey: .runningBuildDigest)
        try container.encodeRequiredNullable(codeIdentity, forKey: .codeIdentity)
        try container.encodeRequiredNullable(pid, forKey: .pid)
        try container.encode(socketPosture, forKey: .socketPosture)
        try container.encodeRequiredNullable(jetkvmControllerGeneration, forKey: .jetkvmControllerGeneration)
        try container.encode(gdm, forKey: .gdm)
        try container.encode(browser, forKey: .browser)
        try container.encode(sudo, forKey: .sudo)
        try container.encode(errors, forKey: .errors)
    }
}

public enum ControlRequest: WireMessage {
    case requestState(requestId: String)
    case cancel(requestId: String)
    case grantList
    case grantRevoke(grantId: String)
    case grantExpire(grantId: String)
    case credentialForget(credentialId: String)
    case emergencyDisable(reason: String)
    case reEnable
    case status

    enum CodingKeys: String, CodingKey, CaseIterable { case action, requestId, grantId, credentialId, reason }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: AnyCodingKey.self)
        guard let actionKey = AnyCodingKey(stringValue: "action"), dynamic.contains(actionKey) else { throw RemoteAuthProtocolError(.protocolInvalid) }
        let action = try dynamic.decode(String.self, forKey: actionKey)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let allowed: Set<String>
        switch action {
        case "request-state": allowed = ["action", "requestId"]; self = .requestState(requestId: try container.decode(String.self, forKey: .requestId))
        case "cancel": allowed = ["action", "requestId"]; self = .cancel(requestId: try container.decode(String.self, forKey: .requestId))
        case "grant-list": allowed = ["action"]; self = .grantList
        case "grant-revoke": allowed = ["action", "grantId"]; self = .grantRevoke(grantId: try container.decode(String.self, forKey: .grantId))
        case "grant-expire": allowed = ["action", "grantId"]; self = .grantExpire(grantId: try container.decode(String.self, forKey: .grantId))
        case "credential-forget": allowed = ["action", "credentialId"]; self = .credentialForget(credentialId: try container.decode(String.self, forKey: .credentialId))
        case "emergency-disable": allowed = ["action", "reason"]; self = .emergencyDisable(reason: try container.decode(String.self, forKey: .reason))
        case "re-enable": allowed = ["action"]; self = .reEnable
        case "status": allowed = ["action"]; self = .status
        default: throw RemoteAuthProtocolError(.protocolInvalid)
        }
        guard dynamic.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else { throw RemoteAuthProtocolError(.excessField) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .requestState(let requestId): try container.encode("request-state", forKey: .action); try container.encode(requestId, forKey: .requestId)
        case .cancel(let requestId): try container.encode("cancel", forKey: .action); try container.encode(requestId, forKey: .requestId)
        case .grantList: try container.encode("grant-list", forKey: .action)
        case .grantRevoke(let grantId): try container.encode("grant-revoke", forKey: .action); try container.encode(grantId, forKey: .grantId)
        case .grantExpire(let grantId): try container.encode("grant-expire", forKey: .action); try container.encode(grantId, forKey: .grantId)
        case .credentialForget(let credentialId): try container.encode("credential-forget", forKey: .action); try container.encode(credentialId, forKey: .credentialId)
        case .emergencyDisable(let reason): try container.encode("emergency-disable", forKey: .action); try container.encode(reason, forKey: .reason)
        case .reEnable: try container.encode("re-enable", forKey: .action)
        case .status: try container.encode("status", forKey: .action)
        }
    }
}
