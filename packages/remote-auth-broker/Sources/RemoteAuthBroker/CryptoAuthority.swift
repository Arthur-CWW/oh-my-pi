import CryptoKit
import Foundation
import RemoteAuthProtocol

public enum CryptoAuthorityError: Error, CustomStringConvertible, LocalizedError, CaseIterable, Sendable {
    case invalidBase64URL
    case invalidRecipientKey
    case invalidEphemeralKey
    case invalidHPKEInput
    case encryptionFailed
    case signingFailed
    case invalidGDMRequest
    case invalidGDMChallenge
    case invalidGDMSentinel
    case invalidGDMPlaintext
    case invalidSudoRequest

    public var description: String {
        switch self {
        case .invalidBase64URL:
            return "base64url input rejected"
        case .invalidRecipientKey:
            return "recipient key rejected"
        case .invalidEphemeralKey:
            return "ephemeral key rejected"
        case .invalidHPKEInput:
            return "encryption input rejected"
        case .encryptionFailed:
            return "encryption failed"
        case .signingFailed:
            return "signing failed"
        case .invalidGDMRequest:
            return "login request rejected"
        case .invalidGDMChallenge:
            return "login challenge rejected"
        case .invalidGDMSentinel:
            return "login sentinel rejected"
        case .invalidGDMPlaintext:
            return "login secret rejected"
        case .invalidSudoRequest:
            return "sudo request rejected"
        }
    }

    public var errorDescription: String? { description }
}

public enum AuthorityBase64URL {
    public static func encode(_ data: Data) -> String {
        var encoded = data.base64EncodedData()
        var writeIndex = encoded.startIndex
        var readIndex = encoded.startIndex

        while readIndex < encoded.endIndex {
            let byte = encoded[readIndex]
            if byte == 0x3d {
                break
            }
            switch byte {
            case 0x2b:
                encoded[writeIndex] = 0x2d
            case 0x2f:
                encoded[writeIndex] = 0x5f
            default:
                encoded[writeIndex] = byte
            }
            writeIndex += 1
            readIndex += 1
        }
        encoded.removeSubrange(writeIndex..<encoded.endIndex)
        return String(decoding: encoded, as: UTF8.self)
    }

    public static func decode(_ value: String) throws -> Data {
        let byteCount = value.utf8.count
        let remainder = byteCount & 3
        guard remainder != 1 else {
            throw CryptoAuthorityError.invalidBase64URL
        }

        var standard = Data()
        standard.reserveCapacity(byteCount + ((4 - remainder) & 3))
        var lastSextet: UInt8 = 0

        for byte in value.utf8 {
            switch byte {
            case 0x41...0x5a:
                lastSextet = byte - 0x41
                standard.append(byte)
            case 0x61...0x7a:
                lastSextet = byte - 0x61 + 26
                standard.append(byte)
            case 0x30...0x39:
                lastSextet = byte - 0x30 + 52
                standard.append(byte)
            case 0x2d:
                lastSextet = 62
                standard.append(0x2b)
            case 0x5f:
                lastSextet = 63
                standard.append(0x2f)
            default:
                throw CryptoAuthorityError.invalidBase64URL
            }
        }

        guard remainder == 0
                || (remainder == 2 && lastSextet & 0x0f == 0)
                || (remainder == 3 && lastSextet & 0x03 == 0)
        else {
            throw CryptoAuthorityError.invalidBase64URL
        }

        if remainder != 0 {
            standard.append(contentsOf: repeatElement(0x3d, count: 4 - remainder))
        }
        guard let decoded = Data(base64Encoded: standard, options: []) else {
            throw CryptoAuthorityError.invalidBase64URL
        }
        return decoded
    }
}

public struct AuthorityHPKESealedBox: Sendable, Equatable {
    public let encapsulatedKey: Data
    public let ciphertext: Data

