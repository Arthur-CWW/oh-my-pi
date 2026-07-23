import Foundation
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class RemoteEndpointClientTests: XCTestCase {
    private let requestId = "AAECAwQFBgcICQoLDA0ODw"

    func testChallengeRequestIsCanonicalSingleFrame() throws {
        let frame = try RemoteEndpointWireCodec.encodeFrame(GDMChallengeRequest())
        let payload = try payload(of: frame)
        XCTAssertEqual(
            String(decoding: payload, as: UTF8.self),
            #"{"action":"issue-challenge","protocolVersion":1}"#
        )
        XCTAssertEqual(frame.prefix(4), Data([0, 0, 0, UInt8(payload.count)]))
    }

    func testChallengeResponseValidatesAndRejectsUnknownOrInvalidFields() throws {
        let valid = framed(
            #"{"protocolVersion":1,"challengeId":"AAECAwQFBgcICQoLDA0ODw","challenge":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","bootId":"boot-fixture","issuedBoottimeMs":1000,"expiresBoottimeMs":2000,"policyDigest":"0000000000000000000000000000000000000000000000000000000000000000"}"#
        )
        let challenge = try RemoteEndpointWireCodec.parseGDMChallenge(from: valid)
        XCTAssertEqual(challenge.bootId, "boot-fixture")
        XCTAssertEqual(challenge.expiresBoottimeMs, 2_000)

        assertEndpointError(.invalidResponse) {
            try RemoteEndpointWireCodec.parseGDMChallenge(from: self.framed(
                #"{"protocolVersion":1,"challengeId":"AAECAwQFBgcICQoLDA0ODw","challenge":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","bootId":"boot-fixture","issuedBoottimeMs":1000,"expiresBoottimeMs":2000,"policyDigest":"0000000000000000000000000000000000000000000000000000000000000000","ciphertext":"forbidden"}"#
            ))
        }
        assertEndpointError(.invalidResponse) {
            try RemoteEndpointWireCodec.parseGDMChallenge(from: self.framed(
                #"{"protocolVersion":1,"challengeId":"AAECAwQFBgcICQoLDA0ODw","challenge":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","bootId":"boot-fixture","issuedBoottimeMs":2000,"expiresBoottimeMs":1000,"policyDigest":"0000000000000000000000000000000000000000000000000000000000000000"}"#
            ))
        }
    }

    func testGDMIngestRequiresAcceptedMatchingRequest() throws {
        let accepted = try RemoteEndpointWireCodec.encodeFrame(
            GDMIngestMetadata(
                protocolVersion: 1,
                requestId: requestId,
                accepted: true,
                error: nil
            )
        )
        let metadata = try RemoteEndpointWireCodec.parseGDMIngestMetadata(
            from: accepted,
            expectedRequestId: requestId
        )
        XCTAssertTrue(metadata.accepted)
        XCTAssertNil(metadata.error)

        assertEndpointError(.requestMismatch) {
            try RemoteEndpointWireCodec.parseGDMIngestMetadata(
                from: accepted,
                expectedRequestId: "AQEBAQEBAQEBAQEBAQEBAQ"
            )
        }

        let rejected = try RemoteEndpointWireCodec.encodeFrame(
            GDMIngestMetadata(
                protocolVersion: 1,
                requestId: requestId,
                accepted: false,
                error: .policyMismatch
            )
        )
        assertEndpointError(.remoteRejected(.policyMismatch)) {
            try RemoteEndpointWireCodec.parseGDMIngestMetadata(
                from: rejected,
                expectedRequestId: self.requestId
            )
        }
    }

    func testGDMStatusWireIsStrictAndBindsExactLifecycleKey() throws {
        let issueId = "AQEBAQEBAQEBAQEBAQEBAQ"
        let nonce = "AgICAgICAgICAgICAgICAg"
        let requestFrame = try RemoteEndpointWireCodec.encodeFrame(
            GDMStatusRequest(requestId: requestId, issueId: issueId, nonce: nonce)
        )
        XCTAssertEqual(
            String(decoding: try payload(of: requestFrame), as: UTF8.self),
            #"{"action":"request-status","issueId":"AQEBAQEBAQEBAQEBAQEBAQ","nonce":"AgICAgICAgICAgICAgICAg","protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw"}"#
        )

        for state in GDMAuthenticationState.allCases {
            let metadata = try RemoteEndpointWireCodec.parseGDMStatus(
                from: framed(
                    #"{"protocolVersion":1,"requestId":"\#(requestId)","issueId":"\#(issueId)","state":"\#(state.rawValue)"}"#
                ),
                expectedRequestId: requestId,
                expectedIssueId: issueId
            )
            XCTAssertEqual(metadata.state, state)
        }

        assertEndpointError(.requestMismatch) {
            try RemoteEndpointWireCodec.parseGDMStatus(
                from: self.framed(
                    #"{"protocolVersion":1,"requestId":"\#(self.requestId)","issueId":"\#(issueId)","state":"succeeded"}"#
                ),
                expectedRequestId: self.requestId,
                expectedIssueId: "AwMDAwMDAwMDAwMDAwMDAw"
            )
        }
        assertEndpointError(.invalidResponse) {
            try RemoteEndpointWireCodec.parseGDMStatus(
                from: self.framed(
                    #"{"protocolVersion":1,"requestId":"\#(self.requestId)","issueId":"\#(issueId)","state":"succeeded","nonce":"forbidden"}"#
                ),
                expectedRequestId: self.requestId,
                expectedIssueId: issueId
            )
        }
    }

    func testGDMCompletionRequiresAuthenticatedSuccess() throws {
        XCTAssertFalse(try RemoteEndpointClient.authenticationSucceeded(.pending))
        XCTAssertFalse(try RemoteEndpointClient.authenticationSucceeded(.claimed))
        XCTAssertTrue(try RemoteEndpointClient.authenticationSucceeded(.succeeded))
        for state in [GDMAuthenticationState.expired, .failed] {
            assertEndpointError(.remoteRejected(.executionFailed)) {
                try RemoteEndpointClient.authenticationSucceeded(state)
            }
        }
    }

    func testSudoReceiptMapsAllOutcomesExactly() throws {
        let succeeded = try RemoteEndpointWireCodec.encodeFrame(
            sudoMetadata(.succeeded, error: nil, exitCode: 0, signal: nil)
        )
        XCTAssertEqual(
            try RemoteEndpointWireCodec.parseSudoReceipt(from: succeeded, expectedRequestId: requestId),
            .succeeded(requestId: requestId)
        )

        let failedExit = try RemoteEndpointWireCodec.encodeFrame(
            sudoMetadata(.failed, error: .executionFailed, exitCode: 23, signal: nil)
        )
        XCTAssertEqual(
            try RemoteEndpointWireCodec.parseSudoReceipt(from: failedExit, expectedRequestId: requestId),
            .failed(requestId: requestId, exitCode: 23, signal: nil)
        )

        let failedSignal = try RemoteEndpointWireCodec.encodeFrame(
            sudoMetadata(.failed, error: .executionFailed, exitCode: nil, signal: 9)
        )
        XCTAssertEqual(
            try RemoteEndpointWireCodec.parseSudoReceipt(from: failedSignal, expectedRequestId: requestId),
            .failed(requestId: requestId, exitCode: nil, signal: 9)
        )

        let rejected = try RemoteEndpointWireCodec.encodeFrame(
            sudoMetadata(.rejected, error: .signatureInvalid, exitCode: nil, signal: nil)
        )
        XCTAssertEqual(
            try RemoteEndpointWireCodec.parseSudoReceipt(from: rejected, expectedRequestId: requestId),
            .rejected(requestId: requestId, error: .signatureInvalid)
        )
    }

    func testSudoReceiptRejectsMismatchAndNoncanonicalOutcomeFields() throws {
        let succeeded = try RemoteEndpointWireCodec.encodeFrame(
            sudoMetadata(.succeeded, error: nil, exitCode: 0, signal: nil)
        )
        assertEndpointError(.requestMismatch) {
            try RemoteEndpointWireCodec.parseSudoReceipt(
                from: succeeded,
                expectedRequestId: "AQEBAQEBAQEBAQEBAQEBAQ"
            )
        }

        let invalidPayloads = [
            #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","outcome":"succeeded","error":"execution-failed","exitCode":0,"signal":null}"#,
            #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","outcome":"failed","error":"execution-failed","exitCode":0,"signal":null}"#,
            #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","outcome":"failed","error":"execution-failed","exitCode":1,"signal":9}"#,
            #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","outcome":"rejected","error":null,"exitCode":null,"signal":null}"#,
            #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","outcome":"succeeded","error":null,"exitCode":0}"#,
            #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","outcome":"succeeded","error":null,"exitCode":0,"signal":null,"signature":"forbidden"}"#,
        ]
        for payload in invalidPayloads {
            assertEndpointError(.invalidResponse) {
                try RemoteEndpointWireCodec.parseSudoReceipt(
                    from: self.framed(payload),
                    expectedRequestId: self.requestId
                )
            }
        }
    }

    func testFrameParserRejectsTrailingTruncatedAndOversizeData() {
        var trailing = framed(
            #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","accepted":true,"error":null}"#
        )
        trailing.append(0)
        assertEndpointError(.invalidFrame) {
            try RemoteEndpointWireCodec.parseGDMIngestMetadata(
                from: trailing,
                expectedRequestId: self.requestId
            )
        }

        let truncated = Data(trailing.dropLast(2))
        assertEndpointError(.invalidFrame) {
            try RemoteEndpointWireCodec.parseGDMIngestMetadata(
                from: truncated,
                expectedRequestId: self.requestId
            )
        }

        let oversizeLength = UInt32(RemoteEndpointWireCodec.maximumMetadataPayloadBytes + 1)
        let oversizeHeader = Data([
            UInt8(truncatingIfNeeded: oversizeLength >> 24),
            UInt8(truncatingIfNeeded: oversizeLength >> 16),
            UInt8(truncatingIfNeeded: oversizeLength >> 8),
            UInt8(truncatingIfNeeded: oversizeLength),
        ])
        assertEndpointError(.responseTooLarge) {
            try RemoteEndpointWireCodec.decodeFrame(GDMIngestMetadata.self, from: oversizeHeader)
        }
    }

    func testStrictJSONRejectsTrailingJSONAndUnknownMetadataFields() {
        assertEndpointError(.invalidResponse) {
            try RemoteEndpointWireCodec.parseGDMIngestMetadata(
                from: self.framed(
                    #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","accepted":true,"error":null} {}"#
                ),
                expectedRequestId: self.requestId
            )
        }
        assertEndpointError(.invalidResponse) {
            try RemoteEndpointWireCodec.parseGDMIngestMetadata(
                from: self.framed(
                    #"{"protocolVersion":1,"requestId":"AAECAwQFBgcICQoLDA0ODw","accepted":true,"error":null,"hpkeEnc":"forbidden"}"#
                ),
                expectedRequestId: self.requestId
            )
        }
    }

    func testReceiptMetadataEncodingIsClosedAndContainsNoSecretMaterial() throws {
        let frame = try RemoteEndpointWireCodec.encodeFrame(
            sudoMetadata(.failed, error: .executionFailed, exitCode: 7, signal: nil)
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: payload(of: frame)) as? [String: Any]
        )
        XCTAssertEqual(
            Set(object.keys),
            Set(["protocolVersion", "requestId", "outcome", "error", "exitCode", "signal"])
        )
        XCTAssertNil(object["ciphertext"])
        XCTAssertNil(object["signature"])
        XCTAssertNil(object["secret"])
    }

    func testEndpointAndPinnedKnownHostValidationIsPureAndExact() throws {
        let blob = ed25519Blob()
        let digest = "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020"
        let configuration = try RemoteEndpointConfiguration(
            endpoint: "ubuntu-auth.example.test",
            forcedPrincipal: .gdm,
            pinnedHostKeySHA256: digest,
            knownHostsFile: "/Users/fixture/known_hosts",
            timeoutMilliseconds: 5_000
        )
        try RemoteEndpointPolicyValidator.validateKnownHostsContents(
            Data("ubuntu-auth.example.test ssh-ed25519 \(blob.base64EncodedString())\n".utf8),
            endpoint: configuration.endpoint,
            pinnedHostKeySHA256: configuration.pinnedHostKeySHA256
        )

        assertEndpointError(.pinnedHostKeyMismatch) {
            try RemoteEndpointPolicyValidator.validateKnownHostsContents(
                Data("other.example.test ssh-ed25519 \(blob.base64EncodedString())\n".utf8),
                endpoint: configuration.endpoint,
                pinnedHostKeySHA256: configuration.pinnedHostKeySHA256
            )
        }
        assertEndpointError(.pinnedHostKeyMismatch) {
            try RemoteEndpointPolicyValidator.validateKnownHostsContents(
                Data("ubuntu-auth.example.test ssh-ed25519 \(blob.base64EncodedString())\nubuntu-auth.example.test ssh-ed25519 \(blob.base64EncodedString())\n".utf8),
                endpoint: configuration.endpoint,
                pinnedHostKeySHA256: configuration.pinnedHostKeySHA256
            )
        }
        assertEndpointError(.pinnedHostKeyMismatch) {
            try RemoteEndpointPolicyValidator.validateKnownHostsContents(
                Data("ubuntu-auth.example.test ssh-ed25519 \(blob.base64EncodedString())\n".utf8),
                endpoint: configuration.endpoint,
                pinnedHostKeySHA256: String(repeating: "0", count: 64)
            )
        }
    }

    func testConfigurationRejectsEndpointInjectionAndNoncanonicalPinFormats() {
        let validDigest = "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020"

        assertEndpointError(.invalidConfiguration) {
            try RemoteEndpointConfiguration(
                endpoint: "host -oProxyCommand=evil",
                forcedPrincipal: .sudo,
                pinnedHostKeySHA256: validDigest,
                knownHostsFile: "/safe/known_hosts"
            )
        }
        assertEndpointError(.invalidConfiguration) {
            try RemoteEndpointConfiguration(
                endpoint: "host.example",
                forcedPrincipal: .sudo,
                pinnedHostKeySHA256: validDigest.uppercased(),
                knownHostsFile: "/safe/known_hosts"
            )
        }
        assertEndpointError(.invalidConfiguration) {
            try RemoteEndpointConfiguration(
                endpoint: "host.example",
                forcedPrincipal: .sudo,
                pinnedHostKeySHA256: "SHA256:ZkAslGjFiUHdGf/WUL8rQvkib4PTvQatUV0OUQSncCA=",
                knownHostsFile: "/safe/known_hosts"
            )
        }
        assertEndpointError(.invalidConfiguration) {
            try RemoteEndpointConfiguration(
                endpoint: "host.example",
                forcedPrincipal: .sudo,
                pinnedHostKeySHA256: validDigest,
                knownHostsFile: "relative/known_hosts"
            )
        }
    }

    private func sudoMetadata(
        _ outcome: SudoRemoteOutcome,
        error: PublicError?,
        exitCode: Int32?,
        signal: Int32?
    ) -> SudoExecutionMetadata {
        SudoExecutionMetadata(
            protocolVersion: 1,
            requestId: requestId,
            outcome: outcome,
            error: error,
            exitCode: exitCode,
            signal: signal
        )
    }

    private func framed(_ payload: String) -> Data {
        let data = Data(payload.utf8)
        let length = UInt32(data.count)
        var frame = Data([
            UInt8(truncatingIfNeeded: length >> 24),
            UInt8(truncatingIfNeeded: length >> 16),
            UInt8(truncatingIfNeeded: length >> 8),
            UInt8(truncatingIfNeeded: length),
        ])
        frame.append(data)
        return frame
    }

    private func payload(of frame: Data) throws -> Data {
        guard frame.count >= 4 else { throw RemoteEndpointError.invalidFrame }
        return frame.subdata(in: 4..<frame.count)
    }

    private func ed25519Blob() -> Data {
        let algorithm = Data("ssh-ed25519".utf8)
        var blob = Data([0, 0, 0, UInt8(algorithm.count)])
        blob.append(algorithm)
        blob.append(contentsOf: [0, 0, 0, 32])
        blob.append(contentsOf: (0..<32).map(UInt8.init))
        return blob
    }

    private func assertEndpointError<T>(
        _ expected: RemoteEndpointError,
        file: StaticString = #filePath,
        line: UInt = #line,
        operation: () throws -> T
    ) {
        do {
            _ = try operation()
            XCTFail("Expected endpoint error \(expected)", file: file, line: line)
        } catch let error as RemoteEndpointError {
            XCTAssertEqual(error, expected, file: file, line: line)
        } catch {
            XCTFail("Unexpected error type: \(type(of: error))", file: file, line: line)
        }
    }
}
