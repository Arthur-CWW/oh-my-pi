import Foundation
import RemoteAuthProtocol

public struct RuntimeIdentity: Codable, Sendable {
    public var buildDigest: String
    public var codeIdentity: String
    public var codeDigest: String
    public var teamIdentifier: String

    public init(buildDigest: String, codeIdentity: String, codeDigest: String, teamIdentifier: String) {
        self.buildDigest = buildDigest
        self.codeIdentity = codeIdentity
        self.codeDigest = codeDigest
        self.teamIdentifier = teamIdentifier
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case buildDigest, codeIdentity, codeDigest, teamIdentifier
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        buildDigest = try container.decode(String.self, forKey: .buildDigest)
        codeIdentity = try container.decode(String.self, forKey: .codeIdentity)
        codeDigest = try container.decode(String.self, forKey: .codeDigest)
        teamIdentifier = try container.decode(String.self, forKey: .teamIdentifier)
    }
}

/// Values independently attested from the connected process and current OMP ownership view.
public struct PeerMatchInput: Codable, Sendable {
    public var pid: UInt32
    public var uid: UInt32
    public var signingIdentifier: String
    public var teamIdentifier: String
    public var executableSHA256: String
    public var designatedRequirement: String
    public var liveSessionId: String
    public var liveOwnerEpoch: String
    public var liveRunnerInstanceIdentity: String

    public init(
        pid: UInt32,
        uid: UInt32,
        signingIdentifier: String,
        teamIdentifier: String,
        executableSHA256: String,
        designatedRequirement: String,
        liveSessionId: String,
        liveOwnerEpoch: String,
        liveRunnerInstanceIdentity: String
    ) {
        self.pid = pid
        self.uid = uid
        self.signingIdentifier = signingIdentifier
        self.teamIdentifier = teamIdentifier
        self.executableSHA256 = executableSHA256
        self.designatedRequirement = designatedRequirement
        self.liveSessionId = liveSessionId
        self.liveOwnerEpoch = liveOwnerEpoch
        self.liveRunnerInstanceIdentity = liveRunnerInstanceIdentity
    }

    public func matches(_ principal: Principal) -> Bool {
        principal.pid == pid
            && principal.uid == uid
            && principal.codeIdentity == signingIdentifier
            && principal.buildDigest == executableSHA256
            && principal.sessionId == liveSessionId
            && principal.ownerEpoch == liveOwnerEpoch
            && principal.runnerInstanceIdentity == liveRunnerInstanceIdentity
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case pid, uid, signingIdentifier, teamIdentifier, executableSHA256, designatedRequirement
        case liveSessionId, liveOwnerEpoch, liveRunnerInstanceIdentity
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        pid = try container.decode(UInt32.self, forKey: .pid)
        uid = try container.decode(UInt32.self, forKey: .uid)
        signingIdentifier = try container.decode(String.self, forKey: .signingIdentifier)
        teamIdentifier = try container.decode(String.self, forKey: .teamIdentifier)
        executableSHA256 = try container.decode(String.self, forKey: .executableSHA256)
        designatedRequirement = try container.decode(String.self, forKey: .designatedRequirement)
        liveSessionId = try container.decode(String.self, forKey: .liveSessionId)
        liveOwnerEpoch = try container.decode(String.self, forKey: .liveOwnerEpoch)
        liveRunnerInstanceIdentity = try container.decode(String.self, forKey: .liveRunnerInstanceIdentity)
    }
}

public enum BiometricAuthorizationScope: Sendable {
    case createGrant(grantId: String)
    case expandGrant(grantId: String)
    case execution(requestId: String, bodyDigest: String)
    case reenable(transactionId: String)
}

extension BiometricAuthorizationScope: Codable {
    private enum CodingKeys: String, CodingKey, CaseIterable { case kind, subjectId, bodyDigest }
    private enum Kind: String, Codable {
        case createGrant, expandGrant, execution, reenable
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .kind)
        let subjectId = try container.decode(String.self, forKey: .subjectId)
        switch kind {
        case .createGrant:
            guard !container.contains(.bodyDigest) else { throw RemoteAuthProtocolError(.noncanonicalValue) }
            self = .createGrant(grantId: subjectId)
        case .expandGrant:
            guard !container.contains(.bodyDigest) else { throw RemoteAuthProtocolError(.noncanonicalValue) }
            self = .expandGrant(grantId: subjectId)
        case .execution:
            self = .execution(
                requestId: subjectId,
                bodyDigest: try container.decode(String.self, forKey: .bodyDigest)
            )
        case .reenable:
            guard !container.contains(.bodyDigest) else { throw RemoteAuthProtocolError(.noncanonicalValue) }
            self = .reenable(transactionId: subjectId)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .createGrant(let grantId):
            try container.encode(Kind.createGrant, forKey: .kind)
            try container.encode(grantId, forKey: .subjectId)
        case .expandGrant(let grantId):
            try container.encode(Kind.expandGrant, forKey: .kind)
            try container.encode(grantId, forKey: .subjectId)
        case .execution(let requestId, let bodyDigest):
            try container.encode(Kind.execution, forKey: .kind)
            try container.encode(requestId, forKey: .subjectId)
            try container.encode(bodyDigest, forKey: .bodyDigest)
        case .reenable(let transactionId):
            try container.encode(Kind.reenable, forKey: .kind)
            try container.encode(transactionId, forKey: .subjectId)
        }
    }
}

