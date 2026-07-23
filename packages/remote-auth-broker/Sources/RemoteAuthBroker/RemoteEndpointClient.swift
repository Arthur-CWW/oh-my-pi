import CryptoKit
import Darwin
import Foundation
import RemoteAuthProtocol

public enum RemoteEndpointError: Error, Equatable, Sendable {
    case invalidConfiguration
    case pinnedHostKeyMismatch
    case wrongForcedPrincipal
    case invalidFrame
    case responseTooLarge
    case invalidResponse
    case requestMismatch
    case remoteRejected(PublicError?)
    case transportRejected
    case timeout
}

public enum RemoteForcedPrincipal: String, Codable, Sendable {
    case gdm = "remote-auth-gdm-ingest"
    case sudo = "remote-auth-sudo-ingest"
}

/// The known-hosts file is provisioned separately from policy because OpenSSH
/// cannot enforce the policy's lowercase hexadecimal SHA-256 digest directly.
/// It is revalidated against that digest immediately before every connection.
public struct RemoteEndpointConfiguration: Equatable, Sendable {
    public let endpoint: String
    public let forcedPrincipal: RemoteForcedPrincipal
    public let pinnedHostKeySHA256: String
    public let knownHostsFile: String
    public let timeoutMilliseconds: UInt64

    public init(
        endpoint: String,
        forcedPrincipal: RemoteForcedPrincipal,
        pinnedHostKeySHA256: String,
        knownHostsFile: String,
        timeoutMilliseconds: UInt64 = 10_000
    ) throws {
        self.endpoint = endpoint
        self.forcedPrincipal = forcedPrincipal
        self.pinnedHostKeySHA256 = pinnedHostKeySHA256
        self.knownHostsFile = knownHostsFile
        self.timeoutMilliseconds = timeoutMilliseconds
        try RemoteEndpointPolicyValidator.validate(self)
    }
}

public enum RemoteEndpointPolicyValidator {
    public static func validate(_ configuration: RemoteEndpointConfiguration) throws {
        guard isEndpoint(configuration.endpoint),
              isFingerprint(configuration.pinnedHostKeySHA256),
              isSafeAbsolutePath(configuration.knownHostsFile),
              (1...30_000).contains(configuration.timeoutMilliseconds)
        else {
            throw RemoteEndpointError.invalidConfiguration
        }
    }

    static func validateKnownHostsContents(
        _ data: Data,
        endpoint: String,
        pinnedHostKeySHA256: String
    ) throws {
        guard data.count <= 4_096,
              let text = String(data: data, encoding: .utf8)
        else { throw RemoteEndpointError.pinnedHostKeyMismatch }

        let line: Substring
        if text.hasSuffix("\n") {
            let withoutNewline = text.dropLast()
            guard !withoutNewline.hasSuffix("\n"), !withoutNewline.contains("\r") else {
                throw RemoteEndpointError.pinnedHostKeyMismatch
            }
            line = withoutNewline
        } else {
            guard !text.contains("\n"), !text.contains("\r") else {
                throw RemoteEndpointError.pinnedHostKeyMismatch
            }
            line = text[...]
        }

        let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
        guard fields.count == 3,
              fields[0] == endpoint[...],
              fields[1] == "ssh-ed25519",
              let blob = Data(base64Encoded: String(fields[2])),
              blob.base64EncodedString() == fields[2],
              isED25519PublicKeyBlob(blob)
        else { throw RemoteEndpointError.pinnedHostKeyMismatch }

        let digest = SHA256.hash(data: blob)
        guard constantTimeMatches(digest, lowercaseHex: pinnedHostKeySHA256) else {
            throw RemoteEndpointError.pinnedHostKeyMismatch
        }
    }

    private static func isEndpoint(_ value: String) -> Bool {
        let bytes = value.utf8
        guard (1...255).contains(bytes.count),
              let first = bytes.first,
              isASCIIAlphanumeric(first)
        else { return false }
        return bytes.dropFirst().allSatisfy {
            isASCIIAlphanumeric($0) || $0 == 0x2d || $0 == 0x2e
        }
    }

