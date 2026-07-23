import CryptoKit
import Foundation
import Security

public struct WebSocketLimits: Sendable, Equatable {
    public let maximumHandshakeBytes: Int
    public let maximumFramePayloadBytes: Int
    public let maximumMessageBytes: Int
    public let readChunkBytes: Int

    public init(
        maximumHandshakeBytes: Int = 16 * 1_024,
        maximumFramePayloadBytes: Int = 1 * 1_024 * 1_024,
        maximumMessageBytes: Int = 2 * 1_024 * 1_024,
        readChunkBytes: Int = 16 * 1_024
    ) {
        self.maximumHandshakeBytes = maximumHandshakeBytes
        self.maximumFramePayloadBytes = maximumFramePayloadBytes
        self.maximumMessageBytes = maximumMessageBytes
        self.readChunkBytes = readChunkBytes
    }

    internal func validate() throws {
        guard (256...64 * 1_024).contains(maximumHandshakeBytes),
              (125...8 * 1_024 * 1_024).contains(maximumFramePayloadBytes),
              maximumMessageBytes >= maximumFramePayloadBytes,
              maximumMessageBytes <= 8 * 1_024 * 1_024,
              (1...64 * 1_024).contains(readChunkBytes)
        else {
            throw WebSocketProtocolError.invalidLimits
        }
    }
}

public struct WebSocketConfiguration: Sendable, Equatable {
    public let limits: WebSocketLimits
    public let messageTimeoutMilliseconds: Int

    public init(
        limits: WebSocketLimits = WebSocketLimits(),
        messageTimeoutMilliseconds: Int = 10_000
    ) {
        self.limits = limits
        self.messageTimeoutMilliseconds = messageTimeoutMilliseconds
    }

    internal func validate() throws {
        try limits.validate()
        guard (1...300_000).contains(messageTimeoutMilliseconds) else {
            throw WebSocketProtocolError.invalidLimits
        }
    }
}

public enum WebSocketProtocolError: Error, CustomStringConvertible, LocalizedError, Sendable, Equatable {
    case invalidLimits
    case invalidRequestTarget
    case randomGenerationFailed
    case handshakeTooLarge
    case malformedHandshake
    case handshakeRejected
    case invalidHandshakeAccept
    case frameTooLarge
    case malformedFrame
    case protocolViolation
    case invalidText
    case peerClosed
    case closed

    public var description: String {
        switch self {
        case .invalidLimits: "websocket_invalid_limits"
        case .invalidRequestTarget: "websocket_invalid_request_target"
        case .randomGenerationFailed: "websocket_random_generation_failed"
        case .handshakeTooLarge: "websocket_handshake_too_large"
        case .malformedHandshake: "websocket_malformed_handshake"
        case .handshakeRejected: "websocket_handshake_rejected"
        case .invalidHandshakeAccept: "websocket_invalid_handshake_accept"
        case .frameTooLarge: "websocket_frame_too_large"
        case .malformedFrame: "websocket_malformed_frame"
        case .protocolViolation: "websocket_protocol_violation"
        case .invalidText: "websocket_invalid_text"
        case .peerClosed: "websocket_peer_closed"
        case .closed: "websocket_closed"
        }
    }

    public var errorDescription: String? { description }
}

internal enum WebSocketOpcode: UInt8, Sendable {
    case continuation = 0x0
    case text = 0x1
    case close = 0x8
    case ping = 0x9
    case pong = 0xA

    internal var isControl: Bool { rawValue >= 0x8 }
}

internal struct ParsedWebSocketFrame: Sendable, Equatable {
    internal let isFinal: Bool
    internal let opcode: WebSocketOpcode
    internal let payload: Data
    internal let byteCount: Int
}

