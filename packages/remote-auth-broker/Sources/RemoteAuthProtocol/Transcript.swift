import CryptoKit
import Foundation

private enum TranscriptDomain {
    static let desktopBrowserRequest = "remote-auth-broker/v1/desktop-browser/execution-request"
    static let sudoRequest = "remote-auth-broker/v1/sudo/execution-request"
    static let gdmHPKEInfo = "remote-auth-broker/v1/desktop-browser/gdm-hpke-info"
    static let gdmHPKEAAD = "remote-auth-broker/v1/desktop-browser/gdm-hpke-aad"
    static let gdmEnvelopeSignature = "remote-auth-broker/v1/desktop-browser/gdm-envelope-signature"
}

private struct TranscriptWriter {
    private(set) var data: Data

    init(capacity: Int) {
        data = Data()
        data.reserveCapacity(capacity)
    }

    mutating func appendHeader(domain: String) throws {
        data.append(0x52)
        data.append(0x41)
        data.append(0x42)
        data.append(0x31)
        let bytes = domain.utf8
        guard bytes.count <= Int(UInt16.max) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        appendUInt16(UInt16(bytes.count))
        data.append(contentsOf: bytes)
    }

    mutating func appendString(_ name: String, _ value: String) throws {
        let bytes = value.utf8
        try appendFieldHeader(name, valueByteCount: bytes.count)
        data.append(contentsOf: bytes)
    }

    mutating func appendUInt32(_ name: String, _ value: UInt32) throws {
        try appendFieldHeader(name, valueByteCount: 4)
        appendUInt32(value)
    }

    mutating func appendUInt64(_ name: String, _ value: UInt64) throws {
        try appendFieldHeader(name, valueByteCount: 8)
        appendUInt64(value)
    }

    mutating func appendOptionalString(_ name: String, _ value: String?) throws {
        guard let value else {
            try appendFieldHeader(name, valueByteCount: 1)
            data.append(0)
            return
        }

        let bytes = value.utf8
        let (valueByteCount, overflow) = bytes.count.addingReportingOverflow(1)
        guard !overflow else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        try appendFieldHeader(name, valueByteCount: valueByteCount)
        data.append(1)
        data.append(contentsOf: bytes)
    }

    mutating func appendStringArray(_ name: String, _ values: [String]) throws {
        guard values.count <= Int(UInt32.max) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }

        var valueByteCount = 4
        for value in values {
            let byteCount = value.utf8.count
            guard byteCount <= Int(UInt32.max) else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
            let (elementByteCount, elementOverflow) = byteCount.addingReportingOverflow(4)
            let (nextValueByteCount, totalOverflow) = valueByteCount.addingReportingOverflow(elementByteCount)
            guard !elementOverflow, !totalOverflow else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
            valueByteCount = nextValueByteCount
        }

        try appendFieldHeader(name, valueByteCount: valueByteCount)
        appendUInt32(UInt32(values.count))
        for value in values {
            let bytes = value.utf8
            appendUInt32(UInt32(bytes.count))
            data.append(contentsOf: bytes)
        }
    }

    mutating func appendData(_ name: String, _ value: Data) throws {
        try appendFieldHeader(name, valueByteCount: value.count)
        data.append(value)
    }

    private mutating func appendFieldHeader(_ name: String, valueByteCount: Int) throws {
        let nameBytes = name.utf8
        guard nameBytes.count <= Int(UInt16.max),
              valueByteCount >= 0,
              valueByteCount <= Int(UInt32.max)
        else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        appendUInt16(UInt16(nameBytes.count))
        data.append(contentsOf: nameBytes)
        appendUInt32(UInt32(valueByteCount))
    }

    private mutating func appendUInt16(_ value: UInt16) {
        data.append(UInt8(truncatingIfNeeded: value >> 8))
        data.append(UInt8(truncatingIfNeeded: value))
    }

    private mutating func appendUInt32(_ value: UInt32) {
        data.append(UInt8(truncatingIfNeeded: value >> 24))
        data.append(UInt8(truncatingIfNeeded: value >> 16))
        data.append(UInt8(truncatingIfNeeded: value >> 8))
        data.append(UInt8(truncatingIfNeeded: value))
    }

    private mutating func appendUInt64(_ value: UInt64) {
        data.append(UInt8(truncatingIfNeeded: value >> 56))
        data.append(UInt8(truncatingIfNeeded: value >> 48))
        data.append(UInt8(truncatingIfNeeded: value >> 40))
        data.append(UInt8(truncatingIfNeeded: value >> 32))
        data.append(UInt8(truncatingIfNeeded: value >> 24))
        data.append(UInt8(truncatingIfNeeded: value >> 16))
        data.append(UInt8(truncatingIfNeeded: value >> 8))
        data.append(UInt8(truncatingIfNeeded: value))
    }
}

