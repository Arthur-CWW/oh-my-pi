import Darwin
import Foundation

internal enum CloudCDPValue: Codable, Sendable, Equatable {
    case null
    case boolean(Bool)
    case integer(Int64)
    case unsignedInteger(UInt64)
    case number(Double)
    case string(String)
    case array([CloudCDPValue])
    case object([String: CloudCDPValue])

    internal init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Int64.self) {
            self = .integer(value)
        } else if let value = try? container.decode(UInt64.self) {
            self = .unsignedInteger(value)
        } else if let value = try? container.decode(Double.self), value.isFinite {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([CloudCDPValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: CloudCDPValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "cloud_cdp_invalid_json_value"
            )
        }
    }

    internal func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case let .boolean(value):
            try container.encode(value)
        case let .integer(value):
            try container.encode(value)
        case let .unsignedInteger(value):
            try container.encode(value)
        case let .number(value):
            guard value.isFinite else {
                throw EncodingError.invalidValue(
                    value,
                    EncodingError.Context(
                        codingPath: encoder.codingPath,
                        debugDescription: "cloud_cdp_non_finite_number"
                    )
                )
            }
            try container.encode(value)
        case let .string(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        }
    }
}

internal enum CDPNullPipeError: Error, Equatable, Sendable {
    case invalidLimits
    case invalidRequest
    case messageTooLarge
    case bufferedDataLimit
    case emptyFrame
    case malformedJSON
    case protocolViolation
    case responseMismatch
    case commandFailed
    case identifierExhausted
    case ignoredEventLimit
    case invalidTimeout
    case timedOut
    case transportClosed
    case systemCall(String, Int32)
}

internal struct CloudCDPLimits: Sendable, Equatable {
    internal let maximumMessageBytes: Int
    internal let maximumBufferedBytes: Int
    internal let maximumJSONDepth: Int
    internal let maximumJSONNodes: Int
    internal let maximumJSONStringBytes: Int
    internal let maximumIgnoredEventCount: Int
    internal let maximumIgnoredEventBytes: Int

    internal init(
        maximumMessageBytes: Int = 1 * 1_024 * 1_024,
        maximumBufferedBytes: Int? = nil,
        maximumJSONDepth: Int = 64,
        maximumJSONNodes: Int = 100_000,
        maximumJSONStringBytes: Int = 256 * 1_024,
        maximumIgnoredEventCount: Int = 256,
        maximumIgnoredEventBytes: Int = 2 * 1_024 * 1_024
    ) throws {
        let derivedBufferSize = maximumMessageBytes.addingReportingOverflow(1)
        guard !derivedBufferSize.overflow else {
            throw CDPNullPipeError.invalidLimits
        }
        let resolvedMaximumBufferedBytes =
            maximumBufferedBytes ?? derivedBufferSize.partialValue
        guard (1...8 * 1_024 * 1_024).contains(maximumMessageBytes),
              resolvedMaximumBufferedBytes > maximumMessageBytes,
              resolvedMaximumBufferedBytes <= 16 * 1_024 * 1_024,
              (1...128).contains(maximumJSONDepth),
              (1...500_000).contains(maximumJSONNodes),
              (1...maximumMessageBytes).contains(maximumJSONStringBytes),
              (0...4_096).contains(maximumIgnoredEventCount),
              (0...32 * 1_024 * 1_024).contains(maximumIgnoredEventBytes)
        else {
            throw CDPNullPipeError.invalidLimits
        }
        self.maximumMessageBytes = maximumMessageBytes
        self.maximumBufferedBytes = resolvedMaximumBufferedBytes
        self.maximumJSONDepth = maximumJSONDepth
        self.maximumJSONNodes = maximumJSONNodes
        self.maximumJSONStringBytes = maximumJSONStringBytes
        self.maximumIgnoredEventCount = maximumIgnoredEventCount
        self.maximumIgnoredEventBytes = maximumIgnoredEventBytes
    }
}

/// Pure NUL framing. Newlines have no framing meaning and empty NUL frames are rejected.
internal struct CDPNullFrameDecoder: Sendable {
    private let limits: CloudCDPLimits
    private var partialFrame: [UInt8] = []

    internal init(limits: CloudCDPLimits) {
        self.limits = limits
        partialFrame.reserveCapacity(min(limits.maximumMessageBytes, 16 * 1_024))
    }

    internal var bufferedByteCount: Int { partialFrame.count }

