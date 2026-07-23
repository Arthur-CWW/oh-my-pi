import Foundation
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class BrokerWireStrictTests: XCTestCase {
    func testRequestDecoderRejectsTopLevelAndNestedExcessFields() {
        let excessPayloads = [
            #"{"type":"control","control":{"action":"status"},"unexpected":true}"#,
            #"{"type":"control","control":{"action":"status","unexpected":true}}"#,
            #"{"type":"control","control":{"action":"cancel","requestId":"AAAAAAAAAAAAAAAAAAAAAA","reason":"extra"}}"#,
        ]

        for payload in excessPayloads {
            assertRemoteError(.excessField) {
                try BrokerWireCodec.decodeRequest(payload: Data(payload.utf8))
            }
        }
    }

    func testRequestDecoderRejectsMissingMalformedAndUnknownDiscriminators() {
        let malformedPayloads = [
            #"{"type":"control","control":{"action":"cancel"}}"#,
            #"{"type":"control","control":{"action":"cancel","requestId":7}}"#,
            #"{"type":"control","control":{"action":"unknown"}}"#,
            #"{"type":"control"}"#,
            #"{"type":"control","control":{"action":"status"}"#,
        ]

        for payload in malformedPayloads {
            assertRemoteError(.protocolInvalid) {
                try BrokerWireCodec.decodeRequest(payload: Data(payload.utf8))
            }
        }
    }

    func testResponseDecoderRejectsNestedExcessMissingAndNoncanonicalFields() {
        assertRemoteError(.excessField) {
            try BrokerWireCodec.decodeResponse(
                payload: Data(
                    #"{"type":"ack","ack":{"operation":"emergency-disable","identifier":null,"unexpected":true}}"#.utf8
                )
            )
        }
        assertRemoteError(.protocolInvalid) {
            try BrokerWireCodec.decodeResponse(
                payload: Data(#"{"type":"ack","ack":{"operation":"cancel"}}"#.utf8)
            )
        }
        assertRemoteError(.noncanonicalValue) {
            try BrokerWireCodec.decodeResponse(
                payload: Data(
                    #"{"type":"ack","ack":{"operation":"emergency-disable","identifier":"must-be-null"}}"#.utf8
                )
            )
        }
        assertRemoteError(.protocolInvalid) {
            try BrokerWireCodec.decodeResponse(
                payload: Data(#"{"type":"error","error":{"code":17}}"#.utf8)
            )
        }
    }

    func testCanonicalAcknowledgementPreservesRequiredNullAndRejectsMutation() throws {
        let response = BrokerWireResponse.ack(
            BrokerAcknowledgement(operation: .emergencyDisable, identifier: nil)
        )
        let payload = try BrokerWireCodec.encodePayload(response)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: payload) as? [String: Any])
        XCTAssertEqual(Set(root.keys), Set(["type", "ack"]))
        XCTAssertEqual(root["type"] as? String, "ack")
        let acknowledgement = try XCTUnwrap(root["ack"] as? [String: Any])
        XCTAssertEqual(Set(acknowledgement.keys), Set(["operation", "identifier"]))
        XCTAssertEqual(
            acknowledgement["operation"] as? String,
            BrokerAcknowledgedOperation.emergencyDisable.rawValue
        )
        XCTAssertTrue(acknowledgement["identifier"] is NSNull)

        let decoded = try BrokerWireCodec.decodeResponse(payload: payload)
        guard case .ack(let decodedAcknowledgement) = decoded else {
            XCTFail("Expected an acknowledgement response")
            return
        }
        XCTAssertEqual(decodedAcknowledgement.operation, .emergencyDisable)
        XCTAssertNil(decodedAcknowledgement.identifier)

        var mutatedRoot = root
        var mutatedAcknowledgement = acknowledgement
        mutatedAcknowledgement["identifier"] = "unexpected-identifier"
        mutatedRoot["ack"] = mutatedAcknowledgement
        let mutatedPayload = try JSONSerialization.data(withJSONObject: mutatedRoot, options: [.sortedKeys])
        assertRemoteError(.noncanonicalValue) {
            try BrokerWireCodec.decodeResponse(payload: mutatedPayload)
        }
    }

    func testCanonicalControlRequestRoundTripsWithExactVariantFields() throws {
        let requestId = AuthorityBase64URL.encode(Data(repeating: 0x7a, count: 16))
        let payload = try BrokerWireCodec.encodePayload(
            .control(.cancel(requestId: requestId))
        )
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: payload) as? [String: Any])
        XCTAssertEqual(Set(root.keys), Set(["type", "control"]))
        XCTAssertEqual(root["type"] as? String, "control")
        let control = try XCTUnwrap(root["control"] as? [String: Any])
        XCTAssertEqual(Set(control.keys), Set(["action", "requestId"]))
        XCTAssertEqual(control["action"] as? String, "cancel")
        XCTAssertEqual(control["requestId"] as? String, requestId)

        let decoded = try BrokerWireCodec.decodeRequest(payload: payload)
        guard case .control(.cancel(let decodedRequestId)) = decoded else {
            XCTFail("Expected a cancel control request")
            return
        }
        XCTAssertEqual(decodedRequestId, requestId)
    }

    private func assertRemoteError<T>(
        _ expected: PublicError,
        file: StaticString = #filePath,
        line: UInt = #line,
        operation: () throws -> T
    ) {
        do {
            _ = try operation()
            XCTFail("Expected remote-auth error \(expected.rawValue)", file: file, line: line)
        } catch let error as RemoteAuthProtocolError {
            XCTAssertEqual(error.publicError.rawValue, expected.rawValue, file: file, line: line)
        } catch {
            XCTFail("Unexpected error type: \(type(of: error))", file: file, line: line)
        }
    }
}
