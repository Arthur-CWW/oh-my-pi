import Darwin
import Foundation
import RemoteAuthProtocol
import XCTest
@testable import RemoteAuthBroker

final class LiveOwnershipProviderTests: XCTestCase {
    func testCurrentExactOwnerPassesAndFormerOwnerReplayFails() throws {
        let fixture = try LiveRegistryFixture()
        defer { fixture.close() }
        let endpoint = try OwnershipProofEndpoint(
            path: fixture.socketPath,
            sessionId: fixture.sessionId,
            ownerEpoch: fixture.ownerEpoch,
            runnerInstanceId: fixture.runner,
            buildDigest: fixture.digest,
            ownerPid: fixture.pid
        )
        defer { endpoint.close() }
        let provider = provider(for: fixture)
        let peer = attestedPeer(for: fixture)
        let current = principal(for: fixture)

        XCTAssertEqual(
            try provider.ownership(for: peer, principal: current),
            LivePeerOwnership(
                sessionId: current.sessionId,
                ownerEpoch: current.ownerEpoch,
                runnerInstanceIdentity: fixture.runner
            )
        )

        var replaced = current
        replaced.ownerEpoch = "ffeeddcc-bbaa-4988-8776-554433221100"
        XCTAssertThrowsError(try provider.ownership(for: peer, principal: replaced)) { error in
            XCTAssertEqual((error as? RemoteAuthProtocolError)?.publicError, .ownerStale)
        }
    }

    func testRegistryIdentityReplacementsFailBeforeProof() throws {
        let fixture = try LiveRegistryFixture()
        defer { fixture.close() }
        let provider = provider(for: fixture)
        let peer = attestedPeer(for: fixture)
        let principal = principal(for: fixture)

        try fixture.update(column: "owner_epoch", text: "ffeeddcc-bbaa-4988-8776-554433221100")
        XCTAssertThrowsError(try provider.ownership(for: peer, principal: principal))
        try fixture.update(column: "owner_epoch", text: fixture.ownerEpoch)

        try fixture.updatePID(fixture.pid + 1)
        XCTAssertThrowsError(try provider.ownership(for: peer, principal: principal))
        try fixture.updatePID(fixture.pid)

        try fixture.update(column: "build_digest", text: String(repeating: "b", count: 64))
        XCTAssertThrowsError(try provider.ownership(for: peer, principal: principal))
        try fixture.update(column: "build_digest", text: fixture.digest)

        let replacementSession = try fixture.makeSessionFile(named: "replacement-session.jsonl")
        try fixture.update(column: "session_file", text: replacementSession.path)
        XCTAssertThrowsError(try provider.ownership(for: peer, principal: principal))
    }

    func testRequestSocketCannotSelectACompliantFakeEndpoint() throws {
        let fixture = try LiveRegistryFixture()
        defer { fixture.close() }
        let fakeDigest = String(repeating: "f", count: 64)
        let fakePath = fixture.ownershipRootURL
            .appendingPathComponent("owners-v1/\(fakeDigest)/claim/owner.sock")
            .path
        let endpoint = try OwnershipProofEndpoint(
            path: fakePath,
            sessionId: fixture.sessionId,
            ownerEpoch: fixture.ownerEpoch,
            runnerInstanceId: fixture.runner,
            buildDigest: fixture.digest,
            ownerPid: fixture.pid
        )
        defer { endpoint.close() }
        var fakePrincipal = principal(for: fixture)
        fakePrincipal.ownershipSocketPath = fakePath

        XCTAssertThrowsError(
            try provider(for: fixture).ownership(
                for: attestedPeer(for: fixture),
                principal: fakePrincipal
            )
        ) { error in
            XCTAssertEqual((error as? RemoteAuthProtocolError)?.publicError, .ownerStale)
        }
    }

    func testRegistryBindingChangedDuringProofFailsClosed() throws {
        let fixture = try LiveRegistryFixture()
        defer { fixture.close() }
        let endpoint = try OwnershipProofEndpoint(
            path: fixture.socketPath,
            sessionId: fixture.sessionId,
            ownerEpoch: fixture.ownerEpoch,
            runnerInstanceId: fixture.runner,
            buildDigest: fixture.digest,
            ownerPid: fixture.pid,
            beforeResponse: {
                try! fixture.update(
                    column: "owner_epoch",
                    text: "ffeeddcc-bbaa-4988-8776-554433221100"
                )
            }
        )
        defer { endpoint.close() }

        XCTAssertThrowsError(
            try provider(for: fixture).ownership(
                for: attestedPeer(for: fixture),
                principal: principal(for: fixture)
            )
        ) { error in
            XCTAssertEqual((error as? RemoteAuthProtocolError)?.publicError, .ownerStale)
        }
    }