    internal mutating func append(_ data: Data) throws -> [Data] {
        try data.withUnsafeBytes { bytes in
            try appendBytes(bytes)
        }
    }

    internal mutating func appendBytes(_ bytes: UnsafeRawBufferPointer) throws -> [Data] {
        guard bytes.count <= limits.maximumBufferedBytes - partialFrame.count else {
            throw CDPNullPipeError.bufferedDataLimit
        }

        var frames: [Data] = []
        if bytes.isEmpty { return frames }
        for byte in bytes {
            if byte == 0 {
                guard !partialFrame.isEmpty else {
                    throw CDPNullPipeError.emptyFrame
                }
                frames.append(Data(partialFrame))
                partialFrame.removeAll(keepingCapacity: true)
                continue
            }
            guard partialFrame.count < limits.maximumMessageBytes else {
                throw CDPNullPipeError.messageTooLarge
            }
            partialFrame.append(byte)
        }
        return frames
    }
}

internal enum CDPInboundMessage: Sendable, Equatable {
    case event(sessionIdentifier: String?)
    case result(identifier: UInt64, sessionIdentifier: String?, value: CloudCDPValue)
    case failure(identifier: UInt64, sessionIdentifier: String?)
}

/// Pure bounded JSON/envelope parsing and response correlation for fixture tests.
internal enum CDPResponseParser {
    internal static func parse(
        _ data: Data,
        limits: CloudCDPLimits
    ) throws -> CDPInboundMessage {
        guard !data.isEmpty, data.count <= limits.maximumMessageBytes else {
            throw data.isEmpty ? CDPNullPipeError.emptyFrame : CDPNullPipeError.messageTooLarge
        }
        let decoded = try BoundedCloudCDPJSONParser.decode(data, limits: limits)
        guard case let .object(envelope) = decoded else {
            throw CDPNullPipeError.protocolViolation
        }

        if envelope["id"] != nil {
            return try parseResponse(envelope)
        }
        return try parseEvent(envelope)
    }

    internal static func correlatedResult(
        from message: CDPInboundMessage,
        expectedIdentifier: UInt64,
        expectedSessionIdentifier: String?
    ) throws -> CloudCDPValue {
        switch message {
        case .event:
            throw CDPNullPipeError.protocolViolation
        case let .result(identifier, sessionIdentifier, value):
            guard identifier == expectedIdentifier,
                  sessionIdentifier == expectedSessionIdentifier
            else {
                throw CDPNullPipeError.responseMismatch
            }
            return value
        case let .failure(identifier, sessionIdentifier):
            guard identifier == expectedIdentifier,
                  sessionIdentifier == expectedSessionIdentifier
            else {
                throw CDPNullPipeError.responseMismatch
            }
            throw CDPNullPipeError.commandFailed
        }
    }

    private static func parseResponse(
        _ envelope: [String: CloudCDPValue]
    ) throws -> CDPInboundMessage {
        let allowed = Set(["id", "sessionId", "result", "error"])
        guard envelope.keys.allSatisfy(allowed.contains),
              let identifierValue = envelope["id"],
              let identifier = unsignedInteger(identifierValue),
              identifier > 0
        else {
            throw CDPNullPipeError.protocolViolation
        }
        let sessionIdentifier = try optionalSessionIdentifier(envelope["sessionId"])
        let result = envelope["result"]
        let failure = envelope["error"]
        guard (result != nil) != (failure != nil) else {
            throw CDPNullPipeError.protocolViolation
        }
        if let result {
            return .result(
                identifier: identifier,
                sessionIdentifier: sessionIdentifier,
                value: result
            )
        }
        try validateRemoteFailure(failure!)
        return .failure(identifier: identifier, sessionIdentifier: sessionIdentifier)
    }

    private static func parseEvent(
        _ envelope: [String: CloudCDPValue]
    ) throws -> CDPInboundMessage {
        let allowed = Set(["method", "params", "sessionId"])
        guard envelope.keys.allSatisfy(allowed.contains),
              case let .string(method)? = envelope["method"],
              isValidMethod(method)
        else {
            throw CDPNullPipeError.protocolViolation
        }
        if let params = envelope["params"], case .object = params {
            // CDP event params, when present, are always an object.
        } else if envelope["params"] != nil {
            throw CDPNullPipeError.protocolViolation
        }
        return .event(
            sessionIdentifier: try optionalSessionIdentifier(envelope["sessionId"])
        )
    }