public struct BiometricAuthorization: Codable, Sendable {
    public var evidenceId: String
    public var evaluatedAt: UInt64
    public var scope: BiometricAuthorizationScope

    public init(evidenceId: String, evaluatedAt: UInt64, scope: BiometricAuthorizationScope) {
        self.evidenceId = evidenceId
        self.evaluatedAt = evaluatedAt
        self.scope = scope
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case evidenceId, evaluatedAt, scope }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        evidenceId = try container.decode(String.self, forKey: .evidenceId)
        evaluatedAt = try container.decode(UInt64.self, forKey: .evaluatedAt)
        scope = try container.decode(BiometricAuthorizationScope.self, forKey: .scope)
    }

    func isFresh(now: UInt64, maximumAge: UInt64) -> Bool {
        evaluatedAt <= now && now - evaluatedAt <= maximumAge
    }
}

public struct ReplayRecord: Codable, Sendable {
    public var requestId: String
    public var nonce: String
    public var bodyDigest: String
    public var expiresAt: UInt64

    public init(requestId: String, nonce: String, bodyDigest: String, expiresAt: UInt64) {
        self.requestId = requestId
        self.nonce = nonce
        self.bodyDigest = bodyDigest
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case requestId, nonce, bodyDigest, expiresAt }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        requestId = try container.decode(String.self, forKey: .requestId)
        nonce = try container.decode(String.self, forKey: .nonce)
        bodyDigest = try container.decode(String.self, forKey: .bodyDigest)
        expiresAt = try container.decode(UInt64.self, forKey: .expiresAt)
    }
}

public enum ReplayDisposition: Equatable, Sendable {
    case accepted
    case replay
    case bodyConflict
}

public struct ReplayStore: Codable, Sendable {
    public private(set) var requestIds: [String: ReplayRecord]
    public private(set) var nonces: [String: ReplayRecord]

    public init(requestIds: [String: ReplayRecord] = [:], nonces: [String: ReplayRecord] = [:]) {
        self.requestIds = requestIds
        self.nonces = nonces
    }

    public func disposition(requestId: String, nonce: String, bodyDigest: String) -> ReplayDisposition {
        let collisions = [requestIds[requestId], nonces[nonce]].compactMap { $0 }
        guard !collisions.isEmpty else { return .accepted }
        return collisions.allSatisfy {
            $0.requestId == requestId && $0.nonce == nonce && $0.bodyDigest == bodyDigest
        } ? .replay : .bodyConflict
    }

    @discardableResult
    public mutating func register(
        requestId: String,
        nonce: String,
        bodyDigest: String,
        expiresAt: UInt64
    ) throws -> ReplayDisposition {
        let result = disposition(requestId: requestId, nonce: nonce, bodyDigest: bodyDigest)
        guard result == .accepted else {
            throw RemoteAuthProtocolError(result == .replay ? .requestReplayed : .bodyConflict)
        }
        let record = ReplayRecord(requestId: requestId, nonce: nonce, bodyDigest: bodyDigest, expiresAt: expiresAt)
        requestIds[requestId] = record
        nonces[nonce] = record
        return .accepted
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case requestIds, nonces }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        requestIds = try container.decode([String: ReplayRecord].self, forKey: .requestIds)
        nonces = try container.decode([String: ReplayRecord].self, forKey: .nonces)
        guard requestIds.values.allSatisfy({ nonces[$0.nonce]?.bodyDigest == $0.bodyDigest }),
              nonces.values.allSatisfy({ requestIds[$0.requestId]?.bodyDigest == $0.bodyDigest }) else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
    }
}

public struct GrantProposal: Codable, Sendable {
    public var grantId: String
    public var principalSelector: PrincipalSelector
    public var domain: AuthorizationDomain
    public var operation: AuthorizationOperation
    public var targetPredicate: ExecutionTarget
    public var riskCeiling: RiskLevel
    public var expiresAt: UInt64

    public init(
        grantId: String,
        principalSelector: PrincipalSelector,
        domain: AuthorizationDomain,
        operation: AuthorizationOperation,
        targetPredicate: ExecutionTarget,
        riskCeiling: RiskLevel,
        expiresAt: UInt64
    ) {
        self.grantId = grantId
        self.principalSelector = principalSelector
        self.domain = domain
        self.operation = operation
        self.targetPredicate = targetPredicate
        self.riskCeiling = riskCeiling
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case grantId, principalSelector, domain, operation, targetPredicate, riskCeiling, expiresAt
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        grantId = try container.decode(String.self, forKey: .grantId)
        principalSelector = try container.decode(PrincipalSelector.self, forKey: .principalSelector)
        domain = try container.decode(AuthorizationDomain.self, forKey: .domain)
        operation = try container.decode(AuthorizationOperation.self, forKey: .operation)
        targetPredicate = try container.decode(ExecutionTarget.self, forKey: .targetPredicate)
        riskCeiling = try container.decode(RiskLevel.self, forKey: .riskCeiling)
        expiresAt = try container.decode(UInt64.self, forKey: .expiresAt)
    }
}

public enum ExternalReleaseState: String, Codable, Sendable {
    case notReleased = "not-released"
    case releasedAwaitingRemote = "released-awaiting-remote"
    case settled
}

