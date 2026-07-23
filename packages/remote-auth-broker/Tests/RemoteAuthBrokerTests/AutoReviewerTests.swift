import Foundation
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class AutoReviewerTests: XCTestCase {
    private let digest = String(repeating: "a", count: 64)
    private let buildDigest = String(repeating: "b", count: 64)
    private let promptDigest = String(repeating: "c", count: 64)

    func testParserAcceptsExactlyOneClosedValidResult() throws {
        let result = makeResult(outcome: .deny, reasonCode: .semanticDeny)
        let data = try ProtocolJSON.encode(result)
        let parsed = try ReviewerResultParser.parse(data, expecting: expectation())
        XCTAssertEqual(parsed.status, .completed)
        XCTAssertEqual(parsed.outcome, .deny)
        XCTAssertEqual(parsed.reasonCode, .semanticDeny)

        var missing = try jsonObject(data)
        missing.removeValue(forKey: "rationale")
        assertInvalidResult(try JSONSerialization.data(withJSONObject: missing))

        var excess = try jsonObject(data)
        excess["unexpected"] = true
        assertInvalidResult(try JSONSerialization.data(withJSONObject: excess))

        var trailing = data
        trailing.append(Data("\n{}".utf8))
        assertInvalidResult(trailing)
        assertInvalidResult(Data("{not-json}".utf8))
    }

    func testParserUsesReviewerResultValidationForOutcomeConsistency() throws {
        var inconsistent = makeResult(outcome: .deny, reasonCode: .semanticDeny)
        inconsistent.reasonCode = .semanticAllow
        let data = try JSONEncoder().encode(inconsistent)
        assertInvalidResult(data)

        var blockedSemantic = makeResult(outcome: .deny, reasonCode: .semanticDeny)
        blockedSemantic.status = .failed
        let blockedData = try JSONEncoder().encode(blockedSemantic)
        assertInvalidResult(blockedData)
    }

    func testParserRejectsEveryExpectedBindingMismatch() throws {
        let data = try ProtocolJSON.encode(makeResult(outcome: .allow, reasonCode: .semanticAllow))

        assertParseError(.reviewIdMismatch, data: data, expected: expectation(reviewId: "other"))
        assertParseError(
            .canonicalRequestDigestMismatch,
            data: data,
            expected: expectation(canonicalRequestDigest: String(repeating: "d", count: 64))
        )
        assertParseError(.reviewerModelMismatch, data: data, expected: expectation(reviewerModel: "other-model"))
        assertParseError(
            .reviewerBuildDigestMismatch,
            data: data,
            expected: expectation(reviewerBuildDigest: String(repeating: "d", count: 64))
        )
        assertParseError(
            .promptPolicyDigestMismatch,
            data: data,
            expected: expectation(promptPolicyDigest: String(repeating: "d", count: 64))
        )
        assertParseError(.riskMismatch, data: data, expected: expectation(risk: .critical))
        assertParseError(
            .userAuthorizationMismatch,
            data: data,
            expected: expectation(userAuthorization: .medium)
        )
        assertParseError(.attemptCountMismatch, data: data, expected: expectation(attemptCount: 2))
    }

    func testValidSemanticDenialAndEscalationAreNeverRetried() {
        let denial = makeResult(outcome: .deny, reasonCode: .semanticDeny)
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .result(denial),
                completedAttempts: 1,
                remainingMilliseconds: 89_000
            ),
            .stop
        )

        let escalation = makeResult(outcome: .escalate, reasonCode: .semanticEscalate)
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .result(escalation),
                completedAttempts: 1,
                remainingMilliseconds: 89_000
            ),
            .stop
        )
    }

    func testTransientRetriesHonorAttemptLimitAndSharedDeadline() {
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .failure(.providerFailure),
                completedAttempts: 1,
                remainingMilliseconds: 1_000
            ),
            .retry(afterMilliseconds: 250)
        )
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .failure(.transportFailure),
                completedAttempts: 2,
                remainingMilliseconds: 1_001
            ),
            .retry(afterMilliseconds: 1_000)
        )
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .failure(.parseDrift),
                completedAttempts: 2,
                remainingMilliseconds: 1_000
            ),
            .stop
        )
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .failure(.providerFailure),
                completedAttempts: 3,
                remainingMilliseconds: 90_000
            ),
            .stop
        )

        let providerResult = makeResult(
            status: .failed,
            outcome: .blocked,
            reasonCode: .providerFailure
        )
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .result(providerResult),
                completedAttempts: 1,
                remainingMilliseconds: 500
            ),
            .retry(afterMilliseconds: 250)
        )
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .failure(.modelFailure),
                completedAttempts: 1,
                remainingMilliseconds: 89_000
            ),
            .stop
        )
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .failure(.timeout),
                completedAttempts: 1,
                remainingMilliseconds: 89_000
            ),
            .stop
        )
    }

    func testCancellationStopsRetriesAndDoesNotChangeBreakerAccounting() throws {
        XCTAssertEqual(
            ReviewerRetryPolicy.decision(
                after: .failure(.cancelled),
                completedAttempts: 1,
                remainingMilliseconds: 89_000
            ),
            .stop
        )

        let configuration = breakerConfiguration()
        let state = try ReviewerCircuitBreaker.State(scope: scope())
        let afterFailureCancellation = try ReviewerCircuitBreaker.record(
            .failure(.cancelled),
            in: state,
            configuration: configuration
        )
        XCTAssertEqual(afterFailureCancellation, state)

        let cancelledResult = makeResult(
            status: .cancelled,
            outcome: .blocked,
            reasonCode: .cancelled
        )
        let afterResultCancellation = try ReviewerCircuitBreaker.record(
            .result(cancelledResult),
            in: state,
            configuration: configuration
        )
        XCTAssertEqual(afterResultCancellation, state)
    }

    func testDenyEscalateAndOperationalFailuresAllCountAsBlockedAttempts() throws {
        let configuration = breakerConfiguration(consecutiveThreshold: 4, rollingThreshold: 4, rollingWindow: 8)
        var state = try ReviewerCircuitBreaker.State(scope: scope())

        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .deny, reasonCode: .semanticDeny)),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .escalate, reasonCode: .semanticEscalate)),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .failure(.transportFailure),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .failure(.integrityFailure),
            in: state,
            configuration: configuration
        )

        XCTAssertEqual(state.reviewedAttemptCount, 4)
        XCTAssertEqual(state.consecutiveBlockedAttempts, 4)
        XCTAssertEqual(state.rollingBlockedAttemptOrdinals, [1, 2, 3, 4])
        XCTAssertTrue(try ReviewerCircuitBreaker.isOpen(state, configuration: configuration))
    }

    func testOnlySemanticAllowResetsConsecutiveAndNeverClearsRollingHistory() throws {
        let configuration = breakerConfiguration(consecutiveThreshold: 5, rollingThreshold: 5, rollingWindow: 8)
        var state = try ReviewerCircuitBreaker.State(scope: scope())
        state = try ReviewerCircuitBreaker.record(
            .failure(.parseDrift),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .deny, reasonCode: .semanticDeny)),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .allow, reasonCode: .semanticAllow)),
            in: state,
            configuration: configuration
        )

        XCTAssertEqual(state.reviewedAttemptCount, 3)
        XCTAssertEqual(state.consecutiveBlockedAttempts, 0)
        XCTAssertEqual(state.rollingBlockedAttemptOrdinals, [1, 2])
    }

    func testRollingThresholdOpensScopeAndAgesWithoutAllowReset() throws {
        let configuration = breakerConfiguration(consecutiveThreshold: 10, rollingThreshold: 3, rollingWindow: 4)
        var state = try ReviewerCircuitBreaker.State(scope: scope())
        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .deny, reasonCode: .semanticDeny)),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .allow, reasonCode: .semanticAllow)),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .escalate, reasonCode: .semanticEscalate)),
            in: state,
            configuration: configuration
        )
        state = try ReviewerCircuitBreaker.record(
            .failure(.setupFailure),
            in: state,
            configuration: configuration
        )

        XCTAssertEqual(state.rollingBlockedAttemptOrdinals, [1, 3, 4])
        XCTAssertTrue(try ReviewerCircuitBreaker.isOpen(state, configuration: configuration))

        state = try ReviewerCircuitBreaker.record(
            .result(makeResult(outcome: .allow, reasonCode: .semanticAllow)),
            in: state,
            configuration: configuration
        )
        XCTAssertEqual(state.rollingBlockedAttemptOrdinals, [3, 4])
        XCTAssertFalse(try ReviewerCircuitBreaker.isOpen(state, configuration: configuration))
    }

    func testBreakerStateRoundTripsAndRejectsExcessFields() throws {
        let configuration = breakerConfiguration()
        var state = try ReviewerCircuitBreaker.State(scope: scope())
        state = try ReviewerCircuitBreaker.record(
            .failure(.providerFailure),
            in: state,
            configuration: configuration
        )

        let data = try JSONEncoder().encode(state)
        XCTAssertEqual(try JSONDecoder().decode(ReviewerCircuitBreaker.State.self, from: data), state)

        var excess = try jsonObject(data)
        excess["rerouteKey"] = "bypass"
        let excessData = try JSONSerialization.data(withJSONObject: excess)
        XCTAssertThrowsError(try JSONDecoder().decode(ReviewerCircuitBreaker.State.self, from: excessData))
    }


    private func makeResult(
        status: ReviewerStatus = .completed,
        outcome: ReviewerOutcome,
        reasonCode: ReviewerReasonCode,
        attemptCount: UInt32 = 1
    ) -> ReviewerResult {
        ReviewerResult(
            reviewId: "AAAAAAAAAAAAAAAAAAAAAA",
            canonicalRequestDigest: digest,
            reviewerModel: "reviewer-model",
            reviewerBuildDigest: buildDigest,
            promptPolicyDigest: promptDigest,
            risk: .high,
            userAuthorization: .high,
            status: status,
            outcome: outcome,
            reasonCode: reasonCode,
            reason: "bounded reason",
            rationale: "bounded rationale",
            attemptCount: attemptCount,
            startedAt: 1,
            completedAt: 2,
            expiresAt: 3
        )
    }

    private func expectation(
        reviewId: String = "AAAAAAAAAAAAAAAAAAAAAA",
        canonicalRequestDigest: String? = nil,
        reviewerModel: String = "reviewer-model",
        reviewerBuildDigest: String? = nil,
        promptPolicyDigest: String? = nil,
        risk: RiskLevel = .high,
        userAuthorization: ReviewerUserAuthorization = .high,
        attemptCount: UInt32 = 1
    ) -> ReviewerResultExpectation {
        ReviewerResultExpectation(
            reviewId: reviewId,
            canonicalRequestDigest: canonicalRequestDigest ?? digest,
            reviewerModel: reviewerModel,
            reviewerBuildDigest: reviewerBuildDigest ?? buildDigest,
            promptPolicyDigest: promptPolicyDigest ?? promptDigest,
            risk: risk,
            userAuthorization: userAuthorization,
            attemptCount: attemptCount
        )
    }

    private func scope() -> ReviewerCircuitScope {
        ReviewerCircuitScope(sessionId: "AAAAAAAAAAAAAAAAAAAAAA", turnId: "BBBBBBBBBBBBBBBBBBBBBA")
    }

    private func breakerConfiguration(
        consecutiveThreshold: UInt32 = 5,
        rollingThreshold: UInt32 = 5,
        rollingWindow: UInt32 = 8
    ) -> ReviewerCircuitBreaker.Configuration {
        ReviewerCircuitBreaker.Configuration(
            consecutiveThreshold: consecutiveThreshold,
            rollingThreshold: rollingThreshold,
            rollingWindow: rollingWindow
        )
    }

    private func jsonObject(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func assertInvalidResult(_ data: Data, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(
            try ReviewerResultParser.parse(data, expecting: expectation()),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(error as? ReviewerResultParseError, .invalidResult, file: file, line: line)
        }
    }

    private func assertParseError(
        _ expectedError: ReviewerResultParseError,
        data: Data,
        expected: ReviewerResultExpectation,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try ReviewerResultParser.parse(data, expecting: expected),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(error as? ReviewerResultParseError, expectedError, file: file, line: line)
        }
    }
}