    private static func validateRemoteFailure(_ value: CloudCDPValue) throws {
        guard case let .object(failure) = value else {
            throw CDPNullPipeError.protocolViolation
        }
        let allowed = Set(["code", "message", "data"])
        guard failure.keys.allSatisfy(allowed.contains),
              let code = failure["code"],
              signedInteger(code) != nil,
              case .string? = failure["message"]
        else {
            throw CDPNullPipeError.protocolViolation
        }
    }

    private static func optionalSessionIdentifier(
        _ value: CloudCDPValue?
    ) throws -> String? {
        guard let value else { return nil }
        guard case let .string(identifier) = value,
              isValidSessionIdentifier(identifier)
        else {
            throw CDPNullPipeError.protocolViolation
        }
        return identifier
    }

    private static func unsignedInteger(_ value: CloudCDPValue) -> UInt64? {
        switch value {
        case let .integer(number) where number >= 0:
            return UInt64(number)
        case let .unsignedInteger(number):
            return number
        default:
            return nil
        }
    }

    private static func signedInteger(_ value: CloudCDPValue) -> Int64? {
        switch value {
        case let .integer(number):
            return number
        case let .unsignedInteger(number) where number <= UInt64(Int64.max):
            return Int64(number)
        default:
            return nil
        }
    }

    fileprivate static func isValidMethod(_ method: String) -> Bool {
        let bytes = method.utf8
        guard !bytes.isEmpty,
              bytes.count <= 128,
              bytes.first != 46,
              bytes.last != 46,
              bytes.contains(46)
        else {
            return false
        }
        return bytes.allSatisfy {
            (65...90).contains($0)
                || (97...122).contains($0)
                || (48...57).contains($0)
                || $0 == 45 || $0 == 46 || $0 == 95
        }
    }

    fileprivate static func isValidSessionIdentifier(_ identifier: String) -> Bool {
        let bytes = identifier.utf8
        guard !bytes.isEmpty, bytes.count <= 256 else { return false }
        return bytes.allSatisfy {
            (65...90).contains($0)
                || (97...122).contains($0)
                || (48...57).contains($0)
                || $0 == 45 || $0 == 95
        }
    }
}

internal enum CDPRequestEncoder {
    internal static func encode(
        identifier: UInt64,
        method: String,
        params: [String: CloudCDPValue]?,
        sessionIdentifier: String?,
        limits: CloudCDPLimits
    ) throws -> Data {
        guard identifier > 0,
              CDPResponseParser.isValidMethod(method),
              sessionIdentifier.map(CDPResponseParser.isValidSessionIdentifier) ?? true
        else {
            throw CDPNullPipeError.invalidRequest
        }

        var envelope: [String: CloudCDPValue] = [
            "id": .unsignedInteger(identifier),
            "method": .string(method),
        ]
        if let params { envelope["params"] = .object(params) }
        if let sessionIdentifier { envelope["sessionId"] = .string(sessionIdentifier) }
        try CloudCDPJSONValidator.validate(.object(envelope), limits: limits)

        let encoded: Data
        do {
            encoded = try JSONEncoder().encode(CloudCDPValue.object(envelope))
        } catch {
            throw CDPNullPipeError.invalidRequest
        }
        guard !encoded.isEmpty, encoded.count <= limits.maximumMessageBytes else {
            throw CDPNullPipeError.messageTooLarge
        }
        return encoded
    }
}

internal final class CDPNullPipeConnection: @unchecked Sendable {
    private static let readChunkBytes = 16 * 1_024

    private let descriptorLock = NSLock()
    private var readDescriptor: Int32
    private var writeDescriptor: Int32
    private let limits: CloudCDPLimits
    private var frameDecoder: CDPNullFrameDecoder
    private var pendingFrames: [Data] = []
    private var pendingFrameIndex = 0
    private var readScratch: [UInt8]
    private var nextIdentifier: UInt64 = 1

    internal init(process: ChromePipeProcess, limits: CloudCDPLimits) throws {
        let decoder = CDPNullFrameDecoder(limits: limits)
        let descriptors = try process.takeTransportDescriptors()
        self.limits = limits
        frameDecoder = decoder
        readDescriptor = descriptors.read
        writeDescriptor = descriptors.write
        readScratch = [UInt8](
            repeating: 0,
            count: min(Self.readChunkBytes, limits.maximumBufferedBytes)
        )
    }

