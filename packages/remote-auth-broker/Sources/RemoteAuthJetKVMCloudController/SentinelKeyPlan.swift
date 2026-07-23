import Foundation

enum SentinelKeyEventType: String, Codable, CaseIterable, Equatable, Sendable {
    case keyDown
    case char
    case keyUp
}

struct SentinelKeyEventDescriptor: Codable, Equatable, Sendable {
    let type: SentinelKeyEventType
    let key: String
    let code: String
    let text: String?
    let unmodifiedText: String?
    let windowsVirtualKeyCode: Int
    let location: Int
    let modifiers: Int
    let delayAfterMilliseconds: Int
}

struct SentinelKeyPlan: Equatable, Sendable {
    static let shiftModifier = 8
    private static let resetDelayMilliseconds = 35

    let sentinelEvents: [SentinelKeyEventDescriptor]
    let submissionEvents: [SentinelKeyEventDescriptor]

    init(sentinel: String, keyDelayMilliseconds: Int) throws {
        guard GDMSentinelValidation.isValid(sentinel),
              (20...250).contains(keyDelayMilliseconds)
        else {
            throw JetKVMCloudError.sentinelInvalid
        }

        var planned: [SentinelKeyEventDescriptor] = []
        planned.reserveCapacity(sentinel.utf8.count * 5)
        for byte in sentinel.utf8 {
            guard let stroke = Self.stroke(for: byte) else {
                throw JetKVMCloudError.sentinelInvalid
            }
            if stroke.requiresShift {
                planned.append(Self.modifierEvent(
                    type: .keyDown,
                    key: "Shift",
                    code: "ShiftLeft",
                    windowsVirtualKeyCode: 16,
                    location: 1,
                    modifiers: Self.shiftModifier,
                    delayAfterMilliseconds: keyDelayMilliseconds
                ))
            }
            let modifiers = stroke.requiresShift ? Self.shiftModifier : 0
            planned.append(SentinelKeyEventDescriptor(
                type: .keyDown,
                key: stroke.key,
                code: stroke.code,
                text: nil,
                unmodifiedText: nil,
                windowsVirtualKeyCode: stroke.windowsVirtualKeyCode,
                location: 0,
                modifiers: modifiers,
                delayAfterMilliseconds: keyDelayMilliseconds
            ))
            planned.append(SentinelKeyEventDescriptor(
                type: .char,
                key: stroke.key,
                code: stroke.code,
                text: stroke.key,
                unmodifiedText: stroke.unmodifiedKey,
                windowsVirtualKeyCode: stroke.windowsVirtualKeyCode,
                location: 0,
                modifiers: modifiers,
                delayAfterMilliseconds: keyDelayMilliseconds
            ))
            planned.append(SentinelKeyEventDescriptor(
                type: .keyUp,
                key: stroke.key,
                code: stroke.code,
                text: nil,
                unmodifiedText: nil,
                windowsVirtualKeyCode: stroke.windowsVirtualKeyCode,
                location: 0,
                modifiers: modifiers,
                delayAfterMilliseconds: keyDelayMilliseconds
            ))
            if stroke.requiresShift {
                planned.append(Self.modifierEvent(
                    type: .keyUp,
                    key: "Shift",
                    code: "ShiftLeft",
                    windowsVirtualKeyCode: 16,
                    location: 1,
                    modifiers: 0,
                    delayAfterMilliseconds: keyDelayMilliseconds
                ))
            }
        }
        sentinelEvents = planned
        submissionEvents = [
            SentinelKeyEventDescriptor(
                type: .keyDown,
                key: "Enter",
                code: "Enter",
                text: nil,
                unmodifiedText: nil,
                windowsVirtualKeyCode: 13,
                location: 0,
                modifiers: 0,
                delayAfterMilliseconds: keyDelayMilliseconds
            ),
            SentinelKeyEventDescriptor(
                type: .keyUp,
                key: "Enter",
                code: "Enter",
                text: nil,
                unmodifiedText: nil,
                windowsVirtualKeyCode: 13,
                location: 0,
                modifiers: 0,
                delayAfterMilliseconds: keyDelayMilliseconds
            ),
        ]
    }

