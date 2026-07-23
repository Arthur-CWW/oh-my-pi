import CryptoKit
import Foundation
import LocalAuthentication
import RemoteAuthProtocol
import Security

public enum KeychainSigningDomain: String, CaseIterable, Sendable, Equatable {
    case desktopBrowser = "desktop-browser"
    case gdm
    case sudo
}

public enum KeychainCredentialKind: String, CaseIterable, Sendable, Equatable {
    case gdmPassword = "gdm-password"
    case bitwarden
    case jetKVM = "jetkvm"

    public init(_ kind: BrokerCredentialKind) {
        switch kind {
        case .bitwarden:
            self = .bitwarden
        case .jetKVM:
            self = .jetKVM
        }
    }
}

public enum BitwardenSessionStatus: Sendable, Equatable {
    case absent
    case present
    case invalid
}

public enum KeychainCredentialStatus: Sendable, Equatable {
    case absent
    case enrolled(kind: KeychainCredentialKind)
}

public enum KeychainCredentialEnrollmentResult: Sendable, Equatable {
    case created
    case replaced
}

public enum KeychainForgetResult: Sendable, Equatable {
    case notFound
    case forgotten
}

public struct KeychainSigningKeyMetadata: Sendable, Equatable {
    public let keyID: String
    public let publicKey: Data

    public init(keyID: String, publicKey: Data) {
        self.keyID = keyID
        self.publicKey = publicKey
    }
}

public enum KeychainSigningKeyStatus: Sendable, Equatable {
    case absent
    case provisioned(KeychainSigningKeyMetadata)
}

public enum KeychainSigningKeyProvisioningResult: Sendable, Equatable {
    case provisioned(KeychainSigningKeyMetadata)
    case alreadyProvisioned(KeychainSigningKeyMetadata)
}

public enum LegacyMigrationDestinationStatus: Sendable, Equatable {
    case absent
    case presentUnverified
    case verified
}

public enum LegacyCredentialMigrationStatus: Sendable, Equatable {
    case notPrepared(destination: LegacyMigrationDestinationStatus)
    case ready(destination: LegacyMigrationDestinationStatus)
    case finalizationPending(destination: LegacyMigrationDestinationStatus)
    case finalized(destination: LegacyMigrationDestinationStatus)
}

public enum LegacyCredentialMigrationPreparationResult: Sendable, Equatable {
    case prepared
    case refreshed
}

public enum LegacyCredentialCutoverResult: Sendable, Equatable {
    case finalized
    case recoveredFinalization
    case alreadyFinalized
}

public enum KeychainAuthorityOperation: String, Sendable, Equatable {
    case readMetadata = "read-metadata"
    case readSecret = "read-secret"
    case storeSecret = "store-secret"
    case deleteSecret = "delete-secret"
    case generateRandom = "generate-random"
}

public enum KeychainAuthorityError: Error, Sendable, Equatable {
    case biometricEvidenceRejected
    case invalidCredentialIdentifier
    case emptyCredential
    case credentialTooLarge
    case credentialNotFound
    case credentialKindMismatch
    case invalidStoredCredential
    case signingKeyNotFound(KeychainSigningDomain)
    case invalidStoredSigningKey(KeychainSigningDomain)
    case legacyCredentialNotFound
    case invalidLegacyCredential
    case migrationNotPrepared
    case migrationAlreadyFinalized
    case invalidMigrationState
    case migrationDestinationMismatch
    case accessControlCreationFailed(Int)
    case keychainFailure(operation: KeychainAuthorityOperation, status: OSStatus)
}

extension KeychainAuthorityError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .biometricEvidenceRejected:
            return "Fresh Touch ID evidence is required for this Keychain operation."
        case .invalidCredentialIdentifier:
            return "The credential identifier is not canonical."
        case .emptyCredential:
            return "The credential is empty."
        case .credentialTooLarge:
            return "The credential exceeds the broker limit."
        case .credentialNotFound:
            return "The broker credential is not enrolled."
        case .credentialKindMismatch:
            return "The enrolled credential has a different broker credential kind."
        case .invalidStoredCredential:
            return "The broker credential has invalid Keychain metadata or contents."
        case .signingKeyNotFound(let domain):
            return "The \(domain.rawValue) signing key is not provisioned."
        case .invalidStoredSigningKey(let domain):
            return "The \(domain.rawValue) signing key has invalid Keychain metadata or contents."
        case .legacyCredentialNotFound:
            return "The reviewed legacy credential is not present."
        case .invalidLegacyCredential:
            return "The reviewed legacy credential is invalid."
        case .migrationNotPrepared:
            return "Legacy credential migration has not been prepared."
        case .migrationAlreadyFinalized:
            return "Legacy credential migration was already finalized."
        case .invalidMigrationState:
            return "The persistent legacy credential migration state is invalid."
        case .migrationDestinationMismatch:
            return "The broker migration destination does not match the reviewed legacy credential copy."
        case .accessControlCreationFailed(let code):
            return "Unable to create device-local Keychain access control (CFError \(code))."
        case .keychainFailure(let operation, let status):
            return "Keychain operation \(operation.rawValue) failed with OSStatus \(status)."
        }
    }
}


