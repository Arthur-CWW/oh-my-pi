import Dispatch
import Foundation

public enum CDPJSONValue: Codable, Sendable, Equatable {
    case null
    case boolean(Bool)
    case integer(Int64)
    case unsignedInteger(UInt64)
    case number(Double)
    case string(String)
    case array([CDPJSONValue])
    case object([String: CDPJSONValue])

    public init(from decoder: Decoder) throws {
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
        } else if let value = try? container.decode([CDPJSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: CDPJSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "cdp_json_invalid_value"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
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
                        debugDescription: "cdp_json_invalid_number"
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

public struct CDPConnectionLimits: Sendable, Equatable {
    public let maximumJSONMessageBytes: Int
    public let maximumJSONDepth: Int
    public let maximumJSONNodes: Int
    public let maximumJSONStringBytes: Int
    public let maximumQueuedEvents: Int
    public let maximumQueuedEventBytes: Int

    public init(
        maximumJSONMessageBytes: Int = 1 * 1_024 * 1_024,
        maximumJSONDepth: Int = 64,
        maximumJSONNodes: Int = 100_000,
        maximumJSONStringBytes: Int = 256 * 1_024,
        maximumQueuedEvents: Int = 256,
        maximumQueuedEventBytes: Int = 2 * 1_024 * 1_024
    ) {
        self.maximumJSONMessageBytes = maximumJSONMessageBytes
        self.maximumJSONDepth = maximumJSONDepth
        self.maximumJSONNodes = maximumJSONNodes
        self.maximumJSONStringBytes = maximumJSONStringBytes
        self.maximumQueuedEvents = maximumQueuedEvents
        self.maximumQueuedEventBytes = maximumQueuedEventBytes
    }

    internal func validate() throws {
        guard (1_024...8 * 1_024 * 1_024).contains(maximumJSONMessageBytes),
              (1...128).contains(maximumJSONDepth),
              (1...500_000).contains(maximumJSONNodes),
              (1...maximumJSONMessageBytes).contains(maximumJSONStringBytes),
              (1...4_096).contains(maximumQueuedEvents),
              maximumQueuedEventBytes >= maximumJSONMessageBytes,
              maximumQueuedEventBytes <= 32 * 1_024 * 1_024
        else {
            throw CDPConnectionError.invalidConfiguration
        }
    }
}

public struct CDPConnectionConfiguration: Sendable, Equatable {
    public let socket: UnixSocketConfiguration
    public let http: HTTPResponseLimits
    public let webSocket: WebSocketConfiguration
    public let cdp: CDPConnectionLimits
    public let requestTimeoutMilliseconds: Int

    public init(
        socket: UnixSocketConfiguration = UnixSocketConfiguration(),
        http: HTTPResponseLimits = HTTPResponseLimits(),
        webSocket: WebSocketConfiguration = WebSocketConfiguration(),
        cdp: CDPConnectionLimits = CDPConnectionLimits(),
        requestTimeoutMilliseconds: Int = 10_000
    ) {
        self.socket = socket
        self.http = http
        self.webSocket = webSocket
        self.cdp = cdp
        self.requestTimeoutMilliseconds = requestTimeoutMilliseconds
    }

    internal func validate() throws {
        try socket.validate()
        try http.validate()
        try webSocket.validate()
        try cdp.validate()
        guard (1...300_000).contains(requestTimeoutMilliseconds),
              cdp.maximumJSONMessageBytes <= webSocket.limits.maximumFramePayloadBytes,
              cdp.maximumJSONMessageBytes + 14 <= socket.maximumWriteBytes,
              cdp.maximumJSONMessageBytes <= webSocket.limits.maximumMessageBytes
        else {
            throw CDPConnectionError.invalidConfiguration
        }
    }
}

public struct CDPTransportEvent: Sendable, Equatable {
    public let method: String
    public let params: CDPJSONValue?
    public let sessionId: String?
    internal let wireByteCount: Int

    internal init(
        method: String,
        params: CDPJSONValue?,
        sessionId: String?,
        wireByteCount: Int
    ) {
        self.method = method
        self.params = params
        self.sessionId = sessionId
        self.wireByteCount = wireByteCount
    }
}

public enum CDPConnectionError: Error, CustomStringConvertible, LocalizedError, Sendable, Equatable {
    case invalidConfiguration
    case invalidRequest
    case requestTooLarge
    case malformedMessage
    case protocolViolation
    case responseMismatch
    case commandFailed
    case eventQueueFull
    case identifierExhausted
    case timedOut
    case transportFailed
    case closed

    public var description: String {
        switch self {
        case .invalidConfiguration: "cdp_invalid_configuration"
        case .invalidRequest: "cdp_invalid_request"
        case .requestTooLarge: "cdp_request_too_large"
        case .malformedMessage: "cdp_malformed_message"
        case .protocolViolation: "cdp_protocol_violation"
        case .responseMismatch: "cdp_response_mismatch"
        case .commandFailed: "cdp_command_failed"
        case .eventQueueFull: "cdp_event_queue_full"
        case .identifierExhausted: "cdp_identifier_exhausted"
        case .timedOut: "cdp_timeout"
        case .transportFailed: "cdp_transport_failed"
        case .closed: "cdp_closed"
        }
    }

    public var errorDescription: String? { description }
}

private struct CDPAnyCodingKey: CodingKey {
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
    func cdpRejectUnknownKeys<Key>(_ keyType: Key.Type) throws
    where Key: CodingKey & CaseIterable {
        let container = try self.container(keyedBy: CDPAnyCodingKey.self)
        let allowed = Set(Key.allCases.map(\.stringValue))
        guard container.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: codingPath,
                    debugDescription: "cdp_json_unknown_key"
                )
            )
        }
    }
}

