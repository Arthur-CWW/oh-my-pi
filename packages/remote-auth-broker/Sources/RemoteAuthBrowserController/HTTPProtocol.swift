import Foundation

public struct HTTPResponseLimits: Sendable, Equatable {
    public let maximumHeaderBytes: Int
    public let maximumBodyBytes: Int
    public let readChunkBytes: Int

    public init(
        maximumHeaderBytes: Int = 16 * 1_024,
        maximumBodyBytes: Int = 256 * 1_024,
        readChunkBytes: Int = 8 * 1_024
    ) {
        self.maximumHeaderBytes = maximumHeaderBytes
        self.maximumBodyBytes = maximumBodyBytes
        self.readChunkBytes = readChunkBytes
    }

    internal func validate() throws {
        guard (256...64 * 1_024).contains(maximumHeaderBytes),
              (1...2 * 1_024 * 1_024).contains(maximumBodyBytes),
              (1...64 * 1_024).contains(readChunkBytes)
        else {
            throw HTTPProtocolError.invalidLimits
        }
    }
}

public enum HTTPProtocolError: Error, CustomStringConvertible, LocalizedError, Sendable, Equatable {
    case invalidLimits
    case responseTooLarge
    case incompleteResponse
    case malformedResponse
    case unsupportedResponse
    case unexpectedStatus
    case invalidContentLength
    case invalidContentType
    case invalidVersionDocument
    case invalidWebSocketEndpoint

    public var description: String {
        switch self {
        case .invalidLimits: "http_invalid_limits"
        case .responseTooLarge: "http_response_too_large"
        case .incompleteResponse: "http_incomplete_response"
        case .malformedResponse: "http_malformed_response"
        case .unsupportedResponse: "http_unsupported_response"
        case .unexpectedStatus: "http_unexpected_status"
        case .invalidContentLength: "http_invalid_content_length"
        case .invalidContentType: "http_invalid_content_type"
        case .invalidVersionDocument: "http_invalid_version_document"
        case .invalidWebSocketEndpoint: "http_invalid_websocket_endpoint"
        }
    }

    public var errorDescription: String? { description }
}

internal struct ParsedHTTPHead: Sendable, Equatable {
    internal let statusCode: Int
    internal let headers: [String: String]
    internal let byteCount: Int
}

internal enum StrictHTTPHeadParser {
    private static let delimiter: [UInt8] = [13, 10, 13, 10]

    internal static func headerByteCount(
        in data: Data,
        maximumHeaderBytes: Int
    ) throws -> Int? {
        let bytes = [UInt8](data)
        if bytes.count >= delimiter.count {
            let finalStart = bytes.count - delimiter.count
            for start in 0...finalStart where bytes[start] == 13 {
                if bytes[start] == delimiter[0],
                   bytes[start + 1] == delimiter[1],
                   bytes[start + 2] == delimiter[2],
                   bytes[start + 3] == delimiter[3]
                {
                    let byteCount = start + delimiter.count
                    guard byteCount <= maximumHeaderBytes else {
                        throw HTTPProtocolError.responseTooLarge
                    }
                    return byteCount
                }
            }
        }
        if data.count >= maximumHeaderBytes {
            throw HTTPProtocolError.responseTooLarge
        }
        return nil
    }