public final class KeychainAuthority: @unchecked Sendable {
    public static let maximumCredentialByteCount = 4_096

    private static let credentialService = "com.arthur.remote-auth-broker.credentials.v1"
    private static let signingKeyService = "com.arthur.remote-auth-broker.signing-keys.v1"
    private static let migrationStateService = "com.arthur.remote-auth-broker.migration-state.v1"

    private static let migratedGDMCredentialAccount = "gdm-password:arthur@desktop"
    private static let migrationStateAccount = "legacy-gdm:dotfiles.remote-sudo:arthur@desktop"
    private static let legacyService = "dotfiles.remote-sudo"
    private static let legacyAccount = "arthur@desktop"
    // The Bitwarden session token is never the master password. Touch ID gates the
    // package-owned item directly; the evaluated LAContext is reused for one batch.
    private static let bitwardenSessionServiceV3 = "dev.arthur.remote-auth-broker.bitwarden-session.v4"
    private static let bitwardenLegacySessionService = "dotfiles.bitwarden-touchid.BW_SESSION"


    private static let credentialMetadataMagic = Data("RABCRED1".utf8)
    private static let signingMetadataMagic = Data("RABSIGN1".utf8)
    private static let migrationStateMagic = Data("RABMIGR1".utf8)
    private static let metadataTokenByteCount = 32

    private let lock = NSLock()

    public func bitwardenSessionStatus(account: String) throws -> BitwardenSessionStatus {
        try validateCredentialID(account)
        if try copyMetadata(bitwardenSessionReference(account: account)) != nil {
            return .present
        }

        do {
            guard var legacy = try copySecret(
                legacyBitwardenSessionReference(account: account),
                context: nil
            ) else {
                return .absent
            }
            defer { Self.zero(&legacy.secret) }
            guard let token = Self.normalizedBitwardenSession(legacy.secret),
                  !token.isEmpty,
                  token.utf8.count <= Self.maximumCredentialByteCount
            else {
                return .invalid
            }
            return .present
        } catch let error as KeychainAuthorityError {
            guard case .keychainFailure(_, let status) = error,
                  status == errSecInteractionNotAllowed || status == errSecAuthFailed
            else {
                throw error
            }
            return .present
        }
    }

    public func storeBitwardenSession(
        account: String,
        session: inout [UInt8],
        evidence: BiometricEvidence
    ) throws {
        defer { Self.zero(&session) }
        try validateCredentialID(account)
        try validateCredential(session)
        let context = try authenticatedContext(evidence, allowing: [.bitwardenSessionAccess])
        defer { context.invalidate() }

        let token = try Self.normalizedBitwardenSession(session)
        guard !token.isEmpty, token.utf8.count <= Self.maximumCredentialByteCount else {
            throw KeychainAuthorityError.invalidStoredCredential
        }
        try synchronized {
            var secret = Data(token.utf8)
            defer { Self.zero(&secret) }
            try upsertBitwardenSession(
                account: account,
                secret: secret,
                context: context
            )
            _ = try delete(legacyBitwardenSessionReference(account: account))
        }
    }

    public func withBitwardenSession<T>(
        account: String,
        evidence: BiometricEvidence,
        _ body: (inout [UInt8]) throws -> T
    ) throws -> T {
        try validateCredentialID(account)
        let context = try authenticatedContext(evidence, allowing: [.bitwardenSessionAccess])
        defer { context.invalidate() }

        var session = try synchronized {
            try loadBitwardenSession(account: account, context: context)
        }
        defer { Self.zero(&session) }
        return try body(&session)
    }

    public init() {}

    public func enrollCredential(
        kind: KeychainCredentialKind,
        credentialID: String,
        secret: inout [UInt8],
        evidence: BiometricEvidence
    ) throws -> KeychainCredentialEnrollmentResult {
        defer { Self.zero(&secret) }
        try validateCredentialID(credentialID)
        try validateCredential(secret)

        let context = try authenticatedContext(evidence, allowing: [.credentialEnrollment])
        defer { context.invalidate() }

        return try synchronized {
            let reference = credentialReference(account: credentialID)
            let existingMetadata = try copyMetadata(reference)
            if let existingMetadata {
                guard existingMetadata.isDeviceLocal,
                      let decoded = Self.decodeCredentialMetadata(existingMetadata.generic)
                else {
                    throw KeychainAuthorityError.invalidStoredCredential
                }
                guard decoded.kind == kind else {
                    throw KeychainAuthorityError.credentialKindMismatch
                }
            }

            var secretData = Data(secret)
            defer { Self.zero(&secretData) }
            let token = try Self.randomToken()
            let metadata = Self.encodeCredentialMetadata(kind: kind, token: token)
            try upsert(
                reference,
                secret: secretData,
                generic: metadata,
                context: context
            )
            try verifyCredential(
                reference,
                expectedKind: kind,
                expectedToken: token,
                expectedSecret: secretData,
                context: context
            )
            return existingMetadata == nil ? .created : .replaced
        }
    }

