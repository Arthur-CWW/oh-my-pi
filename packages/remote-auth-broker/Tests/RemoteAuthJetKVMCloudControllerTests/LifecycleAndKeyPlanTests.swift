@testable import RemoteAuthJetKVMCloudController
import XCTest

final class CloudControllerStateMachineTests: XCTestCase {
    func testSingletonLeaseAndStaleRelease() throws {
        var machine = CloudControllerStateMachine()
        XCTAssertEqual(machine.phase, .idle)
        XCTAssertEqual(machine.generation, 0)

        try machine.beginConnecting()
        try machine.markReady()
        let lease = try machine.acquireLease()
        XCTAssertEqual(machine.phase, .leased)
        XCTAssertEqual(lease.generation, 1)
        XCTAssertThrowsError(try machine.acquireLease()) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .leaseActive)
        }
        XCTAssertNoThrow(try machine.validate(lease))

        let released = machine.release(lease)
        XCTAssertEqual(released.disposition, .released)
        XCTAssertEqual(released.generation, 1)
        XCTAssertEqual(machine.phase, .idle)

        let repeated = machine.release(lease)
        XCTAssertEqual(repeated.disposition, .released)
        XCTAssertEqual(repeated.generation, 1)
    }

    func testInterruptionInvalidatesLeaseAndRecoveryIncrementsGeneration() throws {
        var machine = CloudControllerStateMachine()
        try machine.beginConnecting()
        try machine.markReady()
        let interruptedLease = try machine.acquireLease()

        machine.recordInterruption()
        XCTAssertEqual(machine.phase, .recoveryRequired)
        XCTAssertThrowsError(try machine.validate(interruptedLease)) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .recoveryRequired)
        }
        XCTAssertEqual(machine.release(interruptedLease).disposition, .interrupted)

        try machine.beginRecovery()
        try machine.markReady()
        let recoveredLease = try machine.acquireLease()
        XCTAssertEqual(recoveredLease.generation, interruptedLease.generation + 1)
        XCTAssertThrowsError(try machine.validate(interruptedLease)) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .staleLease)
        }
        XCTAssertNoThrow(try machine.validate(recoveredLease))
    }

    func testShutdownIsTerminalAndInvalidatesLease() throws {
        var machine = CloudControllerStateMachine()
        try machine.beginConnecting()
        try machine.markReady()
        let lease = try machine.acquireLease()

        machine.shutdown()
        XCTAssertEqual(machine.phase, .shutdown)
        XCTAssertThrowsError(try machine.validate(lease)) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .shutdown)
        }
        XCTAssertEqual(machine.release(lease).disposition, .shutdown)
        XCTAssertThrowsError(try machine.beginRecovery()) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .shutdown)
        }
    }
}

final class SentinelKeyPlanTests: XCTestCase {
    private static let validSentinel = "gdm-broker-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    private static let intervalMilliseconds = 35