    private static func isFingerprint(_ value: String) -> Bool {
        let bytes = value.utf8
        guard bytes.count == SHA256.byteCount * 2 else { return false }
        return bytes.allSatisfy {
            (0x30...0x39).contains($0) || (0x61...0x66).contains($0)
        }
    }

    private static func constantTimeMatches(
        _ digest: SHA256.Digest,
        lowercaseHex expected: String
    ) -> Bool {
        guard isFingerprint(expected) else { return false }

        var expectedBytes = expected.utf8.makeIterator()
        var difference: UInt8 = 0
        digest.withUnsafeBytes { digestBytes in
            for byte in digestBytes {
                difference |= lowercaseHexDigit(byte >> 4) ^ expectedBytes.next()!
                difference |= lowercaseHexDigit(byte & 0x0f) ^ expectedBytes.next()!
            }
        }
        return difference == 0
    }

    private static func lowercaseHexDigit(_ nibble: UInt8) -> UInt8 {
        nibble < 10 ? nibble + 0x30 : nibble + 0x57
    }

    private static func isSafeAbsolutePath(_ value: String) -> Bool {
        guard value.utf8.count <= 1_024, value.first == "/" else { return false }
        return value.utf8.allSatisfy {
            isASCIIAlphanumeric($0) || $0 == 0x2f || $0 == 0x2e || $0 == 0x5f || $0 == 0x2d
        }
    }

    private static func isASCIIAlphanumeric(_ byte: UInt8) -> Bool {
        (0x30...0x39).contains(byte) || (0x41...0x5a).contains(byte) || (0x61...0x7a).contains(byte)
    }

    private static func isED25519PublicKeyBlob(_ blob: Data) -> Bool {
        let algorithm = Array("ssh-ed25519".utf8)
        guard blob.count == 4 + algorithm.count + 4 + 32 else { return false }
        return blob.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self)
            let algorithmLength = UInt32(bytes[0]) << 24
                | UInt32(bytes[1]) << 16
                | UInt32(bytes[2]) << 8
                | UInt32(bytes[3])
            guard algorithmLength == UInt32(algorithm.count) else { return false }
            for index in algorithm.indices where bytes[4 + index] != algorithm[index] { return false }
            let keyLengthOffset = 4 + algorithm.count
            let keyLength = UInt32(bytes[keyLengthOffset]) << 24
                | UInt32(bytes[keyLengthOffset + 1]) << 16
                | UInt32(bytes[keyLengthOffset + 2]) << 8
                | UInt32(bytes[keyLengthOffset + 3])
            return keyLength == 32
        }
    }
}

public enum GDMChallengeAction: String, Codable, Sendable {
    case issueChallenge = "issue-challenge"
}

public struct GDMChallengeRequest: Codable, Equatable, Sendable {
    public let protocolVersion: UInt32
    public let action: GDMChallengeAction

    public init(protocolVersion: UInt32 = remoteAuthProtocolVersionV1, action: GDMChallengeAction = .issueChallenge) {
        self.protocolVersion = protocolVersion
        self.action = action
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case protocolVersion, action }

    public init(from decoder: Decoder) throws {
        try decoder.rejectRemoteEndpointUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        action = try container.decode(GDMChallengeAction.self, forKey: .action)
        guard protocolVersion == remoteAuthProtocolVersionV1 else {
            throw RemoteEndpointError.invalidResponse
        }
    }
}

public struct GDMIngestMetadata: Codable, Equatable, Sendable {
    public let protocolVersion: UInt32
    public let requestId: String?
    public let accepted: Bool
    public let error: PublicError?

    public init(protocolVersion: UInt32, requestId: String?, accepted: Bool, error: PublicError?) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.accepted = accepted
        self.error = error
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, requestId, accepted, error
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectRemoteEndpointUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard CodingKeys.allCases.allSatisfy(container.contains) else {
            throw RemoteEndpointError.invalidResponse
        }
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
        accepted = try container.decode(Bool.self, forKey: .accepted)
        error = try container.decodeIfPresent(PublicError.self, forKey: .error)
        guard protocolVersion == remoteAuthProtocolVersionV1 else {
            throw RemoteEndpointError.invalidResponse
        }
        if accepted {
            guard requestId != nil, error == nil else { throw RemoteEndpointError.invalidResponse }
        } else {
            guard error != nil else { throw RemoteEndpointError.invalidResponse }
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(accepted, forKey: .accepted)
        try container.encode(error, forKey: .error)
    }
}