internal enum WebSocketHandshakeEncoder {
    internal static func encode(
        requestTarget: String,
        host: String = "127.0.0.1:9222",
        key: String
    ) throws -> Data {
        let decodedKey = Data(base64Encoded: key)
        guard requestTarget.hasPrefix("/"),
              requestTarget.utf8.count <= 2_048,
              !requestTarget.utf8.contains(where: { $0 == 0 || $0 == 13 || $0 == 10 || $0 == 32 }),
              host == "127.0.0.1:9222",
              decodedKey?.count == 16,
              decodedKey?.base64EncodedString() == key,
              key.utf8.count == 24
        else {
            throw WebSocketProtocolError.invalidRequestTarget
        }
        let request = "GET \(requestTarget) HTTP/1.1\r\nHost: \(host)\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: \(key)\r\nSec-WebSocket-Version: 13\r\n\r\n"
        return Data(request.utf8)
    }
}

internal enum WebSocketHandshakeParser {
    private static let acceptGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    internal static func expectedAccept(for key: String) -> String {
        var input = Data(key.utf8)
        input.append(contentsOf: acceptGUID.utf8)
        let digest = Insecure.SHA1.hash(data: input)
        return Data(digest).base64EncodedString()
    }

    internal static func validate(
        _ data: Data,
        key: String,
        maximumHandshakeBytes: Int
    ) throws -> Int? {
        let head: ParsedHTTPHead
        do {
            guard let parsed = try StrictHTTPHeadParser.parse(
                data,
                maximumHeaderBytes: maximumHandshakeBytes
            ) else {
                return nil
            }
            head = parsed
        } catch HTTPProtocolError.responseTooLarge {
            throw WebSocketProtocolError.handshakeTooLarge
        } catch {
            throw WebSocketProtocolError.malformedHandshake
        }

        guard head.statusCode == 101 else {
            throw WebSocketProtocolError.handshakeRejected
        }
        guard head.headers["upgrade"]?.lowercased() == "websocket",
              let connection = head.headers["connection"],
              commaSeparatedTokens(connection).contains("upgrade"),
              head.headers["sec-websocket-extensions"] == nil,
              head.headers["sec-websocket-protocol"] == nil,
              let accept = head.headers["sec-websocket-accept"]
        else {
            throw WebSocketProtocolError.handshakeRejected
        }
        guard accept == expectedAccept(for: key) else {
            throw WebSocketProtocolError.invalidHandshakeAccept
        }
        return head.byteCount
    }

    private static func commaSeparatedTokens(_ value: String) -> Set<String> {
        Set(value.split(separator: ",", omittingEmptySubsequences: false).map {
            $0.trimmingCharacters(in: .whitespaces).lowercased()
        })
    }
}

internal enum WebSocketFrameEncoder {
    internal static func encodeClientFrame(
        opcode: WebSocketOpcode,
        payload: Data,
        isFinal: Bool = true,
        maskingKey: [UInt8],
        maximumPayloadBytes: Int
    ) throws -> Data {
        guard maskingKey.count == 4,
              payload.count <= maximumPayloadBytes
        else {
            throw WebSocketProtocolError.frameTooLarge
        }
        if opcode.isControl {
            guard isFinal, payload.count <= 125 else {
                throw WebSocketProtocolError.protocolViolation
            }
        }
        if opcode == .close {
            try WebSocketFrameParser.validateClosePayload(payload)
        }

        let extendedLengthBytes: Int
        if payload.count <= 125 {
            extendedLengthBytes = 0
        } else if payload.count <= Int(UInt16.max) {
            extendedLengthBytes = 2
        } else {
            extendedLengthBytes = 8
        }
        var frame = Data()
        frame.reserveCapacity(2 + extendedLengthBytes + 4 + payload.count)
        frame.append((isFinal ? 0x80 : 0) | opcode.rawValue)
        if extendedLengthBytes == 0 {
            frame.append(0x80 | UInt8(payload.count))
        } else if extendedLengthBytes == 2 {
            frame.append(0x80 | 126)
            let length = UInt16(payload.count)
            frame.append(UInt8((length >> 8) & 0xFF))
            frame.append(UInt8(length & 0xFF))
        } else {
            frame.append(0x80 | 127)
            let length = UInt64(payload.count)
            for shift in stride(from: 56, through: 0, by: -8) {
                frame.append(UInt8((length >> UInt64(shift)) & 0xFF))
            }
        }
        frame.append(contentsOf: maskingKey)
        payload.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.bindMemory(to: UInt8.self).baseAddress else { return }
            for index in 0..<payload.count {
                frame.append(baseAddress[index] ^ maskingKey[index & 3])
            }
        }
        return frame
    }
}

