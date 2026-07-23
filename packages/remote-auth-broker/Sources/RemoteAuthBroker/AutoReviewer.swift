import CryptoKit
import Foundation
import RemoteAuthProtocol

public struct ReviewerCircuitScope: Codable, Equatable, Sendable {
    public let sessionId: String
    public let turnId: String

    public init(sessionId: String, turnId: String) {
        self.sessionId = sessionId
        self.turnId = turnId
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case sessionId, turnId
    }

    public init(from decoder: Decoder) throws {
        try rejectUnknownKeys(decoder, CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.decode(String.self, forKey: .sessionId)
        turnId = try container.decode(String.self, forKey: .turnId)
        try validate()
    }

    fileprivate func validate() throws {
        try validateIdentifier(sessionId)
        try validateIdentifier(turnId)
    }
}

public struct AutoReviewEvidence: Codable, Sendable {
    public let intent: String
    public let grant: String
    public let effects: [String]
    public let preconditions: [String]
    public let dryRun: String
    public let diff: String

    public init(
        intent: String,
        grant: String,
        effects: [String],
        preconditions: [String],
        dryRun: String,
        diff: String
    ) {
        self.intent = intent
        self.grant = grant
        self.effects = effects
        self.preconditions = preconditions
        self.dryRun = dryRun
        self.diff = diff
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case intent, grant, effects, preconditions, dryRun, diff
    }

    public init(from decoder: Decoder) throws {
        try rejectUnknownKeys(decoder, CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        intent = try container.decode(String.self, forKey: .intent)
        grant = try container.decode(String.self, forKey: .grant)
        effects = try container.decode([String].self, forKey: .effects)
        preconditions = try container.decode([String].self, forKey: .preconditions)
        dryRun = try container.decode(String.self, forKey: .dryRun)
        diff = try container.decode(String.self, forKey: .diff)
        try validate()
    }

    fileprivate func validate() throws {
        try validateEvidenceText(intent, maximumScalarCount: 2_048)
        try validateEvidenceText(grant, maximumScalarCount: 4_096)
        try validateEvidenceList(effects)
        try validateEvidenceList(preconditions)
        try validateEvidenceText(dryRun, maximumScalarCount: 16_384)
        try validateEvidenceText(diff, maximumScalarCount: 65_536)
    }
}

public enum ReviewableAction: WireMessage {
    case execution(ExecutionRequest)
    case destructiveControl(ControlRequest)

    private enum CodingKeys: String, CodingKey {
        case kind, execution, control
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "execution":
            try requireExactKeys(decoder, ["kind", "execution"])
            self = .execution(try container.decode(ExecutionRequest.self, forKey: .execution))
        case "destructive-control":
            try requireExactKeys(decoder, ["kind", "control"])
            self = .destructiveControl(try container.decode(ControlRequest.self, forKey: .control))
        default:
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        try validate()
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .execution(let request):
            try container.encode("execution", forKey: .kind)
            try container.encode(request, forKey: .execution)
        case .destructiveControl(let request):
            try container.encode("destructive-control", forKey: .kind)
            try container.encode(request, forKey: .control)
        }
    }

    public func validate() throws {
        switch self {
        case .execution(let request):
            try request.validate()
        case .destructiveControl(let request):
            try request.validate()
            switch request {
            case .grantRevoke(_), .grantExpire(_), .credentialForget(_), .emergencyDisable(_), .reEnable:
                break
            case .requestState(_), .cancel(_), .grantList, .status:
                throw RemoteAuthProtocolError(.reviewBlocked)
            }
        }
    }
}

public enum ReviewableActionCanonicalizer {
    public static func canonicalData(_ action: ReviewableAction) throws -> Data {
        let canonical = try encodeCanonicalJSON(action)
        let reconstructed = try ProtocolJSON.decode(ReviewableAction.self, from: canonical)
        let reconstructedCanonical = try encodeCanonicalJSON(reconstructed)
        guard canonical == reconstructedCanonical else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }

        if case .execution(let originalRequest) = action {
            guard case .execution(let reconstructedRequest) = reconstructed,
                  try ProtocolTranscript.executionRequest(originalRequest)
                    == ProtocolTranscript.executionRequest(reconstructedRequest)
            else {
                throw RemoteAuthProtocolError(.integrityFailure)
            }
        }
        return canonical
    }

    public static func digest(_ action: ReviewableAction) throws -> String {
        ProtocolCrypto.sha256Hex(try canonicalData(action))
    }
}

public struct AutoReviewInput: WireMessage {
    public var protocolVersion: UInt32
    public var reviewId: String
    public var attemptCount: UInt32
    public var scope: ReviewerCircuitScope
    public var canonicalActionDigest: String
    public var canonicalAction: ReviewableAction
    public var risk: RiskLevel
    public var userAuthorization: ReviewerUserAuthorization
    public var evidence: AutoReviewEvidence

    public init(
        protocolVersion: UInt32 = remoteAuthProtocolVersionV1,
        reviewId: String,
        attemptCount: UInt32 = 1,
        scope: ReviewerCircuitScope,
        canonicalActionDigest: String,
        canonicalAction: ReviewableAction,
        risk: RiskLevel,
        userAuthorization: ReviewerUserAuthorization,
        evidence: AutoReviewEvidence
    ) {
        self.protocolVersion = protocolVersion
        self.reviewId = reviewId
        self.attemptCount = attemptCount
        self.scope = scope
        self.canonicalActionDigest = canonicalActionDigest
        self.canonicalAction = canonicalAction
        self.risk = risk
        self.userAuthorization = userAuthorization
        self.evidence = evidence
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, reviewId, attemptCount, scope, canonicalActionDigest, canonicalAction, risk, userAuthorization, evidence
    }