    public func credentialStatus(credentialID: String) throws -> KeychainCredentialStatus {
        try validateCredentialID(credentialID)
        guard let metadata = try copyMetadata(credentialReference(account: credentialID)) else {
            return .absent
        }
        guard metadata.isDeviceLocal,
              let decoded = Self.decodeCredentialMetadata(metadata.generic)
        else {
            throw KeychainAuthorityError.invalidStoredCredential
        }
        return .enrolled(kind: decoded.kind)
    }

    public func withCredential<T>(
        credentialID: String,
        expectedKind: KeychainCredentialKind,
        _ body: (inout [UInt8]) throws -> T
    ) throws -> T {
        try validateCredentialID(credentialID)
        return try withCredential(
            reference: credentialReference(account: credentialID),
            expectedKind: expectedKind,
            body
        )
    }

    public func forgetCredential(
        credentialID: String
    ) throws -> KeychainForgetResult {
        try validateCredentialID(credentialID)
        return try synchronized {
            try delete(credentialReference(account: credentialID))
        }
    }

    public func enrollGDMCredential(
        secret: inout [UInt8],
        evidence: BiometricEvidence
    ) throws -> KeychainCredentialEnrollmentResult {
        defer { Self.zero(&secret) }
        try validateCredential(secret)
        let context = try authenticatedContext(evidence, allowing: [.credentialEnrollment])
        defer { context.invalidate() }

        return try synchronized {
            let reference = migratedGDMCredentialReference()
            let existing = try copyMetadata(reference)
            if let existing {
                guard existing.isDeviceLocal,
                      Self.decodeCredentialMetadata(existing.generic)?.kind == .gdmPassword
                else {
                    throw KeychainAuthorityError.invalidStoredCredential
                }
            }

            var secretData = Data(secret)
            defer { Self.zero(&secretData) }
            let token = try Self.randomToken()
            try upsert(
                reference,
                secret: secretData,
                generic: Self.encodeCredentialMetadata(kind: .gdmPassword, token: token),
                context: context
            )
            try verifyCredential(
                reference,
                expectedKind: .gdmPassword,
                expectedToken: token,
                expectedSecret: secretData,
                context: context
            )
            return existing == nil ? .created : .replaced
        }
    }

    public func gdmCredentialStatus() throws -> KeychainCredentialStatus {
        guard let metadata = try copyMetadata(migratedGDMCredentialReference()) else {
            return .absent
        }
        guard metadata.isDeviceLocal,
              Self.decodeCredentialMetadata(metadata.generic)?.kind == .gdmPassword
        else {
            throw KeychainAuthorityError.invalidStoredCredential
        }
        return .enrolled(kind: .gdmPassword)
    }

    public func withGDMCredential<T>(
        _ body: (inout [UInt8]) throws -> T
    ) throws -> T {
        try withCredential(
            reference: migratedGDMCredentialReference(),
            expectedKind: .gdmPassword,
            body
        )
    }

    public func forgetGDMCredential() throws -> KeychainForgetResult {
        try synchronized {
            try delete(migratedGDMCredentialReference())
        }
    }

    public func provisionSigningKey(
        domain: KeychainSigningDomain,
        evidence: BiometricEvidence
    ) throws -> KeychainSigningKeyProvisioningResult {
        let context = try authenticatedContext(evidence, allowing: [.signingKeyProvisioning])
        defer { context.invalidate() }

        return try synchronized {
            let reference = signingKeyReference(domain: domain)
            if try copyMetadata(reference) != nil {
                let metadata = try loadSigningKeyMetadata(domain: domain, context: context)
                return .alreadyProvisioned(metadata)
            }

            let privateKey = Curve25519.Signing.PrivateKey()
            var rawPrivateKey = privateKey.rawRepresentation
            defer { Self.zero(&rawPrivateKey) }
            let metadata = Self.signingKeyMetadata(privateKey)
            try upsert(
                reference,
                secret: rawPrivateKey,
                generic: Self.encodeSigningMetadata(publicKey: metadata.publicKey),
                context: context
            )

            let verified = try loadSigningKeyMetadata(domain: domain, context: context)
            guard verified == metadata else {
                throw KeychainAuthorityError.invalidStoredSigningKey(domain)
            }
            return .provisioned(metadata)
        }
    }

