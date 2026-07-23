import Foundation

public struct GDMChallenge: WireMessage {
    public var protocolVersion: UInt32
    public var challengeId: String
    public var challenge: String
    public var bootId: String
    public var issuedBoottimeMs: UInt64
    public var expiresBoottimeMs: UInt64
    public var policyDigest: String

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, challengeId: String, challenge: String, bootId: String, issuedBoottimeMs: UInt64, expiresBoottimeMs: UInt64, policyDigest: String) {
        self.protocolVersion = protocolVersion
        self.challengeId = challengeId
        self.challenge = challenge
        self.bootId = bootId
        self.issuedBoottimeMs = issuedBoottimeMs
        self.expiresBoottimeMs = expiresBoottimeMs
        self.policyDigest = policyDigest
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, challengeId, challenge, bootId, issuedBoottimeMs, expiresBoottimeMs, policyDigest
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        challengeId = try container.decode(String.self, forKey: .challengeId)
        challenge = try container.decode(String.self, forKey: .challenge)
        bootId = try container.decode(String.self, forKey: .bootId)
        issuedBoottimeMs = try container.decodeTime(forKey: .issuedBoottimeMs)
        expiresBoottimeMs = try container.decodeTime(forKey: .expiresBoottimeMs)
        policyDigest = try container.decode(String.self, forKey: .policyDigest)
    }
}

public struct GDMEnvelope: WireMessage {
    public var protocolVersion: UInt32
    public var request: ExecutionRequest
    public var challenge: GDMChallenge
    public var issueId: String
    public var sentinelHash: String
    public var hpkeEnc: String
    public var ciphertext: String
    public var signingKeyId: String
    public var signature: String

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, request: ExecutionRequest, challenge: GDMChallenge, issueId: String, sentinelHash: String, hpkeEnc: String, ciphertext: String, signingKeyId: String, signature: String) {
        self.protocolVersion = protocolVersion
        self.request = request
        self.challenge = challenge
        self.issueId = issueId
        self.sentinelHash = sentinelHash
        self.hpkeEnc = hpkeEnc
        self.ciphertext = ciphertext
        self.signingKeyId = signingKeyId
        self.signature = signature
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, request, challenge, issueId, sentinelHash, hpkeEnc, ciphertext, signingKeyId, signature
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        request = try container.decode(ExecutionRequest.self, forKey: .request)
        challenge = try container.decode(GDMChallenge.self, forKey: .challenge)
        issueId = try container.decode(String.self, forKey: .issueId)
        sentinelHash = try container.decode(String.self, forKey: .sentinelHash)
        hpkeEnc = try container.decode(String.self, forKey: .hpkeEnc)
        ciphertext = try container.decode(String.self, forKey: .ciphertext)
        signingKeyId = try container.decode(String.self, forKey: .signingKeyId)
        signature = try container.decode(String.self, forKey: .signature)
    }
}

public struct GDMClaim: WireMessage {
    public var protocolVersion: UInt32
    public var requestId: String
    public var nonce: String
    public var issueId: String
    public var sentinel: String
    public var username: String
    public var uid: UInt32
    public var pamService: String
    public var seat: String
    public var tty: String
    public var rhost: RemoteHostPosture
    public var greeterGeneration: UInt64
    public var controllerGeneration: UInt64

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, requestId: String, nonce: String, issueId: String, sentinel: String, username: String, uid: UInt32, pamService: String = "gdm-password", seat: String, tty: String, rhost: RemoteHostPosture, greeterGeneration: UInt64, controllerGeneration: UInt64) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.nonce = nonce
        self.issueId = issueId
        self.sentinel = sentinel
        self.username = username
        self.uid = uid
        self.pamService = pamService
        self.seat = seat
        self.tty = tty
        self.rhost = rhost
        self.greeterGeneration = greeterGeneration
        self.controllerGeneration = controllerGeneration
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, requestId, nonce, issueId, sentinel, username, uid, pamService, seat, tty, rhost, greeterGeneration, controllerGeneration
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        requestId = try container.decode(String.self, forKey: .requestId)
        nonce = try container.decode(String.self, forKey: .nonce)
        issueId = try container.decode(String.self, forKey: .issueId)
        sentinel = try container.decode(String.self, forKey: .sentinel)
        username = try container.decode(String.self, forKey: .username)
        uid = try container.decode(UInt32.self, forKey: .uid)
        pamService = try container.decode(String.self, forKey: .pamService)
        seat = try container.decode(String.self, forKey: .seat)
        tty = try container.decode(String.self, forKey: .tty)
        rhost = try container.decode(RemoteHostPosture.self, forKey: .rhost)
        greeterGeneration = try container.decodeTime(forKey: .greeterGeneration)
        controllerGeneration = try container.decodeTime(forKey: .controllerGeneration)
    }
}