public enum GDMStatusAction: String, Codable, Sendable {
    case requestStatus = "request-status"
}

public struct GDMStatusRequest: Codable, Equatable, Sendable {
    public let protocolVersion: UInt32
    public let action: GDMStatusAction
    public let requestId: String
    public let issueId: String
    public let nonce: String

    public init(
        protocolVersion: UInt32 = remoteAuthProtocolVersionV1,
        action: GDMStatusAction = .requestStatus,
        requestId: String,
        issueId: String,
        nonce: String
    ) {
        self.protocolVersion = protocolVersion
        self.action = action
        self.requestId = requestId
        self.issueId = issueId
        self.nonce = nonce
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, action, requestId, issueId, nonce
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectRemoteEndpointUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard CodingKeys.allCases.allSatisfy(container.contains) else {
            throw RemoteEndpointError.invalidResponse
        }
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        action = try container.decode(GDMStatusAction.self, forKey: .action)
        requestId = try container.decode(String.self, forKey: .requestId)
        issueId = try container.decode(String.self, forKey: .issueId)
        nonce = try container.decode(String.self, forKey: .nonce)
        guard protocolVersion == remoteAuthProtocolVersionV1 else {
            throw RemoteEndpointError.invalidResponse
        }
    }
}

public enum GDMAuthenticationState: String, Codable, CaseIterable, Sendable {
    case pending, claimed, succeeded, expired, failed
}

public struct GDMStatusMetadata: Codable, Equatable, Sendable {
    public let protocolVersion: UInt32
    public let requestId: String
    public let issueId: String
    public let state: GDMAuthenticationState

    public init(
        protocolVersion: UInt32,
        requestId: String,
        issueId: String,
        state: GDMAuthenticationState
    ) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.issueId = issueId
        self.state = state
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, requestId, issueId, state
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectRemoteEndpointUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard CodingKeys.allCases.allSatisfy(container.contains) else {
            throw RemoteEndpointError.invalidResponse
        }
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        requestId = try container.decode(String.self, forKey: .requestId)
        issueId = try container.decode(String.self, forKey: .issueId)
        state = try container.decode(GDMAuthenticationState.self, forKey: .state)
        guard protocolVersion == remoteAuthProtocolVersionV1 else {
            throw RemoteEndpointError.invalidResponse
        }
    }
}

public enum SudoRemoteOutcome: String, Codable, Sendable {
    case succeeded, failed, rejected
}

public struct SudoExecutionMetadata: Codable, Equatable, Sendable {
    public let protocolVersion: UInt32
    public let requestId: String?
    public let outcome: SudoRemoteOutcome
    public let error: PublicError?
    public let exitCode: Int32?
    public let signal: Int32?

    public init(
        protocolVersion: UInt32,
        requestId: String?,
        outcome: SudoRemoteOutcome,
        error: PublicError?,
        exitCode: Int32?,
        signal: Int32?
    ) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.outcome = outcome
        self.error = error
        self.exitCode = exitCode
        self.signal = signal
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, requestId, outcome, error, exitCode, signal
    }

    public init(from decoder: Decoder) throws {
        try decoder.rejectRemoteEndpointUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard CodingKeys.allCases.allSatisfy(container.contains) else {
            throw RemoteEndpointError.invalidResponse
        }
        protocolVersion = try container.decode(UInt32.self, forKey: .protocolVersion)
        requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
        outcome = try container.decode(SudoRemoteOutcome.self, forKey: .outcome)
        error = try container.decodeIfPresent(PublicError.self, forKey: .error)
        exitCode = try container.decodeIfPresent(Int32.self, forKey: .exitCode)
        signal = try container.decodeIfPresent(Int32.self, forKey: .signal)
        guard protocolVersion == remoteAuthProtocolVersionV1 else {
            throw RemoteEndpointError.invalidResponse
        }
        switch outcome {
        case .succeeded:
            guard requestId != nil, error == nil, exitCode == 0, signal == nil else {
                throw RemoteEndpointError.invalidResponse
            }
        case .failed:
            let exited = exitCode.map { $0 != 0 } ?? false
            let signaled = signal.map { $0 > 0 } ?? false
            guard requestId != nil,
                  error == .executionFailed,
                  !(exited && signaled),
                  exitCode == nil || exited,
                  signal == nil || signaled
            else { throw RemoteEndpointError.invalidResponse }
        case .rejected:
            guard error != nil, exitCode == nil, signal == nil else {
                throw RemoteEndpointError.invalidResponse
            }
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(outcome, forKey: .outcome)
        try container.encode(error, forKey: .error)
        try container.encode(exitCode, forKey: .exitCode)
        try container.encode(signal, forKey: .signal)
    }
}