    public func signingKeyStatus(domain: KeychainSigningDomain) throws -> KeychainSigningKeyStatus {
        guard let item = try copyMetadata(signingKeyReference(domain: domain)) else {
            return .absent
        }
        guard item.isDeviceLocal,
              let publicKey = Self.decodeSigningMetadata(item.generic),
              publicKey.count == 32
        else {
            throw KeychainAuthorityError.invalidStoredSigningKey(domain)
        }
        return .provisioned(Self.signingKeyMetadata(publicKey: publicKey))
    }

    public func withSigningKey<T>(
        domain: KeychainSigningDomain,
        _ body: (String, Curve25519.Signing.PrivateKey) throws -> T
    ) throws -> T {
        let reference = signingKeyReference(domain: domain)
        guard var item = try copySecret(reference, context: nil) else {
            throw KeychainAuthorityError.signingKeyNotFound(domain)
        }
        defer { Self.zero(&item.secret) }
        guard item.metadata.isDeviceLocal,
              let storedPublicKey = Self.decodeSigningMetadata(item.metadata.generic),
              let privateKey = try? Curve25519.Signing.PrivateKey(rawRepresentation: item.secret)
        else {
            throw KeychainAuthorityError.invalidStoredSigningKey(domain)
        }

        let metadata = Self.signingKeyMetadata(privateKey)
        guard Self.constantTimeEqual(metadata.publicKey, storedPublicKey) else {
            throw KeychainAuthorityError.invalidStoredSigningKey(domain)
        }
        return try body(metadata.keyID, privateKey)
    }

    public func forgetSigningKey(
        domain: KeychainSigningDomain
    ) throws -> KeychainForgetResult {
        try synchronized {
            try delete(signingKeyReference(domain: domain))
        }
    }

    public func legacyMigrationStatus() throws -> LegacyCredentialMigrationStatus {
        let state = try loadMigrationState()
        let destination = try migrationDestinationStatus(expectedToken: state?.token)
        guard let state else {
            return .notPrepared(destination: destination)
        }
        switch state.phase {
        case .ready:
            return .ready(destination: destination)
        case .cutoverVerified:
            return .finalizationPending(destination: destination)
        case .finalized:
            return .finalized(destination: destination)
        }
    }

    public func prepareLegacyCredentialMigration(
        evidence: BiometricEvidence
    ) throws -> LegacyCredentialMigrationPreparationResult {
        let context = try authenticatedContext(evidence, allowing: [.credentialEnrollment])
        defer { context.invalidate() }

        return try synchronized {
            let existingState = try loadMigrationState(context: context)
            if existingState?.phase == .finalized {
                throw KeychainAuthorityError.migrationAlreadyFinalized
            }

            guard var legacy = try copySecret(legacyCredentialReference(), context: context) else {
                throw KeychainAuthorityError.legacyCredentialNotFound
            }
            defer { Self.zero(&legacy.secret) }
            guard !legacy.secret.isEmpty,
                  legacy.secret.count <= Self.maximumCredentialByteCount
            else {
                throw KeychainAuthorityError.invalidLegacyCredential
            }

            let token = try Self.randomToken()
            let destination = migratedGDMCredentialReference()
            try upsert(
                destination,
                secret: legacy.secret,
                generic: Self.encodeCredentialMetadata(kind: .gdmPassword, token: token),
                context: context
            )
            try verifyCredential(
                destination,
                expectedKind: .gdmPassword,
                expectedToken: token,
                expectedSecret: legacy.secret,
                context: context
            )

            let marker = MigrationState(phase: .ready, token: token)
            try storeMigrationState(marker, context: context)
            return existingState == nil ? .prepared : .refreshed
        }
    }

