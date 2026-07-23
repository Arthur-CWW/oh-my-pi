import Foundation
import LocalAuthentication
import Security

public enum BiometricOperation: String, Codable, CaseIterable, Sendable {
    case credentialEnrollment = "credential-enrollment"
    case signingKeyProvisioning = "signing-key-provisioning"
    case grantCreation = "grant-creation"
    case grantExpansion = "grant-expansion"
    case reEnable = "re-enable"
    case destructiveOneShot = "destructive-one-shot"
    case bitwardenSessionAccess = "bitwarden-session-access"
}

public enum BiometricAuthorityError: Error, Equatable, Sendable {
    case deviceOwnerPostureUnavailable
    case touchIDUnavailable
    case authenticationFailed
    case evidenceInvalid
    case internalFailure
}

extension BiometricAuthorityError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .deviceOwnerPostureUnavailable:
            return "Device-owner authentication is unavailable."
        case .touchIDUnavailable:
            return "Touch ID authentication is unavailable."
        case .authenticationFailed:
            return "Touch ID authentication failed."
        case .evidenceInvalid:
            return "Biometric authorization evidence is invalid."
        case .internalFailure:
            return "Biometric authorization could not be completed."
        }
    }
}

public struct BiometricEvidence: @unchecked Sendable {
    public let evidenceID: String
    public let evaluatedAtMillis: UInt64
    public let operation: BiometricOperation

    private let seal: BiometricEvidenceSeal

    fileprivate init(
        evidenceID: String,
        evaluatedAtMillis: UInt64,
        operation: BiometricOperation,
        context: LAContext,
        evaluatedAtUptime: TimeInterval
    ) {
        self.evidenceID = evidenceID
        self.evaluatedAtMillis = evaluatedAtMillis
        self.operation = operation
        seal = BiometricEvidenceSeal(
            operation: operation,
            context: context,
            evaluatedAtUptime: evaluatedAtUptime
        )
    }

    func consumeAuthenticatedContext(
        allowing allowedOperations: Set<BiometricOperation>
    ) throws -> LAContext {
        try seal.consumeContext(allowing: allowedOperations)
    }
}

public protocol BiometricAuthorizing: Sendable {
    func authorize(_ operation: BiometricOperation) async throws -> BiometricEvidence
}

public final class BiometricAuthority: BiometricAuthorizing, @unchecked Sendable {
    public init() {}

    public func authorize(_ operation: BiometricOperation) async throws -> BiometricEvidence {
        let context = LAContext()
        context.touchIDAuthenticationAllowableReuseDuration = 0
        context.localizedFallbackTitle = ""

        var postureError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &postureError) else {
            context.invalidate()
            throw BiometricAuthorityError.deviceOwnerPostureUnavailable
        }

        var biometricError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometricError),
              context.biometryType == .touchID else {
            context.invalidate()
            throw BiometricAuthorityError.touchIDUnavailable
        }

        do {
            let authenticated = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: Self.localizedReason(for: operation)
            )
            guard authenticated else {
                context.invalidate()
                throw BiometricAuthorityError.authenticationFailed
            }
        } catch is BiometricAuthorityError {
            throw BiometricAuthorityError.authenticationFailed
        } catch {
            context.invalidate()
            throw BiometricAuthorityError.authenticationFailed
        }

        let evaluatedAtMillis = Self.currentTimeMillis()
        let evaluatedAtUptime = ProcessInfo.processInfo.systemUptime
        let evidenceID: String
        do {
            evidenceID = try Self.makeEvidenceID()
        } catch {
            context.invalidate()
            throw BiometricAuthorityError.internalFailure
        }

        return BiometricEvidence(
            evidenceID: evidenceID,
            evaluatedAtMillis: evaluatedAtMillis,
            operation: operation,
            context: context,
            evaluatedAtUptime: evaluatedAtUptime
        )
    }
    private static func localizedReason(for operation: BiometricOperation) -> String {
        switch operation {
        case .credentialEnrollment:
            return "Enroll a remote authentication credential."
        case .signingKeyProvisioning:
            return "Provision remote authentication signing keys."
        case .grantCreation:
            return "Create a remote authentication grant."
        case .grantExpansion:
            return "Expand a remote authentication grant."
        case .reEnable:
            return "Re-enable remote authentication."
        case .destructiveOneShot:
            return "Authorize a destructive one-time remote authentication action."
        case .bitwardenSessionAccess:
            return "Use Touch ID to access the Bitwarden CLI session."
        }
    }

    private static func makeEvidenceID() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw BiometricAuthorityError.internalFailure
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func currentTimeMillis() -> UInt64 {
        let milliseconds = Date().timeIntervalSince1970 * 1_000
        guard milliseconds.isFinite, milliseconds > 0 else { return 0 }
        return UInt64(milliseconds.rounded(.down))
    }
}

private final class BiometricEvidenceSeal: @unchecked Sendable {
    private static let maximumAge: TimeInterval = 60

    private let lock = NSLock()
    private let operation: BiometricOperation
    private let evaluatedAtUptime: TimeInterval
    private var context: LAContext?

    init(
        operation: BiometricOperation,
        context: LAContext,
        evaluatedAtUptime: TimeInterval
    ) {
        self.operation = operation
        self.context = context
        self.evaluatedAtUptime = evaluatedAtUptime
    }

    deinit {
        context?.invalidate()
    }

    func consumeContext(allowing allowedOperations: Set<BiometricOperation>) throws -> LAContext {
        lock.lock()
        defer { lock.unlock() }

        let age = ProcessInfo.processInfo.systemUptime - evaluatedAtUptime
        guard allowedOperations.contains(operation),
              age >= 0,
              age <= Self.maximumAge,
              let authenticatedContext = context else {
            context?.invalidate()
            context = nil
            throw BiometricAuthorityError.evidenceInvalid
        }

        context = nil
        return authenticatedContext
    }
}