    public init(from decoder: Decoder) throws {
        try rejectUnknownKeys(decoder, CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        reviewId = try container.decode(String.self, forKey: .reviewId)
        attemptCount = try container.decode(UInt32.self, forKey: .attemptCount)
        scope = try container.decode(ReviewerCircuitScope.self, forKey: .scope)
        canonicalActionDigest = try container.decode(String.self, forKey: .canonicalActionDigest)
        canonicalAction = try container.decode(ReviewableAction.self, forKey: .canonicalAction)
        risk = try container.decode(RiskLevel.self, forKey: .risk)
        userAuthorization = try container.decode(ReviewerUserAuthorization.self, forKey: .userAuthorization)
        evidence = try container.decode(AutoReviewEvidence.self, forKey: .evidence)
    }

    public func validate() throws {
        guard protocolVersion == remoteAuthProtocolVersionV1, (1...3).contains(attemptCount) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        try validateIdentifier(reviewId)
        try scope.validate()
        try validateDigest(canonicalActionDigest)
        try canonicalAction.validate()
        try evidence.validate()
    }
}

public struct ReviewerResultExpectation: Sendable {
    public let reviewId: String
    public let canonicalRequestDigest: String
    public let reviewerModel: String
    public let reviewerBuildDigest: String
    public let promptPolicyDigest: String
    public let risk: RiskLevel
    public let userAuthorization: ReviewerUserAuthorization
    public let attemptCount: UInt32

    public init(
        reviewId: String,
        canonicalRequestDigest: String,
        reviewerModel: String,
        reviewerBuildDigest: String,
        promptPolicyDigest: String,
        risk: RiskLevel,
        userAuthorization: ReviewerUserAuthorization,
        attemptCount: UInt32
    ) {
        self.reviewId = reviewId
        self.canonicalRequestDigest = canonicalRequestDigest
        self.reviewerModel = reviewerModel
        self.reviewerBuildDigest = reviewerBuildDigest
        self.promptPolicyDigest = promptPolicyDigest
        self.risk = risk
        self.userAuthorization = userAuthorization
        self.attemptCount = attemptCount
    }
}

public enum ReviewerResultParseError: Error, Equatable, Sendable {
    case invalidResult
    case reviewIdMismatch
    case canonicalRequestDigestMismatch
    case reviewerModelMismatch
    case reviewerBuildDigestMismatch
    case promptPolicyDigestMismatch
    case riskMismatch
    case userAuthorizationMismatch
    case attemptCountMismatch
}

public enum ReviewerResultParser {
    public static func parse(_ data: Data, expecting expected: ReviewerResultExpectation) throws -> ReviewerResult {
        let result: ReviewerResult
        do {
            result = try ProtocolJSON.decode(ReviewerResult.self, from: data)
        } catch {
            throw ReviewerResultParseError.invalidResult
        }

        guard result.reviewId == expected.reviewId else { throw ReviewerResultParseError.reviewIdMismatch }
        guard result.canonicalRequestDigest == expected.canonicalRequestDigest else {
            throw ReviewerResultParseError.canonicalRequestDigestMismatch
        }
        guard result.reviewerModel == expected.reviewerModel else { throw ReviewerResultParseError.reviewerModelMismatch }
        guard result.reviewerBuildDigest == expected.reviewerBuildDigest else {
            throw ReviewerResultParseError.reviewerBuildDigestMismatch
        }
        guard result.promptPolicyDigest == expected.promptPolicyDigest else {
            throw ReviewerResultParseError.promptPolicyDigestMismatch
        }
        guard result.risk == expected.risk else { throw ReviewerResultParseError.riskMismatch }
        guard result.userAuthorization == expected.userAuthorization else {
            throw ReviewerResultParseError.userAuthorizationMismatch
        }
        guard result.attemptCount == expected.attemptCount else {
            throw ReviewerResultParseError.attemptCountMismatch
        }
        return result
    }
}

public enum ReviewerAttemptFailure: Equatable, Sendable {
    case providerFailure
    case transportFailure
    case parseDrift
    case modelFailure
    case sessionFailure
    case setupFailure
    case integrityFailure
    case cancelled
    case timeout
}

public enum ReviewerAttemptOutcome: Sendable {
    case result(ReviewerResult)
    case failure(ReviewerAttemptFailure)
}

public enum ReviewerRetryDecision: Equatable, Sendable {
    case retry(afterMilliseconds: UInt64)
    case stop
}

public enum ReviewerRetryPolicy {
    public static let maximumAttempts: UInt32 = 3
    public static let sharedDeadlineMilliseconds: UInt64 = 90_000

