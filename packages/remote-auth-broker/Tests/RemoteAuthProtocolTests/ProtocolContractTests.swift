import Foundation
import XCTest
import RemoteAuthProtocol

final class ProtocolContractTests: XCTestCase {
    func testRequestVectorsRoundTripAndMatchTranscriptsAndDigests() throws {
        for vector in Self.fixture.requestVectors {
            let encoded = try ProtocolJSON.encode(vector.request)
            let decoded = try ProtocolJSON.decode(ExecutionRequest.self, from: encoded)
            XCTAssertEqual(decoded.requestId, vector.request.requestId, vector.name)

            let transcript = try ProtocolTranscript.executionRequest(decoded)
            XCTAssertEqual(transcript, try XCTUnwrap(Data(hex: vector.transcriptHex)), vector.name)
            XCTAssertEqual(ProtocolCrypto.sha256Hex(transcript), vector.sha256, vector.name)
        }
    }

    func testRequestSignatureVectorVerifiesAgainstCredentialFreePublicKey() throws {
        let vector = try XCTUnwrap(Self.fixture.requestVectors.first { $0.ed25519Signature != nil })
        let transcript = try ProtocolTranscript.executionRequest(vector.request)
        let signature = try ProtocolCrypto.base64URLData(try XCTUnwrap(vector.ed25519Signature))
        let publicKey = try ProtocolCrypto.base64URLData(Self.fixture.gdmCryptoVector.ed25519PublicKey)

        XCTAssertTrue(try ProtocolCrypto.verifyEd25519(signature: signature, publicKey: publicKey, message: transcript))

        var altered = transcript
        altered[altered.startIndex] ^= 0x01
        XCTAssertFalse(try ProtocolCrypto.verifyEd25519(signature: signature, publicKey: publicKey, message: altered))

        assertProtocolError(.signatureInvalid) {
            try ProtocolCrypto.verifyEd25519(
                signature: Data(signature.dropLast()),
                publicKey: publicKey,
                message: transcript
            )
        }
        assertProtocolError(.signatureInvalid) {
            try ProtocolCrypto.verifyEd25519(
                signature: signature,
                publicKey: Data(publicKey.dropLast()),
                message: transcript
            )
        }
    }