public enum SudoDirectExecutionReceipt: Equatable, Sendable {
    case succeeded(requestId: String)
    case failed(requestId: String, exitCode: Int32?, signal: Int32?)
    case rejected(requestId: String, error: PublicError)
}

public enum RemoteEndpointWireCodec {
    public static let maximumMetadataPayloadBytes = 4_096

    public static func encodeFrame<T: Encodable>(
        _ value: T,
        maximumPayloadBytes: Int = remoteAuthMaximumFrameBytes
    ) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let payload: Data
        do {
            payload = try encoder.encode(value)
        } catch {
            throw RemoteEndpointError.invalidFrame
        }
        guard !payload.isEmpty, payload.count <= maximumPayloadBytes, payload.count <= Int(UInt32.max) else {
            throw RemoteEndpointError.invalidFrame
        }
        var frame = Data(capacity: 4 + payload.count)
        let length = UInt32(payload.count)
        frame.append(UInt8(truncatingIfNeeded: length >> 24))
        frame.append(UInt8(truncatingIfNeeded: length >> 16))
        frame.append(UInt8(truncatingIfNeeded: length >> 8))
        frame.append(UInt8(truncatingIfNeeded: length))
        frame.append(payload)
        return frame
    }

    public static func decodeFrame<T: Decodable>(
        _ type: T.Type,
        from frame: Data,
        maximumPayloadBytes: Int = maximumMetadataPayloadBytes
    ) throws -> T {
        guard frame.count >= 4 else { throw RemoteEndpointError.invalidFrame }
        let length = frame.withUnsafeBytes { raw -> UInt32 in
            let bytes = raw.bindMemory(to: UInt8.self)
            return UInt32(bytes[0]) << 24
                | UInt32(bytes[1]) << 16
                | UInt32(bytes[2]) << 8
                | UInt32(bytes[3])
        }
        guard length > 0,
              Int(length) <= maximumPayloadBytes,
              frame.count == 4 + Int(length)
        else {
            if Int(length) > maximumPayloadBytes { throw RemoteEndpointError.responseTooLarge }
            throw RemoteEndpointError.invalidFrame
        }
        do {
            return try JSONDecoder().decode(type, from: frame.subdata(in: 4..<frame.count))
        } catch let error as RemoteEndpointError {
            throw error
        } catch {
            throw RemoteEndpointError.invalidResponse
        }
    }

    public static func parseGDMChallenge(from frame: Data) throws -> GDMChallenge {
        let challenge: GDMChallenge = try decodeFrame(GDMChallenge.self, from: frame)
        do {
            try challenge.validate()
            return challenge
        } catch {
            throw RemoteEndpointError.invalidResponse
        }
    }

    public static func parseGDMIngestMetadata(
        from frame: Data,
        expectedRequestId: String
    ) throws -> GDMIngestMetadata {
        let metadata: GDMIngestMetadata = try decodeFrame(GDMIngestMetadata.self, from: frame)
        guard metadata.requestId == expectedRequestId else { throw RemoteEndpointError.requestMismatch }
        guard metadata.accepted else { throw RemoteEndpointError.remoteRejected(metadata.error) }
        return metadata
    }

    public static func parseGDMStatus(
        from frame: Data,
        expectedRequestId: String,
        expectedIssueId: String
    ) throws -> GDMStatusMetadata {
        let metadata: GDMStatusMetadata = try decodeFrame(GDMStatusMetadata.self, from: frame)
        guard metadata.requestId == expectedRequestId,
              metadata.issueId == expectedIssueId
        else { throw RemoteEndpointError.requestMismatch }
        return metadata
    }

    public static func parseSudoReceipt(
        from frame: Data,
        expectedRequestId: String
    ) throws -> SudoDirectExecutionReceipt {
        let metadata: SudoExecutionMetadata = try decodeFrame(SudoExecutionMetadata.self, from: frame)
        guard metadata.requestId == expectedRequestId else { throw RemoteEndpointError.requestMismatch }
        switch metadata.outcome {
        case .succeeded:
            return .succeeded(requestId: expectedRequestId)
        case .failed:
            return .failed(requestId: expectedRequestId, exitCode: metadata.exitCode, signal: metadata.signal)
        case .rejected:
            guard let error = metadata.error else { throw RemoteEndpointError.invalidResponse }
            return .rejected(requestId: expectedRequestId, error: error)
        }
    }
}