    static let resetKeyUps: [SentinelKeyEventDescriptor] = {
        var descriptors: [SentinelKeyEventDescriptor] = []
        descriptors.reserveCapacity(47)
        for index in letterCodes.indices {
            descriptors.append(keyUp(
                key: lowercaseKeys[index],
                code: letterCodes[index],
                windowsVirtualKeyCode: 65 + index
            ))
        }
        for index in digitCodes.indices {
            descriptors.append(keyUp(
                key: digitKeys[index],
                code: digitCodes[index],
                windowsVirtualKeyCode: 48 + index
            ))
        }
        descriptors.append(keyUp(key: "-", code: "Minus", windowsVirtualKeyCode: 189))
        descriptors.append(keyUp(key: ";", code: "Semicolon", windowsVirtualKeyCode: 186))
        descriptors.append(keyUp(key: "Enter", code: "Enter", windowsVirtualKeyCode: 13))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Shift",
            code: "ShiftLeft",
            windowsVirtualKeyCode: 16,
            location: 1,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Shift",
            code: "ShiftRight",
            windowsVirtualKeyCode: 16,
            location: 2,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Control",
            code: "ControlLeft",
            windowsVirtualKeyCode: 17,
            location: 1,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Control",
            code: "ControlRight",
            windowsVirtualKeyCode: 17,
            location: 2,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Alt",
            code: "AltLeft",
            windowsVirtualKeyCode: 18,
            location: 1,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Alt",
            code: "AltRight",
            windowsVirtualKeyCode: 18,
            location: 2,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Meta",
            code: "MetaLeft",
            windowsVirtualKeyCode: 91,
            location: 1,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        descriptors.append(modifierEvent(
            type: .keyUp,
            key: "Meta",
            code: "MetaRight",
            windowsVirtualKeyCode: 92,
            location: 2,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        ))
        return descriptors
    }()

    private struct Stroke {
        let key: String
        let unmodifiedKey: String
        let code: String
        let windowsVirtualKeyCode: Int
        let requiresShift: Bool
    }