    public static func decision(
        after outcome: ReviewerAttemptOutcome,
        completedAttempts: UInt32,
        remainingMilliseconds: UInt64
    ) -> ReviewerRetryDecision {
        guard completedAttempts < maximumAttempts else { return .stop }

        let retryable: Bool
        switch outcome {
        case .failure(let failure):
            switch failure {
            case .providerFailure, .transportFailure, .parseDrift:
                retryable = true
            case .modelFailure, .sessionFailure, .setupFailure, .integrityFailure, .cancelled, .timeout:
                retryable = false
            }
        case .result(let result):
            retryable = result.status == .failed
                && result.outcome == .blocked
                && (result.reasonCode == .providerFailure
                    || result.reasonCode == .transportFailure
                    || result.reasonCode == .parseFailure)
        }

        guard retryable else { return .stop }
        let backoff: UInt64 = completedAttempts == 1 ? 250 : 1_000
        guard remainingMilliseconds > backoff else { return .stop }
        return .retry(afterMilliseconds: backoff)
    }
}

public enum ReviewerCircuitBreaker {
    public struct Configuration: Equatable, Sendable {
        public let consecutiveThreshold: UInt32
        public let rollingThreshold: UInt32
        public let rollingWindow: UInt32

        public init(consecutiveThreshold: UInt32, rollingThreshold: UInt32, rollingWindow: UInt32) {
            self.consecutiveThreshold = consecutiveThreshold
            self.rollingThreshold = rollingThreshold
            self.rollingWindow = rollingWindow
        }

        fileprivate func validate() throws {
            guard consecutiveThreshold > 0,
                  rollingThreshold > 0,
                  rollingWindow > 0,
                  rollingThreshold <= rollingWindow
            else {
                throw AutoReviewerError.invalidBreakerConfiguration
            }
        }
    }

    public struct State: Codable, Equatable, Sendable {
        public var protocolVersion: UInt32
        public var scope: ReviewerCircuitScope
        public var reviewedAttemptCount: UInt64
        public var consecutiveBlockedAttempts: UInt64
        public var rollingBlockedAttemptOrdinals: [UInt64]

        public init(
            protocolVersion: UInt32 = remoteAuthProtocolVersionV1,
            scope: ReviewerCircuitScope,
            reviewedAttemptCount: UInt64 = 0,
            consecutiveBlockedAttempts: UInt64 = 0,
            rollingBlockedAttemptOrdinals: [UInt64] = []
        ) throws {
            self.protocolVersion = protocolVersion
            self.scope = scope
            self.reviewedAttemptCount = reviewedAttemptCount
            self.consecutiveBlockedAttempts = consecutiveBlockedAttempts
            self.rollingBlockedAttemptOrdinals = rollingBlockedAttemptOrdinals
            try validate()
        }

        private enum CodingKeys: String, CodingKey, CaseIterable {
            case protocolVersion, scope, reviewedAttemptCount, consecutiveBlockedAttempts, rollingBlockedAttemptOrdinals
        }

        public init(from decoder: Decoder) throws {
            try rejectUnknownKeys(decoder, CodingKeys.self)
            let container = try decoder.container(keyedBy: CodingKeys.self)
            protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
            scope = try container.decode(ReviewerCircuitScope.self, forKey: .scope)
            reviewedAttemptCount = try container.decode(UInt64.self, forKey: .reviewedAttemptCount)
            consecutiveBlockedAttempts = try container.decode(UInt64.self, forKey: .consecutiveBlockedAttempts)
            rollingBlockedAttemptOrdinals = try container.decode([UInt64].self, forKey: .rollingBlockedAttemptOrdinals)
            try validate()
        }

        fileprivate func validate() throws {
            guard protocolVersion == remoteAuthProtocolVersionV1,
                  consecutiveBlockedAttempts <= reviewedAttemptCount
            else {
                throw AutoReviewerError.invalidBreakerState
            }
            try scope.validate()

            var previous: UInt64 = 0
            for ordinal in rollingBlockedAttemptOrdinals {
                guard ordinal > previous, ordinal <= reviewedAttemptCount else {
                    throw AutoReviewerError.invalidBreakerState
                }
                previous = ordinal
            }
        }
    }

    public static func isOpen(_ state: State, configuration: Configuration) throws -> Bool {
        try state.validate()
        try configuration.validate()
        if state.consecutiveBlockedAttempts >= UInt64(configuration.consecutiveThreshold) {
            return true
        }
        let oldestIncluded = rollingOldestIncluded(
            reviewedAttemptCount: state.reviewedAttemptCount,
            window: UInt64(configuration.rollingWindow)
        )
        let blockedInWindow = state.rollingBlockedAttemptOrdinals.lazy.filter { $0 >= oldestIncluded }.count
        return blockedInWindow >= Int(configuration.rollingThreshold)
    }

    public static func record(
        _ outcome: ReviewerAttemptOutcome,
        in state: State,
        configuration: Configuration
    ) throws -> State {
        try state.validate()
        try configuration.validate()

        let classification: BreakerClassification
        switch outcome {
        case .failure(.cancelled):
            classification = .cancelled
        case .result(let result) where result.status == .cancelled && result.reasonCode == .cancelled:
            classification = .cancelled
        case .result(let result) where result.status == .completed
                && result.outcome == .allow
                && result.reasonCode == .semanticAllow:
            classification = .semanticAllow
        default:
            classification = .blocked
        }

        guard classification != .cancelled else { return state }

        var next = state
        let (nextOrdinal, overflow) = next.reviewedAttemptCount.addingReportingOverflow(1)
        guard !overflow else { throw AutoReviewerError.invalidBreakerState }
        next.reviewedAttemptCount = nextOrdinal

        switch classification {
        case .semanticAllow:
            next.consecutiveBlockedAttempts = 0
        case .blocked:
            let (consecutive, consecutiveOverflow) = next.consecutiveBlockedAttempts.addingReportingOverflow(1)
            guard !consecutiveOverflow else { throw AutoReviewerError.invalidBreakerState }
            next.consecutiveBlockedAttempts = consecutive
            next.rollingBlockedAttemptOrdinals.append(nextOrdinal)
        case .cancelled:
            break
        }

        let oldestIncluded = rollingOldestIncluded(
            reviewedAttemptCount: next.reviewedAttemptCount,
            window: UInt64(configuration.rollingWindow)
        )
        if let firstIncluded = next.rollingBlockedAttemptOrdinals.firstIndex(where: { $0 >= oldestIncluded }),
           firstIncluded > next.rollingBlockedAttemptOrdinals.startIndex {
            next.rollingBlockedAttemptOrdinals.removeFirst(firstIncluded)
        } else if next.rollingBlockedAttemptOrdinals.last.map({ $0 < oldestIncluded }) == true {
            next.rollingBlockedAttemptOrdinals.removeAll(keepingCapacity: true)
        }

        try next.validate()
        return next
    }