public struct RequestRecord: Codable, Sendable {
    public var receiptId: String
    public var requestId: String
    public var bodyDigest: String
    public var principal: Principal
    public var grantId: String?
    public var domain: AuthorizationDomain
    public var operation: AuthorizationOperation
    public var authorizationMode: AuthorizationMode
    public var target: ExecutionTarget
    public var risk: RiskLevel
    public var createdAt: UInt64
    public var expiresAt: UInt64
    public var state: ReceiptState
    public var errorCode: PublicError?
    public var events: ReceiptEvents
    public var policyDigest: String
    public var brokerBuildDigest: String
    public var brokerCodeDigest: String
    public var targetFingerprint: String
    public var targetReleaseDisposition: TargetReleaseDisposition
    public var browserTargetGeneration: UInt64?
    public var externalReleaseState: ExternalReleaseState
    public var localReleaseStoppedAt: UInt64?
    public var cancellationRequestedAt: UInt64?
    public var disableRequestedAt: UInt64?

    public init(
        receiptId: String,
        requestId: String,
        bodyDigest: String,
        principal: Principal,
        grantId: String?,
        domain: AuthorizationDomain,
        operation: AuthorizationOperation,
        authorizationMode: AuthorizationMode,
        target: ExecutionTarget,
        risk: RiskLevel,
        createdAt: UInt64,
        expiresAt: UInt64,
        state: ReceiptState,
        errorCode: PublicError?,
        events: ReceiptEvents,
        policyDigest: String,
        brokerBuildDigest: String,
        brokerCodeDigest: String,
        targetFingerprint: String,
        targetReleaseDisposition: TargetReleaseDisposition,
        browserTargetGeneration: UInt64?,
        externalReleaseState: ExternalReleaseState,
        localReleaseStoppedAt: UInt64?,
        cancellationRequestedAt: UInt64?,
        disableRequestedAt: UInt64?
    ) {
        self.receiptId = receiptId
        self.requestId = requestId
        self.bodyDigest = bodyDigest
        self.principal = principal
        self.grantId = grantId
        self.domain = domain
        self.operation = operation
        self.authorizationMode = authorizationMode
        self.target = target
        self.risk = risk
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.state = state
        self.errorCode = errorCode
        self.events = events
        self.policyDigest = policyDigest
        self.brokerBuildDigest = brokerBuildDigest
        self.brokerCodeDigest = brokerCodeDigest
        self.targetFingerprint = targetFingerprint
        self.targetReleaseDisposition = targetReleaseDisposition
        self.browserTargetGeneration = browserTargetGeneration
        self.externalReleaseState = externalReleaseState
        self.localReleaseStoppedAt = localReleaseStoppedAt
        self.cancellationRequestedAt = cancellationRequestedAt
        self.disableRequestedAt = disableRequestedAt
    }

    public var isTerminal: Bool {
        switch state {
        case .requested, .authorized, .executing: false
        case .succeeded, .failed, .cancelled, .expired, .revoked, .disabled: true
        }
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case receiptId, requestId, bodyDigest, principal, grantId, domain, operation, authorizationMode
        case target, risk, createdAt, expiresAt, state, errorCode, events, policyDigest
        case brokerBuildDigest, brokerCodeDigest, targetFingerprint, targetReleaseDisposition
        case browserTargetGeneration, externalReleaseState, localReleaseStoppedAt
        case cancellationRequestedAt, disableRequestedAt
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        receiptId = try container.decode(String.self, forKey: .receiptId)
        requestId = try container.decode(String.self, forKey: .requestId)
        bodyDigest = try container.decode(String.self, forKey: .bodyDigest)
        principal = try container.decode(Principal.self, forKey: .principal)
        grantId = try container.decodeIfPresent(String.self, forKey: .grantId)
        domain = try container.decode(AuthorizationDomain.self, forKey: .domain)
        operation = try container.decode(AuthorizationOperation.self, forKey: .operation)
        authorizationMode = try container.decode(AuthorizationMode.self, forKey: .authorizationMode)
        target = try container.decode(ExecutionTarget.self, forKey: .target)
        risk = try container.decode(RiskLevel.self, forKey: .risk)
        createdAt = try container.decode(UInt64.self, forKey: .createdAt)
        expiresAt = try container.decode(UInt64.self, forKey: .expiresAt)
        state = try container.decode(ReceiptState.self, forKey: .state)
        errorCode = try container.decodeIfPresent(PublicError.self, forKey: .errorCode)
        events = try container.decode(ReceiptEvents.self, forKey: .events)
        policyDigest = try container.decode(String.self, forKey: .policyDigest)
        brokerBuildDigest = try container.decode(String.self, forKey: .brokerBuildDigest)
        brokerCodeDigest = try container.decode(String.self, forKey: .brokerCodeDigest)
        targetFingerprint = try container.decode(String.self, forKey: .targetFingerprint)
        targetReleaseDisposition = try container.decode(TargetReleaseDisposition.self, forKey: .targetReleaseDisposition)
        browserTargetGeneration = try container.decodeIfPresent(UInt64.self, forKey: .browserTargetGeneration)
        externalReleaseState = try container.decode(ExternalReleaseState.self, forKey: .externalReleaseState)
        localReleaseStoppedAt = try container.decodeIfPresent(UInt64.self, forKey: .localReleaseStoppedAt)
        cancellationRequestedAt = try container.decodeIfPresent(UInt64.self, forKey: .cancellationRequestedAt)
        disableRequestedAt = try container.decodeIfPresent(UInt64.self, forKey: .disableRequestedAt)
    }
}