public final class RemoteEndpointClient: @unchecked Sendable {
    private static let sshExecutable = "/usr/bin/ssh"
    private let configuration: RemoteEndpointConfiguration

    public init(configuration: RemoteEndpointConfiguration) {
        self.configuration = configuration
    }

    public func issueGDMChallenge() throws -> GDMChallenge {
        try requirePrincipal(.gdm)
        let frame = try RemoteEndpointWireCodec.encodeFrame(GDMChallengeRequest())
        return try RemoteEndpointWireCodec.parseGDMChallenge(from: exchange(frame))
    }

    public func ingestGDMEnvelope(_ envelope: GDMEnvelope) throws -> GDMIngestMetadata {
        try requirePrincipal(.gdm)
        do { try envelope.validate() } catch { throw RemoteEndpointError.invalidFrame }
        let frame = try RemoteEndpointWireCodec.encodeFrame(envelope)
        return try RemoteEndpointWireCodec.parseGDMIngestMetadata(
            from: exchange(frame),
            expectedRequestId: envelope.request.requestId
        )
    }

    public func probeGDM(policyDigest: String) throws {
        let challenge = try issueGDMChallenge()
        guard challenge.policyDigest == policyDigest else {
            throw RemoteEndpointError.requestMismatch
        }
    }

    public func queryGDMStatus(
        requestId: String,
        issueId: String,
        nonce: String,
        timeoutMilliseconds: UInt64? = nil
    ) throws -> GDMStatusMetadata {
        try requirePrincipal(.gdm)
        let request = GDMStatusRequest(
            requestId: requestId,
            issueId: issueId,
            nonce: nonce
        )
        let frame = try RemoteEndpointWireCodec.encodeFrame(request)
        return try RemoteEndpointWireCodec.parseGDMStatus(
            from: exchange(frame, timeoutMilliseconds: timeoutMilliseconds),
            expectedRequestId: requestId,
            expectedIssueId: issueId
        )
    }

    public func waitForGDMAuthentication(
        requestId: String,
        issueId: String,
        nonce: String,
        expiresAtMilliseconds: UInt64,
        pollIntervalMilliseconds: UInt64 = 100
    ) throws {
        guard pollIntervalMilliseconds > 0 else {
            throw RemoteEndpointError.invalidConfiguration
        }
        let wallNow = Self.wallClockMilliseconds()
        guard expiresAtMilliseconds > wallNow else {
            throw RemoteEndpointError.timeout
        }
        let duration = (expiresAtMilliseconds - wallNow)
            .multipliedReportingOverflow(by: 1_000_000)
        let deadline = DispatchTime.now().uptimeNanoseconds
            .addingReportingOverflow(duration.partialValue)
        guard !duration.overflow, !deadline.overflow else {
            throw RemoteEndpointError.invalidConfiguration
        }

        while true {
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline.partialValue else {
                throw RemoteEndpointError.timeout
            }
            let remainingNanoseconds = deadline.partialValue - now
            let remainingMilliseconds = remainingNanoseconds / 1_000_000
                + (remainingNanoseconds % 1_000_000 == 0 ? 0 : 1)
            let status = try queryGDMStatus(
                requestId: requestId,
                issueId: issueId,
                nonce: nonce,
                timeoutMilliseconds: min(configuration.timeoutMilliseconds, remainingMilliseconds)
            )
            if try Self.authenticationSucceeded(status.state) {
                return
            }
            let afterQuery = DispatchTime.now().uptimeNanoseconds
            guard afterQuery < deadline.partialValue else {
                throw RemoteEndpointError.timeout
            }
            let remaining = deadline.partialValue - afterQuery
            let requestedSleep = pollIntervalMilliseconds
                .multipliedReportingOverflow(by: 1_000_000)
            let sleepNanoseconds = requestedSleep.overflow
                ? remaining
                : min(remaining, requestedSleep.partialValue)
            usleep(useconds_t(min(sleepNanoseconds / 1_000, UInt64(useconds_t.max))))
        }
    }