    internal convenience init(
        process: ChromePipeProcess,
        maximumMessageBytes: Int,
        maximumJSONDepth: Int,
        maximumJSONNodes: Int,
        maximumJSONStringBytes: Int,
        maximumIgnoredEventCount: Int,
        maximumIgnoredEventBytes: Int
    ) throws {
        let bufferSize = maximumMessageBytes.addingReportingOverflow(1)
        guard !bufferSize.overflow else { throw CDPNullPipeError.invalidLimits }
        try self.init(
            process: process,
            limits: CloudCDPLimits(
                maximumMessageBytes: maximumMessageBytes,
                maximumBufferedBytes: bufferSize.partialValue,
                maximumJSONDepth: maximumJSONDepth,
                maximumJSONNodes: maximumJSONNodes,
                maximumJSONStringBytes: maximumJSONStringBytes,
                maximumIgnoredEventCount: maximumIgnoredEventCount,
                maximumIgnoredEventBytes: maximumIgnoredEventBytes
            )
        )
    }

    deinit {
        close()
    }

    /// The only command primitive visible inside this module. No generic CDP API is public.
    internal func request(
        method: String,
        params: [String: CloudCDPValue]? = nil,
        sessionIdentifier: String? = nil,
        timeoutSeconds: Double
    ) async throws -> CloudCDPValue {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            do {
                return try performRequest(
                    method: method,
                    params: params,
                    sessionIdentifier: sessionIdentifier,
                    timeoutSeconds: timeoutSeconds
                )
            } catch {
                close()
                if Task.isCancelled { throw CancellationError() }
                throw error
            }
        } onCancel: {
            self.close()
        }
    }

    internal func close() {
        descriptorLock.lock()
        let activeRead = readDescriptor
        let activeWrite = writeDescriptor
        readDescriptor = -1
        writeDescriptor = -1
        descriptorLock.unlock()

        if activeRead >= 0 { Darwin.close(activeRead) }
        if activeWrite >= 0 { Darwin.close(activeWrite) }
    }

    private func performRequest(
        method: String,
        params: [String: CloudCDPValue]?,
        sessionIdentifier: String?,
        timeoutSeconds: Double
    ) throws -> CloudCDPValue {
        guard nextIdentifier < UInt64.max else {
            throw CDPNullPipeError.identifierExhausted
        }
        let identifier = nextIdentifier
        let encoded = try CDPRequestEncoder.encode(
            identifier: identifier,
            method: method,
            params: params,
            sessionIdentifier: sessionIdentifier,
            limits: limits
        )
        let deadline = try CDPMonotonicDeadline(seconds: timeoutSeconds)
        nextIdentifier += 1

        try writeFrame(encoded, deadline: deadline)
        var ignoredEventCount = 0
        var ignoredEventBytes = 0
        while true {
            try Task.checkCancellation()
            let frame = try readFrame(deadline: deadline)
            let message = try CDPResponseParser.parse(frame, limits: limits)
            if case .event = message {
                let wireByteCount = frame.count + 1
                guard ignoredEventCount < limits.maximumIgnoredEventCount,
                      wireByteCount <= limits.maximumIgnoredEventBytes - ignoredEventBytes
                else {
                    throw CDPNullPipeError.ignoredEventLimit
                }
                ignoredEventCount += 1
                ignoredEventBytes += wireByteCount
                continue
            }
            return try CDPResponseParser.correlatedResult(
                from: message,
                expectedIdentifier: identifier,
                expectedSessionIdentifier: sessionIdentifier
            )
        }
    }

    private func writeFrame(_ data: Data, deadline: CDPMonotonicDeadline) throws {
        let descriptor = try currentWriteDescriptor()
        try data.withUnsafeBytes { bytes in
            try writeAll(bytes, descriptor: descriptor, deadline: deadline)
        }
        var terminator: UInt8 = 0
        try withUnsafeBytes(of: &terminator) { bytes in
            try writeAll(bytes, descriptor: descriptor, deadline: deadline)
        }
    }

    private func writeAll(
        _ bytes: UnsafeRawBufferPointer,
        descriptor: Int32,
        deadline: CDPMonotonicDeadline
    ) throws {
        guard let baseAddress = bytes.baseAddress else { return }
        var offset = 0
        while offset < bytes.count {
            try Task.checkCancellation()
            try waitForDescriptor(descriptor, events: Int16(POLLOUT), deadline: deadline)
            let result = Darwin.write(
                descriptor,
                baseAddress.advanced(by: offset),
                bytes.count - offset
            )
            if result > 0 {
                offset += result
                continue
            }
            if result < 0, errno == EINTR { continue }
            if result < 0, errno == EAGAIN || errno == EWOULDBLOCK { continue }
            if result < 0, errno == EPIPE || errno == EBADF {
                throw CDPNullPipeError.transportClosed
            }
            throw CDPNullPipeError.systemCall("write", errno)
        }
    }

    private func readFrame(deadline: CDPMonotonicDeadline) throws -> Data {
        if let pending = popPendingFrame() { return pending }

        while true {
            try Task.checkCancellation()
            let descriptor = try currentReadDescriptor()
            try waitForDescriptor(descriptor, events: Int16(POLLIN), deadline: deadline)

            let availableCapacity = limits.maximumBufferedBytes - frameDecoder.bufferedByteCount
            guard availableCapacity > 0 else {
                throw CDPNullPipeError.bufferedDataLimit
            }
            let requestedCount = min(readScratch.count, availableCapacity)
            let readCount = readScratch.withUnsafeMutableBytes { bytes in
                Darwin.read(descriptor, bytes.baseAddress, requestedCount)
            }
            if readCount > 0 {
                let frames = try readScratch.withUnsafeBytes { bytes -> [Data] in
                    let prefix = UnsafeRawBufferPointer(rebasing: bytes[..<readCount])
                    return try frameDecoder.appendBytes(prefix)
                }
                if !frames.isEmpty {
                    pendingFrames = frames
                    pendingFrameIndex = 0
                    return popPendingFrame()!
                }
                continue
            }
            if readCount == 0 { throw CDPNullPipeError.transportClosed }
            if errno == EINTR { continue }
            if errno == EAGAIN || errno == EWOULDBLOCK { continue }
            if errno == EBADF { throw CDPNullPipeError.transportClosed }
            throw CDPNullPipeError.systemCall("read", errno)
        }
    }

    private func popPendingFrame() -> Data? {
        guard pendingFrameIndex < pendingFrames.count else {
            pendingFrames.removeAll(keepingCapacity: true)
            pendingFrameIndex = 0
            return nil
        }
        let frame = pendingFrames[pendingFrameIndex]
        pendingFrameIndex += 1
        if pendingFrameIndex == pendingFrames.count {
            pendingFrames.removeAll(keepingCapacity: true)
            pendingFrameIndex = 0
        }
        return frame
    }

    private func waitForDescriptor(
        _ descriptor: Int32,
        events: Int16,
        deadline: CDPMonotonicDeadline
    ) throws {
        while true {
            try Task.checkCancellation()
            var pollDescriptor = pollfd(fd: descriptor, events: events, revents: 0)
            let timeout = try deadline.remainingPollMilliseconds()
            let result = Darwin.poll(&pollDescriptor, 1, timeout)
            if result > 0 {
                if pollDescriptor.revents & events != 0 { return }
                if pollDescriptor.revents & Int16(POLLNVAL) != 0 {
                    throw CDPNullPipeError.transportClosed
                }
                if pollDescriptor.revents & (Int16(POLLERR) | Int16(POLLHUP)) != 0 {
                    throw CDPNullPipeError.transportClosed
                }
                throw CDPNullPipeError.protocolViolation
            }
            if result == 0 { throw CDPNullPipeError.timedOut }
            if errno == EINTR { continue }
            if errno == EBADF { throw CDPNullPipeError.transportClosed }
            throw CDPNullPipeError.systemCall("poll", errno)
        }
    }

    private func currentReadDescriptor() throws -> Int32 {
        descriptorLock.lock()
        defer { descriptorLock.unlock() }
        guard readDescriptor >= 0 else { throw CDPNullPipeError.transportClosed }
        return readDescriptor
    }

    private func currentWriteDescriptor() throws -> Int32 {
        descriptorLock.lock()
        defer { descriptorLock.unlock() }
        guard writeDescriptor >= 0 else { throw CDPNullPipeError.transportClosed }
        return writeDescriptor
    }
}