public struct ReenableTransaction: Codable, Sendable {
    public var transactionId: String
    public var policyDigest: String
    public var brokerBuildDigest: String
    public var biometricEvidenceId: String
    public var beganAt: UInt64
    public var expiresAt: UInt64

    public init(
        transactionId: String,
        policyDigest: String,
        brokerBuildDigest: String,
        biometricEvidenceId: String,
        beganAt: UInt64,
        expiresAt: UInt64
    ) {
        self.transactionId = transactionId
        self.policyDigest = policyDigest
        self.brokerBuildDigest = brokerBuildDigest
        self.biometricEvidenceId = biometricEvidenceId
        self.beganAt = beganAt
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case transactionId, policyDigest, brokerBuildDigest, biometricEvidenceId, beganAt, expiresAt
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        transactionId = try container.decode(String.self, forKey: .transactionId)
        policyDigest = try container.decode(String.self, forKey: .policyDigest)
        brokerBuildDigest = try container.decode(String.self, forKey: .brokerBuildDigest)
        biometricEvidenceId = try container.decode(String.self, forKey: .biometricEvidenceId)
        beganAt = try container.decode(UInt64.self, forKey: .beganAt)
        expiresAt = try container.decode(UInt64.self, forKey: .expiresAt)
    }
}

public struct EmergencyControlState: Codable, Sendable {
    public var disabled: Bool
    public var disabledAt: UInt64?
    public var reasonCode: String?
    public var generation: UInt64
    public var localEffectsStopped: Bool
    public var pendingReenable: ReenableTransaction?

    public init(
        disabled: Bool = false,
        disabledAt: UInt64? = nil,
        reasonCode: String? = nil,
        generation: UInt64 = 0,
        localEffectsStopped: Bool = false,
        pendingReenable: ReenableTransaction? = nil
    ) {
        self.disabled = disabled
        self.disabledAt = disabledAt
        self.reasonCode = reasonCode
        self.generation = generation
        self.localEffectsStopped = localEffectsStopped
        self.pendingReenable = pendingReenable
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case disabled, disabledAt, reasonCode, generation, localEffectsStopped, pendingReenable
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        disabled = try container.decode(Bool.self, forKey: .disabled)
        disabledAt = try container.decodeIfPresent(UInt64.self, forKey: .disabledAt)
        reasonCode = try container.decodeIfPresent(String.self, forKey: .reasonCode)
        generation = try container.decode(UInt64.self, forKey: .generation)
        localEffectsStopped = try container.decode(Bool.self, forKey: .localEffectsStopped)
        pendingReenable = try container.decodeIfPresent(ReenableTransaction.self, forKey: .pendingReenable)
        guard disabled == (disabledAt != nil), !localEffectsStopped || disabled else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
    }
}

public struct EmergencyDisableOutcome: Sendable {
    public var invalidatedGrantIds: [String]
    public var stoppedRequestIds: [String]
    public var remotelyInFlightRequestIds: [String]

    public init(invalidatedGrantIds: [String], stoppedRequestIds: [String], remotelyInFlightRequestIds: [String]) {
        self.invalidatedGrantIds = invalidatedGrantIds
        self.stoppedRequestIds = stoppedRequestIds
        self.remotelyInFlightRequestIds = remotelyInFlightRequestIds
    }
}

public enum RemoteExecutionOutcome: Sendable {
    case succeeded
    case failed(PublicError)
    case confirmedNoEffect
    case expiredWithoutEffect
}

public struct AuthorityState: Codable, Sendable {
    public static let schemaVersionV1: UInt32 = 1

    public var schemaVersion: UInt32
    public private(set) var replayStore: ReplayStore
    public private(set) var requests: [String: RequestRecord]
    public private(set) var grants: [String: Grant]
    public private(set) var emergency: EmergencyControlState

    public init(
        schemaVersion: UInt32 = AuthorityState.schemaVersionV1,
        replayStore: ReplayStore = ReplayStore(),
        requests: [String: RequestRecord] = [:],
        grants: [String: Grant] = [:],
        emergency: EmergencyControlState = EmergencyControlState()
    ) {
        self.schemaVersion = schemaVersion
        self.replayStore = replayStore
        self.requests = requests
        self.grants = grants
        self.emergency = emergency
    }

