import CryptoKit
import Foundation
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class MacAuthorityPureTests: XCTestCase {
    func testRFC9180DHKEMX25519HKDFSHA256ChaCha20Poly1305Fixture() throws {
        let request = fixtureGDMRequest()
        let challenge = fixtureGDMChallenge()
        let requestTranscript = try ProtocolTranscript.executionRequest(request)
        let info = try ProtocolTranscript.gdmHPKEInfo(
            GDMHPKEInfo(recipientKeyId: "EBESExQVFhcYGRobHB0eHw")
        )
        let aad = try ProtocolTranscript.gdmHPKEAAD(
            GDMHPKEAADInput(
                requestTranscript: requestTranscript,
                challenge: challenge,
                issueId: "wMHCw8TFxsfIycrLzM3Ozw",
                sentinelHash: "c161194a55a7794908cd02e9813b65974dbb7a979ed366f04918607fa456e081"
            )
        )
        let recipientPublicKey = try AuthorityBase64URL.decode(
            "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw"
        )
        let ephemeralPrivateKey = try AuthorityBase64URL.decode(
            "ZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5_gIGCg4Q"
        )
        let plaintext = Data(0xa0...0xbf)

        let sealed = try AuthorityHPKE.seal(
            recipientPublicKey: recipientPublicKey,
            plaintext: plaintext,
            info: info,
            authenticatedData: aad,
            ephemeralPrivateKeyRawRepresentation: ephemeralPrivateKey
        )

        XCTAssertEqual(
            AuthorityBase64URL.encode(sealed.encapsulatedKey),
            "VxR2nRFr92Q2rnS8eT0sMK0ZA8WaxSc4BcfiaYtBDDY"
        )
        XCTAssertEqual(
            AuthorityBase64URL.encode(sealed.ciphertext),
            "6HcLpp7OrfOF7eSlp1sB_h3qqhgjrVpmG5d7CuwfU0BTtjmCq0tTRP05WHMG8LbA"
        )
        XCTAssertEqual(sealed.ciphertext.count, plaintext.count + HPKEV1.authenticationTagByteCount)
    }

    func testRFC8032Ed25519KnownVector() throws {
        let privateKey = try Curve25519.Signing.PrivateKey(
            rawRepresentation: data(hex: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
        )
        XCTAssertEqual(
            privateKey.publicKey.rawRepresentation,
            data(hex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        )

        let signature = try AuthorityEd25519.sign(Data(), using: privateKey)

        let expectedSignature = data(hex: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        XCTAssertTrue(privateKey.publicKey.isValidSignature(expectedSignature, for: Data()))
        XCTAssertTrue(privateKey.publicKey.isValidSignature(signature, for: Data()))
    }

    func testGDMFixtureSignatureCoversCanonicalEnvelopeTranscript() throws {
        let requestTranscript = try ProtocolTranscript.executionRequest(fixtureGDMRequest())
        let aad = try ProtocolTranscript.gdmHPKEAAD(
            GDMHPKEAADInput(
                requestTranscript: requestTranscript,
                challenge: fixtureGDMChallenge(),
                issueId: "wMHCw8TFxsfIycrLzM3Ozw",
                sentinelHash: "c161194a55a7794908cd02e9813b65974dbb7a979ed366f04918607fa456e081"
            )
        )
        let encapsulatedKey = try AuthorityBase64URL.decode(
            "VxR2nRFr92Q2rnS8eT0sMK0ZA8WaxSc4BcfiaYtBDDY"
        )
        let ciphertext = try AuthorityBase64URL.decode(
            "6HcLpp7OrfOF7eSlp1sB_h3qqhgjrVpmG5d7CuwfU0BTtjmCq0tTRP05WHMG8LbA"
        )
        let signatureTranscript = try ProtocolTranscript.gdmEnvelopeSignature(
            GDMEnvelopeSignatureInput(
                hpkeAadTranscript: aad,
                hpkeEnc: encapsulatedKey,
                ciphertext: ciphertext,
                signingKeyId: "UFFSU1RVVldYWVpbXF1eXw"
            )
        )
        let privateKey = try Curve25519.Signing.PrivateKey(
            rawRepresentation: AuthorityBase64URL.decode(
                "4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8"
            )
        )

        let signature = try AuthorityEd25519.sign(signatureTranscript, using: privateKey)

        let expectedSignature = try AuthorityBase64URL.decode(
            "OovO6OH36TsIfr-L1Ap66CD7wwuuUnEo4IeKIW3fNyYcj4e2STcs9tmXkWyMeq_fpjozhng3XAaxjVgvNgusBg"
        )
        XCTAssertTrue(privateKey.publicKey.isValidSignature(expectedSignature, for: signatureTranscript))
        XCTAssertTrue(privateKey.publicKey.isValidSignature(signature, for: signatureTranscript))
        var alteredCiphertext = ciphertext
        alteredCiphertext[alteredCiphertext.startIndex] ^= 0x01
        let alteredTranscript = try ProtocolTranscript.gdmEnvelopeSignature(
            GDMEnvelopeSignatureInput(
                hpkeAadTranscript: aad,
                hpkeEnc: encapsulatedKey,
                ciphertext: alteredCiphertext,
                signingKeyId: "UFFSU1RVVldYWVpbXF1eXw"
            )
        )
        XCTAssertFalse(privateKey.publicKey.isValidSignature(signature, for: alteredTranscript))
    }

    func testSudoSignatureUsesExactCanonicalExecutionRequestTranscript() throws {
        let request = fixtureSudoRequest()
        let transcript = try ProtocolTranscript.executionRequest(request)
        let privateKey = try Curve25519.Signing.PrivateKey(
            rawRepresentation: AuthorityBase64URL.decode(
                "4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8"
            )
        )

        let signature = try AuthorityEd25519.sign(transcript, using: privateKey)

        XCTAssertEqual(
            ProtocolCrypto.sha256Hex(transcript),
            "15170d1e1d9f9c34caf33b0583bf3797cdb93feebb060dce50bb5051ca69eacd"
        )
        let expectedSignature = try AuthorityBase64URL.decode(
            "7jl7kPIIpURGleJa7Jcy8YOJAY8YARjIRuO5F0LWHHe_ptWEZBU7-jgUr2bJ8r9R-PPVB7d_xDRrvGmEIqxmAQ"
        )
        XCTAssertTrue(privateKey.publicKey.isValidSignature(expectedSignature, for: transcript))
        XCTAssertTrue(privateKey.publicKey.isValidSignature(signature, for: transcript))
        var alteredRequest = request
        alteredRequest.purpose = "credential-free sudo protocol fixture altered"
        let alteredTranscript = try ProtocolTranscript.executionRequest(alteredRequest)
        XCTAssertFalse(privateKey.publicKey.isValidSignature(signature, for: alteredTranscript))
        XCTAssertFalse(privateKey.publicKey.isValidSignature(expectedSignature, for: alteredTranscript))
    }

    func testCanonicalBase64URLRoundTripsAndHasNoPadding() throws {
        let bytes = Data((0...255).map(UInt8.init))
        let encoded = AuthorityBase64URL.encode(bytes)

        XCTAssertFalse(encoded.contains("="))
        XCTAssertFalse(encoded.contains("+"))
        XCTAssertFalse(encoded.contains("/"))
        XCTAssertEqual(try AuthorityBase64URL.decode(encoded), bytes)
        XCTAssertEqual(AuthorityBase64URL.encode(Data()), "")
        XCTAssertEqual(try AuthorityBase64URL.decode(""), Data())
        XCTAssertEqual(try AuthorityBase64URL.decode("_w"), Data([0xff]))
    }

    func testCanonicalBase64URLRejectsPaddingAlphabetWhitespaceAndNonzeroPadBits() {
        let rejected = [
            "A",
            "AB",
            "AAB",
            "AA=",
            "AA==",
            "AA+",
            "AA/",
            "AA\n",
            " AA",
            "AA ",
            "é",
        ]

        for value in rejected {
            XCTAssertThrowsError(try AuthorityBase64URL.decode(value), value)
        }
    }

    func testPeerIdentityComparatorRejectsEveryAuthorityFieldMismatch() {
        let expected = ExpectedPeerIdentity(
            uid: 501,
            signingIdentifier: "com.openai.omp",
            teamIdentifier: "TEAMIDENTIFIER",
            executableSHA256: String(repeating: "a", count: 64)
        )
        XCTAssertTrue(PeerIdentityComparator.matches(attestedPeer(), expected: expected))
        XCTAssertFalse(
            PeerIdentityComparator.matches(attestedPeer(uid: 502), expected: expected),
            "uid mismatch must fail closed"
        )
        XCTAssertFalse(
            PeerIdentityComparator.matches(
                attestedPeer(signingIdentifier: "com.openai.other"),
                expected: expected
            ),
            "signing identifier mismatch must fail closed"
        )
        XCTAssertFalse(
            PeerIdentityComparator.matches(
                attestedPeer(teamIdentifier: "OTHERTEAM"),
                expected: expected
            ),
            "team identifier mismatch must fail closed"
        )
        XCTAssertFalse(
            PeerIdentityComparator.matches(
                attestedPeer(executableSHA256: String(repeating: "b", count: 64)),
                expected: expected
            ),
            "build digest mismatch must fail closed"
        )
    }

    func testErrorDescriptionsNeverEchoRejectedInput() {
        let canary = "CANARY:credential-material-must-not-appear"
        XCTAssertThrowsError(try AuthorityBase64URL.decode(canary)) { error in
            XCTAssertFalse(String(describing: error).contains(canary))
            XCTAssertFalse((error as NSError).localizedDescription.contains(canary))
        }
        for error in CryptoAuthorityError.allCases {
            XCTAssertFalse(error.description.contains(canary))
            XCTAssertFalse(error.localizedDescription.contains(canary))
        }
    }

    private func fixtureGDMRequest() -> ExecutionRequest {
        ExecutionRequest(
            requestId: "AAECAwQFBgcICQoLDA0ODw",
            nonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            createdAt: 1_700_000_000_000,
            expiresAt: 1_700_000_060_000,
            principal: Principal(
                sessionId: "session-fixture-v1",
                ownerEpoch: "00112233-4455-4677-8899-aabbccddeeff",
                pid: 4_242,
                uid: 501,
                codeIdentity: "com.openai.omp.fixture",
                buildDigest: String(repeating: "1", count: 64),
                runnerInstanceIdentity: "runner-fixture-v1",
                ownershipSocketPath: "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock"
            ),
            authorizationModeRequested: .delegated,
            domain: .desktopBrowser,
            operation: .gdmLogin,
            target: .gdm(
                GDMTarget(
                    sshHostKeyDigest: String(repeating: "2", count: 64),
                    machineId: "ubuntu-fixture-machine",
                    bootId: "ubuntu-fixture-boot",
                    username: "fixture-user",
                    uid: 1_000,
                    seat: "seat0",
                    tty: "/dev/tty1",
                    rhost: .empty,
                    greeterGeneration: 19,
                    jetkvmDeviceId: "jetkvm-fixture-device",
                    controllerGeneration: 23
                )
            ),
            purpose: "credential-free GDM protocol fixture",
            grantId: "grant-v1:ICEiIyQlJicoKSorLC0uLw"
        )
    }

    private func fixtureGDMChallenge() -> GDMChallenge {
        GDMChallenge(
            challengeId: "QEFCQ0RFRkdISUpLTE1OTw",
            challenge: "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8",
            bootId: "ubuntu-fixture-boot",
            issuedBoottimeMs: 500_000,
            expiresBoottimeMs: 520_000,
            policyDigest: String(repeating: "6", count: 64)
        )
    }

    private func fixtureSudoRequest() -> ExecutionRequest {
        ExecutionRequest(
            requestId: "gIGCg4SFhoeIiYqLjI2Ojw",
            nonce: "_wABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4",
            createdAt: 1_700_000_100_000,
            expiresAt: 1_700_000_160_000,
            principal: Principal(
                sessionId: "session-fixture-v1",
                ownerEpoch: "ffeeddcc-bbaa-4988-8776-554433221100",
                pid: 4_242,
                uid: 501,
                codeIdentity: "com.openai.omp.fixture",
                buildDigest: String(repeating: "1", count: 64),
                runnerInstanceIdentity: "runner-fixture-v1",
                ownershipSocketPath: "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock"
            ),
            authorizationModeRequested: .biometricOneShot,
            domain: .sudo,
            operation: .sudo,
            target: .sudo(
                SudoTarget(
                    sshHostKeyDigest: String(repeating: "3", count: 64),
                    machineId: "ubuntu-fixture-machine",
                    bootId: "ubuntu-fixture-boot",
                    username: "fixture-user",
                    uid: 1_000,
                    sudoPolicyDigest: String(repeating: "4", count: 64),
                    actionId: "fixture-safe-status",
                    executable: "/usr/libexec/remote-auth-broker/fixture-safe-status",
                    argvDigest: String(repeating: "5", count: 64)
                )
            ),
            purpose: "credential-free sudo protocol fixture",
            grantId: nil
        )
    }

    private func attestedPeer(
        uid: UInt32 = 501,
        signingIdentifier: String = "com.openai.omp",
        teamIdentifier: String = "TEAMIDENTIFIER",
        executableSHA256: String = String(repeating: "a", count: 64)
    ) -> AttestedPeer {
        AttestedPeer(
            uid: uid,
            gid: 20,
            pid: 4_242,
            signingIdentifier: signingIdentifier,
            teamIdentifier: teamIdentifier,
            designatedRequirement: "anchor apple generic",
            executableSHA256: executableSHA256
        )
    }

    private func data(hex: String) -> Data {
        precondition(hex.utf8.count.isMultiple(of: 2))
        var result = Data()
        result.reserveCapacity(hex.utf8.count / 2)
        var highNibble: UInt8?
        for byte in hex.utf8 {
            let nibble: UInt8
            switch byte {
            case 0x30...0x39: nibble = byte - 0x30
            case 0x61...0x66: nibble = byte - 0x61 + 10
            default: preconditionFailure("non-hex test vector")
            }
            if let high = highNibble {
                result.append((high << 4) | nibble)
                highNibble = nil
            } else {
                highNibble = nibble
            }
        }
        return result
    }
}