    public func finalizeCutover(
        evidence: BiometricEvidence
    ) throws -> LegacyCredentialCutoverResult {
        let context = try authenticatedContext(evidence, allowing: [.destructiveOneShot])
        defer { context.invalidate() }

        return try synchronized {
            guard var state = try loadMigrationState(context: context) else {
                throw KeychainAuthorityError.migrationNotPrepared
            }
            if state.phase == .finalized {
                return .alreadyFinalized
            }

            guard var destination = try copySecret(migratedGDMCredentialReference(), context: context) else {
                throw KeychainAuthorityError.migrationDestinationMismatch
            }
            defer { Self.zero(&destination.secret) }
            guard destination.metadata.isDeviceLocal,
                  let destinationMetadata = Self.decodeCredentialMetadata(destination.metadata.generic),
                  destinationMetadata.kind == .gdmPassword,
                  Self.constantTimeEqual(destinationMetadata.token, state.token),
                  !destination.secret.isEmpty,
                  destination.secret.count <= Self.maximumCredentialByteCount
            else {
                throw KeychainAuthorityError.migrationDestinationMismatch
            }

            let wasRecovery = state.phase == .cutoverVerified
            if var legacy = try copySecret(legacyCredentialReference(), context: context) {
                defer { Self.zero(&legacy.secret) }
                guard !legacy.secret.isEmpty,
                      legacy.secret.count <= Self.maximumCredentialByteCount,
                      Self.constantTimeEqual(legacy.secret, destination.secret)
                else {
                    throw KeychainAuthorityError.migrationDestinationMismatch
                }

                state = MigrationState(phase: .cutoverVerified, token: state.token)
                try storeMigrationState(state, context: context)
                _ = try delete(legacyCredentialReference())
            } else if !wasRecovery {
                throw KeychainAuthorityError.legacyCredentialNotFound
            }

            state = MigrationState(phase: .finalized, token: state.token)
            try storeMigrationState(state, context: context)
            return wasRecovery ? .recoveredFinalization : .finalized
        }
    }

    private func validateCredentialID(_ credentialID: String) throws {
        do {
            try ControlRequest.credentialForget(credentialId: credentialID).validate()
        } catch {
            throw KeychainAuthorityError.invalidCredentialIdentifier
        }
    }

    private func validateCredential(_ secret: [UInt8]) throws {
        guard !secret.isEmpty else {
            throw KeychainAuthorityError.emptyCredential
        }
        guard secret.count <= Self.maximumCredentialByteCount else {
            throw KeychainAuthorityError.credentialTooLarge
        }
    }

    private func authenticatedContext(
        _ evidence: BiometricEvidence,
        allowing operations: Set<BiometricOperation>
    ) throws -> LAContext {
        do {
            return try evidence.consumeAuthenticatedContext(allowing: operations)
        } catch {
            throw KeychainAuthorityError.biometricEvidenceRejected
        }
    }

    private func withCredential<T>(
        reference: ItemReference,
        expectedKind: KeychainCredentialKind,
        _ body: (inout [UInt8]) throws -> T
    ) throws -> T {
        guard var item = try copySecret(reference, context: nil) else {
            throw KeychainAuthorityError.credentialNotFound
        }
        defer { Self.zero(&item.secret) }
        guard item.metadata.isDeviceLocal,
              let metadata = Self.decodeCredentialMetadata(item.metadata.generic),
              metadata.kind == expectedKind,
              !item.secret.isEmpty,
              item.secret.count <= Self.maximumCredentialByteCount
        else {
            throw KeychainAuthorityError.invalidStoredCredential
        }

        var secret = [UInt8](item.secret)
        defer { Self.zero(&secret) }
        return try body(&secret)
    }

    private func loadSigningKeyMetadata(
        domain: KeychainSigningDomain,
        context: LAContext
    ) throws -> KeychainSigningKeyMetadata {
        guard var item = try copySecret(signingKeyReference(domain: domain), context: context) else {
            throw KeychainAuthorityError.signingKeyNotFound(domain)
        }
        defer { Self.zero(&item.secret) }
        guard item.metadata.isDeviceLocal,
              let storedPublicKey = Self.decodeSigningMetadata(item.metadata.generic),
              let privateKey = try? Curve25519.Signing.PrivateKey(rawRepresentation: item.secret)
        else {
            throw KeychainAuthorityError.invalidStoredSigningKey(domain)
        }
        let metadata = Self.signingKeyMetadata(privateKey)
        guard Self.constantTimeEqual(metadata.publicKey, storedPublicKey) else {
            throw KeychainAuthorityError.invalidStoredSigningKey(domain)
        }
        return metadata
    }

    private func verifyCredential(
        _ reference: ItemReference,
        expectedKind: KeychainCredentialKind,
        expectedToken: Data,
        expectedSecret: Data,
        context: LAContext
    ) throws {
        guard var stored = try copySecret(reference, context: context) else {
            throw KeychainAuthorityError.invalidStoredCredential
        }
        defer { Self.zero(&stored.secret) }
        guard stored.metadata.isDeviceLocal,
              let metadata = Self.decodeCredentialMetadata(stored.metadata.generic),
              metadata.kind == expectedKind,
              Self.constantTimeEqual(metadata.token, expectedToken),
              Self.constantTimeEqual(stored.secret, expectedSecret)
        else {
            throw KeychainAuthorityError.invalidStoredCredential
        }
    }