public enum ProtocolTranscript {
    public static func executionRequest(_ request: ExecutionRequest) throws -> Data {
        try request.validate()
        let principal = try encodePrincipal(request.principal)
        let target = try encodeTarget(request.target)
        let domain = request.domain == .desktopBrowser
            ? TranscriptDomain.desktopBrowserRequest
            : TranscriptDomain.sudoRequest

        var writer = TranscriptWriter(capacity: 512 + principal.count + target.count)
        try writer.appendHeader(domain: domain)
        try writer.appendUInt32("protocolVersion", request.protocolVersion)
        try writer.appendString("requestId", request.requestId)
        try writer.appendString("nonce", request.nonce)
        try writer.appendUInt64("createdAt", request.createdAt)
        try writer.appendUInt64("expiresAt", request.expiresAt)
        try writer.appendData("principal", principal)
        try writer.appendString("authorizationModeRequested", request.authorizationModeRequested.rawValue)
        try writer.appendString("domain", request.domain.rawValue)
        try writer.appendString("operation", request.operation.rawValue)
        try writer.appendData("target", target)
        try writer.appendString("purpose", request.purpose)
        try writer.appendOptionalString("grantId", request.grantId)
        return writer.data
    }

    public static func gdmHPKEInfo(_ input: GDMHPKEInfo) throws -> Data {
        try input.validate()

        var writer = TranscriptWriter(capacity: 160)
        try writer.appendHeader(domain: TranscriptDomain.gdmHPKEInfo)
        try writer.appendUInt32("protocolVersion", input.protocolVersion)
        try writer.appendString("recipientKeyId", input.recipientKeyId)
        return writer.data
    }

    public static func gdmHPKEAAD(_ input: GDMHPKEAADInput) throws -> Data {
        try input.validate()
        let challenge = try encodeChallenge(input.challenge)

        var writer = TranscriptWriter(capacity: 256 + input.requestTranscript.count + challenge.count)
        try writer.appendHeader(domain: TranscriptDomain.gdmHPKEAAD)
        try writer.appendData("requestTranscript", input.requestTranscript)
        try writer.appendData("challenge", challenge)
        try writer.appendString("issueId", input.issueId)
        try writer.appendString("sentinelHash", input.sentinelHash)
        return writer.data
    }

    public static func gdmEnvelopeSignature(_ input: GDMEnvelopeSignatureInput) throws -> Data {
        try input.validate()

        let (firstCapacity, firstOverflow) = input.hpkeAadTranscript.count.addingReportingOverflow(input.hpkeEnc.count)
        let (secondCapacity, secondOverflow) = firstCapacity.addingReportingOverflow(input.ciphertext.count)
        guard !firstOverflow, !secondOverflow else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        var writer = TranscriptWriter(capacity: 256 + secondCapacity)
        try writer.appendHeader(domain: TranscriptDomain.gdmEnvelopeSignature)
        try writer.appendData("hpkeAadTranscript", input.hpkeAadTranscript)
        try writer.appendData("hpkeEnc", input.hpkeEnc)
        try writer.appendData("ciphertext", input.ciphertext)
        try writer.appendString("signingKeyId", input.signingKeyId)
        return writer.data
    }

    private static func encodePrincipal(_ principal: Principal) throws -> Data {
        var writer = TranscriptWriter(capacity: 384)
        try writer.appendString("sessionId", principal.sessionId)
        try writer.appendString("ownerEpoch", principal.ownerEpoch)
        try writer.appendUInt32("pid", principal.pid)
        try writer.appendUInt32("uid", principal.uid)
        try writer.appendString("codeIdentity", principal.codeIdentity)
        try writer.appendString("buildDigest", principal.buildDigest)
        try writer.appendString("runnerInstanceIdentity", principal.runnerInstanceIdentity)
        try writer.appendString("ownershipSocketPath", principal.ownershipSocketPath)
        return writer.data
    }