    @discardableResult
    public mutating func admit(
        _ request: ExecutionRequest,
        peer: PeerMatchInput,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        receiptId: String,
        browserTargetGeneration: UInt64?,
        now: UInt64
    ) throws -> RequestRecord {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled else { throw RemoteAuthProtocolError(.disabled) }
        guard request.createdAt <= now, now < request.expiresAt else {
            throw RemoteAuthProtocolError(.requestExpired)
        }
        guard peer.matches(request.principal), policy.document.trustedCaller(matching: peer) != nil else {
            throw RemoteAuthProtocolError(.peerMismatch)
        }

        let transcript = try ProtocolTranscript.executionRequest(request)
        let bodyDigest = ProtocolCrypto.sha256Hex(transcript)
        let targetFingerprint = try Self.targetFingerprint(request.target)
        let decision = try policy.document.decision(for: request, policyDigest: policy.digest)
        if request.authorizationModeRequested == .delegated,
           decision.biometricPolicy == .freshOneShotRequired {
            throw RemoteAuthProtocolError(.grantForbidden)
        }

        let releasesBrowserSecret = request.operation == .bitwardenUnlock || request.operation == .websiteAutofill
        guard releasesBrowserSecret == (browserTargetGeneration != nil),
              !releasesBrowserSecret || browserTargetGeneration! > 0 else {
            throw RemoteAuthProtocolError(.targetMismatch)
        }

        try replayStore.register(
            requestId: request.requestId,
            nonce: request.nonce,
            bodyDigest: bodyDigest,
            expiresAt: request.expiresAt
        )

        let record = RequestRecord(
            receiptId: receiptId,
            requestId: request.requestId,
            bodyDigest: bodyDigest,
            principal: request.principal,
            grantId: request.grantId,
            domain: request.domain,
            operation: request.operation,
            authorizationMode: request.authorizationModeRequested,
            target: request.target,
            risk: decision.risk,
            createdAt: request.createdAt,
            expiresAt: request.expiresAt,
            state: .requested,
            errorCode: nil,
            events: ReceiptEvents(requestedAt: now, authorizedAt: nil, executingAt: nil, terminalAt: nil),
            policyDigest: policy.digest,
            brokerBuildDigest: runtime.buildDigest,
            brokerCodeDigest: runtime.codeDigest,
            targetFingerprint: targetFingerprint,
            targetReleaseDisposition: releasesBrowserSecret ? .quarantined : .notApplicable,
            browserTargetGeneration: browserTargetGeneration,
            externalReleaseState: .notReleased,
            localReleaseStoppedAt: nil,
            cancellationRequestedAt: nil,
            disableRequestedAt: nil
        )
        requests[request.requestId] = record
        return record
    }