private struct CDPMonotonicDeadline {
    private let nanoseconds: UInt64

    init(seconds: Double) throws {
        guard seconds.isFinite, seconds > 0, seconds <= 300 else {
            throw CDPNullPipeError.invalidTimeout
        }
        let deltaDouble = seconds * 1_000_000_000
        guard deltaDouble.isFinite, deltaDouble <= Double(UInt64.max) else {
            throw CDPNullPipeError.invalidTimeout
        }
        let delta = UInt64(deltaDouble.rounded(.up))
        let now = try Self.now()
        let sum = now.addingReportingOverflow(delta)
        guard !sum.overflow else { throw CDPNullPipeError.invalidTimeout }
        nanoseconds = sum.partialValue
    }

    func remainingPollMilliseconds() throws -> Int32 {
        let current = try Self.now()
        guard current < nanoseconds else { throw CDPNullPipeError.timedOut }
        let remaining = nanoseconds - current
        let roundedMilliseconds = (remaining + 999_999) / 1_000_000
        return Int32(min(roundedMilliseconds, UInt64(Int32.max)))
    }

    private static func now() throws -> UInt64 {
        var time = timespec()
        guard Darwin.clock_gettime(CLOCK_MONOTONIC, &time) == 0,
              time.tv_sec >= 0,
              time.tv_nsec >= 0
        else {
            throw CDPNullPipeError.systemCall("clock_gettime", errno)
        }
        return UInt64(time.tv_sec) * 1_000_000_000 + UInt64(time.tv_nsec)
    }
}

