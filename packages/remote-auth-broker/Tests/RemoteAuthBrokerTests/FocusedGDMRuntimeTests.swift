import Foundation
import RemoteAuthJetKVMCloudController
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class FocusedGDMRuntimeTests: XCTestCase {

    func testGDMEffectsRunOnlyInRequiredOrder() throws {
        var sequence = GDMExecutionSequence()
        var observed: [GDMExecutionEffect] = []

        for effect in GDMExecutionEffect.allCases {
            try sequence.perform(effect) {
                observed.append(effect)
            }
        }

        XCTAssertEqual(observed, [
            .verifierChallenge,
            .keychainEnvelope,
            .forcedEndpointIngest,
            .markReleased,
            .sentinelActuation,
            .authenticatedCompletion,
        ])
        XCTAssertNil(sequence.nextEffect)
    }

    func testPreIngestFailureCannotAdvanceToHIDActuation() throws {
        enum FixtureError: Error { case ingestRejected }
        var sequence = GDMExecutionSequence()
        try sequence.perform(.verifierChallenge) {}
        try sequence.perform(.keychainEnvelope) {}

        XCTAssertThrowsError(try sequence.perform(.forcedEndpointIngest) { () throws -> Void in
            throw FixtureError.ingestRejected
        })
        XCTAssertEqual(sequence.nextEffect, .forcedEndpointIngest)
        XCTAssertThrowsError(try sequence.perform(.sentinelActuation) {}) { error in
            XCTAssertEqual((error as? RemoteAuthProtocolError)?.publicError, .integrityFailure)
        }
        XCTAssertEqual(sequence.nextEffect, .forcedEndpointIngest)
    }

    func testCloudActuatorRejectsGenerationMismatch() {
        XCTAssertThrowsError(try CloudJetKVMSentinelActuator.validateGeneration(
            expected: 41,
            lease: 42,
            status: 42,
            phase: .leased
        )) { error in
            XCTAssertEqual((error as? RemoteAuthProtocolError)?.publicError, .targetMismatch)
        }
        XCTAssertNoThrow(try CloudJetKVMSentinelActuator.validateGeneration(
            expected: 42,
            lease: 42,
            status: 42,
            phase: .leased
        ))
    }

    func testInactiveAndGDMOnlyDispatchDenyNonGDMOperations() {
        var request = gdmRequest()
        XCTAssertFalse(BrokerDispatchCapabilities.inactive.permits(request))
        XCTAssertTrue(BrokerDispatchCapabilities.gdmOnly.permits(request))

        request.operation = .sudo
        request.domain = .sudo
        XCTAssertFalse(BrokerDispatchCapabilities.inactive.permits(request))
        XCTAssertFalse(BrokerDispatchCapabilities.gdmOnly.permits(request))
    }

    private func principal() -> Principal {
        Principal(
            sessionId: "session-1",
            ownerEpoch: "owner-epoch-1",
            pid: 1_234,
            uid: 501,
            codeIdentity: "com.openai.omp",
            buildDigest: String(repeating: "a", count: 64),
            runnerInstanceIdentity: "runner-1",
            ownershipSocketPath: "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock"
        )
    }


    private func gdmRequest() -> ExecutionRequest {
        ExecutionRequest(
            requestId: "00112233-4455-6677-8899-aabbccddeeff",
            nonce: "AAAAAAAAAAAAAAAAAAAAAA",
            createdAt: 1,
            expiresAt: 2,
            principal: principal(),
            authorizationModeRequested: .biometricOneShot,
            domain: .desktopBrowser,
            operation: .gdmLogin,
            target: .gdm(GDMTarget(
                sshHostKeyDigest: String(repeating: "b", count: 64),
                machineId: "ubuntu-desktop",
                bootId: "boot-1",
                username: "arthur",
                uid: 1_000,
                seat: "seat0",
                tty: "tty1",
                rhost: .empty,
                greeterGeneration: 1,
                jetkvmDeviceId: "jetkvm-desktop",
                controllerGeneration: 1
            )),
            purpose: "Establish graphical session",
            grantId: nil
        )
    }
}