internal struct CDPRequestEnvelope: Encodable {
    let id: UInt64
    let method: String
    let params: [String: CDPJSONValue]?
    let sessionId: String?
}

private struct CDPRemoteFailure: Decodable {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case code
        case message
        case data
    }

    init(from decoder: Decoder) throws {
        try decoder.cdpRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        _ = try container.decode(Int.self, forKey: .code)
        _ = try container.decode(String.self, forKey: .message)
        if container.contains(.data) {
            _ = try container.decode(CDPJSONValue.self, forKey: .data)
        }
    }
}

internal struct CDPInboundEnvelope: Decodable {
    let id: UInt64?
    let method: String?
    let params: CDPJSONValue?
    let sessionId: String?
    let result: CDPJSONValue?
    let resultIsPresent: Bool
    let failureIsPresent: Bool

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case id
        case method
        case params
        case sessionId
        case result
        case error
    }

    init(from decoder: Decoder) throws {
        try decoder.cdpRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = container.contains(.id)
            ? try container.decode(UInt64.self, forKey: .id)
            : nil
        method = container.contains(.method)
            ? try container.decode(String.self, forKey: .method)
            : nil
        params = container.contains(.params)
            ? try container.decode(CDPJSONValue.self, forKey: .params)
            : nil
        sessionId = container.contains(.sessionId)
            ? try container.decode(String.self, forKey: .sessionId)
            : nil
        resultIsPresent = container.contains(.result)
        result = resultIsPresent
            ? try container.decode(CDPJSONValue.self, forKey: .result)
            : nil
        failureIsPresent = container.contains(.error)
        if failureIsPresent {
            _ = try container.decode(CDPRemoteFailure.self, forKey: .error)
        }
    }
}

internal enum CDPRequestEncoder {
    internal static func encode(
        id: UInt64,
        method: String,
        params: [String: CDPJSONValue]?,
        sessionId: String?
    ) throws -> Data {
        do {
            return try JSONEncoder().encode(
                CDPRequestEnvelope(
                    id: id,
                    method: method,
                    params: params,
                    sessionId: sessionId
                )
            )
        } catch {
            throw CDPConnectionError.invalidRequest
        }
    }
}

internal enum CDPMessageParser {
    internal static func parse(_ data: Data) throws -> CDPInboundEnvelope {
        do {
            return try JSONDecoder().decode(CDPInboundEnvelope.self, from: data)
        } catch {
            throw CDPConnectionError.malformedMessage
        }
    }
}

public final class CDPConnection: @unchecked Sendable {
    private let transport: WebSocketClient
    private let configuration: CDPConnectionConfiguration
    private let queue = DispatchQueue(label: "RemoteAuthBrowserController.CDPConnection")
    private var nextIdentifier: UInt64 = 1
    private var queuedEvents: [CDPTransportEvent] = []
    private var queuedEventBytes = 0
    private var isClosed = false

    private init(
        transport: WebSocketClient,
        configuration: CDPConnectionConfiguration
    ) {
        self.transport = transport
        self.configuration = configuration
        queuedEvents.reserveCapacity(configuration.cdp.maximumQueuedEvents)
    }

    deinit {
        transport.close()
    }

    public static func connect(
        socketPath: String,
        configuration: CDPConnectionConfiguration = CDPConnectionConfiguration()
    ) throws -> CDPConnection {
        try configuration.validate()
        let version = try CDPHTTPProtocol.fetchVersion(
            socketPath: socketPath,
            socketConfiguration: configuration.socket,
            limits: configuration.http
        )
        let endpoint = try CDPWebSocketEndpoint(versionInfo: version)
        let transport = try WebSocketClient.connect(
            socketPath: socketPath,
            requestTarget: endpoint.requestTarget,
            socketConfiguration: configuration.socket,
            configuration: configuration.webSocket
        )
        return CDPConnection(transport: transport, configuration: configuration)
    }