    private static func encodeTarget(_ target: ExecutionTarget) throws -> Data {
        switch target {
        case .gdm(let value):
            var writer = TranscriptWriter(capacity: 640)
            try writer.appendString("kind", "gdm")
            try writer.appendString("sshHostKeyDigest", value.sshHostKeyDigest)
            try writer.appendString("machineId", value.machineId)
            try writer.appendString("bootId", value.bootId)
            try writer.appendString("username", value.username)
            try writer.appendUInt32("uid", value.uid)
            try writer.appendString("pamService", value.pamService)
            try writer.appendString("seat", value.seat)
            try writer.appendString("tty", value.tty)
            try writer.appendString("rhost", value.rhost.rawValue)
            try writer.appendUInt64("greeterGeneration", value.greeterGeneration)
            try writer.appendString("jetkvmDeviceId", value.jetkvmDeviceId)
            try writer.appendUInt64("controllerGeneration", value.controllerGeneration)
            return writer.data

        case .bitwarden(let value):
            var writer = TranscriptWriter(capacity: 768)
            try writer.appendString("kind", "bitwarden")
            try appendBrowserBinding(value, to: &writer)
            return writer.data

        case .website(let value):
            var writer = TranscriptWriter(capacity: 1_024)
            try writer.appendString("kind", "website")
            try appendBrowserBinding(value, to: &writer)
            try writer.appendStringArray("originSet", value.originSet)
            try writer.appendString("activeTabId", value.activeTabId)
            try writer.appendString("frameId", value.frameId)
            try writer.appendString("formActionOrigin", value.formActionOrigin)
            try writer.appendString("foregroundWindowId", value.foregroundWindowId)
            try writer.appendString("credentialPairingId", value.credentialPairingId)
            return writer.data

        case .sudo(let value):
            var writer = TranscriptWriter(capacity: 640)
            try writer.appendString("kind", "sudo")
            try writer.appendString("sshHostKeyDigest", value.sshHostKeyDigest)
            try writer.appendString("machineId", value.machineId)
            try writer.appendString("bootId", value.bootId)
            try writer.appendString("username", value.username)
            try writer.appendUInt32("uid", value.uid)
            try writer.appendString("sudoPolicyDigest", value.sudoPolicyDigest)
            try writer.appendString("actionId", value.actionId)
            try writer.appendString("executable", value.executable)
            try writer.appendString("argvDigest", value.argvDigest)
            return writer.data
        }
    }

    private static func appendBrowserBinding(_ value: BitwardenTarget, to writer: inout TranscriptWriter) throws {
        try writer.appendString("hostIdentity", value.hostIdentity)
        try writer.appendString("graphicalSessionId", value.graphicalSessionId)
        try writer.appendString("chromeService", value.chromeService)
        try writer.appendString("chromeExecutableDigest", value.chromeExecutableDigest)
        try writer.appendUInt32("chromePid", value.chromePid)
        try writer.appendString("profileIdentity", value.profileIdentity)
        try writer.appendString("browserTargetId", value.browserTargetId)
        try writer.appendString("windowId", value.windowId)
        try writer.appendString("extensionId", value.extensionId)
        try writer.appendString("extensionVersion", value.extensionVersion)
        try writer.appendString("extensionSource", value.extensionSource)
        try writer.appendString("manifestDigest", value.manifestDigest)
        try writer.appendString("uiTarget", value.uiTarget)
    }

    private static func appendBrowserBinding(_ value: WebsiteTarget, to writer: inout TranscriptWriter) throws {
        try writer.appendString("hostIdentity", value.hostIdentity)
        try writer.appendString("graphicalSessionId", value.graphicalSessionId)
        try writer.appendString("chromeService", value.chromeService)
        try writer.appendString("chromeExecutableDigest", value.chromeExecutableDigest)
        try writer.appendUInt32("chromePid", value.chromePid)
        try writer.appendString("profileIdentity", value.profileIdentity)
        try writer.appendString("browserTargetId", value.browserTargetId)
        try writer.appendString("windowId", value.windowId)
        try writer.appendString("extensionId", value.extensionId)
        try writer.appendString("extensionVersion", value.extensionVersion)
        try writer.appendString("extensionSource", value.extensionSource)
        try writer.appendString("manifestDigest", value.manifestDigest)
        try writer.appendString("uiTarget", value.uiTarget)
    }

    private static func encodeChallenge(_ challenge: GDMChallenge) throws -> Data {
        var writer = TranscriptWriter(capacity: 384)
        try writer.appendUInt32("protocolVersion", challenge.protocolVersion)
        try writer.appendString("challengeId", challenge.challengeId)
        try writer.appendString("challenge", challenge.challenge)
        try writer.appendString("bootId", challenge.bootId)
        try writer.appendUInt64("issuedBoottimeMs", challenge.issuedBoottimeMs)
        try writer.appendUInt64("expiresBoottimeMs", challenge.expiresBoottimeMs)
        try writer.appendString("policyDigest", challenge.policyDigest)
        return writer.data
    }

}