    private enum BreakerClassification {
        case semanticAllow, blocked, cancelled
    }

    private static func rollingOldestIncluded(reviewedAttemptCount: UInt64, window: UInt64) -> UInt64 {
        guard reviewedAttemptCount >= window else { return 1 }
        return reviewedAttemptCount - window + 1
    }
}

public enum AutoReviewerError: Error, Equatable, Sendable {
    case invalidConfiguration
    case invalidBreakerConfiguration
    case invalidBreakerState
    case breakerScopeMismatch
    case circuitOpen
}

public struct AutoReviewRun: Sendable {
    public let result: ReviewerResult
    public let breakerState: ReviewerCircuitBreaker.State

    public init(result: ReviewerResult, breakerState: ReviewerCircuitBreaker.State) {
        self.result = result
        self.breakerState = breakerState
    }
}

public final class AutoReviewer: @unchecked Sendable {
    public struct Configuration: Sendable {
        public let ompPath: String
        public let reviewedPolicyModel: String
        public let fixedPrompt: String
        public let promptPolicyDigest: String
        public let reviewerBuildDigest: String
        public let reviewedWorkingDirectory: String
        public let exactEnvironment: [String: String]
        public let deadlineMilliseconds: UInt64
        public let maximumAttempts: UInt32
        public let retryBackoffMilliseconds: [UInt64]
        public let breakerConsecutiveThreshold: UInt32
        public let breakerRollingThreshold: UInt32
        public let breakerRollingWindow: UInt32

        public init(
            ompPath: String,
            reviewedPolicyModel: String,
            fixedPrompt: String,
            promptPolicyDigest: String,
            reviewerBuildDigest: String,
            reviewedWorkingDirectory: String,
            exactEnvironment: [String: String],
            deadlineMilliseconds: UInt64,
            maximumAttempts: UInt32,
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

        public var breakerConfiguration: ReviewerCircuitBreaker.Configuration {
            ReviewerCircuitBreaker.Configuration(
                consecutiveThreshold: breakerConsecutiveThreshold,
                rollingThreshold: breakerRollingThreshold,
                rollingWindow: breakerRollingWindow
            )
        }

        fileprivate func validateStructure() throws {
            guard deadlineMilliseconds == ReviewerRetryPolicy.sharedDeadlineMilliseconds,
                  maximumAttempts == ReviewerRetryPolicy.maximumAttempts,
                  retryBackoffMilliseconds == [250, 1_000],
                  URL(fileURLWithPath: ompPath).path == ompPath,
                  URL(fileURLWithPath: reviewedWorkingDirectory).path == reviewedWorkingDirectory,
                  !reviewedPolicyModel.isEmpty,
                  !fixedPrompt.isEmpty,
                  !reviewedPolicyModel.contains("\0"),
                  !fixedPrompt.contains("\0")
            else {
                throw AutoReviewerError.invalidConfiguration
            }
            try validateDigest(promptPolicyDigest)
            try validateDigest(reviewerBuildDigest)
            guard ProtocolCrypto.sha256Hex(Data(fixedPrompt.utf8)) == promptPolicyDigest else {
                throw AutoReviewerError.invalidConfiguration
            }
            try breakerConfiguration.validate()

            let allowedEnvironment = Set(["HOME", "TMPDIR", "LANG", "LC_ALL", "PATH", "NO_COLOR", "TERM"])
            guard exactEnvironment.count <= allowedEnvironment.count,
                  exactEnvironment.allSatisfy({ key, value in
                      allowedEnvironment.contains(key)
                          && !value.contains("\0")
                          && value.utf8.count <= 4_096
                  })
            else {
                throw AutoReviewerError.invalidConfiguration
            }
        }
    }

    private let configuration: Configuration

    public init(configuration: Configuration) throws {
        try configuration.validateStructure()
        self.configuration = configuration
    }

    public func review(
        _ input: AutoReviewInput,
        breakerState: ReviewerCircuitBreaker.State
    ) async throws -> AutoReviewRun {
        let breakerConfiguration = configuration.breakerConfiguration
        guard breakerState.scope == input.scope else { throw AutoReviewerError.breakerScopeMismatch }
        guard try !ReviewerCircuitBreaker.isOpen(breakerState, configuration: breakerConfiguration) else {
            throw AutoReviewerError.circuitOpen
        }

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .milliseconds(Int64(configuration.deadlineMilliseconds)))
        let startedAt = wallClockMilliseconds()
        var state = breakerState
        var completedAttempts: UInt32 = 0
        if Task.isCancelled {
            return cancellation(input: input, attemptCount: 1, startedAt: startedAt, state: state)
        }