private enum CloudCDPJSONValidator {
    static func validate(_ value: CloudCDPValue, limits: CloudCDPLimits) throws {
        var nodes = 0
        try validate(value, depth: 0, nodes: &nodes, limits: limits)
    }

    private static func validate(
        _ value: CloudCDPValue,
        depth: Int,
        nodes: inout Int,
        limits: CloudCDPLimits
    ) throws {
        guard depth <= limits.maximumJSONDepth,
              nodes < limits.maximumJSONNodes
        else {
            throw CDPNullPipeError.invalidRequest
        }
        nodes += 1
        switch value {
        case .null, .boolean, .integer, .unsignedInteger:
            return
        case let .number(number):
            guard number.isFinite else { throw CDPNullPipeError.invalidRequest }
        case let .string(string):
            guard string.utf8.count <= limits.maximumJSONStringBytes else {
                throw CDPNullPipeError.invalidRequest
            }
        case let .array(array):
            for nested in array {
                try validate(nested, depth: depth + 1, nodes: &nodes, limits: limits)
            }
        case let .object(object):
            for (key, nested) in object {
                guard key.utf8.count <= limits.maximumJSONStringBytes else {
                    throw CDPNullPipeError.invalidRequest
                }
                try validate(nested, depth: depth + 1, nodes: &nodes, limits: limits)
            }
        }
    }
}

private struct BoundedCloudCDPJSONParser {
    private let bytes: UnsafeBufferPointer<UInt8>
    private let limits: CloudCDPLimits
    private var index = 0
    private var nodeCount = 0

    static func decode(_ data: Data, limits: CloudCDPLimits) throws -> CloudCDPValue {
        try data.withUnsafeBytes { rawBytes in
            let bytes = rawBytes.bindMemory(to: UInt8.self)
            var parser = BoundedCloudCDPJSONParser(bytes: bytes, limits: limits)
            let value = try parser.parseValue(depth: 0)
            parser.skipWhitespace()
            guard parser.index == bytes.count else {
                throw CDPNullPipeError.malformedJSON
            }
            return value
        }
    }

    private mutating func parseValue(depth: Int) throws -> CloudCDPValue {
        skipWhitespace()
        guard depth <= limits.maximumJSONDepth,
              nodeCount < limits.maximumJSONNodes,
              index < bytes.count
        else {
            throw CDPNullPipeError.malformedJSON
        }
        nodeCount += 1

        switch bytes[index] {
        case 0x6E:
            try consumeLiteral([0x6E, 0x75, 0x6C, 0x6C])
            return .null
        case 0x74:
            try consumeLiteral([0x74, 0x72, 0x75, 0x65])
            return .boolean(true)
        case 0x66:
            try consumeLiteral([0x66, 0x61, 0x6C, 0x73, 0x65])
            return .boolean(false)
        case 0x22:
            return .string(try parseString())
        case 0x5B:
            return .array(try parseArray(depth: depth))
        case 0x7B:
            return .object(try parseObject(depth: depth))
        case 0x2D, 0x30...0x39:
            return try parseNumber()
        default:
            throw CDPNullPipeError.malformedJSON
        }
    }