    func testGDMTranscriptsDigestAndSignatureMatchSharedVector() throws {
        let crypto = Self.fixture.gdmCryptoVector
        let request = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "gdm-delegated" })
        let requestTranscript = try ProtocolTranscript.executionRequest(request.request)

        let info = try ProtocolTranscript.gdmHPKEInfo(
            GDMHPKEInfo(recipientKeyId: crypto.recipientKeyId)
        )
        XCTAssertEqual(info, try XCTUnwrap(Data(hex: crypto.hpkeInfoTranscriptHex)))

        let aad = try ProtocolTranscript.gdmHPKEAAD(
            GDMHPKEAADInput(
                requestTranscript: requestTranscript,
                challenge: crypto.challenge,
                issueId: crypto.issueId,
                sentinelHash: crypto.sentinelHash
            )
        )
        XCTAssertEqual(aad, try XCTUnwrap(Data(hex: crypto.hpkeAadTranscriptHex)))
        XCTAssertEqual(ProtocolCrypto.sha256Hex(Data(crypto.sentinel.utf8)), crypto.sentinelHash)

        let signatureTranscript = try ProtocolTranscript.gdmEnvelopeSignature(
            GDMEnvelopeSignatureInput(
                hpkeAadTranscript: aad,
                hpkeEnc: try ProtocolCrypto.base64URLData(crypto.encapsulatedKey),
                ciphertext: try ProtocolCrypto.base64URLData(crypto.ciphertext),
                signingKeyId: crypto.signingKeyId
            )
        )
        XCTAssertEqual(signatureTranscript, try XCTUnwrap(Data(hex: crypto.signatureTranscriptHex)))
        XCTAssertTrue(
            try ProtocolCrypto.verifyEd25519(
                signature: ProtocolCrypto.base64URLData(crypto.signature),
                publicKey: ProtocolCrypto.base64URLData(crypto.ed25519PublicKey),
                message: signatureTranscript
            )
        )
    }

    func testGDMSentinelCasesComeFromSharedFixture() {
        for sentinelCase in Self.fixture.sentinelCases {
            XCTAssertEqual(isValidGDMSentinel(sentinelCase.value), sentinelCase.valid, sentinelCase.value)
        }
    }

    func testFixtureMalformedRequestMutationsReportTheirPublicErrors() throws {
        for malformed in Self.fixture.malformedRequestCases {
            let base = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == malformed.base })
            var object = try requestJSONObject(base.request)
            object[malformed.mutation.path] = malformed.mutation.value.foundationObject
            let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            let expected = try XCTUnwrap(PublicError(rawValue: malformed.expectedError))

            assertProtocolError(expected, malformed.case) {
                try ProtocolJSON.decode(ExecutionRequest.self, from: data)
            }
        }
    }

    func testTopLevelAndNestedExcessFieldsAreRejected() throws {
        let request = try XCTUnwrap(Self.fixture.requestVectors.first).request

        var topLevel = try requestJSONObject(request)
        topLevel["unexpected"] = "rejected"
        assertDecodeError(.excessField, object: topLevel)

        var nestedPrincipal = try requestJSONObject(request)
        var principal = try XCTUnwrap(nestedPrincipal["principal"] as? [String: Any])
        principal["unexpected"] = "rejected"
        nestedPrincipal["principal"] = principal
        assertDecodeError(.excessField, object: nestedPrincipal)

        var nestedTarget = try requestJSONObject(request)
        var target = try XCTUnwrap(nestedTarget["target"] as? [String: Any])
        target["unexpected"] = NSNull()
        nestedTarget["target"] = target
        assertDecodeError(.excessField, object: nestedTarget)
    }

    func testDomainOperationAndTargetMustAgree() throws {
        let gdm = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "gdm-delegated" })
        let sudo = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "sudo-biometric-one-shot" })

        var wrongDomain = try requestJSONObject(gdm.request)
        wrongDomain["domain"] = "sudo"
        assertDecodeError(.domainMismatch, object: wrongDomain)

        var wrongOperation = try requestJSONObject(gdm.request)
        wrongOperation["operation"] = "bitwarden-unlock"
        assertDecodeError(.targetMismatch, object: wrongOperation)

        var wrongTarget = try requestJSONObject(sudo.request)
        wrongTarget["target"] = try XCTUnwrap(try requestJSONObject(gdm.request)["target"])
        assertDecodeError(.targetMismatch, object: wrongTarget)
    }

    func testGrantIdModeRules() throws {
        let delegated = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "gdm-delegated" })
        var missingGrant = try requestJSONObject(delegated.request)
        missingGrant["grantId"] = NSNull()
        assertDecodeError(.grantRequired, object: missingGrant)

        let oneShot = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "sudo-biometric-one-shot" })
        var forbiddenGrant = try requestJSONObject(oneShot.request)
        forbiddenGrant["grantId"] = "grant-v1:ICEiIyQlJicoKSorLC0uLw"
        assertDecodeError(.grantForbidden, object: forbiddenGrant)
    }

    func testRequestTimeOrderingLifetimeAndSafeIntegerBounds() throws {
        let request = try XCTUnwrap(Self.fixture.requestVectors.first).request

        var reversed = try requestJSONObject(request)
        reversed["expiresAt"] = NSNumber(value: request.createdAt - 1)
        assertDecodeError(.requestExpired, object: reversed)

        var equal = try requestJSONObject(request)
        equal["expiresAt"] = NSNumber(value: request.createdAt)
        assertDecodeError(.requestExpired, object: equal)

        var maximumLifetime = try requestJSONObject(request)
        maximumLifetime["expiresAt"] = NSNumber(
            value: request.createdAt + remoteAuthMaximumRequestLifetimeMilliseconds
        )
        _ = try ProtocolJSON.decode(
            ExecutionRequest.self,
            from: JSONSerialization.data(withJSONObject: maximumLifetime, options: [.sortedKeys])
        )

        var tooLong = try requestJSONObject(request)
        tooLong["expiresAt"] = NSNumber(value: request.createdAt + remoteAuthMaximumRequestLifetimeMilliseconds + 1)
        assertDecodeError(.noncanonicalValue, object: tooLong)

        var unsafeCreatedAt = try requestJSONObject(request)
        unsafeCreatedAt["createdAt"] = NSNumber(value: UInt64(9_007_199_254_740_992))
        assertDecodeError(.noncanonicalValue, object: unsafeCreatedAt)

    }

    func testOwnerEpochRequiresCanonicalUUIDInPrincipalAndSelector() throws {
        let request = try XCTUnwrap(Self.fixture.requestVectors.first).request

        var wrongType = try requestJSONObject(request)
        var wrongTypePrincipal = try XCTUnwrap(wrongType["principal"] as? [String: Any])
        wrongTypePrincipal["ownerEpoch"] = NSNumber(value: 1)
        wrongType["principal"] = wrongTypePrincipal
        assertDecodeError(.protocolInvalid, object: wrongType)

        let invalidOwnerEpochs = [
            "00112233-4455-4677-8899-AABBCCDDEEFF",
            "00112233-4455-9677-8899-aabbccddeeff",
            "00112233-4455-4677-7899-aabbccddeeff",
        ]
        for ownerEpoch in invalidOwnerEpochs {
            var object = try requestJSONObject(request)
            var principal = try XCTUnwrap(object["principal"] as? [String: Any])
            principal["ownerEpoch"] = ownerEpoch
            object["principal"] = principal
            assertDecodeError(.noncanonicalValue, object: object)

            let selector = PrincipalSelector(
                sessionId: request.principal.sessionId,
                ownerEpoch: ownerEpoch,
                uid: request.principal.uid,
                codeIdentity: request.principal.codeIdentity,
                buildDigest: request.principal.buildDigest
            )
            assertProtocolError(.noncanonicalValue) {
                try selector.validate()
            }
        }

        try PrincipalSelector(
            sessionId: request.principal.sessionId,
            ownerEpoch: request.principal.ownerEpoch,
            uid: request.principal.uid,
            codeIdentity: request.principal.codeIdentity,
            buildDigest: request.principal.buildDigest
        ).validate()
    }

    func testControlCharactersAndNoncanonicalBase64URLAreRejected() throws {
        var request = try XCTUnwrap(Self.fixture.requestVectors.first).request
        request.purpose = "bad\ncontrol"
        assertProtocolError(.noncanonicalValue) {
            try request.validate()
        }

        request = try XCTUnwrap(Self.fixture.requestVectors.first).request
        request.purpose = "bad\u{0085}control"
        assertProtocolError(.noncanonicalValue) {
            try request.validate()
        }

        request = try XCTUnwrap(Self.fixture.requestVectors.first).request
        request.requestId = String(repeating: "A", count: 21) + "B"
        assertProtocolError(.noncanonicalValue) {
            try request.validate()
        }

        request = try XCTUnwrap(Self.fixture.requestVectors.first).request
        request.nonce = String(repeating: "A", count: 42) + "B"
        assertProtocolError(.noncanonicalValue) {
            try request.validate()
        }
    }

    func testWebsiteOriginsRejectMalformedDNSLabelsAndNoncanonicalPorts() throws {
        let digest = String(repeating: "0", count: 64)
        var target = WebsiteTarget(
            hostIdentity: "host",
            graphicalSessionId: "graphical-session",
            chromeService: "chrome",
            chromeExecutableDigest: digest,
            chromePid: 42,
            profileIdentity: "profile",
            browserTargetId: "browser-target",
            windowId: "window",
            extensionId: "extension",
            extensionVersion: "1",
            manifestDigest: digest,
            uiTarget: "login-form",
            originSet: ["https://example.com"],
            activeTabId: "tab",
            frameId: "frame",
            formActionOrigin: "https://example.com",
            foregroundWindowId: "window",
            credentialPairingId: "pairing"
        )
        try target.validate()

        target.originSet = ["https://example.com:8443"]
        target.formActionOrigin = "https://example.com:8443"
        try target.validate()

        let invalidOrigins = [
            "https://Example.com",
            "https://example..com",
            "https://.example.com",
            "https://example.com.",
            "https://-example.com",
            "https://example-.com",
            "https://\(String(repeating: "a", count: 64)).com",
            "https://example.com:0",
            "https://example.com:0443",
            "https://example.com:443",
            "https://example.com:65536",
        ]
        for origin in invalidOrigins {
            target.originSet = [origin]
            target.formActionOrigin = origin
            assertProtocolError(.noncanonicalValue, origin) {
                try target.validate()
            }
        }
    }

    func testControlRequestsRequireExactFieldsAndRejectNullArguments() throws {
        let requestId = "AAECAwQFBgcICQoLDA0ODw"
        let grantId = "grant-v1:ICEiIyQlJicoKSorLC0uLw"
        let exactRequests = [
            #"{"action":"request-state","requestId":"\#(requestId)"}"#,
            #"{"action":"cancel","requestId":"\#(requestId)"}"#,
            #"{"action":"grant-list"}"#,
            #"{"action":"grant-revoke","grantId":"\#(grantId)"}"#,
            #"{"action":"grant-expire","grantId":"\#(grantId)"}"#,
            #"{"action":"credential-forget","credentialId":"\#(requestId)"}"#,
            #"{"action":"emergency-disable","reason":"fixture disable"}"#,
            #"{"action":"re-enable"}"#,
            #"{"action":"status"}"#,
        ]
        for exactRequest in exactRequests {
            _ = try ProtocolJSON.decode(ControlRequest.self, from: Data(exactRequest.utf8))
        }

        let statusObject = try XCTUnwrap(
            try jsonObject(ProtocolJSON.encode(ControlRequest.status)) as? [String: Any]
        )
        XCTAssertEqual(statusObject.count, 1)
        XCTAssertEqual(statusObject["action"] as? String, "status")

        for extraNull in [
            #"{"action":"status","requestId":null}"#,
            #"{"action":"grant-list","grantId":null}"#,
            #"{"action":"re-enable","reason":null}"#,
        ] {
            assertProtocolError(.excessField) {
                try ProtocolJSON.decode(ControlRequest.self, from: Data(extraNull.utf8))
            }
        }

        for requiredNull in [
            #"{"action":"request-state","requestId":null}"#,
            #"{"action":"cancel","requestId":null}"#,
            #"{"action":"grant-revoke","grantId":null}"#,
            #"{"action":"grant-expire","grantId":null}"#,
            #"{"action":"credential-forget","credentialId":null}"#,
            #"{"action":"emergency-disable","reason":null}"#,
        ] {
            assertProtocolError(.protocolInvalid) {
                try ProtocolJSON.decode(ControlRequest.self, from: Data(requiredNull.utf8))
            }
        }
    }

    func testFramePayloadAndTypedMessageRoundTrips() throws {
        let request = try XCTUnwrap(Self.fixture.requestVectors.first).request
        let payload = try ProtocolJSON.encode(request)
        let frame = try FrameCodec.encode(payload: payload)

        XCTAssertEqual(frame.count, payload.count + MemoryLayout<UInt32>.size)
        XCTAssertEqual(try FrameCodec.decodePayload(from: frame), payload)

        let typedFrame = try FrameCodec.encode(request)
        let decoded = try FrameCodec.decode(typedFrame, as: ExecutionRequest.self)
        XCTAssertEqual(
            try ProtocolTranscript.executionRequest(decoded),
            try ProtocolTranscript.executionRequest(request)
        )

        let maximumPayload = Data(repeating: 0, count: remoteAuthMaximumFrameBytes)
        XCTAssertEqual(
            try FrameCodec.decodePayload(from: FrameCodec.encode(payload: maximumPayload)),
            maximumPayload
        )
    }

    func testFrameRejectsTruncationTrailingBytesOversizeAndLengthMismatch() throws {
        let payload = Data(#"{"action":"status"}"#.utf8)
        let frame = try FrameCodec.encode(payload: payload)

        assertProtocolError(.frameInvalid) {
            try FrameCodec.decodePayload(from: Data(frame.dropLast()))
        }

        var trailing = frame
        trailing.append(0)
        assertProtocolError(.frameInvalid) {
            try FrameCodec.decodePayload(from: trailing)
        }

        assertProtocolError(.frameInvalid) {
            try FrameCodec.encode(payload: Data(repeating: 0, count: remoteAuthMaximumFrameBytes + 1))
        }

        assertProtocolError(.frameInvalid) {
            try FrameCodec.decodePayload(from: Data([0x00, 0x04, 0x00, 0x01]))
        }
        assertProtocolError(.frameInvalid) {
            try FrameCodec.decodePayload(from: Data([0x00, 0x00, 0x00]))
        }
        assertProtocolError(.frameInvalid) {
            try FrameCodec.decodePayload(from: Data([0x00, 0x00, 0x00, 0x05, 1, 2, 3, 4]))
        }
    }

    func testHPKEV1SuiteAndRepresentationsAreExact() throws {
        let crypto = Self.fixture.gdmCryptoVector
        XCTAssertEqual(HPKEV1.kemId, 0x0020)
        XCTAssertEqual(HPKEV1.kdfId, 0x0001)
        XCTAssertEqual(HPKEV1.aeadId, 0x0003)
        XCTAssertEqual(HPKEV1.kemSuiteIdentifier, Data([0x4b, 0x45, 0x4d, 0x00, 0x20]))
        XCTAssertEqual(
            HPKEV1.suiteIdentifier,
            Data([0x48, 0x50, 0x4b, 0x45, 0x00, 0x20, 0x00, 0x01, 0x00, 0x03])
        )

        let recipientPublicKey = try ProtocolCrypto.base64URLData(crypto.recipientPublicKey)
        let encapsulatedKey = try ProtocolCrypto.base64URLData(crypto.encapsulatedKey)
        let ciphertext = try ProtocolCrypto.base64URLData(crypto.ciphertext)
        XCTAssertEqual(recipientPublicKey.count, HPKEV1.recipientPublicKeyByteCount)
        XCTAssertEqual(encapsulatedKey.count, HPKEV1.encapsulatedKeyByteCount)
        XCTAssertGreaterThanOrEqual(ciphertext.count, HPKEV1.authenticationTagByteCount)
        try HPKEV1.validateRecipientPublicKey(recipientPublicKey)
        try HPKEV1.validateEncapsulatedKey(encapsulatedKey)
        try HPKEV1.validateCiphertext(ciphertext)
        assertProtocolError(.noncanonicalValue) {
            try ProtocolCrypto.base64URLData(crypto.encapsulatedKey + "=")
        }

        assertProtocolError(.ciphertextInvalid) {
            try HPKEV1.validateRecipientPublicKey(Data(recipientPublicKey.dropLast()))
        }
        assertProtocolError(.ciphertextInvalid) {
            try HPKEV1.validateEncapsulatedKey(Data(encapsulatedKey.dropLast()))
        }
        assertProtocolError(.ciphertextInvalid) {
            try HPKEV1.validateCiphertext(
                Data(repeating: 0, count: HPKEV1.authenticationTagByteCount - 1)
            )
        }

        var maximumCiphertext = Data(repeating: 0, count: HPKEV1.maximumCiphertextByteCount)
        try HPKEV1.validateCiphertext(maximumCiphertext)
        maximumCiphertext.append(0)
        assertProtocolError(.ciphertextInvalid) {
            try HPKEV1.validateCiphertext(maximumCiphertext)
        }

        assertProtocolError(.ciphertextInvalid) {
            try GDMEnvelopeSignatureInput(
                hpkeAadTranscript: Data(),
                hpkeEnc: Data(repeating: 0, count: HPKEV1.encapsulatedKeyByteCount - 1),
                ciphertext: Data(repeating: 0, count: HPKEV1.authenticationTagByteCount),
                signingKeyId: crypto.signingKeyId
            )
        }
        assertProtocolError(.ciphertextInvalid) {
            try GDMEnvelopeSignatureInput(
                hpkeAadTranscript: Data(),
                hpkeEnc: Data(repeating: 0, count: HPKEV1.encapsulatedKeyByteCount),
                ciphertext: Data(repeating: 0, count: HPKEV1.authenticationTagByteCount - 1),
                signingKeyId: crypto.signingKeyId
            )
        }
    }
    func testSecureMessagesEnforceNestedBindingsAndEncodedBounds() throws {
        let crypto = Self.fixture.gdmCryptoVector
        let gdm = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "gdm-delegated" }).request
        let sudo = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "sudo-biometric-one-shot" })
        guard case .gdm(let gdmTarget) = gdm.target else {
            return XCTFail("GDM fixture has the wrong target")
        }

        let envelope = GDMEnvelope(
            request: gdm,
            challenge: crypto.challenge,
            issueId: crypto.issueId,
            sentinelHash: crypto.sentinelHash,
            hpkeEnc: crypto.encapsulatedKey,
            ciphertext: crypto.ciphertext,
            signingKeyId: crypto.signingKeyId,
            signature: crypto.signature
        )
        _ = try ProtocolJSON.encode(envelope)

        var wrongBoot = envelope
        wrongBoot.challenge.bootId += "-other"
        assertProtocolError(.challengeInvalid) {
            try wrongBoot.validate()
        }

        var wrongOperation = envelope
        wrongOperation.request = sudo.request
        assertProtocolError(.targetMismatch) {
            try wrongOperation.validate()
        }

        var invalidEncapsulation = envelope
        invalidEncapsulation.hpkeEnc = String(repeating: "A", count: 42) + "B"
        assertProtocolError(.noncanonicalValue) {
            try invalidEncapsulation.validate()
        }

        var shortCiphertext = envelope
        shortCiphertext.ciphertext = String(repeating: "A", count: 21)
        assertProtocolError(.noncanonicalValue) {
            try shortCiphertext.validate()
        }

        var invalidSignature = envelope
        invalidSignature.signature = String(repeating: "A", count: 85)
        assertProtocolError(.noncanonicalValue) {
            try invalidSignature.validate()
        }

        let claim = GDMClaim(
            requestId: gdm.requestId,
            nonce: gdm.nonce,
            issueId: crypto.issueId,
            sentinel: crypto.sentinel,
            username: gdmTarget.username,
            uid: gdmTarget.uid,
            seat: gdmTarget.seat,
            tty: gdmTarget.tty,
            rhost: gdmTarget.rhost,
            greeterGeneration: gdmTarget.greeterGeneration,
            controllerGeneration: gdmTarget.controllerGeneration
        )
        try claim.validate()
        var invalidClaim = claim
        invalidClaim.sentinel = "gdm-broker-v1:" + String(repeating: "A", count: 42) + "B"
        assertProtocolError(.claimRejected) {
            try invalidClaim.validate()
        }

        let signedSudo = SudoSignedRequest(
            request: sudo.request,
            canonicalBodyDigest: sudo.sha256,
            signingKeyId: crypto.signingKeyId,
            signature: crypto.signature
        )
        try signedSudo.validate()
        var mismatchedDigest = signedSudo
        mismatchedDigest.canonicalBodyDigest = String(repeating: "0", count: 64)
        assertProtocolError(.integrityFailure) {
            try mismatchedDigest.validate()
        }
        var wrongSudoTarget = signedSudo
        wrongSudoTarget.request = gdm
        assertProtocolError(.targetMismatch) {
            try wrongSudoTarget.validate()
        }
    }

    func testReviewerResultEnforcesClosedOutcomeAndTimeInvariants() throws {
        let crypto = Self.fixture.gdmCryptoVector
        let digest = try XCTUnwrap(Self.fixture.requestVectors.first).sha256
        let result = ReviewerResult(
            reviewId: crypto.issueId,
            canonicalRequestDigest: digest,
            reviewerModel: "reviewer-model",
            reviewerBuildDigest: digest,
            promptPolicyDigest: digest,
            risk: .high,
            userAuthorization: .high,
            status: .completed,
            outcome: .allow,
            reasonCode: .semanticAllow,
            reason: "request is within policy",
            rationale: "all security evidence is present",
            attemptCount: 1,
            startedAt: 100,
            completedAt: 101,
            expiresAt: 102
        )
        try result.validate()

        var inconsistent = result
        inconsistent.reasonCode = .semanticDeny
        assertProtocolError(.reviewBlocked) {
            try inconsistent.validate()
        }

        var noAttempts = result
        noAttempts.attemptCount = 0
        assertProtocolError(.reviewBlocked) {
            try noAttempts.validate()
        }

        var reversed = result
        reversed.completedAt = reversed.startedAt - 1
        assertProtocolError(.reviewBlocked) {
            try reversed.validate()
        }

        var noValidityWindow = result
        noValidityWindow.expiresAt = noValidityWindow.completedAt
        assertProtocolError(.reviewBlocked) {
            try noValidityWindow.validate()
        }
    }

    func testMetadataMessagesAreClosedAndOperationBound() throws {
        let vector = try XCTUnwrap(Self.fixture.requestVectors.first { $0.name == "gdm-delegated" })
        let digest = vector.sha256
        let receipt = ReceiptMetadata(
            receiptId: Self.fixture.gdmCryptoVector.issueId,
            requestId: vector.request.requestId,
            grantId: vector.request.grantId,
            domain: vector.request.domain,
            operation: vector.request.operation,
            authorizationModeUsed: vector.request.authorizationModeRequested,
            targetFingerprint: digest,
            state: .succeeded,
            errorCode: nil,
            events: ReceiptEvents(requestedAt: 100, authorizedAt: 101, executingAt: 102, terminalAt: 103),
            policyDigest: digest,
            brokerBuildDigest: digest,
            brokerCodeDigest: digest,
            targetReleaseDisposition: .notApplicable,
            browserTargetGeneration: nil
        )
        let receiptObject = try XCTUnwrap(try jsonObject(MetadataJSONEncoder.encode(receipt)) as? [String: Any])
        XCTAssertEqual(Set(receiptObject.keys), Set([
            "protocolVersion", "receiptId", "requestId", "grantId", "domain", "operation",
            "authorizationModeUsed", "targetFingerprint", "state", "errorCode", "events",
            "policyDigest", "brokerBuildDigest", "brokerCodeDigest",
            "targetReleaseDisposition", "browserTargetGeneration",
        ]))

        var nonBrowserRelease = receipt
        nonBrowserRelease.targetReleaseDisposition = .closed
        assertProtocolError(.noncanonicalValue) {
            try nonBrowserRelease.validate()
        }

        var browserRelease = receipt
        browserRelease.operation = .bitwardenUnlock
        browserRelease.targetReleaseDisposition = .quarantined
        browserRelease.browserTargetGeneration = 7
        try browserRelease.validate()

        var missingTerminalError = receipt
        missingTerminalError.state = .cancelled
        assertProtocolError(.noncanonicalValue) {
            try missingTerminalError.validate()
        }

        let status = PublicStatusMetadata(
            canonicalStatus: .designInactive,
            policyDigest: nil,
            installedBuildDigest: nil,
            runningBuildDigest: nil,
            codeIdentity: nil,
            pid: nil,
            socketPosture: .absent,
            jetkvmControllerGeneration: nil,
            gdm: EndpointStatus(ready: false, errorCode: .inactive),
            browser: EndpointStatus(ready: false, errorCode: .inactive),
            sudo: EndpointStatus(ready: false, errorCode: .inactive),
            errors: [.inactive]
        )
        let statusObject = try XCTUnwrap(try jsonObject(MetadataJSONEncoder.encode(status)) as? [String: Any])
        XCTAssertEqual(Set(statusObject.keys), Set([
            "protocolVersion", "canonicalStatus", "policyDigest", "installedBuildDigest",
            "runningBuildDigest", "codeIdentity", "pid", "socketPosture",
            "jetkvmControllerGeneration", "gdm", "browser", "sudo", "errors",
        ]))

        var ambiguousEndpoint = status
        ambiguousEndpoint.gdm = EndpointStatus(ready: false, errorCode: nil)
        assertProtocolError(.noncanonicalValue) {
            try ambiguousEndpoint.validate()
        }
    }
}