public struct SudoSignedRequest: WireMessage {
    public var protocolVersion: UInt32
    public var request: ExecutionRequest
    public var canonicalBodyDigest: String
    public var signingKeyId: String
    public var signature: String

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, request: ExecutionRequest, canonicalBodyDigest: String, signingKeyId: String, signature: String) {
        self.protocolVersion = protocolVersion
        self.request = request
        self.canonicalBodyDigest = canonicalBodyDigest
        self.signingKeyId = signingKeyId
        self.signature = signature
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, request, canonicalBodyDigest, signingKeyId, signature
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        request = try container.decode(ExecutionRequest.self, forKey: .request)
        canonicalBodyDigest = try container.decode(String.self, forKey: .canonicalBodyDigest)
        signingKeyId = try container.decode(String.self, forKey: .signingKeyId)
        signature = try container.decode(String.self, forKey: .signature)
    }
}

public enum ReviewerUserAuthorization: String, Codable, Sendable {
    case unknown, low, medium, high
}

public enum ReviewerStatus: String, Codable, Sendable {
    case completed, failed, cancelled
}

public enum ReviewerOutcome: String, Codable, Sendable {
    case allow, deny, escalate, blocked
}

public enum ReviewerReasonCode: String, Codable, Sendable {
    case semanticAllow = "semantic_allow"
    case semanticDeny = "semantic_deny"
    case semanticEscalate = "semantic_escalate"
    case timeout
    case cancelled
    case modelFailure = "model_failure"
    case sessionFailure = "session_failure"
    case providerFailure = "provider_failure"
    case transportFailure = "transport_failure"
    case parseFailure = "parse_failure"
    case missingEvidence = "missing_evidence"
    case promptInjection = "prompt_injection"
    case digestMismatch = "digest_mismatch"
    case truncatedInput = "truncated_input"
    case omittedSecurityField = "omitted_security_field"
    case canonicalActionUnreconstructable = "canonical_action_unreconstructable"
    case reviewerSetupFailure = "reviewer_setup_failure"
}