internal enum WebSocketFrameParser {
    internal static func parseServerFrame(
        _ data: Data,
        maximumPayloadBytes: Int
    ) throws -> ParsedWebSocketFrame? {
        guard data.count >= 2 else { return nil }
        let bytes = [UInt8](data)
        let first = bytes[0]
        let second = bytes[1]
        guard first & 0x70 == 0,
              second & 0x80 == 0,
              let opcode = WebSocketOpcode(rawValue: first & 0x0F)
        else {
            throw WebSocketProtocolError.protocolViolation
        }

        let isFinal = first & 0x80 != 0
        var payloadLength = UInt64(second & 0x7F)
        var payloadStart = 2
        if payloadLength == 126 {
            guard bytes.count >= 4 else { return nil }
            payloadLength = UInt64(bytes[2]) << 8 | UInt64(bytes[3])
            guard payloadLength >= 126 else {
                throw WebSocketProtocolError.malformedFrame
            }
            payloadStart = 4
        } else if payloadLength == 127 {
            guard bytes.count >= 10 else { return nil }
            guard bytes[2] & 0x80 == 0 else {
                throw WebSocketProtocolError.malformedFrame
            }
            payloadLength = 0
            for byte in bytes[2..<10] {
                payloadLength = (payloadLength << 8) | UInt64(byte)
            }
            guard payloadLength > UInt64(UInt16.max) else {
                throw WebSocketProtocolError.malformedFrame
            }
            payloadStart = 10
        }

        guard payloadLength <= UInt64(maximumPayloadBytes),
              payloadLength <= UInt64(Int.max)
        else {
            throw WebSocketProtocolError.frameTooLarge
        }
        if opcode.isControl {
            guard isFinal, payloadLength <= 125 else {
                throw WebSocketProtocolError.protocolViolation
            }
        }

        let payloadByteCount = Int(payloadLength)
        guard payloadStart <= Int.max - payloadByteCount else {
            throw WebSocketProtocolError.frameTooLarge
        }
        let totalByteCount = payloadStart + payloadByteCount
        guard bytes.count >= totalByteCount else { return nil }
        let payload = Data(bytes[payloadStart..<totalByteCount])
        if opcode == .close {
            try validateClosePayload(payload)
        }
        return ParsedWebSocketFrame(
            isFinal: isFinal,
            opcode: opcode,
            payload: payload,
            byteCount: totalByteCount
        )
    }

    internal static func validateClosePayload(_ payload: Data) throws {
        guard payload.count != 1, payload.count <= 125 else {
            throw WebSocketProtocolError.protocolViolation
        }
        guard payload.count >= 2 else { return }
        let bytes = [UInt8](payload)
        let code = UInt16(bytes[0]) << 8 | UInt16(bytes[1])
        let validCode = (code >= 1_000 && code <= 1_014
            && code != 1_004 && code != 1_005 && code != 1_006)
            || (code >= 3_000 && code <= 4_999)
        guard validCode else {
            throw WebSocketProtocolError.protocolViolation
        }
        if payload.count > 2 {
            guard String(data: payload.subdata(in: 2..<payload.count), encoding: .utf8) != nil else {
                throw WebSocketProtocolError.invalidText
            }
        }
    }
}

public final class WebSocketClient {
    private let socket: UnixSocket
    private let configuration: WebSocketConfiguration
    private var inboundBuffer: Data
    private var fragmentedText: Data?
    private var didSendClose = false
    private var isClosed = false