    private mutating func parseArray(depth: Int) throws -> [CloudCDPValue] {
        index += 1
        skipWhitespace()
        if consumeIf(0x5D) { return [] }

        var values: [CloudCDPValue] = []
        while true {
            values.append(try parseValue(depth: depth + 1))
            skipWhitespace()
            if consumeIf(0x5D) { return values }
            guard consumeIf(0x2C) else { throw CDPNullPipeError.malformedJSON }
        }
    }

    private mutating func parseObject(depth: Int) throws -> [String: CloudCDPValue] {
        index += 1
        skipWhitespace()
        if consumeIf(0x7D) { return [:] }

        var values: [String: CloudCDPValue] = [:]
        while true {
            skipWhitespace()
            guard index < bytes.count, bytes[index] == 0x22 else {
                throw CDPNullPipeError.malformedJSON
            }
            let key = try parseString()
            skipWhitespace()
            guard consumeIf(0x3A) else { throw CDPNullPipeError.malformedJSON }
            let value = try parseValue(depth: depth + 1)
            guard values.updateValue(value, forKey: key) == nil else {
                throw CDPNullPipeError.malformedJSON
            }
            skipWhitespace()
            if consumeIf(0x7D) { return values }
            guard consumeIf(0x2C) else { throw CDPNullPipeError.malformedJSON }
        }
    }

