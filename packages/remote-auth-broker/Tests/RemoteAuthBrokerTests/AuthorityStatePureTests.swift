import Foundation
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class AuthorityStatePureTests: XCTestCase {
    private let baseTime: UInt64 = 1_000_000
    private let brokerDigest = String(repeating: "a", count: 64)
    private let callerDigest = String(repeating: "b", count: 64)
    private let targetDigest = String(repeating: "c", count: 64)
    private let ownerEpoch = "01890f3c-0000-7000-8000-000000000001"

    func testPolicyAdmissionReplayAndBodyConflictAreDistinct() throws {
        let policy = try loadedPolicy()
        let request = executionRequest(identifierByte: 1, nonceByte: 2, purpose: "Authorize deterministic GDM request")
        let decision = try policy.document.decision(for: request, policyDigest: policy.digest)
        XCTAssertEqual(decision.risk.rawValue, RiskLevel.medium.rawValue)
        XCTAssertEqual(
            decision.biometricPolicy.rawValue,
            BiometricPolicy.standingGrantOrOneShot.rawValue
        )

        var inactiveDocument = policy.document
        inactiveDocument.active = false
        inactiveDocument.canonicalStatus = .designInactive
        inactiveDocument.policyDigestState = .inactivePlaceholder
        inactiveDocument.policyDigest = BrokerPolicy.inactiveDigestPlaceholder
        assertRemoteError(.inactive) {
            try inactiveDocument.decision(for: request, policyDigest: inactiveDocument.policyDigest)
        }

        var state = AuthorityState()
        var mismatchedRuntime = runtimeIdentity()
        mismatchedRuntime.codeDigest = String(repeating: "d", count: 64)
        assertRemoteError(.policyMismatch) {
            try state.admit(
                request,
                peer: peerMatchInput(),
                policy: policy,
                runtime: mismatchedRuntime,
                receiptId: identifier(3),
                browserTargetGeneration: nil,
                now: baseTime + 100
            )
        }
        XCTAssertTrue(state.replayStore.requestIds.isEmpty)

        let admitted = try state.admit(
            request,
            peer: peerMatchInput(),
            policy: policy,
            runtime: runtimeIdentity(),
            receiptId: identifier(3),
            browserTargetGeneration: nil,
            now: baseTime + 100
        )
        XCTAssertEqual(admitted.requestId, request.requestId)
        XCTAssertEqual(state.replayStore.requestIds[request.requestId]?.bodyDigest, admitted.bodyDigest)

        assertRemoteError(.requestReplayed) {
            try state.admit(
                request,
                peer: peerMatchInput(),
                policy: policy,
                runtime: runtimeIdentity(),
                receiptId: identifier(4),
                browserTargetGeneration: nil,
                now: baseTime + 101
            )
        }

        var conflictingRequest = request
        conflictingRequest.purpose = "Different canonical request body"
        assertRemoteError(.bodyConflict) {
            try state.admit(
                conflictingRequest,
                peer: peerMatchInput(),
                policy: policy,
                runtime: runtimeIdentity(),
                receiptId: identifier(5),
                browserTargetGeneration: nil,
                now: baseTime + 102
            )
        }
        XCTAssertEqual(state.requests.count, 1)
        XCTAssertEqual(state.requests[request.requestId]?.bodyDigest, admitted.bodyDigest)
    }

    func testReplayStoreRejectsRequestAndNonceAliasesWithoutMutation() throws {
        let requestId = identifier(6)
        let nonce = nonce(7)
        let bodyDigest = String(repeating: "f", count: 64)
        var store = ReplayStore()

        XCTAssertEqual(
            store.disposition(requestId: requestId, nonce: nonce, bodyDigest: bodyDigest),
            .accepted
        )
        _ = try store.register(
            requestId: requestId,
            nonce: nonce,
            bodyDigest: bodyDigest,
            expiresAt: baseTime + 1_000
        )
        XCTAssertEqual(
            store.disposition(requestId: requestId, nonce: nonce, bodyDigest: bodyDigest),
            .replay
        )
        XCTAssertEqual(
            store.disposition(
                requestId: requestId,
                nonce: self.nonce(8),
                bodyDigest: String(repeating: "e", count: 64)
            ),
            .bodyConflict
        )
        XCTAssertEqual(
            store.disposition(
                requestId: identifier(9),
                nonce: nonce,
                bodyDigest: String(repeating: "d", count: 64)
            ),
            .bodyConflict
        )
        assertRemoteError(.requestReplayed) {
            try store.register(
                requestId: requestId,
                nonce: nonce,
                bodyDigest: bodyDigest,
                expiresAt: baseTime + 2_000
            )
        }
        assertRemoteError(.bodyConflict) {
            try store.register(
                requestId: identifier(9),
                nonce: nonce,
                bodyDigest: String(repeating: "d", count: 64),
                expiresAt: baseTime + 2_000
            )
        }
        XCTAssertEqual(store.requestIds.count, 1)
        XCTAssertEqual(store.nonces.count, 1)
        XCTAssertEqual(store.requestIds[requestId]?.expiresAt, baseTime + 1_000)
    }

    func testGrantCreationConsumptionExpiryRevocationAndExplicitExpiration() throws {
        let policy = try loadedPolicy()
        let runtime = runtimeIdentity()
        let now = baseTime + 100
        var state = AuthorityState()

        let consumedId = grantIdentifier(10)
        let consumed = try createGrant(
            id: consumedId,
            expiresAt: baseTime + 9_000,
            evidenceByte: 20,
            now: now,
            state: &state,
            policy: policy,
            runtime: runtime
        )
        XCTAssertEqual(consumed.lifecycleState.rawValue, GrantLifecycleState.active.rawValue)
        XCTAssertEqual(consumed.issuedAt, now)
        XCTAssertEqual(consumed.biometricIssuedAt, now - 10)
        XCTAssertEqual(consumed.policyDigest, policy.digest)
        XCTAssertEqual(consumed.brokerBuildDigest, runtime.buildDigest)

        let consumedTransition = try state.consumeGrant(
            domain: .desktopBrowser,
            grantId: consumedId,
            now: now + 100
        )
        XCTAssertEqual(consumedTransition.lifecycleState.rawValue, GrantLifecycleState.consumed.rawValue)
        XCTAssertEqual(consumedTransition.consumedAt, now + 100)
        XCTAssertNil(consumedTransition.revokedAt)
        assertRemoteError(.grantInvalid) {
            try state.consumeGrant(domain: .desktopBrowser, grantId: consumedId, now: now + 101)
        }

        let expiresOnConsumeId = grantIdentifier(11)
        let expiresOnConsume = try createGrant(
            id: expiresOnConsumeId,
            expiresAt: baseTime + 9_000,
            evidenceByte: 21,
            now: now,
            state: &state,
            policy: policy,
            runtime: runtime
        )
        let expiredTransition = try state.consumeGrant(
            domain: .desktopBrowser,
            grantId: expiresOnConsumeId,
            now: expiresOnConsume.expiresAt
        )
        XCTAssertEqual(expiredTransition.lifecycleState.rawValue, GrantLifecycleState.expired.rawValue)
        XCTAssertNil(expiredTransition.consumedAt)
        XCTAssertNil(expiredTransition.revokedAt)

        let revokedId = grantIdentifier(12)
        _ = try createGrant(
            id: revokedId,
            expiresAt: baseTime + 9_000,
            evidenceByte: 22,
            now: now,
            state: &state,
            policy: policy,
            runtime: runtime
        )
        let revokedTransition = try state.revokeGrant(
            domain: .desktopBrowser,
            grantId: revokedId,
            now: now + 200
        )
        XCTAssertEqual(revokedTransition.lifecycleState.rawValue, GrantLifecycleState.revoked.rawValue)
        XCTAssertEqual(revokedTransition.revokedAt, now + 200)
        XCTAssertNil(revokedTransition.consumedAt)

        let explicitlyExpiredId = grantIdentifier(13)
        _ = try createGrant(
            id: explicitlyExpiredId,
            expiresAt: baseTime + 9_000,
            evidenceByte: 23,
            now: now,
            state: &state,
            policy: policy,
            runtime: runtime
        )
        let explicitlyExpired = try state.expireGrant(
            domain: .desktopBrowser,
            grantId: explicitlyExpiredId
        )
        XCTAssertEqual(explicitlyExpired.lifecycleState.rawValue, GrantLifecycleState.expired.rawValue)
        XCTAssertNil(explicitlyExpired.consumedAt)
        XCTAssertNil(explicitlyExpired.revokedAt)
        XCTAssertEqual(
            state.grant(domain: .desktopBrowser, grantId: explicitlyExpiredId)?.lifecycleState.rawValue,
            GrantLifecycleState.expired.rawValue
        )
    }

    func testCancellationStopsLocalWorkAndWaitsForReleasedRemoteWork() throws {
        let policy = try loadedPolicy()
        let runtime = runtimeIdentity()
        var state = AuthorityState()

        let localRequest = executionRequest(
            identifierByte: 30,
            nonceByte: 31,
            purpose: "Cancel before external release"
        )
        _ = try state.admit(
            localRequest,
            peer: peerMatchInput(),
            policy: policy,
            runtime: runtime,
            receiptId: identifier(32),
            browserTargetGeneration: nil,
            now: baseTime + 100
        )
        let locallyCancelled = try state.cancel(requestId: localRequest.requestId, now: baseTime + 200)
        XCTAssertEqual(locallyCancelled.state.rawValue, ReceiptState.cancelled.rawValue)
        XCTAssertEqual(locallyCancelled.errorCode?.rawValue, PublicError.cancelled.rawValue)
        XCTAssertEqual(locallyCancelled.localReleaseStoppedAt, baseTime + 200)
        XCTAssertEqual(locallyCancelled.cancellationRequestedAt, baseTime + 200)
        XCTAssertEqual(locallyCancelled.events.terminalAt, baseTime + 200)

        let idempotentCancellation = try state.cancel(requestId: localRequest.requestId, now: baseTime + 300)
        XCTAssertEqual(idempotentCancellation.localReleaseStoppedAt, baseTime + 200)
        XCTAssertEqual(idempotentCancellation.cancellationRequestedAt, baseTime + 200)
        XCTAssertEqual(idempotentCancellation.events.terminalAt, baseTime + 200)

        let remoteRequest = executionRequest(
            identifierByte: 33,
            nonceByte: 34,
            purpose: "Cancel after external release"
        )
        let admitted = try state.admit(
            remoteRequest,
            peer: peerMatchInput(),
            policy: policy,
            runtime: runtime,
            receiptId: identifier(35),
            browserTargetGeneration: nil,
            now: baseTime + 110
        )
        _ = try state.authorizeBiometricOneShot(
            requestId: remoteRequest.requestId,
            authorization: BiometricAuthorization(
                evidenceId: identifier(36),
                evaluatedAt: baseTime + 120,
                scope: .execution(requestId: remoteRequest.requestId, bodyDigest: admitted.bodyDigest)
            ),
            policy: policy,
            runtime: runtime,
            now: baseTime + 120
        )
        _ = try state.beginExecution(
            requestId: remoteRequest.requestId,
            policy: policy,
            runtime: runtime,
            now: baseTime + 130
        )
        _ = try state.markRemoteReleased(
            requestId: remoteRequest.requestId,
            policy: policy,
            runtime: runtime,
            now: baseTime + 140
        )

        let pendingRemoteCancellation = try state.cancel(
            requestId: remoteRequest.requestId,
            now: baseTime + 150
        )
        XCTAssertEqual(pendingRemoteCancellation.state.rawValue, ReceiptState.executing.rawValue)
        XCTAssertNil(pendingRemoteCancellation.errorCode)
        XCTAssertNil(pendingRemoteCancellation.events.terminalAt)
        XCTAssertEqual(
            pendingRemoteCancellation.externalReleaseState.rawValue,
            ExternalReleaseState.releasedAwaitingRemote.rawValue
        )
        XCTAssertEqual(pendingRemoteCancellation.cancellationRequestedAt, baseTime + 150)

        let settledCancellation = try state.complete(
            requestId: remoteRequest.requestId,
            outcome: .confirmedNoEffect,
            releaseDisposition: .notApplicable,
            now: baseTime + 160
        )
        XCTAssertEqual(settledCancellation.state.rawValue, ReceiptState.cancelled.rawValue)
        XCTAssertEqual(settledCancellation.errorCode?.rawValue, PublicError.cancelled.rawValue)
        XCTAssertEqual(settledCancellation.events.terminalAt, baseTime + 160)
        XCTAssertEqual(settledCancellation.externalReleaseState.rawValue, ExternalReleaseState.settled.rawValue)
    }

    func testEmergencyDisableAndReenableRemainTransactional() throws {
        let policy = try loadedPolicy()
        let runtime = runtimeIdentity()
        var state = AuthorityState()

        let activeGrantId = grantIdentifier(40)
        _ = try createGrant(
            id: activeGrantId,
            expiresAt: baseTime + 9_000,
            evidenceByte: 41,
            now: baseTime + 100,
            state: &state,
            policy: policy,
            runtime: runtime
        )

        let localRequest = executionRequest(
            identifierByte: 42,
            nonceByte: 43,
            purpose: "Disable local request"
        )
        _ = try state.admit(
            localRequest,
            peer: peerMatchInput(),
            policy: policy,
            runtime: runtime,
            receiptId: identifier(44),
            browserTargetGeneration: nil,
            now: baseTime + 200
        )

        let remoteRequest = executionRequest(
            identifierByte: 45,
            nonceByte: 46,
            purpose: "Disable remote request"
        )
        let remoteRecord = try state.admit(
            remoteRequest,
            peer: peerMatchInput(),
            policy: policy,
            runtime: runtime,
            receiptId: identifier(47),
            browserTargetGeneration: nil,
            now: baseTime + 210
        )
        _ = try state.authorizeBiometricOneShot(
            requestId: remoteRequest.requestId,
            authorization: BiometricAuthorization(
                evidenceId: identifier(48),
                evaluatedAt: baseTime + 220,
                scope: .execution(requestId: remoteRequest.requestId, bodyDigest: remoteRecord.bodyDigest)
            ),
            policy: policy,
            runtime: runtime,
            now: baseTime + 220
        )
        _ = try state.beginExecution(
            requestId: remoteRequest.requestId,
            policy: policy,
            runtime: runtime,
            now: baseTime + 230
        )
        _ = try state.markRemoteReleased(
            requestId: remoteRequest.requestId,
            policy: policy,
            runtime: runtime,
            now: baseTime + 240
        )

        let disabled = try state.emergencyDisable(reasonCode: "operator-requested", now: baseTime + 300)
        XCTAssertEqual(disabled.invalidatedGrantIds, [activeGrantId])
        XCTAssertEqual(disabled.stoppedRequestIds, [localRequest.requestId])
        XCTAssertEqual(disabled.remotelyInFlightRequestIds, [remoteRequest.requestId])
        XCTAssertTrue(state.emergency.disabled)
        XCTAssertTrue(state.emergency.localEffectsStopped)
        XCTAssertEqual(state.emergency.disabledAt, baseTime + 300)
        XCTAssertEqual(state.emergency.reasonCode, "operator-requested")
        XCTAssertEqual(state.emergency.generation, 1)
        XCTAssertEqual(
            state.grant(domain: .desktopBrowser, grantId: activeGrantId)?.lifecycleState.rawValue,
            GrantLifecycleState.invalidated.rawValue
        )
        XCTAssertEqual(state.requests[localRequest.requestId]?.state.rawValue, ReceiptState.disabled.rawValue)
        XCTAssertEqual(state.requests[localRequest.requestId]?.disableRequestedAt, baseTime + 300)
        XCTAssertEqual(state.requests[remoteRequest.requestId]?.state.rawValue, ReceiptState.executing.rawValue)
        XCTAssertEqual(state.requests[remoteRequest.requestId]?.disableRequestedAt, baseTime + 300)

        let repeatedDisable = try state.emergencyDisable(reasonCode: "ignored-while-disabled", now: baseTime + 301)
        XCTAssertTrue(repeatedDisable.invalidatedGrantIds.isEmpty)
        XCTAssertTrue(repeatedDisable.stoppedRequestIds.isEmpty)
        XCTAssertEqual(repeatedDisable.remotelyInFlightRequestIds, [remoteRequest.requestId])
        XCTAssertEqual(state.emergency.disabledAt, baseTime + 300)
        XCTAssertEqual(state.emergency.reasonCode, "operator-requested")
        XCTAssertEqual(state.emergency.generation, 1)

        let firstTransactionId = identifier(49)
        let firstTransaction = try state.beginReenable(
            transactionId: firstTransactionId,
            authorization: BiometricAuthorization(
                evidenceId: identifier(50),
                evaluatedAt: baseTime + 400,
                scope: .reenable(transactionId: firstTransactionId)
            ),
            policy: policy,
            runtime: runtime,
            now: baseTime + 400
        )
        XCTAssertEqual(state.emergency.pendingReenable?.transactionId, firstTransactionId)
        assertRemoteError(.policyMismatch) {
            try state.commitReenable(
                transactionId: firstTransactionId,
                policy: policy,
                runtime: runtime,
                now: firstTransaction.expiresAt + 1
            )
        }
        XCTAssertTrue(state.emergency.disabled)
        XCTAssertEqual(state.emergency.pendingReenable?.transactionId, firstTransactionId)
        state.abortReenable(transactionId: identifier(51))
        XCTAssertEqual(state.emergency.pendingReenable?.transactionId, firstTransactionId)
        state.abortReenable(transactionId: firstTransactionId)
        XCTAssertNil(state.emergency.pendingReenable)
        XCTAssertTrue(state.emergency.disabled)

        let secondTransactionId = identifier(52)
        let secondBeginTime = firstTransaction.expiresAt + 2
        _ = try state.beginReenable(
            transactionId: secondTransactionId,
            authorization: BiometricAuthorization(
                evidenceId: identifier(53),
                evaluatedAt: secondBeginTime,
                scope: .reenable(transactionId: secondTransactionId)
            ),
            policy: policy,
            runtime: runtime,
            now: secondBeginTime
        )
        try state.commitReenable(
            transactionId: secondTransactionId,
            policy: policy,
            runtime: runtime,
            now: secondBeginTime + 1
        )
        XCTAssertFalse(state.emergency.disabled)
        XCTAssertFalse(state.emergency.localEffectsStopped)
        XCTAssertNil(state.emergency.disabledAt)
        XCTAssertNil(state.emergency.reasonCode)
        XCTAssertNil(state.emergency.pendingReenable)
        XCTAssertEqual(state.emergency.generation, 2)
    }

    func testReceiptReportsStateAndSerializesOnlyRedactedMetadata() throws {
        let policy = try loadedPolicy()
        let runtime = runtimeIdentity()
        let request = executionRequest(
            identifierByte: 60,
            nonceByte: 61,
            purpose: "Sensitive purpose excluded from receipt"
        )
        var state = AuthorityState()
        let admitted = try state.admit(
            request,
            peer: peerMatchInput(),
            policy: policy,
            runtime: runtime,
            receiptId: identifier(62),
            browserTargetGeneration: nil,
            now: baseTime + 100
        )
        _ = try state.cancel(requestId: request.requestId, now: baseTime + 200)

        let receipt = try state.receipt(for: request.requestId)
        let targetEncoder = JSONEncoder()
        targetEncoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let expectedFingerprint = ProtocolCrypto.sha256Hex(try targetEncoder.encode(request.target))
        XCTAssertEqual(receipt.receiptId, admitted.receiptId)
        XCTAssertEqual(receipt.requestId, request.requestId)
        XCTAssertNil(receipt.grantId)
        XCTAssertEqual(receipt.domain.rawValue, request.domain.rawValue)
        XCTAssertEqual(receipt.operation.rawValue, request.operation.rawValue)
        XCTAssertEqual(receipt.authorizationModeUsed.rawValue, request.authorizationModeRequested.rawValue)
        XCTAssertEqual(receipt.targetFingerprint, expectedFingerprint)
        XCTAssertEqual(receipt.state.rawValue, ReceiptState.cancelled.rawValue)
        XCTAssertEqual(receipt.errorCode?.rawValue, PublicError.cancelled.rawValue)
        XCTAssertEqual(receipt.events.requestedAt, baseTime + 100)
        XCTAssertNil(receipt.events.authorizedAt)
        XCTAssertNil(receipt.events.executingAt)
        XCTAssertEqual(receipt.events.terminalAt, baseTime + 200)
        XCTAssertEqual(receipt.policyDigest, policy.digest)
        XCTAssertEqual(receipt.brokerBuildDigest, runtime.buildDigest)
        XCTAssertEqual(receipt.brokerCodeDigest, runtime.codeDigest)
        XCTAssertEqual(receipt.targetReleaseDisposition.rawValue, TargetReleaseDisposition.notApplicable.rawValue)
        XCTAssertNil(receipt.browserTargetGeneration)

        let payload = try BrokerWireCodec.encodePayload(.receipt(receipt))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: payload) as? [String: Any])
        XCTAssertEqual(Set(root.keys), Set(["type", "receipt"]))
        XCTAssertEqual(root["type"] as? String, "receipt")
        let serializedReceipt = try XCTUnwrap(root["receipt"] as? [String: Any])
        XCTAssertEqual(
            Set(serializedReceipt.keys),
            Set([
                "protocolVersion", "receiptId", "requestId", "grantId", "domain", "operation",
                "authorizationModeUsed", "targetFingerprint", "state", "errorCode", "events",
                "policyDigest", "brokerBuildDigest", "brokerCodeDigest", "targetReleaseDisposition",
                "browserTargetGeneration",
            ])
        )
        XCTAssertFalse(serializedReceipt.keys.contains("principal"))
        XCTAssertFalse(serializedReceipt.keys.contains("target"))
        XCTAssertFalse(serializedReceipt.keys.contains("purpose"))
        XCTAssertFalse(serializedReceipt.keys.contains("bodyDigest"))
        XCTAssertEqual(serializedReceipt["targetFingerprint"] as? String, expectedFingerprint)
        XCTAssertEqual(serializedReceipt["state"] as? String, ReceiptState.cancelled.rawValue)
        XCTAssertEqual(serializedReceipt["errorCode"] as? String, PublicError.cancelled.rawValue)
        XCTAssertTrue(serializedReceipt["grantId"] is NSNull)
        XCTAssertTrue(serializedReceipt["browserTargetGeneration"] is NSNull)

        let serializedEvents = try XCTUnwrap(serializedReceipt["events"] as? [String: Any])
        XCTAssertEqual(
            Set(serializedEvents.keys),
            Set(["requestedAt", "authorizedAt", "executingAt", "terminalAt"])
        )
        XCTAssertEqual((serializedEvents["requestedAt"] as? NSNumber)?.uint64Value, baseTime + 100)
        XCTAssertTrue(serializedEvents["authorizedAt"] is NSNull)
        XCTAssertTrue(serializedEvents["executingAt"] is NSNull)
        XCTAssertEqual((serializedEvents["terminalAt"] as? NSNumber)?.uint64Value, baseTime + 200)

        let decodedResponse = try BrokerWireCodec.decodeResponse(payload: payload)
        guard case .receipt(let decodedReceipt) = decodedResponse else {
            XCTFail("Expected a receipt response")
            return
        }
        XCTAssertEqual(decodedReceipt.receiptId, receipt.receiptId)
        XCTAssertEqual(decodedReceipt.targetFingerprint, receipt.targetFingerprint)
        XCTAssertEqual(decodedReceipt.state.rawValue, receipt.state.rawValue)
        XCTAssertEqual(decodedReceipt.errorCode?.rawValue, receipt.errorCode?.rawValue)
    }

    func testPeerMatchingChecksEveryLivePrincipalFieldAndPolicyAttestation() throws {
        let principal = principal()
        let matchingPeer = peerMatchInput()
        XCTAssertTrue(matchingPeer.matches(principal))

        var mismatches = [PeerMatchInput]()
        var pidMismatch = matchingPeer
        pidMismatch.pid += 1
        mismatches.append(pidMismatch)
        var uidMismatch = matchingPeer
        uidMismatch.uid += 1
        mismatches.append(uidMismatch)
        var identityMismatch = matchingPeer
        identityMismatch.signingIdentifier = "com.openai.other"
        mismatches.append(identityMismatch)
        var digestMismatch = matchingPeer
        digestMismatch.executableSHA256 = String(repeating: "e", count: 64)
        mismatches.append(digestMismatch)
        var sessionMismatch = matchingPeer
        sessionMismatch.liveSessionId = "other-session"
        mismatches.append(sessionMismatch)
        var ownerMismatch = matchingPeer
        ownerMismatch.liveOwnerEpoch = "01890f3c-0000-7000-8000-000000000002"
        mismatches.append(ownerMismatch)
        var runnerMismatch = matchingPeer
        runnerMismatch.liveRunnerInstanceIdentity = "other-runner"
        mismatches.append(runnerMismatch)

        for mismatch in mismatches {
            XCTAssertFalse(mismatch.matches(principal))
        }

        let policy = try loadedPolicy()
        XCTAssertNotNil(policy.document.trustedCaller(matching: matchingPeer))
        var teamMismatch = matchingPeer
        teamMismatch.teamIdentifier = "OTHERTEAM"
        XCTAssertTrue(teamMismatch.matches(principal))
        XCTAssertNil(policy.document.trustedCaller(matching: teamMismatch))
        var requirementMismatch = matchingPeer
        requirementMismatch.designatedRequirement = "identifier other"
        XCTAssertTrue(requirementMismatch.matches(principal))
        XCTAssertNil(policy.document.trustedCaller(matching: requirementMismatch))

        var state = AuthorityState()
        assertRemoteError(.peerMismatch) {
            try state.admit(
                executionRequest(identifierByte: 70, nonceByte: 71, purpose: "Reject peer attestation mismatch"),
                peer: teamMismatch,
                policy: policy,
                runtime: runtimeIdentity(),
                receiptId: identifier(72),
                browserTargetGeneration: nil,
                now: baseTime + 100
            )
        }
        XCTAssertTrue(state.replayStore.requestIds.isEmpty)
    }

    private func loadedPolicy() throws -> LoadedPolicy {
        let zeroDigest = BrokerPolicy.inactiveDigestPlaceholder
        let gdmVerifierId = "desktop-gdm-verifier"
        var document = BrokerPolicy(
            policyId: "policy-v1-test",
            policyDigest: zeroDigest,
            policyDigestState: .reviewed,
            canonicalStatus: .active,
            active: true,
            maximumBiometricAgeMilliseconds: 5_000,
            brokerIdentity: BrokerIdentityPolicy(
                signingIdentifier: "com.example.remote-auth-broker",
                teamIdentifier: "BROKERTEAM",
                designatedRequirement: "identifier com.example.remote-auth-broker and anchor apple generic",
                executableSHA256: brokerDigest,
                buildDigest: brokerDigest
            ),
            sockets: SocketPolicy(
                brokerSocketPath: SocketPolicy.canonicalBrokerSocketPath,
                browserControllerSocketPath: SocketPolicy.canonicalBrowserControllerSocketPath
            ),
            reviewer: ReviewerPolicy(
                ompPath: "/Users/arthur/.local/bin/omp",
                reviewedPolicyModel: "reviewer-model",
                fixedPrompt: "Review the canonical request",
                promptPolicyDigest: String(repeating: "d", count: 64),
                reviewerBuildDigest: String(repeating: "e", count: 64),
                reviewedWorkingDirectory: "/Users/arthur/agents",
                exactEnvironment: ReviewerEnvironment(
                    home: "/Users/arthur",
                    temporaryDirectory: "/tmp",
                    locale: "C.UTF-8",
                    lcAll: "C.UTF-8",
                    path: "/usr/bin:/bin",
                    noColor: "1",
                    term: "dumb"
                ),
                deadlineMilliseconds: 90_000,
                maximumAttempts: 3,
                retryBackoffMilliseconds: [250, 1_000],
                breakerConsecutiveThreshold: 2,
                breakerRollingThreshold: 3,
                breakerRollingWindow: 4
            ),
            jetKVM: JetKVMPolicy(
                chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                profileDirectoryPath: "/Users/arthur/Library/Application Support/RemoteAuthBroker/jetkvm-cloud-profile",
                deviceId: "jetkvm-test",
                tlsSPKISHA256: targetDigest,
                frontendAssetManifestSHA256: targetDigest,
                vendoredFrontendCommit: "fe77acd5f00300a4ab9acd5da57d7bb0916351d9",
                vendoredFrontendDigest: "0ad51887f89bd16da9cec1931e9f3a982091881abdb7648e8de944f8306258d7",
                launchTimeoutSeconds: 30,
                cdpTimeoutSeconds: 10,
                readinessTimeoutSeconds: 45,
                replacementGraceSeconds: 1.25,
                keyIntervalSeconds: 0.035,
                maximumCDPMessageBytes: 1_048_576,
                maximumCDPJSONDepth: 64,
                maximumCDPJSONNodes: 100_000,
                maximumCDPJSONStringBytes: 262_144,
                maximumQueuedEvents: 256,
                maximumQueuedEventBytes: 2_097_152
            ),
            verifiers: VerifierPolicy(
                gdm: GDMVerifierPolicy(
                    verifierId: gdmVerifierId,
                    endpoint: "ubuntu-desktop.tailnet",
                    pinnedHostKeySHA256: targetDigest,
                    recipientKeyId: "gdm-recipient-key",
                    recipientPublicKey: String(repeating: "A", count: 43)
                ),
                sudo: nil
            ),
            trustedOmpCallers: [
                TrustedOmpCaller(
                    uid: 501,
                    signingIdentifier: "com.openai.omp",
                    teamIdentifier: "OMPTEAM123",
                    executableSHA256: callerDigest,
                    buildDigest: callerDigest,
                    designatedRequirement: "identifier com.openai.omp and anchor apple"
                ),
            ],
            credentialTargets: [
                .gdm(GDMCredentialTargetPolicy(
                    credentialId: "desktop-login",
                    account: "arthur-login",
                    verifierId: gdmVerifierId,
                    machineId: "desktop-test",
                    username: "arthur",
                    uid: 1_000,
                    seat: "seat0",
                    jetKVMDeviceId: "jetkvm-test"
                )),
            ],
            operations: [
                OperationPolicy(
                    domain: .desktopBrowser,
                    operation: .gdmLogin,
                    risk: .medium,
                    biometricPolicy: .standingGrantOrOneShot,
                    maximumGrantLifetimeMilliseconds: 10_000
                ),
            ],
            actions: [],
            caller: CallerPolicy(
                uid: 501,
                codeIdentity: "com.openai.omp",
                buildDigest: callerDigest
            ),
            authorityKeys: AuthorityKeysPolicy(
                desktopBrowserSigningKeyId: "desktop-signing-key",
                sudoSigningKeyId: nil
            )
        )
        var digestMaterial = document
        digestMaterial.policyDigest = zeroDigest
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        document.policyDigest = ProtocolCrypto.sha256Hex(try encoder.encode(digestMaterial))
        return try PolicyLoader.load(document: document)
    }

    private func runtimeIdentity() -> RuntimeIdentity {
        RuntimeIdentity(
            buildDigest: brokerDigest,
            codeIdentity: "com.example.remote-auth-broker",
            codeDigest: brokerDigest,
            teamIdentifier: "BROKERTEAM"
        )
    }

    private func principal() -> Principal {
        Principal(
            sessionId: "session-test",
            ownerEpoch: ownerEpoch,
            pid: 4_242,
            uid: 501,
            codeIdentity: "com.openai.omp",
            buildDigest: callerDigest,
            runnerInstanceIdentity: "runner-test",
            ownershipSocketPath: "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock"
        )
    }

    private func principalSelector() -> PrincipalSelector {
        let principal = principal()
        return PrincipalSelector(
            sessionId: principal.sessionId,
            ownerEpoch: principal.ownerEpoch,
            uid: principal.uid,
            codeIdentity: principal.codeIdentity,
            buildDigest: principal.buildDigest
        )
    }

    private func peerMatchInput() -> PeerMatchInput {
        let principal = principal()
        return PeerMatchInput(
            pid: principal.pid,
            uid: principal.uid,
            signingIdentifier: principal.codeIdentity,
            teamIdentifier: "OMPTEAM123",
            executableSHA256: principal.buildDigest,
            designatedRequirement: "identifier com.openai.omp and anchor apple",
            liveSessionId: principal.sessionId,
            liveOwnerEpoch: principal.ownerEpoch,
            liveRunnerInstanceIdentity: principal.runnerInstanceIdentity
        )
    }

    private func executionRequest(identifierByte: UInt8, nonceByte: UInt8, purpose: String) -> ExecutionRequest {
        ExecutionRequest(
            requestId: identifier(identifierByte),
            nonce: nonce(nonceByte),
            createdAt: baseTime,
            expiresAt: baseTime + 100_000,
            principal: principal(),
            authorizationModeRequested: .biometricOneShot,
            domain: .desktopBrowser,
            operation: .gdmLogin,
            target: gdmTarget(),
            purpose: purpose,
            grantId: nil
        )
    }

    private func gdmTarget() -> ExecutionTarget {
        .gdm(
            GDMTarget(
                sshHostKeyDigest: targetDigest,
                machineId: "desktop-test",
                bootId: "boot-test",
                username: "arthur",
                uid: 1_000,
                seat: "seat0",
                tty: "tty1",
                rhost: .empty,
                greeterGeneration: 7,
                jetkvmDeviceId: "jetkvm-test",
                controllerGeneration: 9
            )
        )
    }

    private func createGrant(
        id: String,
        expiresAt: UInt64,
        evidenceByte: UInt8,
        now: UInt64,
        state: inout AuthorityState,
        policy: LoadedPolicy,
        runtime: RuntimeIdentity
    ) throws -> Grant {
        try state.createGrant(
            GrantProposal(
                grantId: id,
                principalSelector: principalSelector(),
                domain: .desktopBrowser,
                operation: .gdmLogin,
                targetPredicate: gdmTarget(),
                riskCeiling: .medium,
                expiresAt: expiresAt
            ),
            authorization: BiometricAuthorization(
                evidenceId: identifier(evidenceByte),
                evaluatedAt: now - 10,
                scope: .createGrant(grantId: id)
            ),
            policy: policy,
            runtime: runtime,
            now: now
        )
    }

    private func identifier(_ byte: UInt8) -> String {
        AuthorityBase64URL.encode(Data(repeating: byte, count: 16))
    }

    private func nonce(_ byte: UInt8) -> String {
        AuthorityBase64URL.encode(Data(repeating: byte, count: 32))
    }

    private func grantIdentifier(_ byte: UInt8) -> String {
        "grant-v1:\(identifier(byte))"
    }

    private func assertRemoteError<T>(
        _ expected: PublicError,
        file: StaticString = #filePath,
        line: UInt = #line,
        operation: () throws -> T
    ) {
        do {
            _ = try operation()
            XCTFail("Expected remote-auth error \(expected.rawValue)", file: file, line: line)
        } catch let error as RemoteAuthProtocolError {
            XCTAssertEqual(error.publicError.rawValue, expected.rawValue, file: file, line: line)
        } catch {
            XCTFail("Unexpected error type: \(type(of: error))", file: file, line: line)
        }
    }
}