        do {
            try validateRuntimeSetup()
        } catch {
            return try terminalFailure(
                input: input,
                reasonCode: .reviewerSetupFailure,
                attemptCount: 1,
                startedAt: startedAt,
                state: state,
                failure: .setupFailure
            )
        }

        for attempt in UInt32(1)...ReviewerRetryPolicy.maximumAttempts {
            if Task.isCancelled {
                return cancellation(input: input, attemptCount: max(1, completedAttempts), startedAt: startedAt, state: state)
            }
            guard clock.now < deadline else {
                return try terminalFailure(
                    input: input,
                    reasonCode: .timeout,
                    attemptCount: max(1, completedAttempts),
                    startedAt: startedAt,
                    state: state,
                    failure: .timeout
                )
            }

            let payload: Data
            do {
                payload = try prepareInput(input, attemptCount: attempt)
            } catch PreparationFailure.missingEvidence {
                return try terminalFailure(
                    input: input,
                    reasonCode: .missingEvidence,
                    attemptCount: attempt,
                    startedAt: startedAt,
                    state: state,
                    failure: .integrityFailure
                )
            } catch PreparationFailure.digestMismatch {
                return try terminalFailure(
                    input: input,
                    reasonCode: .digestMismatch,
                    attemptCount: attempt,
                    startedAt: startedAt,
                    state: state,
                    failure: .integrityFailure
                )
            } catch PreparationFailure.inputTooLarge {
                return try terminalFailure(
                    input: input,
                    reasonCode: .truncatedInput,
                    attemptCount: attempt,
                    startedAt: startedAt,
                    state: state,
                    failure: .integrityFailure
                )
            } catch {
                return try terminalFailure(
                    input: input,
                    reasonCode: .canonicalActionUnreconstructable,
                    attemptCount: attempt,
                    startedAt: startedAt,
                    state: state,
                    failure: .integrityFailure
                )
            }

            let processOutcome = await execute(payload: payload, deadline: deadline, clock: clock)
            completedAttempts = attempt

            let attemptOutcome: ReviewerAttemptOutcome
            let result: ReviewerResult
            switch processOutcome {
            case .output(let output):
                let expected = ReviewerResultExpectation(
                    reviewId: input.reviewId,
                    canonicalRequestDigest: input.canonicalActionDigest,
                    reviewerModel: configuration.reviewedPolicyModel,
                    reviewerBuildDigest: configuration.reviewerBuildDigest,
                    promptPolicyDigest: configuration.promptPolicyDigest,
                    risk: input.risk,
                    userAuthorization: input.userAuthorization,
                    attemptCount: attempt
                )
                do {
                    result = try ReviewerResultParser.parse(output, expecting: expected)
                    attemptOutcome = .result(result)
                } catch let error as ReviewerResultParseError {
                    let mapped = mappedBindingFailure(error)
                    if mapped.failure == .parseDrift {
                        result = failureResult(
                            input: input,
                            reasonCode: .parseFailure,
                            attemptCount: attempt,
                            startedAt: startedAt
                        )
                    } else {
                        result = failureResult(
                            input: input,
                            reasonCode: mapped.reasonCode,
                            attemptCount: attempt,
                            startedAt: startedAt
                        )
                    }
                    attemptOutcome = .failure(mapped.failure)
                } catch {
                    result = failureResult(
                        input: input,
                        reasonCode: .parseFailure,
                        attemptCount: attempt,
                        startedAt: startedAt
                    )
                    attemptOutcome = .failure(.parseDrift)
                }
            case .failure(let failure):
                if failure == .cancelled {
                    return cancellation(input: input, attemptCount: attempt, startedAt: startedAt, state: state)
                }
                result = failureResult(
                    input: input,
                    reasonCode: reasonCode(for: failure),
                    attemptCount: attempt,
                    startedAt: startedAt
                )
                attemptOutcome = .failure(failure)
            }

            state = try ReviewerCircuitBreaker.record(
                attemptOutcome,
                in: state,
                configuration: breakerConfiguration
            )

            if try ReviewerCircuitBreaker.isOpen(state, configuration: breakerConfiguration) {
                return AutoReviewRun(result: result, breakerState: state)
            }

            let remaining = milliseconds(from: clock.now.duration(to: deadline))
            switch ReviewerRetryPolicy.decision(
                after: attemptOutcome,
                completedAttempts: attempt,
                remainingMilliseconds: remaining
            ) {
            case .stop:
                return AutoReviewRun(result: result, breakerState: state)
            case .retry(let backoffMilliseconds):
                do {
                    try await clock.sleep(for: .milliseconds(Int64(backoffMilliseconds)))
                } catch {
                    return cancellation(input: input, attemptCount: attempt, startedAt: startedAt, state: state)
                }
            }
        }

        return try terminalFailure(
            input: input,
            reasonCode: .timeout,
            attemptCount: max(1, completedAttempts),
            startedAt: startedAt,
            state: state,
            failure: .timeout
        )
    }