public struct ReviewerResult: WireMessage {
    public var protocolVersion: UInt32
    public var reviewId: String
    public var canonicalRequestDigest: String
    public var reviewerModel: String
    public var reviewerBuildDigest: String
    public var promptPolicyDigest: String
    public var risk: RiskLevel
    public var userAuthorization: ReviewerUserAuthorization
    public var status: ReviewerStatus
    public var outcome: ReviewerOutcome
    public var reasonCode: ReviewerReasonCode
    public var reason: String
    public var rationale: String
    public var attemptCount: UInt32
    public var startedAt: UInt64
    public var completedAt: UInt64
    public var expiresAt: UInt64

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, reviewId: String, canonicalRequestDigest: String, reviewerModel: String, reviewerBuildDigest: String, promptPolicyDigest: String, risk: RiskLevel, userAuthorization: ReviewerUserAuthorization, status: ReviewerStatus, outcome: ReviewerOutcome, reasonCode: ReviewerReasonCode, reason: String, rationale: String, attemptCount: UInt32, startedAt: UInt64, completedAt: UInt64, expiresAt: UInt64) {
        self.protocolVersion = protocolVersion
        self.reviewId = reviewId
        self.canonicalRequestDigest = canonicalRequestDigest
        self.reviewerModel = reviewerModel
        self.reviewerBuildDigest = reviewerBuildDigest
        self.promptPolicyDigest = promptPolicyDigest
        self.risk = risk
        self.userAuthorization = userAuthorization
        self.status = status
        self.outcome = outcome
        self.reasonCode = reasonCode
        self.reason = reason
        self.rationale = rationale
        self.attemptCount = attemptCount
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.expiresAt = expiresAt
    }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, reviewId, canonicalRequestDigest, reviewerModel, reviewerBuildDigest, promptPolicyDigest, risk, userAuthorization, status, outcome, reasonCode, reason, rationale, attemptCount, startedAt, completedAt, expiresAt
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        reviewId = try container.decode(String.self, forKey: .reviewId)
        canonicalRequestDigest = try container.decode(String.self, forKey: .canonicalRequestDigest)
        reviewerModel = try container.decode(String.self, forKey: .reviewerModel)
        reviewerBuildDigest = try container.decode(String.self, forKey: .reviewerBuildDigest)
        promptPolicyDigest = try container.decode(String.self, forKey: .promptPolicyDigest)
        risk = try container.decode(RiskLevel.self, forKey: .risk)
        userAuthorization = try container.decode(ReviewerUserAuthorization.self, forKey: .userAuthorization)
        status = try container.decode(ReviewerStatus.self, forKey: .status)
        outcome = try container.decode(ReviewerOutcome.self, forKey: .outcome)
        reasonCode = try container.decode(ReviewerReasonCode.self, forKey: .reasonCode)
        reason = try container.decode(String.self, forKey: .reason)
        rationale = try container.decode(String.self, forKey: .rationale)
        attemptCount = try container.decode(UInt32.self, forKey: .attemptCount)
        startedAt = try container.decodeTime(forKey: .startedAt)
        completedAt = try container.decodeTime(forKey: .completedAt)
        expiresAt = try container.decodeTime(forKey: .expiresAt)
    }
}

public struct GDMHPKEInfo: Sendable {
    public var protocolVersion: UInt32
    public var recipientKeyId: String

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, recipientKeyId: String) {
        self.protocolVersion = protocolVersion
        self.recipientKeyId = recipientKeyId
    }
}

public struct GDMHPKEAADInput: Sendable {
    public var requestTranscript: Data
    public var challenge: GDMChallenge
    public var issueId: String
    public var sentinelHash: String

    public init(requestTranscript: Data, challenge: GDMChallenge, issueId: String, sentinelHash: String) {
        self.requestTranscript = requestTranscript
        self.challenge = challenge
        self.issueId = issueId
        self.sentinelHash = sentinelHash
    }
}

public struct GDMEnvelopeSignatureInput: Sendable {
    public var hpkeAadTranscript: Data
    public var hpkeEnc: Data
    public var ciphertext: Data
    public var signingKeyId: String

    public init(hpkeAadTranscript: Data, hpkeEnc: Data, ciphertext: Data, signingKeyId: String) throws {
        self.hpkeAadTranscript = hpkeAadTranscript
        self.hpkeEnc = hpkeEnc
        self.ciphertext = ciphertext
        self.signingKeyId = signingKeyId
        try validate()
    }
}

public enum HPKEV1 {
    public static let kemId: UInt16 = 0x0020
    public static let kdfId: UInt16 = 0x0001
    public static let aeadId: UInt16 = 0x0003
    public static let encapsulatedKeyByteCount = 32
    public static let recipientPublicKeyByteCount = 32
    public static let authenticationTagByteCount = 16
}