    private mutating func parseString() throws -> String {
        guard consumeIf(0x22) else { throw CDPNullPipeError.malformedJSON }
        var decoded: [UInt8] = []
        decoded.reserveCapacity(min(64, limits.maximumJSONStringBytes))

        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if byte == 0x22 {
                guard let string = String(bytes: decoded, encoding: .utf8) else {
                    throw CDPNullPipeError.malformedJSON
                }
                return string
            }
            if byte == 0x5C {
                try parseEscape(into: &decoded)
                continue
            }
            guard byte >= 0x20 else { throw CDPNullPipeError.malformedJSON }
            try append(byte, to: &decoded)
        }
        throw CDPNullPipeError.malformedJSON
    }

    private mutating func parseEscape(into decoded: inout [UInt8]) throws {
        guard index < bytes.count else { throw CDPNullPipeError.malformedJSON }
        let escape = bytes[index]
        index += 1
        switch escape {
        case 0x22, 0x2F, 0x5C:
            try append(escape, to: &decoded)
        case 0x62:
            try append(0x08, to: &decoded)
        case 0x66:
            try append(0x0C, to: &decoded)
        case 0x6E:
            try append(0x0A, to: &decoded)
        case 0x72:
            try append(0x0D, to: &decoded)
        case 0x74:
            try append(0x09, to: &decoded)
        case 0x75:
            let first = try parseHexQuad()
            let scalar: UInt32
            if (0xD800...0xDBFF).contains(first) {
                guard index + 2 <= bytes.count,
                      bytes[index] == 0x5C,
                      bytes[index + 1] == 0x75
                else {
                    throw CDPNullPipeError.malformedJSON
                }
                index += 2
                let second = try parseHexQuad()
                guard (0xDC00...0xDFFF).contains(second) else {
                    throw CDPNullPipeError.malformedJSON
                }
                scalar = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
            } else {
                guard !(0xDC00...0xDFFF).contains(first) else {
                    throw CDPNullPipeError.malformedJSON
                }
                scalar = first
            }
            try appendUTF8(scalar, to: &decoded)
        default:
            throw CDPNullPipeError.malformedJSON
        }
    }

    private mutating func parseHexQuad() throws -> UInt32 {
        guard index + 4 <= bytes.count else { throw CDPNullPipeError.malformedJSON }
        var value: UInt32 = 0
        for _ in 0..<4 {
            let byte = bytes[index]
            index += 1
            let digit: UInt32
            switch byte {
            case 0x30...0x39: digit = UInt32(byte - 0x30)
            case 0x41...0x46: digit = UInt32(byte - 0x41 + 10)
            case 0x61...0x66: digit = UInt32(byte - 0x61 + 10)
            default: throw CDPNullPipeError.malformedJSON
            }
            value = (value << 4) | digit
        }
        return value
    }

    private mutating func parseNumber() throws -> CloudCDPValue {
        let start = index
        let negative = consumeIf(0x2D)
        guard index < bytes.count else { throw CDPNullPipeError.malformedJSON }

        if consumeIf(0x30) {
            guard index >= bytes.count || !(0x30...0x39).contains(bytes[index]) else {
                throw CDPNullPipeError.malformedJSON
            }
        } else {
            guard index < bytes.count, (0x31...0x39).contains(bytes[index]) else {
                throw CDPNullPipeError.malformedJSON
            }
            index += 1
            while index < bytes.count, (0x30...0x39).contains(bytes[index]) { index += 1 }
        }

        var isInteger = true
        if consumeIf(0x2E) {
            isInteger = false
            guard index < bytes.count, (0x30...0x39).contains(bytes[index]) else {
                throw CDPNullPipeError.malformedJSON
            }
            while index < bytes.count, (0x30...0x39).contains(bytes[index]) { index += 1 }
        }
        if index < bytes.count, bytes[index] == 0x65 || bytes[index] == 0x45 {
            isInteger = false
            index += 1
            if index < bytes.count, bytes[index] == 0x2B || bytes[index] == 0x2D { index += 1 }
            guard index < bytes.count, (0x30...0x39).contains(bytes[index]) else {
                throw CDPNullPipeError.malformedJSON
            }
            while index < bytes.count, (0x30...0x39).contains(bytes[index]) { index += 1 }
        }

        guard index - start <= 128 else { throw CDPNullPipeError.malformedJSON }
        if isInteger, let integer = exactInteger(start: start, end: index, negative: negative) {
            return integer
        }
        let token = String(decoding: bytes[start..<index], as: UTF8.self)
        guard let value = Double(token), value.isFinite else {
            throw CDPNullPipeError.malformedJSON
        }
        return .number(value)
    }

    private func exactInteger(
        start: Int,
        end: Int,
        negative: Bool
    ) -> CloudCDPValue? {
        var cursor = start + (negative ? 1 : 0)
        var magnitude: UInt64 = 0
        while cursor < end {
            let digit = UInt64(bytes[cursor] - 0x30)
            let multiplied = magnitude.multipliedReportingOverflow(by: 10)
            if multiplied.overflow { return nil }
            let added = multiplied.partialValue.addingReportingOverflow(digit)
            if added.overflow { return nil }
            magnitude = added.partialValue
            cursor += 1
        }
        if negative {
            let minimumMagnitude = UInt64(Int64.max) + 1
            guard magnitude <= minimumMagnitude else { return nil }
            if magnitude == minimumMagnitude { return .integer(Int64.min) }
            return .integer(-Int64(magnitude))
        }
        if magnitude <= UInt64(Int64.max) { return .integer(Int64(magnitude)) }
        return .unsignedInteger(magnitude)
    }

    private mutating func consumeLiteral(_ literal: [UInt8]) throws {
        guard index + literal.count <= bytes.count else {
            throw CDPNullPipeError.malformedJSON
        }
        for expected in literal {
            guard bytes[index] == expected else { throw CDPNullPipeError.malformedJSON }
            index += 1
        }
    }

    private mutating func consumeIf(_ byte: UInt8) -> Bool {
        guard index < bytes.count, bytes[index] == byte else { return false }
        index += 1
        return true
    }

    private mutating func skipWhitespace() {
        while index < bytes.count {
            switch bytes[index] {
            case 0x20, 0x09, 0x0A, 0x0D: index += 1
            default: return
            }
        }
    }

    private func append(_ byte: UInt8, to output: inout [UInt8]) throws {
        guard output.count < limits.maximumJSONStringBytes else {
            throw CDPNullPipeError.malformedJSON
        }
        output.append(byte)
    }

    private func appendUTF8(_ scalar: UInt32, to output: inout [UInt8]) throws {
        if scalar <= 0x7F {
            try append(UInt8(scalar), to: &output)
        } else if scalar <= 0x7FF {
            try append(UInt8(0xC0 | (scalar >> 6)), to: &output)
            try append(UInt8(0x80 | (scalar & 0x3F)), to: &output)
        } else if scalar <= 0xFFFF {
            try append(UInt8(0xE0 | (scalar >> 12)), to: &output)
            try append(UInt8(0x80 | ((scalar >> 6) & 0x3F)), to: &output)
            try append(UInt8(0x80 | (scalar & 0x3F)), to: &output)
        } else if scalar <= 0x10FFFF {
            try append(UInt8(0xF0 | (scalar >> 18)), to: &output)
            try append(UInt8(0x80 | ((scalar >> 12) & 0x3F)), to: &output)
            try append(UInt8(0x80 | ((scalar >> 6) & 0x3F)), to: &output)
            try append(UInt8(0x80 | (scalar & 0x3F)), to: &output)
        } else {
            throw CDPNullPipeError.malformedJSON
        }
    }
}