    public init(encapsulatedKey: Data, ciphertext: Data) {
        self.encapsulatedKey = encapsulatedKey
        self.ciphertext = ciphertext
    }
}

public enum AuthorityHPKE {
    private static let versionLabel = Data("HPKE-v1".utf8)
    private static let eaePRKLabel = Data("eae_prk".utf8)
    private static let sharedSecretLabel = Data("shared_secret".utf8)
    private static let pskIDHashLabel = Data("psk_id_hash".utf8)
    private static let infoHashLabel = Data("info_hash".utf8)
    private static let secretLabel = Data("secret".utf8)
    private static let keyLabel = Data("key".utf8)
    private static let baseNonceLabel = Data("base_nonce".utf8)

    public static func seal(
        recipientPublicKey: Data,
        plaintext: Data,
        info: Data,
        authenticatedData: Data
    ) throws -> AuthorityHPKESealedBox {
        let ephemeralPrivateKey = Curve25519.KeyAgreement.PrivateKey()
        return try seal(
            recipientPublicKey: recipientPublicKey,
            plaintext: plaintext,
            info: info,
            authenticatedData: authenticatedData,
            using: ephemeralPrivateKey
        )
    }

    static func seal(
        recipientPublicKey: Data,
        plaintext: Data,
        info: Data,
        authenticatedData: Data,
        ephemeralPrivateKeyRawRepresentation: Data
    ) throws -> AuthorityHPKESealedBox {
        let ephemeralPrivateKey: Curve25519.KeyAgreement.PrivateKey
        do {
            ephemeralPrivateKey = try Curve25519.KeyAgreement.PrivateKey(
                rawRepresentation: ephemeralPrivateKeyRawRepresentation
            )
        } catch {
            throw CryptoAuthorityError.invalidEphemeralKey
        }
        return try seal(
            recipientPublicKey: recipientPublicKey,
            plaintext: plaintext,
            info: info,
            authenticatedData: authenticatedData,
            using: ephemeralPrivateKey
        )
    }

    private static func seal(
        recipientPublicKey: Data,
        plaintext: Data,
        info: Data,
        authenticatedData: Data,
        using ephemeralPrivateKey: Curve25519.KeyAgreement.PrivateKey
    ) throws -> AuthorityHPKESealedBox {
        do {
            try HPKEV1.validateRecipientPublicKey(recipientPublicKey)
        } catch {
            throw CryptoAuthorityError.invalidRecipientKey
        }
        guard plaintext.count <= HPKEV1.maximumCiphertextByteCount - HPKEV1.authenticationTagByteCount else {
            throw CryptoAuthorityError.invalidHPKEInput
        }

        let recipientKey: Curve25519.KeyAgreement.PublicKey
        let sharedSecret: SharedSecret
        do {
            recipientKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: recipientPublicKey)
            sharedSecret = try ephemeralPrivateKey.sharedSecretFromKeyAgreement(with: recipientKey)
        } catch {
            throw CryptoAuthorityError.invalidRecipientKey
        }

        let encapsulatedKey = ephemeralPrivateKey.publicKey.rawRepresentation
        var dh = sharedSecret.withUnsafeBytes { Data($0) }
        defer { zero(&dh) }

        var eaePRK = try labeledExtract(
            salt: Data(),
            suiteID: HPKEV1.kemSuiteIdentifier,
            label: eaePRKLabel,
            inputKeyMaterial: dh
        )
        defer { zero(&eaePRK) }

        var kemContext = Data()
        kemContext.reserveCapacity(encapsulatedKey.count + recipientPublicKey.count)
        kemContext.append(encapsulatedKey)
        kemContext.append(recipientPublicKey)

        var kemSharedSecret = try labeledExpand(
            pseudoRandomKey: eaePRK,
            suiteID: HPKEV1.kemSuiteIdentifier,
            label: sharedSecretLabel,
            info: kemContext,
            outputByteCount: 32
        )
        defer { zero(&kemSharedSecret) }