    private init(
        socket: UnixSocket,
        configuration: WebSocketConfiguration,
        inboundBuffer: Data
    ) {
        self.socket = socket
        self.configuration = configuration
        self.inboundBuffer = inboundBuffer
    }

    deinit {
        close()
    }

    public static func connect(
        socketPath: String,
        requestTarget: String,
        socketConfiguration: UnixSocketConfiguration = UnixSocketConfiguration(),
        configuration: WebSocketConfiguration = WebSocketConfiguration()
    ) throws -> WebSocketClient {
        try configuration.validate()
        let nonce = try secureRandomBytes(count: 16)
        let key = Data(nonce).base64EncodedString()
        let request = try WebSocketHandshakeEncoder.encode(
            requestTarget: requestTarget,
            key: key
        )
        let socket = try UnixSocket(path: socketPath, configuration: socketConfiguration)
        do {
            try socket.write(request)
            var response = Data()
            response.reserveCapacity(configuration.limits.maximumHandshakeBytes)
            let handshakeDeadline = try MonotonicDeadline(
                milliseconds: socketConfiguration.readTimeoutMilliseconds
            )
            while true {
                if let consumed = try WebSocketHandshakeParser.validate(
                    response,
                    key: key,
                    maximumHandshakeBytes: configuration.limits.maximumHandshakeBytes
                ) {
                    let remainder = response.subdata(in: consumed..<response.count)
                    return WebSocketClient(
                        socket: socket,
                        configuration: configuration,
                        inboundBuffer: remainder
                    )
                }
                guard response.count < configuration.limits.maximumHandshakeBytes else {
                    throw WebSocketProtocolError.handshakeTooLarge
                }
                guard let timeout = handshakeDeadline.remainingMilliseconds() else {
                    throw UnixSocketError.readTimedOut
                }
                let readCount = min(
                    configuration.limits.readChunkBytes,
                    configuration.limits.maximumHandshakeBytes - response.count
                )
                response.append(
                    try socket.read(
                        maximumBytes: readCount,
                        timeoutMilliseconds: timeout
                    )
                )
            }
        } catch {
            socket.close()
            throw error
        }
    }

    public func sendText(_ text: String) throws {
        try sendText(Data(text.utf8))
    }

    internal func sendText(
        _ utf8: Data,
        timeoutMilliseconds: Int? = nil
    ) throws {
        guard !isClosed else { throw WebSocketProtocolError.closed }
        guard utf8.count <= configuration.limits.maximumFramePayloadBytes,
              utf8.count <= configuration.limits.maximumMessageBytes
        else {
            throw WebSocketProtocolError.frameTooLarge
        }
        guard String(data: utf8, encoding: .utf8) != nil else {
            throw WebSocketProtocolError.invalidText
        }
        try sendFrame(
            opcode: .text,
            payload: utf8,
            timeoutMilliseconds: timeoutMilliseconds
        )
    }

    public func receiveText(timeoutMilliseconds: Int? = nil) throws -> String {
        let data = try receiveTextData(timeoutMilliseconds: timeoutMilliseconds)
        guard let text = String(data: data, encoding: .utf8) else {
            throw WebSocketProtocolError.invalidText
        }
        return text
    }