    private func provider(for fixture: LiveRegistryFixture) -> LiveOwnershipProvider {
        LiveOwnershipProvider(timeoutMilliseconds: 1_000, registryReader: fixture.reader)
    }

    private func attestedPeer(for fixture: LiveRegistryFixture) -> AttestedPeer {
        AttestedPeer(
            uid: getuid(),
            gid: getgid(),
            pid: getpid(),
            signingIdentifier: "com.openai.omp",
            teamIdentifier: "TEAM",
            designatedRequirement: "identifier com.openai.omp",
            executableSHA256: fixture.digest
        )
    }

    private func principal(for fixture: LiveRegistryFixture) -> Principal {
        Principal(
            sessionId: fixture.sessionId,
            ownerEpoch: fixture.ownerEpoch,
            pid: fixture.pid,
            uid: UInt32(getuid()),
            codeIdentity: "com.openai.omp",
            buildDigest: fixture.digest,
            runnerInstanceIdentity: fixture.runner,
            ownershipSocketPath: fixture.socketPath
        )
    }
}

private final class OwnershipProofEndpoint: @unchecked Sendable {
    private let descriptor: Int32
    private let path: String
    private let queue = DispatchQueue(label: "live-ownership-provider-test")
    private let proof: [String: Any]
    private let beforeResponse: () -> Void

    init(
        path: String,
        sessionId: String,
        ownerEpoch: String,
        runnerInstanceId: String,
        buildDigest: String,
        ownerPid: UInt32,
        beforeResponse: @escaping () -> Void = {}
    ) throws {
        self.path = path
        self.beforeResponse = beforeResponse
        self.proof = [
            "t": "ownerProof", "nonce": "", "sessionId": sessionId, "ownerEpoch": ownerEpoch,
            "buildRevision": ["digest": buildDigest, "version": "test"],
            "runnerInstanceId": runnerInstanceId, "sessionMatch": true, "phase": "running",
            "ownerPid": ownerPid, "ownershipSocketPath": path,
        ]
        try FileManager.default.createDirectory(
            atPath: (path as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true
        )
        unlink(path)
        descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw POSIXError(.ENOTSOCK) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
            Darwin.close(descriptor)
            throw POSIXError(.ENAMETOOLONG)
        }
        withUnsafeMutableBytes(of: &address.sun_path) { target in
            target.copyBytes(from: bytes)
            target[bytes.count] = 0
        }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0, Darwin.listen(descriptor, 1) == 0 else {
            Darwin.close(descriptor)
            throw POSIXError(.EADDRINUSE)
        }
        guard path.withCString({ Darwin.chmod($0, 0o600) }) == 0 else {
            Darwin.close(descriptor)
            throw POSIXError(.EPERM)
        }
        queue.async { [self] in serveOne() }
    }

    func close() {
        Darwin.close(descriptor)
        unlink(path)
    }

    private func serveOne() {
        let client = Darwin.accept(descriptor, nil, nil)
        guard client >= 0 else { return }
        defer { Darwin.close(client) }
        guard let request = try? readFrame(client),
              request["kind"] as? String == "request",
              let requestId = request["requestId"] as? String,
              let correlationId = request["correlationId"] as? String,
              let payload = request["payload"] as? [String: Any],
              let nonce = payload["nonce"] as? String
        else { return }
        beforeResponse()
        var result = proof
        result["nonce"] = nonce
        let response: [String: Any] = [
            "kind": "response", "correlationId": correlationId, "requestId": requestId,
            "ok": true, "result": result,
        ]
        try? writeFrame(response, client)
    }

    private func readFrame(_ descriptor: Int32) throws -> [String: Any] {
        var length = UInt32(0)
        try withUnsafeMutableBytes(of: &length) { try readAll($0, descriptor) }
        var data = Data(count: Int(UInt32(bigEndian: length)))
        try data.withUnsafeMutableBytes { try readAll($0, descriptor) }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func writeFrame(_ object: [String: Any], _ descriptor: Int32) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        var length = UInt32(data.count).bigEndian
        try withUnsafeBytes(of: &length) { try writeAll($0, descriptor) }
        try data.withUnsafeBytes { try writeAll($0, descriptor) }
    }

    private func readAll(_ buffer: UnsafeMutableRawBufferPointer, _ descriptor: Int32) throws {
        var offset = 0
        while offset < buffer.count {
            let count = Darwin.read(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            guard count > 0 else { throw POSIXError(.ECONNRESET) }
            offset += count
        }
    }

    private func writeAll(_ buffer: UnsafeRawBufferPointer, _ descriptor: Int32) throws {
        var offset = 0
        while offset < buffer.count {
            let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            guard count > 0 else { throw POSIXError(.ECONNRESET) }
            offset += count
        }
    }
}
