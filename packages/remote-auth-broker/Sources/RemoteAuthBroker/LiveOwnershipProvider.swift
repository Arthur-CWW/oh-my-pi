import Darwin
import Foundation
import RemoteAuthProtocol

public struct LiveOwnershipProvider: LivePeerOwnershipProviding, Sendable {
    private let timeoutMilliseconds: Int32
    private let registryReader: LiveOwnershipRegistryReader

    public init(timeoutMilliseconds: Int32 = 500) {
        self.timeoutMilliseconds = timeoutMilliseconds
        self.registryReader = LiveOwnershipRegistryReader()
    }

    init(
        timeoutMilliseconds: Int32 = 500,
        registryReader: LiveOwnershipRegistryReader
    ) {
        self.timeoutMilliseconds = timeoutMilliseconds
        self.registryReader = registryReader
    }

    public func ownership(
        for attestedPeer: AttestedPeer,
        principal: Principal
    ) throws -> LivePeerOwnership {
        do { try principal.validate() } catch { throw RemoteAuthProtocolError(.principalInvalid) }
        guard timeoutMilliseconds > 0,
              attestedPeer.pid > 0,
              UInt64(attestedPeer.pid) <= UInt64(UInt32.max),
              UInt64(attestedPeer.uid) <= UInt64(UInt32.max),
              principal.pid == UInt32(attestedPeer.pid),
              principal.uid == UInt32(attestedPeer.uid),
              principal.codeIdentity == attestedPeer.signingIdentifier,
              principal.buildDigest == attestedPeer.executableSHA256
        else { throw RemoteAuthProtocolError(.peerMismatch) }

        let registryRecord: LiveOwnershipRegistryRecord
        do {
            registryRecord = try registryReader.resolve(
                sessionId: principal.sessionId,
                ownerUID: attestedPeer.uid
            )
        } catch {
            throw RemoteAuthProtocolError(.ownerStale)
        }
        guard registryRecord.pid == principal.pid,
              registryRecord.pid == UInt32(attestedPeer.pid),
              registryRecord.ownerEpoch == principal.ownerEpoch,
              registryRecord.buildDigest == principal.buildDigest,
              registryRecord.buildDigest == attestedPeer.executableSHA256,
              registryRecord.ownershipSocketPath == principal.ownershipSocketPath
        else { throw RemoteAuthProtocolError(.ownerStale) }

        let nonce = UUID().uuidString.lowercased()
        let correlationId = UUID().uuidString.lowercased()
        let requestId = UUID().uuidString.lowercased()
        let payload: [String: Any] = [
            "nonce": nonce,
            "sessionId": principal.sessionId,
            "ownerEpoch": principal.ownerEpoch,
            "runnerInstanceId": principal.runnerInstanceIdentity,
            "buildDigest": principal.buildDigest,
            "ownerPid": principal.pid,
            "ownershipSocketPath": principal.ownershipSocketPath,
        ]
        let request: [String: Any] = [
            "kind": "request",
            "correlationId": correlationId,
            "requestId": requestId,
            "operation": "ownerProof",
            "payload": payload,
        ]

        let descriptor = try connect(path: registryRecord.ownershipSocketPath, ownerUID: attestedPeer.uid)
        defer { Darwin.close(descriptor) }
        do {
            try writeFrame(request, to: descriptor)
            let response = try readFrame(from: descriptor)
            try verify(
                response,
                correlationId: correlationId,
                requestId: requestId,
                nonce: nonce,
                principal: principal,
                ownerPid: principal.pid
            )
            let currentRecord = try registryReader.resolve(
                sessionId: principal.sessionId,
                ownerUID: attestedPeer.uid
            )
            guard currentRecord == registryRecord else {
                throw RemoteAuthProtocolError(.ownerStale)
            }
        } catch let error as RemoteAuthProtocolError {
            throw error
        } catch {
            throw RemoteAuthProtocolError(.ownerStale)
        }
        return LivePeerOwnership(
            sessionId: principal.sessionId,
            ownerEpoch: principal.ownerEpoch,
            runnerInstanceIdentity: principal.runnerInstanceIdentity
        )
    }