public enum ProtocolCrypto {
    public static func sha256Hex(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)
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

    public static func base64URLData(_ value: String) throws -> Data {
        guard let decoded = decodeCanonicalBase64URL(value.utf8) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        return decoded
    }

    public static func verifyEd25519(signature: Data, publicKey: Data, message: Data) throws -> Bool {
        guard signature.count == 64, publicKey.count == 32 else {
            throw RemoteAuthProtocolError(.signatureInvalid)
        }
        do {
            let key = try Curve25519.Signing.PublicKey(rawRepresentation: publicKey)
            return key.isValidSignature(signature, for: message)
        } catch {
            throw RemoteAuthProtocolError(.signatureInvalid)
        }
    }
}

public extension HPKEV1 {
    static let maximumCiphertextByteCount = 393_216
    static let kemSuiteIdentifier = Data([0x4b, 0x45, 0x4d, 0x00, 0x20])
    static let suiteIdentifier = Data([0x48, 0x50, 0x4b, 0x45, 0x00, 0x20, 0x00, 0x01, 0x00, 0x03])

    static func validateRecipientPublicKey(_ key: Data) throws {
        guard key.count == recipientPublicKeyByteCount else {
            throw RemoteAuthProtocolError(.ciphertextInvalid)
        }
    }

    static func validateEncapsulatedKey(_ encapsulatedKey: Data) throws {
        guard encapsulatedKey.count == encapsulatedKeyByteCount else {
            throw RemoteAuthProtocolError(.ciphertextInvalid)
        }
    }

    static func validateCiphertext(_ ciphertext: Data) throws {
        guard ciphertext.count >= authenticationTagByteCount,
              ciphertext.count <= maximumCiphertextByteCount
        else {
            throw RemoteAuthProtocolError(.ciphertextInvalid)
        }
    }
}

public func isValidGDMSentinel(_ value: String) -> Bool {
    let prefix = "gdm-broker-v1:".utf8
    let bytes = value.utf8
    guard bytes.count == prefix.count + 43, bytes.starts(with: prefix),
          let payload = decodeCanonicalBase64URL(bytes.dropFirst(prefix.count))
    else {
        return false
    }
    return payload.count == 32
}

private func isBase64URLByte(_ byte: UInt8) -> Bool {
    (byte >= 0x41 && byte <= 0x5a)
        || (byte >= 0x61 && byte <= 0x7a)
        || (byte >= 0x30 && byte <= 0x39)
        || byte == 0x2d
        || byte == 0x5f
}

private func base64URLSextet(_ byte: UInt8) -> UInt32? {
    switch byte {
    case 0x41...0x5a: return UInt32(byte - 0x41)
    case 0x61...0x7a: return UInt32(byte - 0x61 + 26)
    case 0x30...0x39: return UInt32(byte - 0x30 + 52)
    case 0x2d: return 62
    case 0x5f: return 63
    default: return nil
    }
}

private func decodeCanonicalBase64URL<Bytes: Collection>(_ bytes: Bytes) -> Data? where Bytes.Element == UInt8 {
    let encodedByteCount = bytes.count
    guard encodedByteCount > 0, encodedByteCount <= 524_288, encodedByteCount % 4 != 1 else {
        return nil
    }

    let remainder = encodedByteCount % 4
    let decodedByteCount = (encodedByteCount / 4) * 3 + (remainder == 0 ? 0 : remainder - 1)
    var decoded = Data()
    decoded.reserveCapacity(decodedByteCount)
    var accumulator: UInt32 = 0
    var sextetCount = 0

    for byte in bytes {
        guard let sextet = base64URLSextet(byte) else {
            return nil
        }
        accumulator = (accumulator << 6) | sextet
        sextetCount += 1
        if sextetCount == 4 {
            decoded.append(UInt8(truncatingIfNeeded: accumulator >> 16))
            decoded.append(UInt8(truncatingIfNeeded: accumulator >> 8))
            decoded.append(UInt8(truncatingIfNeeded: accumulator))
            accumulator = 0
            sextetCount = 0
        }
    }

    switch sextetCount {
    case 0:
        break
    case 2:
        guard accumulator & 0x0f == 0 else { return nil }
        decoded.append(UInt8(truncatingIfNeeded: accumulator >> 4))
    case 3:
        guard accumulator & 0x03 == 0 else { return nil }
        decoded.append(UInt8(truncatingIfNeeded: accumulator >> 10))
        decoded.append(UInt8(truncatingIfNeeded: accumulator >> 2))
    default:
        return nil
    }
    return decoded
}