        var pskIDHash = try labeledExtract(
            salt: Data(),
            suiteID: HPKEV1.suiteIdentifier,
            label: pskIDHashLabel,
            inputKeyMaterial: Data()
        )
        defer { zero(&pskIDHash) }

        var infoHash = try labeledExtract(
            salt: Data(),
            suiteID: HPKEV1.suiteIdentifier,
            label: infoHashLabel,
            inputKeyMaterial: info
        )
        defer { zero(&infoHash) }

        var keyScheduleContext = Data()
        keyScheduleContext.reserveCapacity(1 + pskIDHash.count + infoHash.count)
        keyScheduleContext.append(0x00)
        keyScheduleContext.append(pskIDHash)
        keyScheduleContext.append(infoHash)

        var secret = try labeledExtract(
            salt: kemSharedSecret,
            suiteID: HPKEV1.suiteIdentifier,
            label: secretLabel,
            inputKeyMaterial: Data()
        )
        defer { zero(&secret) }

        var keyBytes = try labeledExpand(
            pseudoRandomKey: secret,
            suiteID: HPKEV1.suiteIdentifier,
            label: keyLabel,
            info: keyScheduleContext,
            outputByteCount: 32
        )
        defer { zero(&keyBytes) }

        var baseNonce = try labeledExpand(
            pseudoRandomKey: secret,
            suiteID: HPKEV1.suiteIdentifier,
            label: baseNonceLabel,
            info: keyScheduleContext,
            outputByteCount: 12
        )
        defer { zero(&baseNonce) }

        do {
            let key = SymmetricKey(data: keyBytes)
            let nonce = try ChaChaPoly.Nonce(data: baseNonce)
            let sealed = try ChaChaPoly.seal(
                plaintext,
                using: key,
                nonce: nonce,
                authenticating: authenticatedData
            )
            var ciphertext = sealed.ciphertext
            ciphertext.reserveCapacity(sealed.ciphertext.count + sealed.tag.count)
            ciphertext.append(sealed.tag)
            return AuthorityHPKESealedBox(
                encapsulatedKey: encapsulatedKey,
                ciphertext: ciphertext
            )
        } catch {
            throw CryptoAuthorityError.encryptionFailed
        }
    }

    private static func labeledExtract(
        salt: Data,
        suiteID: Data,
        label: Data,
        inputKeyMaterial: Data
    ) throws -> Data {
        var labeledInput = Data()
        let capacity = try checkedCapacity(
            versionLabel.count,
            suiteID.count,
            label.count,
            inputKeyMaterial.count
        )
        labeledInput.reserveCapacity(capacity)
        labeledInput.append(versionLabel)
        labeledInput.append(suiteID)
        labeledInput.append(label)
        labeledInput.append(inputKeyMaterial)
        defer { zero(&labeledInput) }

        let key = SymmetricKey(data: salt)
        return Data(HMAC<SHA256>.authenticationCode(for: labeledInput, using: key))
    }

    private static func labeledExpand(
        pseudoRandomKey: Data,
        suiteID: Data,
        label: Data,
        info: Data,
        outputByteCount: Int
    ) throws -> Data {
        guard (0...32).contains(outputByteCount), outputByteCount <= Int(UInt16.max) else {
            throw CryptoAuthorityError.invalidHPKEInput
        }

        var labeledInfo = Data()
        let capacity = try checkedCapacity(
            2,
            versionLabel.count,
            suiteID.count,
            label.count,
            info.count,
            1
        )
        labeledInfo.reserveCapacity(capacity)
        appendUInt16(UInt16(outputByteCount), to: &labeledInfo)
        labeledInfo.append(versionLabel)
        labeledInfo.append(suiteID)
        labeledInfo.append(label)
        labeledInfo.append(info)
        labeledInfo.append(0x01)
        defer { zero(&labeledInfo) }

        let key = SymmetricKey(data: pseudoRandomKey)
        let block = HMAC<SHA256>.authenticationCode(for: labeledInfo, using: key)
        return Data(block.prefix(outputByteCount))
    }

    private static func checkedCapacity(_ counts: Int...) throws -> Int {
        var total = 0
        for count in counts {
            let (next, overflow) = total.addingReportingOverflow(count)
            guard !overflow else {
                throw CryptoAuthorityError.invalidHPKEInput
            }
            total = next
        }
        return total
    }

    private static func appendUInt16(_ value: UInt16, to data: inout Data) {
        data.append(UInt8(truncatingIfNeeded: value >> 8))
        data.append(UInt8(truncatingIfNeeded: value))
    }

    private static func zero(_ data: inout Data) {
        data.resetBytes(in: data.startIndex..<data.endIndex)
    }
}