    @discardableResult
    public mutating func authorizeDelegated(
        requestId: String,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> RequestRecord {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled else { throw RemoteAuthProtocolError(.disabled) }
        guard var record = requests[requestId], record.state == .requested,
              record.authorizationMode == .delegated,
              let grantId = record.grantId else {
            throw RemoteAuthProtocolError(.grantRequired)
        }
        try gateRequest(record, policy: policy, runtime: runtime, now: now)
        _ = try redeemGrant(
            grantId: grantId,
            domain: record.domain,
            principal: record.principal,
            operation: record.operation,
            target: record.target,
            risk: record.risk,
            requestExpiresAt: record.expiresAt,
            policy: policy,
            runtime: runtime,
            now: now
        )
        record.state = .authorized
        record.events.authorizedAt = now
        requests[requestId] = record
        return record
    }

    @discardableResult
    public mutating func authorizeBiometricOneShot(
        requestId: String,
        authorization: BiometricAuthorization,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> RequestRecord {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled else { throw RemoteAuthProtocolError(.disabled) }
        guard var record = requests[requestId], record.state == .requested,
              record.authorizationMode == .biometricOneShot else {
            throw RemoteAuthProtocolError(.grantForbidden)
        }
        try gateRequest(record, policy: policy, runtime: runtime, now: now)
        guard authorization.isFresh(now: now, maximumAge: policy.document.maximumBiometricAgeMilliseconds),
              case .execution(let evidenceRequestId, let evidenceBodyDigest) = authorization.scope,
              evidenceRequestId == requestId,
              evidenceBodyDigest == record.bodyDigest else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        record.state = .authorized
        record.events.authorizedAt = now
        requests[requestId] = record
        return record
    }

    @discardableResult
    public mutating func beginExecution(
        requestId: String,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> RequestRecord {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled else { throw RemoteAuthProtocolError(.disabled) }
        guard var record = requests[requestId], record.state == .authorized else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
        try gateRequest(record, policy: policy, runtime: runtime, now: now)
        record.state = .executing
        record.events.executingAt = now
        requests[requestId] = record
        return record
    }

    @discardableResult
    public mutating func markRemoteReleased(
        requestId: String,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> RequestRecord {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled else { throw RemoteAuthProtocolError(.disabled) }
        guard var record = requests[requestId], record.state == .executing,
              record.externalReleaseState == .notReleased else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
        try gateRequest(record, policy: policy, runtime: runtime, now: now)
        record.externalReleaseState = .releasedAwaitingRemote
        requests[requestId] = record
        return record
    }

    @discardableResult
    public mutating func complete(
        requestId: String,
        outcome: RemoteExecutionOutcome,
        releaseDisposition: TargetReleaseDisposition,
        now: UInt64
    ) throws -> RequestRecord {
        guard var record = requests[requestId], record.state == .executing else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
        let browserSecret = record.operation == .bitwardenUnlock || record.operation == .websiteAutofill
        guard browserSecret ? releaseDisposition != .notApplicable : releaseDisposition == .notApplicable else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        record.targetReleaseDisposition = releaseDisposition
        record.externalReleaseState = .settled
        switch outcome {
        case .succeeded:
            Self.makeTerminal(&record, state: .succeeded, error: nil, now: now)
        case .failed(let error):
            Self.makeTerminal(&record, state: .failed, error: error, now: now)
        case .confirmedNoEffect:
            if record.disableRequestedAt != nil {
                Self.makeTerminal(&record, state: .disabled, error: .disabled, now: now)
            } else if record.cancellationRequestedAt != nil {
                Self.makeTerminal(&record, state: .cancelled, error: .cancelled, now: now)
            } else {
                Self.makeTerminal(&record, state: .failed, error: .executionFailed, now: now)
            }
        case .expiredWithoutEffect:
            if record.disableRequestedAt != nil {
                Self.makeTerminal(&record, state: .disabled, error: .disabled, now: now)
            } else if record.cancellationRequestedAt != nil {
                Self.makeTerminal(&record, state: .cancelled, error: .cancelled, now: now)
            } else {
                Self.makeTerminal(&record, state: .expired, error: .requestExpired, now: now)
            }
        }
        requests[requestId] = record
        return record
    }

    @discardableResult
    public mutating func cancel(requestId: String, now: UInt64) throws -> RequestRecord {
        guard var record = requests[requestId] else { throw RemoteAuthProtocolError(.protocolInvalid) }
        guard !record.isTerminal else { return record }
        record.localReleaseStoppedAt = record.localReleaseStoppedAt ?? now
        record.cancellationRequestedAt = record.cancellationRequestedAt ?? now
        if record.externalReleaseState == .releasedAwaitingRemote {
            requests[requestId] = record
            return record
        }
        Self.makeTerminal(&record, state: .cancelled, error: .cancelled, now: now)
        requests[requestId] = record
        return record
    }

    @discardableResult
    public mutating func createGrant(
        _ proposal: GrantProposal,
        authorization: BiometricAuthorization,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> Grant {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled else { throw RemoteAuthProtocolError(.disabled) }
        let key = Self.grantKey(domain: proposal.domain, grantId: proposal.grantId)
        guard grants[key] == nil,
              case .createGrant(let evidenceGrantId) = authorization.scope,
              evidenceGrantId == proposal.grantId else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        let grant = try makeGrant(
            proposal,
            authorization: authorization,
            policy: policy,
            runtime: runtime,
            now: now
        )
        grants[key] = grant
        return grant
    }

    @discardableResult
    public mutating func expandGrant(
        _ proposal: GrantProposal,
        authorization: BiometricAuthorization,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> Grant {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled else { throw RemoteAuthProtocolError(.disabled) }
        let key = Self.grantKey(domain: proposal.domain, grantId: proposal.grantId)
        guard let existing = grants[key], existing.lifecycleState == .active,
              now < existing.expiresAt,
              Self.selectorMatches(existing.principalSelector, proposal.principalSelector),
              existing.domain == proposal.domain,
              existing.operation == proposal.operation,
              case .expandGrant(let evidenceGrantId) = authorization.scope,
              evidenceGrantId == proposal.grantId else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        let grant = try makeGrant(
            proposal,
            authorization: authorization,
            policy: policy,
            runtime: runtime,
            now: now
        )
        grants[key] = grant
        return grant
    }

    public func redeemGrant(
        grantId: String,
        domain: AuthorizationDomain,
        principal: Principal,
        operation: AuthorizationOperation,
        target: ExecutionTarget,
        risk: RiskLevel,
        requestExpiresAt: UInt64,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> Grant {
        try gateEffects(policy: policy, runtime: runtime)
        guard !emergency.disabled,
              let grant = grants[Self.grantKey(domain: domain, grantId: grantId)],
              grant.lifecycleState == .active,
              grant.issuedAt <= now,
              now < grant.expiresAt,
              requestExpiresAt <= grant.expiresAt,
              grant.policyDigest == policy.digest,
              grant.brokerBuildDigest == runtime.buildDigest,
              grant.brokerCodeIdentity == runtime.codeIdentity,
              grant.domain == domain,
              grant.operation == operation,
              risk.isAtMost(grant.riskCeiling),
              Self.selectorMatches(grant.principalSelector, principal),
              try Self.targetFingerprint(grant.targetPredicate) == Self.targetFingerprint(target),
              let operationRule = policy.document.operationPolicy(for: operation, domain: domain),
              operationRule.biometricPolicy == .standingGrantOrOneShot else {
            throw RemoteAuthProtocolError(emergency.disabled ? .disabled : .grantInvalid)
        }
        return grant
    }

    @discardableResult
    public mutating func consumeGrant(domain: AuthorizationDomain, grantId: String, now: UInt64) throws -> Grant {
        let key = Self.grantKey(domain: domain, grantId: grantId)
        guard var grant = grants[key], grant.lifecycleState == .active, grant.issuedAt <= now else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        if now >= grant.expiresAt {
            grant.lifecycleState = .expired
        } else {
            grant.lifecycleState = .consumed
            grant.consumedAt = now
        }
        grants[key] = grant
        return grant
    }

    @discardableResult
    public mutating func revokeGrant(domain: AuthorizationDomain, grantId: String, now: UInt64) throws -> Grant {
        let key = Self.grantKey(domain: domain, grantId: grantId)
        guard var grant = grants[key], grant.lifecycleState == .active, grant.issuedAt <= now else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        if now >= grant.expiresAt {
            grant.lifecycleState = .expired
        } else {
            grant.lifecycleState = .revoked
            grant.revokedAt = now
        }
        grants[key] = grant
        return grant
    }

    @discardableResult
    public mutating func expireGrant(domain: AuthorizationDomain, grantId: String) throws -> Grant {
        let key = Self.grantKey(domain: domain, grantId: grantId)
        guard var grant = grants[key], grant.lifecycleState == .active else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        grant.lifecycleState = .expired
        grants[key] = grant
        return grant
    }

    @discardableResult
    public mutating func invalidateGrant(domain: AuthorizationDomain, grantId: String) throws -> Grant {
        let key = Self.grantKey(domain: domain, grantId: grantId)
        guard var grant = grants[key], grant.lifecycleState == .active else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        grant.lifecycleState = .invalidated
        grants[key] = grant
        return grant
    }

    public func grant(domain: AuthorizationDomain, grantId: String) -> Grant? {
        grants[Self.grantKey(domain: domain, grantId: grantId)]
    }

    @discardableResult
    public mutating func emergencyDisable(reasonCode: String, now: UInt64) throws -> EmergencyDisableOutcome {
        guard !reasonCode.isEmpty, reasonCode.utf8.count <= 256,
              reasonCode.utf8.allSatisfy({ $0 >= 0x20 && $0 != 0x7f }) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        if !emergency.disabled {
            emergency.disabled = true
            emergency.disabledAt = now
            emergency.reasonCode = reasonCode
            emergency.generation &+= 1
            emergency.localEffectsStopped = true
            emergency.pendingReenable = nil
        }

        var invalidated = [String]()
        for key in grants.keys.sorted() {
            guard var grant = grants[key], grant.lifecycleState == .active else { continue }
            grant.lifecycleState = .invalidated
            grants[key] = grant
            invalidated.append(grant.grantId)
        }

        var stopped = [String]()
        var inFlight = [String]()
        for requestId in requests.keys.sorted() {
            guard var record = requests[requestId], !record.isTerminal else { continue }
            record.localReleaseStoppedAt = record.localReleaseStoppedAt ?? now
            record.disableRequestedAt = record.disableRequestedAt ?? now
            if record.externalReleaseState == .releasedAwaitingRemote {
                inFlight.append(requestId)
            } else {
                Self.makeTerminal(&record, state: .disabled, error: .disabled, now: now)
                stopped.append(requestId)
            }
            requests[requestId] = record
        }
        return EmergencyDisableOutcome(
            invalidatedGrantIds: invalidated,
            stoppedRequestIds: stopped,
            remotelyInFlightRequestIds: inFlight
        )
    }

    @discardableResult
    public mutating func beginReenable(
        transactionId: String,
        authorization: BiometricAuthorization,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> ReenableTransaction {
        try gateEffects(policy: policy, runtime: runtime, allowDisabled: true)
        guard emergency.disabled, emergency.pendingReenable == nil,
              authorization.isFresh(now: now, maximumAge: policy.document.maximumBiometricAgeMilliseconds),
              case .reenable(let evidenceTransactionId) = authorization.scope,
              evidenceTransactionId == transactionId else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        let expiresAt = authorization.evaluatedAt.addingReportingOverflow(
            policy.document.maximumBiometricAgeMilliseconds
        )
        guard !expiresAt.overflow, now <= expiresAt.partialValue else {
            throw RemoteAuthProtocolError(.requestExpired)
        }
        let transaction = ReenableTransaction(
            transactionId: transactionId,
            policyDigest: policy.digest,
            brokerBuildDigest: runtime.buildDigest,
            biometricEvidenceId: authorization.evidenceId,
            beganAt: now,
            expiresAt: expiresAt.partialValue
        )
        emergency.pendingReenable = transaction
        return transaction
    }

    public mutating func commitReenable(
        transactionId: String,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws {
        try gateEffects(policy: policy, runtime: runtime, allowDisabled: true)
        guard emergency.disabled,
              let transaction = emergency.pendingReenable,
              transaction.transactionId == transactionId,
              transaction.policyDigest == policy.digest,
              transaction.brokerBuildDigest == runtime.buildDigest,
              now <= transaction.expiresAt else {
            throw RemoteAuthProtocolError(.policyMismatch)
        }
        emergency.disabled = false
        emergency.disabledAt = nil
        emergency.reasonCode = nil
        emergency.localEffectsStopped = false
        emergency.pendingReenable = nil
        emergency.generation &+= 1
    }

    public mutating func abortReenable(transactionId: String) {
        guard emergency.pendingReenable?.transactionId == transactionId else { return }
        emergency.pendingReenable = nil
    }

    public func receipt(for requestId: String) throws -> ReceiptMetadata {
        guard let record = requests[requestId] else { throw RemoteAuthProtocolError(.protocolInvalid) }
        let receipt = ReceiptMetadata(
            receiptId: record.receiptId,
            requestId: record.requestId,
            grantId: record.grantId,
            domain: record.domain,
            operation: record.operation,
            authorizationModeUsed: record.authorizationMode,
            targetFingerprint: record.targetFingerprint,
            state: record.state,
            errorCode: record.errorCode,
            events: record.events,
            policyDigest: record.policyDigest,
            brokerBuildDigest: record.brokerBuildDigest,
            brokerCodeDigest: record.brokerCodeDigest,
            targetReleaseDisposition: record.targetReleaseDisposition,
            browserTargetGeneration: record.browserTargetGeneration
        )
        try receipt.validate()
        return receipt
    }

    private func makeGrant(
        _ proposal: GrantProposal,
        authorization: BiometricAuthorization,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws -> Grant {
        guard authorization.isFresh(now: now, maximumAge: policy.document.maximumBiometricAgeMilliseconds),
              let operationRule = policy.document.operationPolicy(for: proposal.operation, domain: proposal.domain),
              operationRule.biometricPolicy == .standingGrantOrOneShot,
              now < proposal.expiresAt,
              proposal.expiresAt - now <= operationRule.maximumGrantLifetimeMilliseconds,
              Self.selectorIsTrusted(proposal.principalSelector, policy: policy.document) else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }

        let requiredRisk: RiskLevel
        switch proposal.targetPredicate {
        case .sudo(let target):
            guard proposal.domain == .sudo, proposal.operation == .sudo,
                  target.sudoPolicyDigest == policy.digest,
                  let action = policy.document.registeredAction(for: target),
                  action.biometricPolicy == .standingGrantOrOneShot else {
                throw RemoteAuthProtocolError(.targetMismatch)
            }
            requiredRisk = RiskLevel.maximum(operationRule.risk, action.risk)
        case .gdm:
            guard proposal.domain == .desktopBrowser, proposal.operation == .gdmLogin else {
                throw RemoteAuthProtocolError(.domainMismatch)
            }
            requiredRisk = operationRule.risk
        case .bitwarden:
            guard proposal.domain == .desktopBrowser, proposal.operation == .bitwardenUnlock else {
                throw RemoteAuthProtocolError(.domainMismatch)
            }
            requiredRisk = operationRule.risk
        case .website:
            guard proposal.domain == .desktopBrowser, proposal.operation == .websiteAutofill else {
                throw RemoteAuthProtocolError(.domainMismatch)
            }
            requiredRisk = operationRule.risk
        }
        guard requiredRisk.isAtMost(proposal.riskCeiling) else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }

        let grant = Grant(
            grantId: proposal.grantId,
            principalSelector: proposal.principalSelector,
            domain: proposal.domain,
            operation: proposal.operation,
            targetPredicate: proposal.targetPredicate,
            riskCeiling: proposal.riskCeiling,
            issuedAt: now,
            expiresAt: proposal.expiresAt,
            revokedAt: nil,
            consumedAt: nil,
            policyDigest: policy.digest,
            brokerBuildDigest: runtime.buildDigest,
            brokerCodeIdentity: runtime.codeIdentity,
            biometricEvidenceId: authorization.evidenceId,
            biometricIssuedAt: authorization.evaluatedAt,
            lifecycleState: .active
        )
        try grant.validate()
        return grant
    }

    private func gateEffects(
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        allowDisabled: Bool = false
    ) throws {
        guard policy.document.permitsEffects else { throw RemoteAuthProtocolError(.inactive) }
        guard runtime.codeIdentity == policy.document.brokerIdentity.signingIdentifier,
              runtime.teamIdentifier == policy.document.brokerIdentity.teamIdentifier,
              runtime.codeDigest == policy.document.brokerIdentity.executableSHA256,
              runtime.buildDigest == policy.document.brokerIdentity.executableSHA256 else {
            throw RemoteAuthProtocolError(.policyMismatch)
        }
        if emergency.disabled && !allowDisabled { throw RemoteAuthProtocolError(.disabled) }
    }

    private func gateRequest(
        _ record: RequestRecord,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        now: UInt64
    ) throws {
        guard record.policyDigest == policy.digest,
              record.brokerBuildDigest == runtime.buildDigest,
              record.brokerCodeDigest == runtime.codeDigest else {
            throw RemoteAuthProtocolError(.policyMismatch)
        }
        guard record.createdAt <= now, now < record.expiresAt else {
            throw RemoteAuthProtocolError(.requestExpired)
        }
    }

    private static func makeTerminal(
        _ record: inout RequestRecord,
        state: ReceiptState,
        error: PublicError?,
        now: UInt64
    ) {
        guard !record.isTerminal else { return }
        record.state = state
        record.errorCode = error
        record.events.terminalAt = now
    }

    private static func grantKey(domain: AuthorizationDomain, grantId: String) -> String {
        "\(domain.rawValue):\(grantId)"
    }

    private static func selectorMatches(_ selector: PrincipalSelector, _ principal: Principal) -> Bool {
        selector.sessionId == principal.sessionId
            && selector.ownerEpoch == principal.ownerEpoch
            && selector.uid == principal.uid
            && selector.codeIdentity == principal.codeIdentity
            && selector.buildDigest == principal.buildDigest
    }

    private static func selectorMatches(_ lhs: PrincipalSelector, _ rhs: PrincipalSelector) -> Bool {
        lhs.sessionId == rhs.sessionId
            && lhs.ownerEpoch == rhs.ownerEpoch
            && lhs.uid == rhs.uid
            && lhs.codeIdentity == rhs.codeIdentity
            && lhs.buildDigest == rhs.buildDigest
    }

    private static func selectorIsTrusted(_ selector: PrincipalSelector, policy: BrokerPolicy) -> Bool {
        policy.trustedOmpCallers.contains {
            $0.uid == selector.uid
                && $0.signingIdentifier == selector.codeIdentity
                && $0.executableSHA256 == selector.buildDigest
        }
    }

    private static func targetFingerprint(_ target: ExecutionTarget) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return ProtocolCrypto.sha256Hex(try encoder.encode(target))
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, replayStore, requests, grants, emergency
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownPolicyKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(UInt32.self, forKey: .schemaVersion)
        replayStore = try container.decode(ReplayStore.self, forKey: .replayStore)
        requests = try container.decode([String: RequestRecord].self, forKey: .requests)
        grants = try container.decode([String: Grant].self, forKey: .grants)
        emergency = try container.decode(EmergencyControlState.self, forKey: .emergency)
        guard schemaVersion == Self.schemaVersionV1,
              requests.allSatisfy({ $0.key == $0.value.requestId }),
              grants.allSatisfy({ $0.key == Self.grantKey(domain: $0.value.domain, grantId: $0.value.grantId) }) else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
    }
}