    private func migrationDestinationStatus(
        expectedToken: Data?
    ) throws -> LegacyMigrationDestinationStatus {
        guard let metadata = try copyMetadata(migratedGDMCredentialReference()) else {
            return .absent
        }
        guard metadata.isDeviceLocal,
              let decoded = Self.decodeCredentialMetadata(metadata.generic),
              decoded.kind == .gdmPassword
        else {
            return .presentUnverified
        }
        guard let expectedToken else {
            return .presentUnverified
        }
        return Self.constantTimeEqual(decoded.token, expectedToken) ? .verified : .presentUnverified
    }

    private func loadMigrationState(context: LAContext? = nil) throws -> MigrationState? {
        guard var item = try copySecret(migrationStateReference(), context: context) else {
            return nil
        }
        defer { Self.zero(&item.secret) }
        guard item.metadata.isDeviceLocal,
              Self.constantTimeEqual(item.metadata.generic ?? Data(), Self.migrationStateMagic),
              let state = Self.decodeMigrationState(item.secret)
        else {
            throw KeychainAuthorityError.invalidMigrationState
        }
        return state
    }

    private func storeMigrationState(
        _ state: MigrationState,
        context: LAContext
    ) throws {
        var encoded = Self.encodeMigrationState(state)
        defer { Self.zero(&encoded) }
        try upsert(
            migrationStateReference(),
            secret: encoded,
            generic: Self.migrationStateMagic,
            context: context
        )

        guard let verified = try loadMigrationState(context: context), verified == state else {
            throw KeychainAuthorityError.invalidMigrationState
        }
    }

    private func synchronized<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func credentialReference(account: String) -> ItemReference {
        ItemReference(service: Self.credentialService, account: account)
    }
    private func bitwardenSessionReference(account: String) -> ItemReference {
        ItemReference(service: Self.bitwardenSessionServiceV3, account: account)
    }

    private func legacyBitwardenSessionReference(account: String) -> ItemReference {
        ItemReference(service: Self.bitwardenLegacySessionService, account: account)
    }


    private func migratedGDMCredentialReference() -> ItemReference {
        ItemReference(
            service: Self.credentialService,
            account: Self.migratedGDMCredentialAccount
        )
    }

    private func signingKeyReference(domain: KeychainSigningDomain) -> ItemReference {
        ItemReference(service: Self.signingKeyService, account: domain.rawValue)
    }

    private func migrationStateReference() -> ItemReference {
        ItemReference(service: Self.migrationStateService, account: Self.migrationStateAccount)
    }

    private func legacyCredentialReference() -> ItemReference {
        ItemReference(service: Self.legacyService, account: Self.legacyAccount)
    }

    private func copyMetadata(_ reference: ItemReference) throws -> ItemMetadata? {
        var query = baseQuery(reference)
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess,
              let dictionary = result as? [String: Any]
        else {
            if status == errSecSuccess {
                throw KeychainAuthorityError.keychainFailure(
                    operation: .readMetadata,
                    status: errSecDecode
                )
            }
            throw KeychainAuthorityError.keychainFailure(operation: .readMetadata, status: status)
        }
        return Self.itemMetadata(dictionary)
    }

    private func copySecret(
        _ reference: ItemReference,
        context: LAContext?
    ) throws -> SecretItem? {
        var query = baseQuery(reference)
        query[kSecReturnAttributes as String] = true
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        if let context {
            query[kSecUseAuthenticationContext as String] = context
        }

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess,
              let dictionary = result as? [String: Any],
              let secret = dictionary[kSecValueData as String] as? Data
        else {
            if status == errSecSuccess {
                throw KeychainAuthorityError.keychainFailure(
                    operation: .readSecret,
                    status: errSecDecode
                )
            }
            throw KeychainAuthorityError.keychainFailure(operation: .readSecret, status: status)
        }
        return SecretItem(secret: secret, metadata: Self.itemMetadata(dictionary))
    }

    private func loadBitwardenSession(
        account: String,
        context: LAContext
    ) throws -> [UInt8] {
        if var v3 = try copySecret(
            bitwardenSessionReference(account: account),
            context: nil
        ) {
            defer { Self.zero(&v3.secret) }
            if let token = Self.normalizedBitwardenSession(v3.secret),
               !token.isEmpty,
               token.utf8.count <= Self.maximumCredentialByteCount {
                _ = try delete(legacyBitwardenSessionReference(account: account))
                return Array(token.utf8)
            }
        }

        if var legacy = try copySecret(
            legacyBitwardenSessionReference(account: account),
            context: context
        ) {
            defer { Self.zero(&legacy.secret) }
            guard let token = Self.normalizedBitwardenSession(legacy.secret),
                  !token.isEmpty,
                  token.utf8.count <= Self.maximumCredentialByteCount
            else {
                throw KeychainAuthorityError.invalidStoredCredential
            }
            var secret = Data(token.utf8)
            defer { Self.zero(&secret) }
            try upsertBitwardenSession(account: account, secret: secret, context: context)
            _ = try delete(legacyBitwardenSessionReference(account: account))
            return Array(token.utf8)
        }

        if try bitwardenSessionStatus(account: account) == .invalid {
            throw KeychainAuthorityError.invalidStoredCredential
        }
        throw KeychainAuthorityError.credentialNotFound
    }