    internal func receiveTextData(timeoutMilliseconds: Int? = nil) throws -> Data {
        guard !isClosed else { throw WebSocketProtocolError.closed }
        let timeout = timeoutMilliseconds ?? configuration.messageTimeoutMilliseconds
        let deadline: MonotonicDeadline
        do {
            deadline = try MonotonicDeadline(milliseconds: timeout)
        } catch {
            throw WebSocketProtocolError.invalidLimits
        }

        while true {
            let frame: ParsedWebSocketFrame
            do {
                frame = try readFrame(deadline: deadline)
            } catch let error as WebSocketProtocolError {
                try rejectAndClose(error)
            } catch {
                close()
                throw error
            }

            switch frame.opcode {
            case .text:
                guard fragmentedText == nil else {
                    try rejectAndClose(.protocolViolation)
                }
                if frame.isFinal {
                    guard String(data: frame.payload, encoding: .utf8) != nil else {
                        try rejectAndClose(.invalidText)
                    }
                    return frame.payload
                }
                fragmentedText = frame.payload

            case .continuation:
                guard var message = fragmentedText,
                      frame.payload.count <= configuration.limits.maximumMessageBytes - message.count
                else {
                    try rejectAndClose(.protocolViolation)
                }
                message.append(frame.payload)
                if frame.isFinal {
                    fragmentedText = nil
                    guard String(data: message, encoding: .utf8) != nil else {
                        try rejectAndClose(.invalidText)
                    }
                    return message
                }
                fragmentedText = message

            case .ping:
                do {
                    try sendFrame(opcode: .pong, payload: frame.payload)
                } catch {
                    close()
                    throw error
                }

            case .pong:
                continue

            case .close:
                if !didSendClose {
                    try? sendFrame(opcode: .close, payload: frame.payload)
                }
                isClosed = true
                socket.close()
                throw WebSocketProtocolError.peerClosed
            }
        }
    }

    public func close(code: UInt16 = 1_000) {
        guard !isClosed else { return }
        if isValidClientCloseCode(code) {
            var payload = Data()
            payload.append(UInt8((code >> 8) & 0xFF))
            payload.append(UInt8(code & 0xFF))
            try? sendFrame(opcode: .close, payload: payload)
        }
        isClosed = true
        socket.close()
    }

    private func readFrame(deadline: MonotonicDeadline) throws -> ParsedWebSocketFrame {
        let maximumWireBytes = configuration.limits.maximumFramePayloadBytes + 10
        while true {
            if let frame = try WebSocketFrameParser.parseServerFrame(
                inboundBuffer,
                maximumPayloadBytes: configuration.limits.maximumFramePayloadBytes
            ) {
                inboundBuffer.removeSubrange(0..<frame.byteCount)
                return frame
            }
            guard inboundBuffer.count < maximumWireBytes else {
                throw WebSocketProtocolError.frameTooLarge
            }
            guard let timeout = deadline.remainingMilliseconds() else {
                throw UnixSocketError.readTimedOut
            }
            let readCount = min(
                configuration.limits.readChunkBytes,
                maximumWireBytes - inboundBuffer.count
            )
            inboundBuffer.append(
                try socket.read(maximumBytes: readCount, timeoutMilliseconds: timeout)
            )
        }
    }

    private func sendFrame(
        opcode: WebSocketOpcode,
        payload: Data,
        timeoutMilliseconds: Int? = nil
    ) throws {
        let maskingKey = try Self.secureRandomBytes(count: 4)
        let frame = try WebSocketFrameEncoder.encodeClientFrame(
            opcode: opcode,
            payload: payload,
            maskingKey: maskingKey,
            maximumPayloadBytes: configuration.limits.maximumFramePayloadBytes
        )
        if opcode == .close {
            didSendClose = true
        }
        try socket.write(frame, timeoutMilliseconds: timeoutMilliseconds)
    }

    private func rejectAndClose(_ error: WebSocketProtocolError) throws -> Never {
        if !didSendClose {
            var payload = Data()
            payload.append(0x03)
            payload.append(0xEA)
            try? sendFrame(opcode: .close, payload: payload)
        }
        isClosed = true
        socket.close()
        throw error
    }

    private func isValidClientCloseCode(_ code: UInt16) -> Bool {
        (code >= 1_000 && code <= 1_014
            && code != 1_004 && code != 1_005 && code != 1_006)
            || (code >= 3_000 && code <= 4_999)
    }

    private static func secureRandomBytes(count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = bytes.withUnsafeMutableBytes { buffer in
            guard let baseAddress = buffer.baseAddress else { return errSecParam }
            return SecRandomCopyBytes(kSecRandomDefault, count, baseAddress)
        }
        guard status == errSecSuccess else {
            throw WebSocketProtocolError.randomGenerationFailed
        }
        return bytes
    }
}