    private func prepareInput(_ original: AutoReviewInput, attemptCount: UInt32) throws -> Data {
        do {
            try original.evidence.validate()
        } catch {
            throw PreparationFailure.missingEvidence
        }

        var input = original
        input.attemptCount = attemptCount
        let encoded: Data
        do {
            try input.validate()
            encoded = try encodeCanonicalJSON(input)
        } catch {
            throw PreparationFailure.unreconstructable
        }
        guard encoded.count <= remoteAuthMaximumFrameBytes else { throw PreparationFailure.inputTooLarge }

        let reconstructed: AutoReviewInput
        do {
            reconstructed = try ProtocolJSON.decode(AutoReviewInput.self, from: encoded)
            let originalCanonicalAction = try ReviewableActionCanonicalizer.canonicalData(original.canonicalAction)
            let reconstructedCanonicalAction = try ReviewableActionCanonicalizer.canonicalData(reconstructed.canonicalAction)
            guard originalCanonicalAction == reconstructedCanonicalAction,
                  ProtocolCrypto.sha256Hex(reconstructedCanonicalAction) == reconstructed.canonicalActionDigest
            else {
                throw PreparationFailure.digestMismatch
            }
        } catch let failure as PreparationFailure {
            throw failure
        } catch {
            throw PreparationFailure.unreconstructable
        }
        return encoded
    }

    private func validateRuntimeSetup() throws {
        try configuration.validateStructure()
        let fileManager = FileManager.default
        let executableURL = URL(fileURLWithPath: configuration.ompPath).standardizedFileURL
        let workingDirectoryURL = URL(fileURLWithPath: configuration.reviewedWorkingDirectory).standardizedFileURL

        guard executableURL.resolvingSymlinksInPath().path == executableURL.path,
              workingDirectoryURL.resolvingSymlinksInPath().path == workingDirectoryURL.path
        else {
            throw AutoReviewerError.invalidConfiguration
        }

        let executableAttributes = try fileManager.attributesOfItem(atPath: executableURL.path)
        guard executableAttributes[.type] as? FileAttributeType == .typeRegular,
              fileManager.isExecutableFile(atPath: executableURL.path),
              try executableDigest(at: executableURL) == configuration.reviewerBuildDigest
        else {
            throw AutoReviewerError.invalidConfiguration
        }

        let directoryAttributes = try fileManager.attributesOfItem(atPath: workingDirectoryURL.path)
        let permissions = (directoryAttributes[.posixPermissions] as? NSNumber)?.uint16Value
        guard directoryAttributes[.type] as? FileAttributeType == .typeDirectory,
              let permissions,
              permissions & 0o222 == 0,
              try fileManager.contentsOfDirectory(atPath: workingDirectoryURL.path).isEmpty
        else {
            throw AutoReviewerError.invalidConfiguration
        }
    }

    private func execute(
        payload: Data,
        deadline: ContinuousClock.Instant,
        clock: ContinuousClock
    ) async -> ProcessOutcome {
        if Task.isCancelled { return .failure(.cancelled) }

        let process = Process()
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        let waiter = ProcessWaiter()
        let processHandle = ReviewerProcessHandle(process)

        process.executableURL = URL(fileURLWithPath: configuration.ompPath)
        process.arguments = [
            "-p",
            "--no-session",
            "--no-tools",
            "--model",
            configuration.reviewedPolicyModel,
            configuration.fixedPrompt,
        ]
        process.currentDirectoryURL = URL(fileURLWithPath: configuration.reviewedWorkingDirectory)
        process.environment = configuration.exactEnvironment
        process.standardInput = inputPipe
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        process.terminationHandler = { terminated in
            waiter.finish(.exited(terminated.terminationStatus))
        }

        do {
            try process.run()
        } catch {
            try? inputPipe.fileHandleForWriting.close()
            try? outputPipe.fileHandleForWriting.close()
            try? errorPipe.fileHandleForWriting.close()
            return .failure(.setupFailure)
        }

        let inputTask = Task.detached(priority: .utility) { () -> Bool in
            defer { try? inputPipe.fileHandleForWriting.close() }
            do {
                try inputPipe.fileHandleForWriting.write(contentsOf: payload)
                return true
            } catch {
                return false
            }
        }
        let outputTask = Task.detached(priority: .utility) { () -> BoundedRead? in
            try? readBounded(outputPipe.fileHandleForReading, maximumBytes: remoteAuthMaximumFrameBytes)
        }
        let errorTask = Task.detached(priority: .utility) {
            drain(errorPipe.fileHandleForReading)
        }

        let termination = await withTaskCancellationHandler(operation: {
            let timeoutTask = Task {
                do {
                    try await clock.sleep(until: deadline)
                    processHandle.terminate()
                    waiter.finish(.timedOut)
                } catch {
                    return
                }
            }
            let outcome = await waiter.wait()
            timeoutTask.cancel()
            return outcome
        }, onCancel: {
            processHandle.terminate()
            waiter.finish(.cancelled)
        })

        switch termination {
        case .cancelled:
            inputTask.cancel()
            outputTask.cancel()
            errorTask.cancel()
            return .failure(.cancelled)
        case .timedOut:
            inputTask.cancel()
            outputTask.cancel()
            errorTask.cancel()
            return .failure(.timeout)
        case .exited(let status):
            let inputSucceeded = await inputTask.value
            let output = await outputTask.value
            _ = await errorTask.value
            if Task.isCancelled { return .failure(.cancelled) }
            guard status == 0, inputSucceeded else { return .failure(.transportFailure) }
            guard let output, !output.exceededMaximum else { return .failure(.parseDrift) }
            return .output(output.data)
        }
    }