    public func request(
        method: String,
        params: [String: CDPJSONValue]? = nil,
        sessionId: String? = nil,
        timeoutMilliseconds: Int? = nil
    ) throws -> CDPJSONValue {
        try queue.sync {
            try requestOnQueue(
                method: method,
                params: params,
                sessionId: sessionId,
                timeoutMilliseconds: timeoutMilliseconds
            )
        }
    }

    public func receiveEvent(timeoutMilliseconds: Int? = nil) throws -> CDPTransportEvent {
        try queue.sync {
            do {
                guard !isClosed else { throw CDPConnectionError.closed }
                if !queuedEvents.isEmpty {
                    let event = queuedEvents.removeFirst()
                    queuedEventBytes -= event.wireByteCount
                    return event
                }

                let timeout = timeoutMilliseconds ?? configuration.requestTimeoutMilliseconds
                let deadline = try makeDeadline(milliseconds: timeout)
                let inbound = try receiveEnvelope(deadline: deadline)
                guard inbound.envelope.id == nil else {
                    throw CDPConnectionError.protocolViolation
                }
                return try makeEvent(
                    from: inbound.envelope,
                    wireByteCount: inbound.wireByteCount
                )
            } catch let error as CDPConnectionError {
                if error != .closed {
                    closeOnQueue()
                }
                throw error
            } catch {
                closeOnQueue()
                throw CDPConnectionError.transportFailed
            }
        }
    }

    public func drainEvents() -> [CDPTransportEvent] {
        queue.sync {
            let events = queuedEvents
            queuedEvents.removeAll(keepingCapacity: true)
            queuedEventBytes = 0
            return events
        }
    }

    public func close() {
        queue.sync {
            closeOnQueue()
        }
    }

    private func requestOnQueue(
        method: String,
        params: [String: CDPJSONValue]?,
        sessionId: String?,
        timeoutMilliseconds: Int?
    ) throws -> CDPJSONValue {
        guard !isClosed else { throw CDPConnectionError.closed }
        guard Self.isValidMethod(method),
              sessionId.map(Self.isValidSessionIdentifier) ?? true
        else {
            throw CDPConnectionError.invalidRequest
        }

        var nodeCount = 0
        if let params {
            try validateJSONObject(params, depth: 0, nodeCount: &nodeCount)
        }
        guard nextIdentifier < UInt64.max else {
            closeOnQueue()
            throw CDPConnectionError.identifierExhausted
        }
        let identifier = nextIdentifier
        nextIdentifier += 1

        let requestData = try CDPRequestEncoder.encode(
            id: identifier,
            method: method,
            params: params,
            sessionId: sessionId
        )
        guard requestData.count <= configuration.cdp.maximumJSONMessageBytes else {
            throw CDPConnectionError.requestTooLarge
        }

        let timeout = timeoutMilliseconds ?? configuration.requestTimeoutMilliseconds
        let deadline = try makeDeadline(milliseconds: timeout)
        do {
            guard let writeTimeout = deadline.remainingMilliseconds() else {
                throw CDPConnectionError.timedOut
            }
            try transport.sendText(
                requestData,
                timeoutMilliseconds: writeTimeout
            )
            while true {
                let inbound = try receiveEnvelope(deadline: deadline)
                if inbound.envelope.id == nil {
                    let event = try makeEvent(
                        from: inbound.envelope,
                        wireByteCount: inbound.wireByteCount
                    )
                    try enqueue(event)
                    continue
                }

                guard inbound.envelope.id == identifier else {
                    throw CDPConnectionError.responseMismatch
                }
                guard inbound.envelope.method == nil,
                      inbound.envelope.params == nil,
                      inbound.envelope.sessionId == sessionId,
                      inbound.envelope.resultIsPresent != inbound.envelope.failureIsPresent
                else {
                    throw CDPConnectionError.protocolViolation
                }
                if inbound.envelope.failureIsPresent {
                    throw CDPConnectionError.commandFailed
                }
                guard let result = inbound.envelope.result else {
                    throw CDPConnectionError.protocolViolation
                }
                return result
            }
        } catch CDPConnectionError.commandFailed {
            throw CDPConnectionError.commandFailed
        } catch let error as CDPConnectionError {
            closeOnQueue()
            throw error
        } catch UnixSocketError.readTimedOut {
            closeOnQueue()
            throw CDPConnectionError.timedOut
        } catch {
            closeOnQueue()
            throw CDPConnectionError.transportFailed
        }
    }