    private static let uppercaseKeys = [
        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
        "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    ]
    private static let lowercaseKeys = [
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
        "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
    ]
    private static let letterCodes = [
        "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI",
        "KeyJ", "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR",
        "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
    ]
    private static let digitKeys = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
    private static let digitCodes = [
        "Digit0", "Digit1", "Digit2", "Digit3", "Digit4",
        "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
    ]

    private static func stroke(for byte: UInt8) -> Stroke? {
        switch byte {
        case 0x41...0x5a:
            let index = Int(byte - 0x41)
            return Stroke(
                key: uppercaseKeys[index],
                unmodifiedKey: lowercaseKeys[index],
                code: letterCodes[index],
                windowsVirtualKeyCode: 65 + index,
                requiresShift: true
            )
        case 0x61...0x7a:
            let index = Int(byte - 0x61)
            return Stroke(
                key: lowercaseKeys[index],
                unmodifiedKey: lowercaseKeys[index],
                code: letterCodes[index],
                windowsVirtualKeyCode: 65 + index,
                requiresShift: false
            )
        case 0x30...0x39:
            let index = Int(byte - 0x30)
            return Stroke(
                key: digitKeys[index],
                unmodifiedKey: digitKeys[index],
                code: digitCodes[index],
                windowsVirtualKeyCode: 48 + index,
                requiresShift: false
            )
        case 0x2d:
            return Stroke(key: "-", unmodifiedKey: "-", code: "Minus", windowsVirtualKeyCode: 189, requiresShift: false)
        case 0x5f:
            return Stroke(key: "_", unmodifiedKey: "-", code: "Minus", windowsVirtualKeyCode: 189, requiresShift: true)
        case 0x3a:
            return Stroke(key: ":", unmodifiedKey: ";", code: "Semicolon", windowsVirtualKeyCode: 186, requiresShift: true)
        default:
            return nil
        }
    }

    private static func keyUp(
        key: String,
        code: String,
        windowsVirtualKeyCode: Int
    ) -> SentinelKeyEventDescriptor {
        SentinelKeyEventDescriptor(
            type: .keyUp,
            key: key,
            code: code,
            text: nil,
            unmodifiedText: nil,
            windowsVirtualKeyCode: windowsVirtualKeyCode,
            location: 0,
            modifiers: 0,
            delayAfterMilliseconds: resetDelayMilliseconds
        )
    }

    private static func modifierEvent(
        type: SentinelKeyEventType,
        key: String,
        code: String,
        windowsVirtualKeyCode: Int,
        location: Int,
        modifiers: Int,
        delayAfterMilliseconds: Int
    ) -> SentinelKeyEventDescriptor {
        SentinelKeyEventDescriptor(
            type: type,
            key: key,
            code: code,
            text: nil,
            unmodifiedText: nil,
            windowsVirtualKeyCode: windowsVirtualKeyCode,
            location: location,
            modifiers: modifiers,
            delayAfterMilliseconds: delayAfterMilliseconds
        )
    }
}

struct SentinelSubmissionLifecycle: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case typingSentinel
        case awaitingAttestation
        case submitting
        case submitted
        case failed
    }

    private let plan: SentinelKeyPlan
    private let generation: UInt64
    private var sentinelIndex = 0
    private var submissionIndex = 0
    private(set) var phase: Phase = .typingSentinel

    init(plan: SentinelKeyPlan, generation: UInt64) {
        self.plan = plan
        self.generation = generation
    }

    mutating func nextSentinelEvent(
        activeGeneration: UInt64?
    ) throws -> SentinelKeyEventDescriptor? {
        try validateGeneration(activeGeneration)
        guard phase == .typingSentinel else {
            throw JetKVMCloudError.invalidStateTransition
        }
        guard sentinelIndex < plan.sentinelEvents.count else {
            phase = .awaitingAttestation
            return nil
        }
        defer { sentinelIndex += 1 }
        return plan.sentinelEvents[sentinelIndex]
    }

    mutating func authorizeSubmission(activeGeneration: UInt64?) throws {
        try validateGeneration(activeGeneration)
        guard phase == .awaitingAttestation,
              sentinelIndex == plan.sentinelEvents.count
        else {
            throw JetKVMCloudError.invalidStateTransition
        }
        phase = .submitting
    }

    mutating func nextSubmissionEvent(
        activeGeneration: UInt64?
    ) throws -> SentinelKeyEventDescriptor? {
        try validateGeneration(activeGeneration)
        guard phase == .submitting || phase == .submitted else {
            throw JetKVMCloudError.invalidStateTransition
        }
        guard phase == .submitting else { return nil }
        guard submissionIndex < plan.submissionEvents.count else {
            phase = .submitted
            return nil
        }
        defer { submissionIndex += 1 }
        return plan.submissionEvents[submissionIndex]
    }

    mutating func fail() {
        phase = .failed
    }

    private func validateGeneration(_ activeGeneration: UInt64?) throws {
        guard activeGeneration == generation else {
            throw JetKVMCloudError.staleLease
        }
    }
}

enum GDMSentinelValidation {
    private static let prefix = Array("gdm-broker-v1:".utf8)

    static func isValid(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count == prefix.count + 43,
              bytes.starts(with: prefix)
        else {
            return false
        }
        let payload = bytes.dropFirst(prefix.count)
        guard payload.allSatisfy(isBase64URLByte),
              let final = payload.last.flatMap(base64URLSextet)
        else {
            return false
        }
        // A 32-byte unpadded Base64URL value has 43 characters and four
        // significant bits in its final sextet. Requiring the padding bits to
        // be zero makes the representation canonical.
        return final & 0b11 == 0
    }

    private static func isBase64URLByte(_ byte: UInt8) -> Bool {
        (byte >= 0x41 && byte <= 0x5a)
            || (byte >= 0x61 && byte <= 0x7a)
            || (byte >= 0x30 && byte <= 0x39)
            || byte == 0x2d
            || byte == 0x5f
    }

    private static func base64URLSextet(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 0x41...0x5a: byte - 0x41
        case 0x61...0x7a: byte - 0x61 + 26
        case 0x30...0x39: byte - 0x30 + 52
        case 0x2d: 62
        case 0x5f: 63
        default: nil
        }
    }
}