    private func upsertBitwardenSession(
        account: String,
        secret: Data,
        context: LAContext
    ) throws {
        let accessControl = try Self.makeBitwardenAccessControl()
        var query = baseQuery(bitwardenSessionReference(account: account))
        query[kSecUseAuthenticationContext as String] = context
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let attributes: [String: Any] = [
            kSecValueData as String: secret,
            kSecAttrAccessControl as String: accessControl,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainAuthorityError.keychainFailure(operation: .storeSecret, status: updateStatus)
        }

        query[kSecValueData as String] = secret
        query[kSecAttrAccessControl as String] = accessControl
        let addStatus = SecItemAdd(query as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainAuthorityError.keychainFailure(operation: .storeSecret, status: addStatus)
        }
    }

    private func upsert(
        _ reference: ItemReference,
        secret: Data,
        generic: Data,
        context: LAContext
    ) throws {
        let accessControl = try Self.makeAccessControl()
        var query = baseQuery(reference)
        query[kSecUseAuthenticationContext as String] = context
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let attributes: [String: Any] = [
            kSecValueData as String: secret,
            kSecAttrGeneric as String: generic,
            kSecAttrAccessControl as String: accessControl,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainAuthorityError.keychainFailure(operation: .storeSecret, status: updateStatus)
        }

        var item = baseQuery(reference)
        item[kSecValueData as String] = secret
        item[kSecAttrGeneric as String] = generic
        item[kSecAttrAccessControl as String] = accessControl
        item[kSecUseAuthenticationContext as String] = context
        item[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            let retryStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            guard retryStatus == errSecSuccess else {
                throw KeychainAuthorityError.keychainFailure(operation: .storeSecret, status: retryStatus)
            }
            return
        }
        guard addStatus == errSecSuccess else {
            throw KeychainAuthorityError.keychainFailure(operation: .storeSecret, status: addStatus)
        }
    }

    private func delete(
        _ reference: ItemReference
    ) throws -> KeychainForgetResult {
        var query = baseQuery(reference)
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let status = SecItemDelete(query as CFDictionary)
        switch status {
        case errSecSuccess:
            return .forgotten
        case errSecItemNotFound:
            return .notFound
        default:
            throw KeychainAuthorityError.keychainFailure(operation: .deleteSecret, status: status)
        }
    }

    private func baseQuery(_ reference: ItemReference) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: reference.service,
            kSecAttrAccount as String: reference.account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    private static func itemMetadata(_ dictionary: [String: Any]) -> ItemMetadata {
        ItemMetadata(
            generic: dictionary[kSecAttrGeneric as String] as? Data,
            accessible: dictionary[kSecAttrAccessible as String] as? String
        )
    }

