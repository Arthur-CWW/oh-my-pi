import CryptoKit
import Foundation

enum TLSCertificateAttestation {
    private static let maximumChainLength = 8
    private static let maximumCertificateBytes = 64 * 1_024

    static func attest(
        certificateChainBase64: [String],
        expectedSPKISHA256: String
    ) throws {
        guard (1...maximumChainLength).contains(certificateChainBase64.count),
              let encodedLeaf = certificateChainBase64.first,
              !encodedLeaf.isEmpty,
              encodedLeaf.utf8.count <= maximumCertificateBytes * 2,
              let leaf = Data(base64Encoded: encodedLeaf),
              !leaf.isEmpty,
              leaf.count <= maximumCertificateBytes,
              leaf.base64EncodedString() == encodedLeaf
        else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        let actual = try spkiSHA256Hex(certificateDER: leaf)
        guard constantTimeEqual(actual, expectedSPKISHA256) else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
    }

    static func spkiSHA256Hex(certificateDER: Data) throws -> String {
        let range = try subjectPublicKeyInfoRange(in: certificateDER)
        let digest = SHA256.hash(data: certificateDER[range])
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func subjectPublicKeyInfoDER(in certificateDER: Data) throws -> Data {
        let range = try subjectPublicKeyInfoRange(in: certificateDER)
        return Data(certificateDER[range])
    }

    private static func subjectPublicKeyInfoRange(in certificate: Data) throws -> Range<Int> {
        guard !certificate.isEmpty, certificate.count <= maximumCertificateBytes else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        let outer = try readTLV(certificate, at: 0, upperBound: certificate.count)
        guard outer.tag == 0x30, outer.fullRange == 0..<certificate.count else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        let tbs = try readTLV(
            certificate,
            at: outer.contentRange.lowerBound,
            upperBound: outer.contentRange.upperBound
        )
        guard tbs.tag == 0x30 else {
            throw JetKVMCloudError.tlsIdentityRejected
        }

        var cursor = tbs.contentRange.lowerBound
        if cursor < tbs.contentRange.upperBound, certificate[cursor] == 0xa0 {
            cursor = try readTLV(
                certificate,
                at: cursor,
                upperBound: tbs.contentRange.upperBound
            ).fullRange.upperBound
        }
        let requiredTags: [UInt8] = [0x02, 0x30, 0x30, 0x30, 0x30]
        for requiredTag in requiredTags {
            let field = try readTLV(
                certificate,
                at: cursor,
                upperBound: tbs.contentRange.upperBound
            )
            guard field.tag == requiredTag else {
                throw JetKVMCloudError.tlsIdentityRejected
            }
            cursor = field.fullRange.upperBound
        }
        let subjectPublicKeyInfo = try readTLV(
            certificate,
            at: cursor,
            upperBound: tbs.contentRange.upperBound
        )
        guard subjectPublicKeyInfo.tag == 0x30 else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        return subjectPublicKeyInfo.fullRange
    }

    private static func readTLV(
        _ data: Data,
        at offset: Int,
        upperBound: Int
    ) throws -> DERElement {
        guard offset >= 0, upperBound <= data.count, offset < upperBound else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        let tag = data[offset]
        guard tag & 0x1f != 0x1f else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        let lengthOffset = offset + 1
        guard lengthOffset < upperBound else {
            throw JetKVMCloudError.tlsIdentityRejected
        }

        let initialLength = data[lengthOffset]
        let contentOffset: Int
        let contentLength: Int
        if initialLength & 0x80 == 0 {
            contentOffset = lengthOffset + 1
            contentLength = Int(initialLength)
        } else {
            let octetCount = Int(initialLength & 0x7f)
            guard (1...4).contains(octetCount),
                  lengthOffset + octetCount < upperBound,
                  data[lengthOffset + 1] != 0
            else {
                throw JetKVMCloudError.tlsIdentityRejected
            }
            var length = 0
            for index in 0..<octetCount {
                let shifted = length.multipliedReportingOverflow(by: 256)
                guard !shifted.overflow else {
                    throw JetKVMCloudError.tlsIdentityRejected
                }
                let added = shifted.partialValue.addingReportingOverflow(
                    Int(data[lengthOffset + 1 + index])
                )
                guard !added.overflow else {
                    throw JetKVMCloudError.tlsIdentityRejected
                }
                length = added.partialValue
            }
            guard length >= 128 else {
                throw JetKVMCloudError.tlsIdentityRejected
            }
            contentOffset = lengthOffset + 1 + octetCount
            contentLength = length
        }
        let end = contentOffset.addingReportingOverflow(contentLength)
        guard !end.overflow, end.partialValue <= upperBound else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        return DERElement(
            tag: tag,
            fullRange: offset..<end.partialValue,
            contentRange: contentOffset..<end.partialValue
        )
    }

    private static func constantTimeEqual(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.utf8)
        let right = Array(rhs.utf8)
        guard left.count == right.count else { return false }
        var difference: UInt8 = 0
        for index in left.indices {
            difference |= left[index] ^ right[index]
        }
        return difference == 0
    }

    private struct DERElement {
        let tag: UInt8
        let fullRange: Range<Int>
        let contentRange: Range<Int>
    }
}