    private func receiveEnvelope(
        deadline: MonotonicDeadline
    ) throws -> (envelope: CDPInboundEnvelope, wireByteCount: Int) {
        guard let timeout = deadline.remainingMilliseconds() else {
            throw CDPConnectionError.timedOut
        }
        let data: Data
        do {
            data = try transport.receiveTextData(timeoutMilliseconds: timeout)
        } catch UnixSocketError.readTimedOut {
            throw CDPConnectionError.timedOut
        } catch {
            throw CDPConnectionError.transportFailed
        }
        guard data.count <= configuration.cdp.maximumJSONMessageBytes else {
            throw CDPConnectionError.malformedMessage
        }

        let envelope = try CDPMessageParser.parse(data)
        try validateEnvelopeValues(envelope)
        return (envelope, data.count)
    }

    private func validateEnvelopeValues(_ envelope: CDPInboundEnvelope) throws {
        guard envelope.method.map(Self.isValidMethod) ?? true,
              envelope.sessionId.map(Self.isValidSessionIdentifier) ?? true
        else {
            throw CDPConnectionError.malformedMessage
        }
        var nodeCount = 0
        if let params = envelope.params {
            try validateJSONValue(
                params,
                depth: 0,
                nodeCount: &nodeCount,
                violation: .malformedMessage
            )
        }
        if let result = envelope.result {
            try validateJSONValue(
                result,
                depth: 0,
                nodeCount: &nodeCount,
                violation: .malformedMessage
            )
        }
    }

    private func makeEvent(
        from envelope: CDPInboundEnvelope,
        wireByteCount: Int
    ) throws -> CDPTransportEvent {
        guard envelope.id == nil,
              let method = envelope.method,
              !envelope.resultIsPresent,
              !envelope.failureIsPresent
        else {
            throw CDPConnectionError.protocolViolation
        }
        return CDPTransportEvent(
            method: method,
            params: envelope.params,
            sessionId: envelope.sessionId,
            wireByteCount: wireByteCount
        )
    }

    private func enqueue(_ event: CDPTransportEvent) throws {
        guard queuedEvents.count < configuration.cdp.maximumQueuedEvents,
              event.wireByteCount <= configuration.cdp.maximumQueuedEventBytes - queuedEventBytes
        else {
            throw CDPConnectionError.eventQueueFull
        }
        queuedEvents.append(event)
        queuedEventBytes += event.wireByteCount
    }

    private func validateJSONObject(
        _ object: [String: CDPJSONValue],
        depth: Int,
        nodeCount: inout Int
    ) throws {
        guard depth <= configuration.cdp.maximumJSONDepth else {
            throw CDPConnectionError.invalidRequest
        }
        for (key, value) in object {
            guard key.utf8.count <= configuration.cdp.maximumJSONStringBytes else {
                throw CDPConnectionError.invalidRequest
            }
            try validateJSONValue(
                value,
                depth: depth + 1,
                nodeCount: &nodeCount,
                violation: .invalidRequest
            )
        }
    }

    private func validateJSONValue(
        _ value: CDPJSONValue,
        depth: Int,
        nodeCount: inout Int,
        violation: CDPConnectionError
    ) throws {
        guard depth <= configuration.cdp.maximumJSONDepth,
              nodeCount < configuration.cdp.maximumJSONNodes
        else {
            throw violation
        }
        nodeCount += 1
        switch value {
        case .null, .boolean, .integer, .unsignedInteger:
            return
        case let .number(number):
            guard number.isFinite else { throw violation }
        case let .string(string):
            guard string.utf8.count <= configuration.cdp.maximumJSONStringBytes else {
                throw violation
            }
        case let .array(array):
            for element in array {
                try validateJSONValue(
                    element,
                    depth: depth + 1,
                    nodeCount: &nodeCount,
                    violation: violation
                )
            }
        case let .object(object):
            for (key, nested) in object {
                guard key.utf8.count <= configuration.cdp.maximumJSONStringBytes else {
                    throw violation
                }
                try validateJSONValue(
                    nested,
                    depth: depth + 1,
                    nodeCount: &nodeCount,
                    violation: violation
                )
            }
        }
    }

    private func makeDeadline(milliseconds: Int) throws -> MonotonicDeadline {
        do {
            return try MonotonicDeadline(milliseconds: milliseconds)
        } catch {
            throw CDPConnectionError.invalidConfiguration
        }
    }

    private func closeOnQueue() {
        guard !isClosed else { return }
        isClosed = true
        transport.close()
    }

    private static func isValidMethod(_ method: String) -> Bool {
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

    private static func isValidSessionIdentifier(_ identifier: String) -> Bool {
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