    private func terminalFailure(
        input: AutoReviewInput,
        reasonCode: ReviewerReasonCode,
        attemptCount: UInt32,
        startedAt: UInt64,
        state: ReviewerCircuitBreaker.State,
        failure: ReviewerAttemptFailure
    ) throws -> AutoReviewRun {
        let result = failureResult(
            input: input,
            reasonCode: reasonCode,
            attemptCount: attemptCount,
            startedAt: startedAt
        )
        let next = try ReviewerCircuitBreaker.record(
            .failure(failure),
            in: state,
            configuration: configuration.breakerConfiguration
        )
        return AutoReviewRun(result: result, breakerState: next)
    }

    private func cancellation(
        input: AutoReviewInput,
        attemptCount: UInt32,
        startedAt: UInt64,
        state: ReviewerCircuitBreaker.State
    ) -> AutoReviewRun {
        let completedAt = max(startedAt, wallClockMilliseconds())
        let result = ReviewerResult(
            reviewId: input.reviewId,
            canonicalRequestDigest: input.canonicalActionDigest,
            reviewerModel: configuration.reviewedPolicyModel,
            reviewerBuildDigest: configuration.reviewerBuildDigest,
            promptPolicyDigest: configuration.promptPolicyDigest,
            risk: input.risk,
            userAuthorization: input.userAuthorization,
            status: .cancelled,
            outcome: .blocked,
            reasonCode: .cancelled,
            reason: "review cancelled",
            rationale: "the caller cancelled the review",
            attemptCount: min(ReviewerRetryPolicy.maximumAttempts, max(1, attemptCount)),
            startedAt: startedAt,
            completedAt: completedAt,
            expiresAt: completedAt + 1
        )
        return AutoReviewRun(result: result, breakerState: state)
    }

    private func failureResult(
        input: AutoReviewInput,
        reasonCode: ReviewerReasonCode,
        attemptCount: UInt32,
        startedAt: UInt64
    ) -> ReviewerResult {
        let completedAt = max(startedAt, wallClockMilliseconds())
        let status: ReviewerStatus
        switch reasonCode {
        case .missingEvidence, .promptInjection, .digestMismatch, .truncatedInput,
             .omittedSecurityField, .canonicalActionUnreconstructable:
            status = .completed
        default:
            status = .failed
        }
        return ReviewerResult(
            reviewId: input.reviewId,
            canonicalRequestDigest: input.canonicalActionDigest,
            reviewerModel: configuration.reviewedPolicyModel,
            reviewerBuildDigest: configuration.reviewerBuildDigest,
            promptPolicyDigest: configuration.promptPolicyDigest,
            risk: input.risk,
            userAuthorization: input.userAuthorization,
            status: status,
            outcome: .blocked,
            reasonCode: reasonCode,
            reason: failureReason(reasonCode),
            rationale: "review failed closed",
            attemptCount: min(ReviewerRetryPolicy.maximumAttempts, max(1, attemptCount)),
            startedAt: startedAt,
            completedAt: completedAt,
            expiresAt: completedAt + 1
        )
    }

    private func mappedBindingFailure(
        _ error: ReviewerResultParseError
    ) -> (failure: ReviewerAttemptFailure, reasonCode: ReviewerReasonCode) {
        switch error {
        case .invalidResult:
            return (.parseDrift, .parseFailure)
        case .canonicalRequestDigestMismatch, .reviewerBuildDigestMismatch, .promptPolicyDigestMismatch:
            return (.integrityFailure, .digestMismatch)
        case .reviewerModelMismatch:
            return (.integrityFailure, .reviewerSetupFailure)
        case .reviewIdMismatch, .riskMismatch, .userAuthorizationMismatch, .attemptCountMismatch:
            return (.integrityFailure, .omittedSecurityField)
        }
    }

    private func reasonCode(for failure: ReviewerAttemptFailure) -> ReviewerReasonCode {
        switch failure {
        case .providerFailure: return .providerFailure
        case .transportFailure: return .transportFailure
        case .parseDrift: return .parseFailure
        case .modelFailure: return .modelFailure
        case .sessionFailure: return .sessionFailure
        case .setupFailure: return .reviewerSetupFailure
        case .integrityFailure: return .digestMismatch
        case .cancelled: return .cancelled
        case .timeout: return .timeout
        }
    }

    private func failureReason(_ reasonCode: ReviewerReasonCode) -> String {
        switch reasonCode {
        case .timeout: return "review deadline exceeded"
        case .modelFailure: return "reviewer model failure"
        case .sessionFailure: return "reviewer session failure"
        case .providerFailure: return "reviewer provider failure"
        case .transportFailure: return "reviewer transport failure"
        case .parseFailure: return "reviewer result parse failure"
        case .missingEvidence: return "required review evidence missing"
        case .promptInjection: return "prompt injection suspected"
        case .digestMismatch: return "review digest mismatch"
        case .truncatedInput: return "review input exceeded its bound"
        case .omittedSecurityField: return "review result binding mismatch"
        case .canonicalActionUnreconstructable: return "canonical action reconstruction failed"
        case .reviewerSetupFailure: return "reviewer setup failure"
        case .cancelled: return "review cancelled"
        case .semanticAllow, .semanticDeny, .semanticEscalate:
            return "invalid semantic failure"
        }
    }