public enum AuthorityEd25519 {
    static func sign(
        _ message: Data,
        using privateKey: Curve25519.Signing.PrivateKey
    ) throws -> Data {
        do {
            return try privateKey.signature(for: message)
        } catch {
            throw CryptoAuthorityError.signingFailed
        }
    }
}

public final class CryptoAuthority {
    public static let maximumGDMPasswordByteCount = 4_096

    private let keychainAuthority: KeychainAuthority

    public init(keychainAuthority: KeychainAuthority) {
        self.keychainAuthority = keychainAuthority
    }

    public func makeGDMEnvelope(
        for request: ExecutionRequest,
        challenge: GDMChallenge,
        issueID: String,
        sentinel: String,
        password: inout [UInt8],
        recipientKeyID: String,
        recipientPublicKey: Data
    ) throws -> GDMEnvelope {
        defer { Self.zero(&password) }

        do {
            try request.validate()
        } catch {
            throw CryptoAuthorityError.invalidGDMRequest
        }
        guard request.domain == .desktopBrowser,
              request.operation == .gdmLogin,
              case .gdm(let target) = request.target
        else {
            throw CryptoAuthorityError.invalidGDMRequest
        }

        do {
            try challenge.validate()
        } catch {
            throw CryptoAuthorityError.invalidGDMChallenge
        }
        guard target.bootId == challenge.bootId else {
            throw CryptoAuthorityError.invalidGDMChallenge
        }
        guard isValidGDMSentinel(sentinel) else {
            throw CryptoAuthorityError.invalidGDMSentinel
        }

        let requestTranscript = try ProtocolTranscript.executionRequest(request)
        let hpkeInfo = try ProtocolTranscript.gdmHPKEInfo(
            GDMHPKEInfo(recipientKeyId: recipientKeyID)
        )
        let sentinelHash = ProtocolCrypto.sha256Hex(Data(sentinel.utf8))
        let hpkeAAD = try ProtocolTranscript.gdmHPKEAAD(
            GDMHPKEAADInput(
                requestTranscript: requestTranscript,
                challenge: challenge,
                issueId: issueID,
                sentinelHash: sentinelHash
            )
        )

        var plaintext = try Self.makeGDMPlaintext(password: password, sentinel: sentinel)
        defer { Self.zero(&plaintext) }
        let sealed = try AuthorityHPKE.seal(
            recipientPublicKey: recipientPublicKey,
            plaintext: plaintext,
            info: hpkeInfo,
            authenticatedData: hpkeAAD
        )

        return try keychainAuthority.withSigningKey(domain: .desktopBrowser) { signingKeyID, privateKey in
            let signatureTranscript = try ProtocolTranscript.gdmEnvelopeSignature(
                try GDMEnvelopeSignatureInput(
                    hpkeAadTranscript: hpkeAAD,
                    hpkeEnc: sealed.encapsulatedKey,
                    ciphertext: sealed.ciphertext,
                    signingKeyId: signingKeyID
                )
            )
            let signature = try AuthorityEd25519.sign(signatureTranscript, using: privateKey)
            let envelope = GDMEnvelope(
                request: request,
                challenge: challenge,
                issueId: issueID,
                sentinelHash: sentinelHash,
                hpkeEnc: AuthorityBase64URL.encode(sealed.encapsulatedKey),
                ciphertext: AuthorityBase64URL.encode(sealed.ciphertext),
                signingKeyId: signingKeyID,
                signature: AuthorityBase64URL.encode(signature)
            )
            try envelope.validate()
            return envelope
        }
    }