    private func connect(path: String, ownerUID: uid_t) throws -> Int32 {
        var status = stat()
        guard path.withCString({ Darwin.lstat($0, &status) }) == 0,
              (status.st_mode & S_IFMT) == S_IFSOCK,
              status.st_uid == ownerUID,
              (status.st_mode & 0o777) == 0o600
        else { throw RemoteAuthProtocolError(.ownerStale) }
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw RemoteAuthProtocolError(.ownerStale) }
        do {
            var timeout = timeval(
                tv_sec: Int(timeoutMilliseconds / 1_000),
                tv_usec: Int32(timeoutMilliseconds % 1_000) * 1_000
            )
            guard Darwin.setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0,
                  Darwin.setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0
            else { throw RemoteAuthProtocolError(.ownerStale) }

            let bytes = Array(path.utf8)
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
                throw RemoteAuthProtocolError(.principalInvalid)
            }
            withUnsafeMutableBytes(of: &address.sun_path) { destination in
                destination.copyBytes(from: bytes)
                destination[bytes.count] = 0
            }
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            let connected = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard connected == 0 else { throw RemoteAuthProtocolError(.ownerStale) }
            return descriptor
        } catch {
            Darwin.close(descriptor)
            throw error
        }
    }

    private func writeFrame(_ object: [String: Any], to descriptor: Int32) throws {
        let body = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard body.count <= 65_536 else { throw RemoteAuthProtocolError(.protocolInvalid) }
        var length = UInt32(body.count).bigEndian
        try withUnsafeBytes(of: &length) { try writeAll($0, to: descriptor) }
        try body.withUnsafeBytes { try writeAll($0, to: descriptor) }
    }

    private func writeAll(_ bytes: UnsafeRawBufferPointer, to descriptor: Int32) throws {
        var offset = 0
        while offset < bytes.count {
            let count = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            if count > 0 { offset += count; continue }
            if count < 0 && errno == EINTR { continue }
            throw RemoteAuthProtocolError(.ownerStale)
        }
    }

    private func readFrame(from descriptor: Int32) throws -> [String: Any] {
        var length = UInt32(0)
        try withUnsafeMutableBytes(of: &length) { try readAll($0, from: descriptor) }
        let count = Int(UInt32(bigEndian: length))
        guard (1...65_536).contains(count) else { throw RemoteAuthProtocolError(.protocolInvalid) }
        var body = Data(count: count)
        try body.withUnsafeMutableBytes { try readAll($0, from: descriptor) }
        guard let object = try JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        return object
    }

    private func readAll(_ bytes: UnsafeMutableRawBufferPointer, from descriptor: Int32) throws {
        var offset = 0
        while offset < bytes.count {
            let count = Darwin.read(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            if count > 0 { offset += count; continue }
            if count < 0 && errno == EINTR { continue }
            throw RemoteAuthProtocolError(.ownerStale)
        }
    }

    private func verify(
        _ response: [String: Any],
        correlationId: String,
        requestId: String,
        nonce: String,
        principal: Principal,
        ownerPid: UInt32
    ) throws {
        guard Set(response.keys) == ["kind", "correlationId", "requestId", "ok", "result"],
              response["kind"] as? String == "response",
              response["correlationId"] as? String == correlationId,
              response["requestId"] as? String == requestId,
              response["ok"] as? Bool == true,
              let proof = response["result"] as? [String: Any],
              Set(proof.keys) == ["t", "nonce", "sessionId", "ownerEpoch", "buildRevision", "runnerInstanceId", "sessionMatch", "phase", "ownerPid", "ownershipSocketPath"],
              proof["t"] as? String == "ownerProof",
              proof["nonce"] as? String == nonce,
              proof["sessionId"] as? String == principal.sessionId,
              proof["ownerEpoch"] as? String == principal.ownerEpoch,
              proof["runnerInstanceId"] as? String == principal.runnerInstanceIdentity,
              proof["sessionMatch"] as? Bool == true,
              proof["phase"] as? String == "running",
              (proof["ownerPid"] as? NSNumber)?.uint32Value == ownerPid,
              proof["ownershipSocketPath"] as? String == principal.ownershipSocketPath,
              let build = proof["buildRevision"] as? [String: Any],
              Set(build.keys) == ["digest", "version"],
              build["digest"] as? String == principal.buildDigest,
              let version = build["version"] as? String,
              !version.isEmpty
        else { throw RemoteAuthProtocolError(.ownerStale) }
    }
}