    internal static func parse(
        _ data: Data,
        maximumHeaderBytes: Int
    ) throws -> ParsedHTTPHead? {
        guard let headerByteCount = try headerByteCount(
            in: data,
            maximumHeaderBytes: maximumHeaderBytes
        ) else {
            return nil
        }

        let bytes = [UInt8](data.prefix(headerByteCount))
        guard bytes.allSatisfy({ $0 == 9 || $0 == 13 || $0 == 10 || (32...126).contains($0) }) else {
            throw HTTPProtocolError.malformedResponse
        }

        var lineRanges: [Range<Int>] = []
        lineRanges.reserveCapacity(32)
        var lineStart = 0
        var cursor = 0
        while cursor + 1 < headerByteCount {
            if bytes[cursor] == 13, bytes[cursor + 1] == 10 {
                lineRanges.append(lineStart..<cursor)
                cursor += 2
                lineStart = cursor
                if cursor + 1 < headerByteCount,
                   bytes[cursor] == 13,
                   bytes[cursor + 1] == 10
                {
                    cursor += 2
                    break
                }
                continue
            }
            if bytes[cursor] == 10 {
                throw HTTPProtocolError.malformedResponse
            }
            cursor += 1
        }
        guard cursor == headerByteCount,
              !lineRanges.isEmpty,
              lineRanges.count <= 128
        else {
            throw HTTPProtocolError.malformedResponse
        }

        let statusCode = try parseStatusLine(bytes[lineRanges[0]])
        var headers: [String: String] = [:]
        headers.reserveCapacity(lineRanges.count - 1)
        for range in lineRanges.dropFirst() {
            guard !range.isEmpty else {
                throw HTTPProtocolError.malformedResponse
            }
            let line = bytes[range]
            if line.first == 32 || line.first == 9 {
                throw HTTPProtocolError.malformedResponse
            }
            guard let colon = line.firstIndex(of: 58), colon != line.startIndex else {
                throw HTTPProtocolError.malformedResponse
            }
            let nameBytes = line[..<colon]
            guard nameBytes.allSatisfy(isHeaderNameByte) else {
                throw HTTPProtocolError.malformedResponse
            }
            let name = String(decoding: nameBytes, as: UTF8.self).lowercased()
            guard headers[name] == nil else {
                throw HTTPProtocolError.malformedResponse
            }

            var valueStart = line.index(after: colon)
            while valueStart < line.endIndex, line[valueStart] == 32 || line[valueStart] == 9 {
                valueStart = line.index(after: valueStart)
            }
            var valueEnd = line.endIndex
            while valueEnd > valueStart {
                let prior = line.index(before: valueEnd)
                if line[prior] == 32 || line[prior] == 9 {
                    valueEnd = prior
                } else {
                    break
                }
            }
            let valueBytes = line[valueStart..<valueEnd]
            guard valueBytes.allSatisfy({ $0 == 9 || (32...126).contains($0) }) else {
                throw HTTPProtocolError.malformedResponse
            }
            headers[name] = String(decoding: valueBytes, as: UTF8.self)
        }

        return ParsedHTTPHead(
            statusCode: statusCode,
            headers: headers,
            byteCount: headerByteCount
        )
    }

    private static func parseStatusLine(_ line: ArraySlice<UInt8>) throws -> Int {
        let bytes = Array(line)
        let prefix = Array("HTTP/1.1 ".utf8)
        guard bytes.count >= 13,
              bytes.starts(with: prefix),
              (48...57).contains(bytes[9]),
              (48...57).contains(bytes[10]),
              (48...57).contains(bytes[11]),
              bytes[12] == 32,
              bytes[13...].allSatisfy({ (32...126).contains($0) })
        else {
            throw HTTPProtocolError.malformedResponse
        }
        return Int(bytes[9] - 48) * 100 + Int(bytes[10] - 48) * 10 + Int(bytes[11] - 48)
    }

    private static func isHeaderNameByte(_ byte: UInt8) -> Bool {
        switch byte {
        case 33, 35...39, 42, 43, 45, 46, 48...57, 65...90, 94...122, 124, 126:
            true
        default:
            false
        }
    }
}

internal struct ParsedHTTPResponse: Sendable, Equatable {
    internal let head: ParsedHTTPHead
    internal let body: Data
}

internal enum HTTPResponseParser {
    internal static func parse(
        _ data: Data,
        limits: HTTPResponseLimits
    ) throws -> ParsedHTTPResponse? {
        try limits.validate()
        guard data.count <= limits.maximumHeaderBytes + limits.maximumBodyBytes else {
            throw HTTPProtocolError.responseTooLarge
        }
        guard let head = try StrictHTTPHeadParser.parse(
            data,
            maximumHeaderBytes: limits.maximumHeaderBytes
        ) else {
            return nil
        }
        guard head.statusCode == 200 else {
            throw HTTPProtocolError.unexpectedStatus
        }
        guard head.headers["transfer-encoding"] == nil,
              head.headers["content-encoding"] == nil,
              let contentLengthText = head.headers["content-length"],
              let contentLength = parseContentLength(contentLengthText),
              contentLength <= limits.maximumBodyBytes
        else {
            throw HTTPProtocolError.invalidContentLength
        }
        guard let contentType = head.headers["content-type"],
              isJSONContentType(contentType)
        else {
            throw HTTPProtocolError.invalidContentType
        }

        let expectedCount = head.byteCount + contentLength
        if data.count < expectedCount { return nil }
        guard data.count == expectedCount else {
            throw HTTPProtocolError.malformedResponse
        }
        return ParsedHTTPResponse(
            head: head,
            body: data.subdata(in: head.byteCount..<expectedCount)
        )
    }

