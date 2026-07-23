import Foundation

public enum BrowserControllerPhase: String, Codable, CaseIterable, Sendable {
    case quarantined
    case attached
    case attested
    case inputDispatched = "input-dispatched"
    case fillDispatched = "fill-dispatched"
    case destroyed
    case closed
}

public struct BrowserStateMachine: Equatable, Sendable {
    public private(set) var requestID: String
    public private(set) var targetGeneration: UInt64
    public private(set) var phase: BrowserControllerPhase
    public private(set) var isInvalidated: Bool

    private var fillWasDispatched: Bool

    public init(requestID: String, targetGeneration: UInt64) throws {
        guard Self.validRequestID(requestID) else {
            throw BrowserControllerError.requestBindingMismatch
        }
        guard targetGeneration > 0 else {
            throw BrowserControllerError.targetGenerationInvalid
        }
        self.requestID = requestID
        self.targetGeneration = targetGeneration
        phase = .quarantined
        isInvalidated = false
        fillWasDispatched = false
    }

    public mutating func transition(
        to next: BrowserControllerPhase,
        requestID: String,
        targetGeneration: UInt64
    ) throws {
        guard requestID == self.requestID else {
            isInvalidated = true
            throw BrowserControllerError.requestBindingMismatch
        }
        guard targetGeneration == self.targetGeneration else {
            isInvalidated = true
            throw BrowserControllerError.targetGenerationInvalid
        }

        if isInvalidated {
            guard next == .destroyed, phase != .destroyed, phase != .closed else {
                throw BrowserControllerError.invalidStateTransition
            }
            phase = .destroyed
            return
        }

        guard Self.canTransition(from: phase, to: next) else {
            isInvalidated = true
            throw BrowserControllerError.invalidStateTransition
        }
        phase = next
        if next == .fillDispatched {
            fillWasDispatched = true
        }
    }

    public mutating func quarantineNextTarget(
        requestID: String,
        targetGeneration: UInt64
    ) throws {
        guard phase == .destroyed || phase == .closed else {
            isInvalidated = true
            throw BrowserControllerError.invalidStateTransition
        }
        guard Self.validRequestID(requestID) else {
            isInvalidated = true
            throw BrowserControllerError.requestBindingMismatch
        }
        guard targetGeneration > self.targetGeneration else {
            isInvalidated = true
            throw BrowserControllerError.targetGenerationInvalid
        }

        self.requestID = requestID
        self.targetGeneration = targetGeneration
        phase = .quarantined
        isInvalidated = false
        fillWasDispatched = false
    }

    public func makeReleaseAttestation(
        navigationDestroyed: Bool,
        inputDestroyed: Bool,
        requestDestroyed: Bool,
        networkDestroyed: Bool
    ) throws -> BrowserReleaseAttestation {
        guard !isInvalidated || phase == .destroyed else {
            throw BrowserControllerError.invalidStateTransition
        }
        let disposition: BrowserReleaseDisposition
        switch phase {
        case .destroyed:
            disposition = .destroyed
        case .closed:
            disposition = .closed
        default:
            throw BrowserControllerError.invalidStateTransition
        }

        return try BrowserReleaseAttestation(
            requestID: requestID,
            targetGeneration: targetGeneration,
            disposition: disposition,
            navigationDestroyed: navigationDestroyed,
            inputDestroyed: inputDestroyed,
            requestDestroyed: requestDestroyed,
            networkDestroyed: networkDestroyed
        )
    }

    public func makeResult(
        navigationDestroyed: Bool,
        inputDestroyed: Bool,
        requestDestroyed: Bool,
        networkDestroyed: Bool
    ) throws -> BrowserControllerResult {
        guard fillWasDispatched, !isInvalidated else {
            throw BrowserControllerError.invalidStateTransition
        }
        let attestation = try makeReleaseAttestation(
            navigationDestroyed: navigationDestroyed,
            inputDestroyed: inputDestroyed,
            requestDestroyed: requestDestroyed,
            networkDestroyed: networkDestroyed
        )
        return try BrowserControllerResult(
            requestID: requestID,
            targetGeneration: targetGeneration,
            outcome: .fillDispatched,
            releaseAttestation: attestation
        )
    }

    private static func canTransition(
        from current: BrowserControllerPhase,
        to next: BrowserControllerPhase
    ) -> Bool {
        if next == .destroyed {
            return current != .destroyed && current != .closed
        }
        switch (current, next) {
        case (.quarantined, .attached),
             (.attached, .attested),
             (.attested, .inputDispatched),
             (.attested, .fillDispatched),
             (.inputDispatched, .fillDispatched),
             (.inputDispatched, .closed),
             (.fillDispatched, .closed):
            return true
        default:
            return false
        }
    }

    private static func validRequestID(_ value: String) -> Bool {
        !value.isEmpty &&
            value.utf8.count <= 128 &&
            !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) &&
            !value.allSatisfy({ $0.isWhitespace })
    }
}