    private func executableDigest(at url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 65_536), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        let digest = hasher.finalize()
        return String(unsafeUninitializedCapacity: 64) { output in
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

private enum PreparationFailure: Error {
    case missingEvidence
    case digestMismatch
    case inputTooLarge
    case unreconstructable
}

private enum ProcessOutcome {
    case output(Data)
    case failure(ReviewerAttemptFailure)
}

private struct BoundedRead {
    var data: Data
    var exceededMaximum: Bool
}

private func readBounded(_ handle: FileHandle, maximumBytes: Int) throws -> BoundedRead {
    defer { try? handle.close() }
    var data = Data()
    data.reserveCapacity(min(maximumBytes, 16_384))
    var exceeded = false
    while let chunk = try handle.read(upToCount: 16_384), !chunk.isEmpty {
        if !exceeded, chunk.count <= maximumBytes - data.count {
            data.append(chunk)
        } else {
            exceeded = true
        }
    }
    return BoundedRead(data: data, exceededMaximum: exceeded)
}

private func drain(_ handle: FileHandle) {
    defer { try? handle.close() }
    do {
        while let chunk = try handle.read(upToCount: 16_384), !chunk.isEmpty {}
    } catch {
        return
    }
}

private final class ReviewerProcessHandle: @unchecked Sendable {
    private let process: Process

    init(_ process: Process) {
        self.process = process
    }

    func terminate() {
        if process.isRunning {
            process.terminate()
        }
    }
}

private final class ProcessWaiter: @unchecked Sendable {
    enum Outcome {
        case exited(Int32)
        case timedOut
        case cancelled
    }

    private let lock = NSLock()
    private var continuation: CheckedContinuation<Outcome, Never>?
    private var outcome: Outcome?

    func wait() async -> Outcome {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let outcome {
                lock.unlock()
                continuation.resume(returning: outcome)
            } else {
                self.continuation = continuation
                lock.unlock()
            }
        }
    }

    func finish(_ outcome: Outcome) {
        lock.lock()
        guard self.outcome == nil else {
            lock.unlock()
            return
        }
        self.outcome = outcome
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(returning: outcome)
    }
}

private func encodeCanonicalJSON<T: WireMessage>(_ value: T) throws -> Data {
    try value.validate()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
}

private func requireExactKeys(_ decoder: Decoder, _ expected: Set<String>) throws {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    guard Set(container.allKeys.map(\.stringValue)) == expected else {
        throw RemoteAuthProtocolError(.excessField)
    }
}

private func rejectUnknownKeys<Key>(_ decoder: Decoder, _ keys: Key.Type) throws
where Key: CodingKey & CaseIterable {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    let accepted = Set(Key.allCases.map(\.stringValue))
    guard container.allKeys.allSatisfy({ accepted.contains($0.stringValue) }) else {
        throw RemoteAuthProtocolError(.excessField)
    }
}

private struct DynamicCodingKey: CodingKey {
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

private func validateIdentifier(_ value: String) throws {
    let bytes = value.utf8
    guard (22...86).contains(bytes.count) else {
        throw RemoteAuthProtocolError(.noncanonicalValue)
    }

    var lastSextet: UInt8?
    for byte in bytes {
        let sextet: UInt8
        switch byte {
        case 65...90: sextet = byte - 65
        case 97...122: sextet = byte - 97 + 26
        case 48...57: sextet = byte - 48 + 52
        case 45: sextet = 62
        case 95: sextet = 63
        default: throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        lastSextet = sextet
    }

    guard let lastSextet else { throw RemoteAuthProtocolError(.noncanonicalValue) }
    let remainder = bytes.count % 4
    guard remainder == 0
            || (remainder == 2 && lastSextet & 0x0f == 0)
            || (remainder == 3 && lastSextet & 0x03 == 0)
    else {
        throw RemoteAuthProtocolError(.noncanonicalValue)
    }
}

private func validateDigest(_ value: String) throws {
    let bytes = value.utf8
    guard bytes.count == 64,
          bytes.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
    else {
        throw RemoteAuthProtocolError(.noncanonicalValue)
    }
}

private func validateEvidenceText(_ value: String, maximumScalarCount: Int) throws {
    let scalars = value.unicodeScalars
    guard !scalars.isEmpty,
          scalars.count <= maximumScalarCount,
          scalars.allSatisfy({ scalar in
              scalar.value == 0x09
                  || scalar.value == 0x0a
                  || scalar.value == 0x0d
                  || scalar.properties.generalCategory != .control
          })
    else {
        throw RemoteAuthProtocolError(.reviewBlocked)
    }
}

private func validateEvidenceList(_ values: [String]) throws {
    guard !values.isEmpty, values.count <= 64 else {
        throw RemoteAuthProtocolError(.reviewBlocked)
    }
    for value in values {
        try validateEvidenceText(value, maximumScalarCount: 1_024)
    }
}

private func wallClockMilliseconds() -> UInt64 {
    UInt64(max(1, Date().timeIntervalSince1970 * 1_000))
}

private func milliseconds(from duration: Duration) -> UInt64 {
    let components = duration.components
    guard components.seconds >= 0 else { return 0 }
    let seconds = UInt64(components.seconds)
    let millisecondsFromSeconds = seconds.multipliedReportingOverflow(by: 1_000)
    guard !millisecondsFromSeconds.overflow else { return UInt64.max }
    let fractional = components.attoseconds > 0
        ? UInt64(components.attoseconds / 1_000_000_000_000_000)
        : 0
    let total = millisecondsFromSeconds.partialValue.addingReportingOverflow(fractional)
    return total.overflow ? UInt64.max : total.partialValue
}