    func testSentinelValidityUsesCanonicalContract() throws {
        XCTAssertTrue(GDMSentinelValidation.isValid(Self.validSentinel))
        XCTAssertFalse(GDMSentinelValidation.isValid(
            "gdm-broker-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        ))
        XCTAssertFalse(GDMSentinelValidation.isValid(
            "gdm-broker-v2:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        ))
        XCTAssertFalse(GDMSentinelValidation.isValid(
            "gdm-broker-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB"
        ))

        XCTAssertNoThrow(try SentinelKeyPlan(
            sentinel: Self.validSentinel,
            keyDelayMilliseconds: Self.intervalMilliseconds
        ))
        XCTAssertThrowsError(try SentinelKeyPlan(
            sentinel: "gdm-broker-v1:not-a-sentinel",
            keyDelayMilliseconds: Self.intervalMilliseconds
        )) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .sentinelInvalid)
        }
    }

    func testExactKeySequenceForEverySentinelCharacter() throws {
        let plan = try SentinelKeyPlan(
            sentinel: Self.validSentinel,
            keyDelayMilliseconds: Self.intervalMilliseconds
        )
        XCTAssertEqual(plan.sentinelEvents, try expectedEvents(for: Self.validSentinel))
        XCTAssertEqual(
            plan.sentinelEvents.compactMap { $0.type == .char ? $0.text : nil }.joined(),
            Self.validSentinel
        )
    }
    func testSubmissionRequiresCompleteSentinelAndSameGenerationAndOccursOnce() throws {
        let plan = try SentinelKeyPlan(
            sentinel: Self.validSentinel,
            keyDelayMilliseconds: Self.intervalMilliseconds
        )
        var lifecycle = SentinelSubmissionLifecycle(plan: plan, generation: 7)

        XCTAssertThrowsError(try lifecycle.authorizeSubmission(activeGeneration: 7)) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .invalidStateTransition)
        }

        var dispatched: [SentinelKeyEventDescriptor] = []
        while let event = try lifecycle.nextSentinelEvent(activeGeneration: 7) {
            dispatched.append(event)
        }
        XCTAssertEqual(dispatched, plan.sentinelEvents)
        XCTAssertEqual(lifecycle.phase, .awaitingAttestation)
        XCTAssertFalse(dispatched.contains { $0.code == "Enter" })

        XCTAssertThrowsError(try lifecycle.authorizeSubmission(activeGeneration: 8)) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .staleLease)
        }
        try lifecycle.authorizeSubmission(activeGeneration: 7)

        while let event = try lifecycle.nextSubmissionEvent(activeGeneration: 7) {
            dispatched.append(event)
        }
        XCTAssertEqual(lifecycle.phase, .submitted)
        XCTAssertNil(try lifecycle.nextSubmissionEvent(activeGeneration: 7))
        XCTAssertEqual(dispatched.suffix(2), plan.submissionEvents[...])
        XCTAssertEqual(
            dispatched.filter { $0.code == "Enter" && $0.type == .keyDown }.count,
            1
        )
        XCTAssertEqual(
            dispatched.filter { $0.code == "Enter" && $0.type == .keyUp }.count,
            1
        )
        XCTAssertTrue(plan.submissionEvents.allSatisfy {
            $0.text == nil
                && $0.unmodifiedText == nil
                && $0.delayAfterMilliseconds == Self.intervalMilliseconds
        })
    }

    func testFailureMakesSubmissionTerminal() throws {
        let plan = try SentinelKeyPlan(
            sentinel: Self.validSentinel,
            keyDelayMilliseconds: Self.intervalMilliseconds
        )
        var lifecycle = SentinelSubmissionLifecycle(plan: plan, generation: 11)
        lifecycle.fail()

        XCTAssertEqual(lifecycle.phase, .failed)
        XCTAssertThrowsError(try lifecycle.nextSentinelEvent(activeGeneration: 11)) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .invalidStateTransition)
        }
        XCTAssertThrowsError(try lifecycle.nextSubmissionEvent(activeGeneration: 11)) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .invalidStateTransition)
        }
    }


    func testResetCoversEveryDescriptorWithKeyUp() {
        let reset = SentinelKeyPlan.resetKeyUps
        let expectedCodes = (UnicodeScalar("A").value...UnicodeScalar("Z").value).map {
            "Key\(Character(UnicodeScalar($0)!))"
        } + (0...9).map { "Digit\($0)" } + [
            "Minus", "Semicolon", "Enter",
            "ShiftLeft", "ShiftRight",
            "ControlLeft", "ControlRight",
            "AltLeft", "AltRight",
            "MetaLeft", "MetaRight",
        ]

        XCTAssertEqual(reset.count, 47)
        XCTAssertEqual(reset.map(\.code), expectedCodes)
        XCTAssertTrue(reset.allSatisfy { $0.type == .keyUp })
        XCTAssertTrue(reset.allSatisfy { $0.text == nil && $0.unmodifiedText == nil })
        XCTAssertTrue(reset.allSatisfy { $0.modifiers == 0 })
        XCTAssertTrue(reset.allSatisfy { $0.delayAfterMilliseconds == 35 })
    }

    private func expectedEvents(for sentinel: String) throws -> [SentinelKeyEventDescriptor] {
        try sentinel.utf8.flatMap { byte -> [SentinelKeyEventDescriptor] in
            let stroke = try expectedStroke(for: byte)
            let modifiers = stroke.shifted ? SentinelKeyPlan.shiftModifier : 0
            var result: [SentinelKeyEventDescriptor] = []
            if stroke.shifted {
                result.append(descriptor(
                    type: .keyDown,
                    key: "Shift",
                    code: "ShiftLeft",
                    unmodified: nil,
                    virtualKey: 16,
                    location: 1,
                    modifiers: SentinelKeyPlan.shiftModifier
                ))
            }
            result.append(descriptor(
                type: .keyDown,
                key: stroke.key,
                code: stroke.code,
                unmodified: nil,
                virtualKey: stroke.virtualKey,
                location: 0,
                modifiers: modifiers
            ))
            result.append(SentinelKeyEventDescriptor(
                type: .char,
                key: stroke.key,
                code: stroke.code,
                text: stroke.key,
                unmodifiedText: stroke.unmodified,
                windowsVirtualKeyCode: stroke.virtualKey,
                location: 0,
                modifiers: modifiers,
                delayAfterMilliseconds: Self.intervalMilliseconds
            ))
            result.append(descriptor(
                type: .keyUp,
                key: stroke.key,
                code: stroke.code,
                unmodified: nil,
                virtualKey: stroke.virtualKey,
                location: 0,
                modifiers: modifiers
            ))
            if stroke.shifted {
                result.append(descriptor(
                    type: .keyUp,
                    key: "Shift",
                    code: "ShiftLeft",
                    unmodified: nil,
                    virtualKey: 16,
                    location: 1,
                    modifiers: 0
                ))
            }
            return result
        }
    }

    private func descriptor(
        type: SentinelKeyEventType,
        key: String,
        code: String,
        unmodified: String?,
        virtualKey: Int,
        location: Int,
        modifiers: Int
    ) -> SentinelKeyEventDescriptor {
        SentinelKeyEventDescriptor(
            type: type,
            key: key,
            code: code,
            text: nil,
            unmodifiedText: unmodified,
            windowsVirtualKeyCode: virtualKey,
            location: location,
            modifiers: modifiers,
            delayAfterMilliseconds: Self.intervalMilliseconds
        )
    }

    private func expectedStroke(for byte: UInt8) throws -> (
        key: String,
        unmodified: String,
        code: String,
        virtualKey: Int,
        shifted: Bool
    ) {
        switch byte {
        case 0x41...0x5A:
            let scalar = UnicodeScalar(byte)
            return (
                String(Character(scalar)),
                String(Character(UnicodeScalar(byte + 0x20))),
                "Key\(Character(scalar))",
                Int(byte),
                true
            )
        case 0x61...0x7A:
            let scalar = UnicodeScalar(byte)
            let upper = UnicodeScalar(byte - 0x20)
            let value = String(Character(scalar))
            return (value, value, "Key\(Character(upper))", Int(byte - 0x20), false)
        case 0x30...0x39:
            let value = String(Character(UnicodeScalar(byte)))
            return (value, value, "Digit\(value)", Int(byte), false)
        case 0x2D:
            return ("-", "-", "Minus", 189, false)
        case 0x5F:
            return ("_", "-", "Minus", 189, true)
        case 0x3A:
            return (":", ";", "Semicolon", 186, true)
        default:
            throw JetKVMCloudError.sentinelInvalid
        }
    }
}