    public func makeSudoSignedRequest(for request: ExecutionRequest) throws -> SudoSignedRequest {
        do {
            try request.validate()
        } catch {
            throw CryptoAuthorityError.invalidSudoRequest
        }
        guard request.domain == .sudo,
              request.operation == .sudo,
              case .sudo = request.target
        else {
            throw CryptoAuthorityError.invalidSudoRequest
        }

        let requestTranscript = try ProtocolTranscript.executionRequest(request)
        let canonicalBodyDigest = ProtocolCrypto.sha256Hex(requestTranscript)
        return try keychainAuthority.withSigningKey(domain: .sudo) { signingKeyID, privateKey in
            let signature = try AuthorityEd25519.sign(requestTranscript, using: privateKey)
            let signedRequest = SudoSignedRequest(
                request: request,
                canonicalBodyDigest: canonicalBodyDigest,
                signingKeyId: signingKeyID,
                signature: AuthorityBase64URL.encode(signature)
            )
            try signedRequest.validate()
            return signedRequest
        }
    }

    private static func makeGDMPlaintext(password: [UInt8], sentinel: String) throws -> Data {
        guard !password.isEmpty,
              password.count <= maximumGDMPasswordByteCount,
              password.count <= Int(UInt32.max)
        else {
            throw CryptoAuthorityError.invalidGDMPlaintext
        }
        let sentinelByteCount = sentinel.utf8.count
        guard sentinelByteCount <= Int(UInt16.max) else {
            throw CryptoAuthorityError.invalidGDMPlaintext
        }

        let fixedByteCount = 8 + 4 + 2
        let (withPassword, passwordOverflow) = fixedByteCount.addingReportingOverflow(password.count)
        let (totalByteCount, sentinelOverflow) = withPassword.addingReportingOverflow(sentinelByteCount)
        guard !passwordOverflow,
              !sentinelOverflow,
              totalByteCount <= HPKEV1.maximumCiphertextByteCount - HPKEV1.authenticationTagByteCount
        else {
            throw CryptoAuthorityError.invalidGDMPlaintext
        }

        var plaintext = Data()
        plaintext.reserveCapacity(totalByteCount)
        plaintext.append(contentsOf: [0x52, 0x41, 0x42, 0x47, 0x44, 0x4d, 0x31, 0x00])
        appendUInt32(UInt32(password.count), to: &plaintext)
        password.withUnsafeBytes { bytes in
            plaintext.append(contentsOf: bytes)
        }
        appendUInt16(UInt16(sentinelByteCount), to: &plaintext)
        plaintext.append(contentsOf: sentinel.utf8)
        return plaintext
    }

    private static func appendUInt16(_ value: UInt16, to data: inout Data) {
        data.append(UInt8(truncatingIfNeeded: value >> 8))
        data.append(UInt8(truncatingIfNeeded: value))
    }

    private static func appendUInt32(_ value: UInt32, to data: inout Data) {
        data.append(UInt8(truncatingIfNeeded: value >> 24))
        data.append(UInt8(truncatingIfNeeded: value >> 16))
        data.append(UInt8(truncatingIfNeeded: value >> 8))
        data.append(UInt8(truncatingIfNeeded: value))
    }

    private static func zero(_ data: inout Data) {
        data.resetBytes(in: data.startIndex..<data.endIndex)
    }

    private static func zero(_ bytes: inout [UInt8]) {
        bytes.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
}