    private static func parseContentLength(_ text: String) -> Int? {
        let bytes = text.utf8
        guard !bytes.isEmpty,
              bytes.allSatisfy({ (48...57).contains($0) }),
              bytes.count == 1 || bytes.first != 48
        else {
            return nil
        }
        var value = 0
        for byte in bytes {
            let digit = Int(byte - 48)
            guard value <= (Int.max - digit) / 10 else { return nil }
            value = value * 10 + digit
        }
        return value
    }

    private static func isJSONContentType(_ text: String) -> Bool {
        let components = text.split(separator: ";", omittingEmptySubsequences: false)
        guard let mediaType = components.first,
              mediaType.trimmingCharacters(in: .whitespaces).lowercased() == "application/json"
        else {
            return false
        }
        for parameter in components.dropFirst() {
            let normalized = parameter.trimmingCharacters(in: .whitespaces).lowercased()
            guard normalized == "charset=utf-8" else { return false }
        }
        return true
    }
}

internal enum HTTPVersionRequestEncoder {
    internal static func encode() -> Data {
        Data(
            "GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nAccept: application/json\r\nConnection: close\r\n\r\n".utf8
        )
    }
}

public struct CDPVersionInfo: Decodable, Sendable, Equatable {
    public let browser: String?
    public let protocolVersion: String?
    public let userAgent: String?
    public let v8Version: String?
    public let webKitVersion: String?
    public let webSocketDebuggerURL: String

    private enum CodingKeys: String, CodingKey {
        case browser = "Browser"
        case protocolVersion = "Protocol-Version"
        case userAgent = "User-Agent"
        case v8Version = "V8-Version"
        case webKitVersion = "WebKit-Version"
        case webSocketDebuggerURL = "webSocketDebuggerUrl"
    }
}

internal struct CDPWebSocketEndpoint: Sendable, Equatable {
    internal let requestTarget: String

    internal init(versionInfo: CDPVersionInfo) throws {
        guard versionInfo.webSocketDebuggerURL.utf8.count <= 2_048,
              let components = URLComponents(string: versionInfo.webSocketDebuggerURL),
              components.scheme == "ws",
              components.user == nil,
              components.password == nil,
              components.host == "127.0.0.1",
              components.port == 9_222,
              components.percentEncodedQuery == nil,
              components.fragment == nil
        else {
            throw HTTPProtocolError.invalidWebSocketEndpoint
        }
        let target = components.percentEncodedPath
        guard target.utf8.count <= 2_048,
              target.hasPrefix("/devtools/browser/"),
              target.count > "/devtools/browser/".count,
              !target.utf8.contains(where: { $0 == 13 || $0 == 10 || $0 == 0 })
        else {
            throw HTTPProtocolError.invalidWebSocketEndpoint
        }
        requestTarget = target
    }
}

public enum CDPHTTPProtocol {
    public static func fetchVersion(
        socketPath: String,
        socketConfiguration: UnixSocketConfiguration = UnixSocketConfiguration(),
        limits: HTTPResponseLimits = HTTPResponseLimits()
    ) throws -> CDPVersionInfo {
        try limits.validate()
        let socket = try UnixSocket(path: socketPath, configuration: socketConfiguration)
        defer { socket.close() }
        try socket.write(HTTPVersionRequestEncoder.encode())

        var response = Data()
        response.reserveCapacity(limits.maximumHeaderBytes + limits.maximumBodyBytes)
        let deadline = try MonotonicDeadline(
            milliseconds: socketConfiguration.readTimeoutMilliseconds
        )
        while true {
            if let parsed = try HTTPResponseParser.parse(response, limits: limits) {
                let decoder = JSONDecoder()
                guard let versionInfo = try? decoder.decode(CDPVersionInfo.self, from: parsed.body),
                      versionInfo.webSocketDebuggerURL.utf8.count <= 2_048
                else {
                    throw HTTPProtocolError.invalidVersionDocument
                }
                _ = try CDPWebSocketEndpoint(versionInfo: versionInfo)
                return versionInfo
            }

            let maximumTotal = limits.maximumHeaderBytes + limits.maximumBodyBytes
            guard response.count < maximumTotal else {
                throw HTTPProtocolError.responseTooLarge
            }
            guard let timeout = deadline.remainingMilliseconds() else {
                throw UnixSocketError.readTimedOut
            }
            let readCount = min(limits.readChunkBytes, maximumTotal - response.count)
            do {
                let chunk = try socket.read(
                    maximumBytes: readCount,
                    timeoutMilliseconds: timeout
                )
                response.append(chunk)
            } catch UnixSocketError.peerClosed {
                throw HTTPProtocolError.incompleteResponse
            }
        }
    }
}