private extension ProtocolContractTests {
    static let fixture: ProtocolFixture = {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let fixtureURL = packageRoot.appendingPathComponent("contracts/fixtures/v1/protocol-vectors.json")
        return try! JSONDecoder().decode(ProtocolFixture.self, from: Data(contentsOf: fixtureURL))
    }()

    func requestJSONObject(_ request: ExecutionRequest) throws -> [String: Any] {
        try XCTUnwrap(try jsonObject(ProtocolJSON.encode(request)) as? [String: Any])
    }

    func jsonObject(_ data: Data) throws -> Any {
        try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    func assertDecodeError(
        _ expected: PublicError,
        object: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        assertProtocolError(expected, file: file, line: line) {
            let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            return try ProtocolJSON.decode(ExecutionRequest.self, from: data)
        }
    }

    func assertProtocolError<T>(
        _ expected: PublicError,
        _ context: String = "",
        file: StaticString = #filePath,
        line: UInt = #line,
        _ body: () throws -> T
    ) {
        do {
            _ = try body()
            XCTFail("Expected \(expected.rawValue) \(context)", file: file, line: line)
        } catch let error as RemoteAuthProtocolError {
            XCTAssertEqual(error.publicError, expected, context, file: file, line: line)
        } catch {
            XCTFail("Expected RemoteAuthProtocolError(\(expected.rawValue)), got \(error) \(context)", file: file, line: line)
        }
    }
}

private struct ProtocolFixture: Decodable {
    let requestVectors: [RequestVector]
    let gdmCryptoVector: GDMCryptoVector
    let sentinelCases: [SentinelCase]
    let malformedRequestCases: [MalformedRequestCase]
}

private struct RequestVector: Decodable {
    let name: String
    let request: ExecutionRequest
    let transcriptHex: String
    let sha256: String
    let ed25519Signature: String?
}

private struct GDMCryptoVector: Decodable {
    let challenge: GDMChallenge
    let issueId: String
    let sentinel: String
    let sentinelHash: String
    let recipientKeyId: String
    let hpkeInfoTranscriptHex: String
    let hpkeAadTranscriptHex: String
    let recipientPublicKey: String
    let encapsulatedKey: String
    let ciphertext: String
    let signingKeyId: String
    let ed25519PublicKey: String
    let signatureTranscriptHex: String
    let signature: String
}

private struct SentinelCase: Decodable {
    let value: String
    let valid: Bool
}

private struct MalformedRequestCase: Decodable {
    let `case`: String
    let base: String
    let mutation: FixtureMutation
    let expectedError: String
}

private struct FixtureMutation: Decodable {
    let path: String
    let value: FixtureScalar
}

private enum FixtureScalar: Decodable {
    case null
    case string(String)
    case unsigned(UInt64)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else {
            self = .unsigned(try container.decode(UInt64.self))
        }
    }

    var foundationObject: Any {
        switch self {
        case .null: NSNull()
        case .string(let value): value
        case .unsigned(let value): NSNumber(value: value)
        }
    }
}

private extension Data {
    init?(hex: String) {
        guard hex.count.isMultiple(of: 2) else { return nil }
        self.init(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            append(byte)
            index = next
        }
    }
}