    static func authenticationSucceeded(_ state: GDMAuthenticationState) throws -> Bool {
        switch state {
        case .succeeded:
            return true
        case .pending, .claimed:
            return false
        case .expired, .failed:
            throw RemoteEndpointError.remoteRejected(.executionFailed)
        }
    }

    public func executeSudo(_ request: SudoSignedRequest) throws -> SudoDirectExecutionReceipt {
        try requirePrincipal(.sudo)
        do { try request.validate() } catch { throw RemoteEndpointError.invalidFrame }
        let frame = try RemoteEndpointWireCodec.encodeFrame(request)
        return try RemoteEndpointWireCodec.parseSudoReceipt(
            from: exchange(frame),
            expectedRequestId: request.request.requestId
        )
    }

    private func requirePrincipal(_ expected: RemoteForcedPrincipal) throws {
        guard configuration.forcedPrincipal == expected else {
            throw RemoteEndpointError.wrongForcedPrincipal
        }
    }

    private func exchange(
        _ requestFrame: Data,
        timeoutMilliseconds: UInt64? = nil
    ) throws -> Data {
        try validateKnownHostsFile()

        let process = Process()
        let input = Pipe()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: Self.sshExecutable)
        process.arguments = sshArguments()
        process.environment = ["LANG": "C", "LC_ALL": "C"]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            throw RemoteEndpointError.transportRejected
        }
        input.fileHandleForReading.closeFile()
        output.fileHandleForWriting.closeFile()

        let inputHandle = input.fileHandleForWriting
        let outputHandle = output.fileHandleForReading
        defer {
            inputHandle.closeFile()
            outputHandle.closeFile()
            if process.isRunning { Self.terminate(process) }
        }

        guard Self.makeNonblocking(inputHandle.fileDescriptor),
              Self.makeNonblocking(outputHandle.fileDescriptor)
        else {
            Self.terminate(process)
            throw RemoteEndpointError.transportRejected
        }

        let effectiveTimeout = min(
            timeoutMilliseconds ?? configuration.timeoutMilliseconds,
            configuration.timeoutMilliseconds
        )
        guard effectiveTimeout > 0 else { throw RemoteEndpointError.timeout }
        let deadline = DispatchTime.now().uptimeNanoseconds
            &+ effectiveTimeout &* 1_000_000
        var requestOffset = 0
        var inputClosed = false
        var response = Data()
        response.reserveCapacity(remoteAuthMaximumFrameBytes)
        var readBuffer = [UInt8](repeating: 0, count: 4_096)
        var reachedEOF = false

        while true {
            if !inputClosed {
                if requestOffset == requestFrame.count {
                    inputHandle.closeFile()
                    inputClosed = true
                } else {
                    let written = requestFrame.withUnsafeBytes { raw -> Int in
                        Darwin.write(
                            inputHandle.fileDescriptor,
                            raw.baseAddress!.advanced(by: requestOffset),
                            requestFrame.count - requestOffset
                        )
                    }
                    if written > 0 {
                        requestOffset += written
                    } else if written < 0 && errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK {
                        Self.terminate(process)
                        throw RemoteEndpointError.transportRejected
                    }
                }
            }

            while !reachedEOF {
                let count = Darwin.read(outputHandle.fileDescriptor, &readBuffer, readBuffer.count)
                if count > 0 {
                    guard count <= remoteAuthMaximumFrameBytes - response.count else {
                        Self.terminate(process)
                        throw RemoteEndpointError.responseTooLarge
                    }
                    response.append(readBuffer, count: count)
                } else if count == 0 {
                    reachedEOF = true
                } else if errno == EINTR {
                    continue
                } else if errno == EAGAIN || errno == EWOULDBLOCK {
                    break
                } else {
                    Self.terminate(process)
                    throw RemoteEndpointError.transportRejected
                }
            }


            if !process.isRunning, reachedEOF {
                process.waitUntilExit()
                guard inputClosed,
                      process.terminationReason == .exit,
                      process.terminationStatus == 0
                else { throw RemoteEndpointError.transportRejected }
                return response
            }
            guard DispatchTime.now().uptimeNanoseconds < deadline else {
                Self.terminate(process)
                throw RemoteEndpointError.timeout
            }
            usleep(5_000)
        }
    }

    private static func wallClockMilliseconds() -> UInt64 {
        let milliseconds = Date().timeIntervalSince1970 * 1_000
        return milliseconds > 0 && milliseconds < Double(UInt64.max)
            ? UInt64(milliseconds)
            : 0
    }

    private func sshArguments() -> [String] {
        [
            "-F", "/dev/null",
            "-T",
            "-o", "BatchMode=yes",
            "-o", "CanonicalizeHostname=no",
            "-o", "CheckHostIP=no",
            "-o", "ClearAllForwardings=yes",
            "-o", "ConnectionAttempts=1",
            "-o", "ConnectTimeout=5",
            "-o", "EnableEscapeCommandline=no",
            "-o", "ForwardAgent=no",
            "-o", "ForwardX11=no",
            "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", "HostKeyAlgorithms=ssh-ed25519",
            "-o", "HostKeyAlias=\(configuration.endpoint)",
            "-o", "IdentitiesOnly=yes",
            "-o", "IdentityAgent=none",
            "-o", "LogLevel=ERROR",
            "-o", "PermitLocalCommand=no",
            "-o", "ProxyCommand=none",
            "-o", "ProxyJump=none",
            "-o", "RequestTTY=no",
            "-o", "StrictHostKeyChecking=yes",
            "-o", "UpdateHostKeys=no",
            "-o", "UserKnownHostsFile=\(configuration.knownHostsFile)",
            "-o", "VerifyHostKeyDNS=no",
            "\(configuration.forcedPrincipal.rawValue)@\(configuration.endpoint)",
        ]
    }

    private func validateKnownHostsFile() throws {
        var status = stat()
        guard lstat(configuration.knownHostsFile, &status) == 0,
              status.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              (status.st_uid == 0 || status.st_uid == getuid()),
              status.st_mode & mode_t(0o022) == 0,
              status.st_size >= 0,
              status.st_size <= 4_096
        else { throw RemoteEndpointError.pinnedHostKeyMismatch }
        let contents: Data
        do {
            contents = try Data(contentsOf: URL(fileURLWithPath: configuration.knownHostsFile), options: .mappedIfSafe)
        } catch {
            throw RemoteEndpointError.pinnedHostKeyMismatch
        }
        try RemoteEndpointPolicyValidator.validateKnownHostsContents(
            contents,
            endpoint: configuration.endpoint,
            pinnedHostKeySHA256: configuration.pinnedHostKeySHA256
        )
    }

    private static func makeNonblocking(_ descriptor: Int32) -> Bool {
        let flags = fcntl(descriptor, F_GETFL)
        return flags >= 0 && fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0
    }

    private static func terminate(_ process: Process) {
        guard process.isRunning else {
            process.waitUntilExit()
            return
        }
        process.terminate()
        let deadline = DispatchTime.now().uptimeNanoseconds + 250_000_000
        while process.isRunning && DispatchTime.now().uptimeNanoseconds < deadline {
            usleep(5_000)
        }
        if process.isRunning {
            _ = Darwin.kill(process.processIdentifier, SIGKILL)
            while process.isRunning { usleep(1_000) }
        }
        process.waitUntilExit()
    }
}

private struct RemoteEndpointAnyCodingKey: CodingKey, Hashable {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private extension Decoder {
    func rejectRemoteEndpointUnknownKeys<K>(_ keyType: K.Type) throws
    where K: CodingKey & CaseIterable, K.AllCases: Collection {
        let container = try self.container(keyedBy: RemoteEndpointAnyCodingKey.self)
        let allowed = Set(K.allCases.map(\.stringValue))
        guard container.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw RemoteEndpointError.invalidResponse
        }
    }
}