    private static func makeBitwardenAccessControl() throws -> SecAccessControl {
        var unmanagedError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .biometryCurrentSet,
            &unmanagedError
        ) else {
            let error = unmanagedError?.takeRetainedValue()
            throw KeychainAuthorityError.accessControlCreationFailed(error.map(CFErrorGetCode) ?? -1)
        }
        return accessControl
    }

    private static func makeAccessControl() throws -> SecAccessControl {
        var unmanagedError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [],
            &unmanagedError
        ) else {
            let code: Int
            if let unmanagedError {
                let error = unmanagedError.takeRetainedValue()
                code = CFErrorGetCode(error)
            } else {
                code = -1
            }
            throw KeychainAuthorityError.accessControlCreationFailed(code)
        }
        return accessControl
    }

    private static func randomToken() throws -> Data {
        var token = Data(count: metadataTokenByteCount)
        let status = token.withUnsafeMutableBytes { bytes -> OSStatus in
            guard let baseAddress = bytes.baseAddress else {
                return errSecAllocate
            }
            return SecRandomCopyBytes(kSecRandomDefault, metadataTokenByteCount, baseAddress)
        }
        guard status == errSecSuccess else {
            zero(&token)
            throw KeychainAuthorityError.keychainFailure(operation: .generateRandom, status: status)
        }
        return token
    }

    private static func encodeCredentialMetadata(
        kind: KeychainCredentialKind,
        token: Data
    ) -> Data {
        var encoded = credentialMetadataMagic
        encoded.append(credentialKindByte(kind))
        encoded.append(token)
        return encoded
    }

    private static func decodeCredentialMetadata(
        _ data: Data?
    ) -> (kind: KeychainCredentialKind, token: Data)? {
        guard let data,
              data.count == credentialMetadataMagic.count + 1 + metadataTokenByteCount,
              data.starts(with: credentialMetadataMagic)
        else {
            return nil
        }
        let kindOffset = credentialMetadataMagic.count
        guard let kind = credentialKind(data[kindOffset]) else {
            return nil
        }
        let tokenStart = data.index(data.startIndex, offsetBy: kindOffset + 1)
        return (kind, Data(data[tokenStart...]))
    }

    private static func credentialKindByte(_ kind: KeychainCredentialKind) -> UInt8 {
        switch kind {
        case .gdmPassword: return 1
        case .bitwarden: return 2
        case .jetKVM: return 3
        }
    }

    private static func credentialKind(_ byte: UInt8) -> KeychainCredentialKind? {
        switch byte {
        case 1: return .gdmPassword
        case 2: return .bitwarden
        case 3: return .jetKVM
        default: return nil
        }
    }

    private static func encodeSigningMetadata(publicKey: Data) -> Data {
        var encoded = signingMetadataMagic
        encoded.append(publicKey)
        return encoded
    }

    private static func decodeSigningMetadata(_ data: Data?) -> Data? {
        guard let data,
              data.count == signingMetadataMagic.count + 32,
              data.starts(with: signingMetadataMagic)
        else {
            return nil
        }
        let publicKeyStart = data.index(data.startIndex, offsetBy: signingMetadataMagic.count)
        return Data(data[publicKeyStart...])
    }

    private static func signingKeyMetadata(
        _ privateKey: Curve25519.Signing.PrivateKey
    ) -> KeychainSigningKeyMetadata {
        signingKeyMetadata(publicKey: privateKey.publicKey.rawRepresentation)
    }

    private static func signingKeyMetadata(publicKey: Data) -> KeychainSigningKeyMetadata {
        let digest = Data(SHA256.hash(data: publicKey))
        return KeychainSigningKeyMetadata(
            keyID: AuthorityBase64URL.encode(digest),
            publicKey: publicKey
        )
    }

    private static func encodeMigrationState(_ state: MigrationState) -> Data {
        var encoded = migrationStateMagic
        encoded.append(state.phase.rawValue)
        encoded.append(state.token)
        return encoded
    }

    private static func decodeMigrationState(_ data: Data) -> MigrationState? {
        guard data.count == migrationStateMagic.count + 1 + metadataTokenByteCount,
              data.starts(with: migrationStateMagic)
        else {
            return nil
        }
        let phaseOffset = migrationStateMagic.count
        guard let phase = MigrationPhase(rawValue: data[phaseOffset]) else {
            return nil
        }
        let tokenStart = data.index(data.startIndex, offsetBy: phaseOffset + 1)
        return MigrationState(phase: phase, token: Data(data[tokenStart...]))
    }

    private static func constantTimeEqual(_ lhs: Data, _ rhs: Data) -> Bool {
        guard lhs.count == rhs.count else {
            return false
        }
        return lhs.withUnsafeBytes { (lhsBytes: UnsafeRawBufferPointer) in
            rhs.withUnsafeBytes { (rhsBytes: UnsafeRawBufferPointer) in
                var difference: UInt8 = 0
                for index in 0..<lhs.count {
                    difference |= lhsBytes[index] ^ rhsBytes[index]
                }
                return difference == 0
            }
        }
    }

    private static func normalizedBitwardenSession(_ data: Data) -> String? {
        guard let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizedBitwardenSession(_ bytes: [UInt8]) throws -> String {
        guard let token = String(bytes: bytes, encoding: .utf8) else {
            throw KeychainAuthorityError.invalidStoredCredential
        }
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func zero(_ data: inout Data) {
        data.withUnsafeMutableBytes { bytes in
            if let baseAddress = bytes.baseAddress {
                baseAddress.initializeMemory(as: UInt8.self, repeating: 0, count: bytes.count)
            }
        }
        data.removeAll(keepingCapacity: false)
    }

    private static func zero(_ bytes: inout [UInt8]) {
        bytes.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
        bytes.removeAll(keepingCapacity: false)
    }
}

private struct ItemReference: Sendable {
    let service: String
    let account: String
}

private struct ItemMetadata {
    let generic: Data?
    let accessible: String?

    var isDeviceLocal: Bool {
        accessible == (kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
    }
}

private struct SecretItem {
    var secret: Data
    let metadata: ItemMetadata
}

private enum MigrationPhase: UInt8, Sendable, Equatable {
    case ready = 1
    case cutoverVerified = 2
    case finalized = 3
}

private struct MigrationState: Sendable, Equatable {
    let phase: MigrationPhase
    let token: Data
}
