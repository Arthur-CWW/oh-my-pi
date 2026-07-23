import Darwin
import Dispatch
import Foundation

public struct UnixSocketConfiguration: Sendable, Equatable {
    public let connectTimeoutMilliseconds: Int
    public let readTimeoutMilliseconds: Int
    public let writeTimeoutMilliseconds: Int
    public let maximumReadBytes: Int
    public let maximumWriteBytes: Int

    public init(
        connectTimeoutMilliseconds: Int = 5_000,
        readTimeoutMilliseconds: Int = 10_000,
        writeTimeoutMilliseconds: Int = 10_000,
        maximumReadBytes: Int = 64 * 1_024,
        maximumWriteBytes: Int = 2 * 1_024 * 1_024
    ) {
        self.connectTimeoutMilliseconds = connectTimeoutMilliseconds
        self.readTimeoutMilliseconds = readTimeoutMilliseconds
        self.writeTimeoutMilliseconds = writeTimeoutMilliseconds
        self.maximumReadBytes = maximumReadBytes
        self.maximumWriteBytes = maximumWriteBytes
    }

    internal func validate() throws {
        guard (1...300_000).contains(connectTimeoutMilliseconds),
              (1...300_000).contains(readTimeoutMilliseconds),
              (1...300_000).contains(writeTimeoutMilliseconds),
              (1...16 * 1_024 * 1_024).contains(maximumReadBytes),
              (1...16 * 1_024 * 1_024).contains(maximumWriteBytes)
        else {
            throw UnixSocketError.invalidConfiguration
        }
    }
}

public enum UnixSocketError: Error, CustomStringConvertible, LocalizedError, Sendable, Equatable {
    case invalidConfiguration
    case invalidPath
    case pathTooLong
    case creationFailed
    case optionFailed
    case connectTimedOut
    case connectFailed
    case readTimedOut
    case readFailed
    case writeTimedOut
    case writeFailed
    case peerClosed
    case sizeLimitExceeded
    case closed

    public var description: String {
        switch self {
        case .invalidConfiguration: "unix_socket_invalid_configuration"
        case .invalidPath: "unix_socket_invalid_path"
        case .pathTooLong: "unix_socket_path_too_long"
        case .creationFailed: "unix_socket_creation_failed"
        case .optionFailed: "unix_socket_option_failed"
        case .connectTimedOut: "unix_socket_connect_timeout"
        case .connectFailed: "unix_socket_connect_failed"
        case .readTimedOut: "unix_socket_read_timeout"
        case .readFailed: "unix_socket_read_failed"
        case .writeTimedOut: "unix_socket_write_timeout"
        case .writeFailed: "unix_socket_write_failed"
        case .peerClosed: "unix_socket_peer_closed"
        case .sizeLimitExceeded: "unix_socket_size_limit"
        case .closed: "unix_socket_closed"
        }
    }

    public var errorDescription: String? { description }
}

internal struct MonotonicDeadline {
    private let nanoseconds: UInt64

    internal init(milliseconds: Int) throws {
        guard (1...300_000).contains(milliseconds) else {
            throw UnixSocketError.invalidConfiguration
        }
        let now = DispatchTime.now().uptimeNanoseconds
        let delta = UInt64(milliseconds) * 1_000_000
        nanoseconds = now > UInt64.max - delta ? UInt64.max : now + delta
    }

    internal func remainingMilliseconds() -> Int? {
        let now = DispatchTime.now().uptimeNanoseconds
        guard now < nanoseconds else { return nil }
        let remaining = nanoseconds - now
        let roundedUp = (remaining + 999_999) / 1_000_000
        return Int(min(roundedUp, UInt64(Int32.max)))
    }
}

public final class UnixSocket {
    private var descriptor: Int32
    public let configuration: UnixSocketConfiguration

    public init(path: String, configuration: UnixSocketConfiguration = UnixSocketConfiguration()) throws {
        try configuration.validate()
        guard !path.isEmpty, !path.utf8.contains(0) else {
            throw UnixSocketError.invalidPath
        }

        var address = sockaddr_un()
        let pathCapacity = MemoryLayout.size(ofValue: address.sun_path)
        let pathBytes = Array(path.utf8)
        guard pathBytes.count < pathCapacity else {
            throw UnixSocketError.pathTooLong
        }

        let newDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard newDescriptor >= 0 else {
            throw UnixSocketError.creationFailed
        }

        descriptor = newDescriptor
        self.configuration = configuration
        var connected = false
        defer {
            if !connected {
                Darwin.close(newDescriptor)
            }
        }

        var noSigPipe: Int32 = 1
        guard Darwin.setsockopt(
            newDescriptor,
            SOL_SOCKET,
            SO_NOSIGPIPE,
            &noSigPipe,
            socklen_t(MemoryLayout<Int32>.size)
        ) == 0 else {
            throw UnixSocketError.optionFailed
        }

        let currentFlags = Darwin.fcntl(newDescriptor, F_GETFL)
        guard currentFlags >= 0,
              Darwin.fcntl(newDescriptor, F_SETFL, currentFlags | O_NONBLOCK) == 0
        else {
            throw UnixSocketError.optionFailed
        }

        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { destination in
            destination.initializeMemory(as: UInt8.self, repeating: 0)
            pathBytes.withUnsafeBytes { source in
                if let sourceBase = source.baseAddress, let destinationBase = destination.baseAddress {
                    destinationBase.copyMemory(from: sourceBase, byteCount: pathBytes.count)
                }
            }
        }

        let connectResult = withUnsafePointer(to: &address) { addressPointer in
            addressPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                Darwin.connect(
                    newDescriptor,
                    socketAddress,
                    socklen_t(MemoryLayout<sockaddr_un>.size)
                )
            }
        }

        if connectResult != 0 {
            guard errno == EINPROGRESS else {
                throw UnixSocketError.connectFailed
            }
            let deadline = try MonotonicDeadline(milliseconds: configuration.connectTimeoutMilliseconds)
            try Self.wait(
                descriptor: newDescriptor,
                events: Int16(POLLOUT),
                deadline: deadline,
                timeoutError: .connectTimedOut,
                failureError: .connectFailed
            )

            var socketError: Int32 = 0
            var socketErrorLength = socklen_t(MemoryLayout<Int32>.size)
            guard Darwin.getsockopt(
                newDescriptor,
                SOL_SOCKET,
                SO_ERROR,
                &socketError,
                &socketErrorLength
            ) == 0,
            socketError == 0
            else {
                throw UnixSocketError.connectFailed
            }
        }

        connected = true
    }

    deinit {
        close()
    }

    public var isOpen: Bool { descriptor >= 0 }

    public func close() {
        guard descriptor >= 0 else { return }
        let activeDescriptor = descriptor
        descriptor = -1
        Darwin.shutdown(activeDescriptor, SHUT_RDWR)
        Darwin.close(activeDescriptor)
    }

    public func read(
        maximumBytes: Int,
        timeoutMilliseconds: Int? = nil
    ) throws -> Data {
        guard descriptor >= 0 else { throw UnixSocketError.closed }
        guard maximumBytes > 0,
              maximumBytes <= configuration.maximumReadBytes
        else {
            throw UnixSocketError.sizeLimitExceeded
        }

        let timeout = timeoutMilliseconds ?? configuration.readTimeoutMilliseconds
        let deadline = try MonotonicDeadline(milliseconds: timeout)
        try Self.wait(
            descriptor: descriptor,
            events: Int16(POLLIN),
            deadline: deadline,
            timeoutError: .readTimedOut,
            failureError: .readFailed
        )

        var bytes = Data(count: maximumBytes)
        while true {
            let received = bytes.withUnsafeMutableBytes { buffer -> Int in
                guard let baseAddress = buffer.baseAddress else { return 0 }
                return Darwin.recv(descriptor, baseAddress, maximumBytes, 0)
            }
            if received > 0 {
                bytes.removeSubrange(received..<bytes.count)
                return bytes
            }
            if received == 0 {
                throw UnixSocketError.peerClosed
            }
            if errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK {
                try Self.wait(
                    descriptor: descriptor,
                    events: Int16(POLLIN),
                    deadline: deadline,
                    timeoutError: .readTimedOut,
                    failureError: .readFailed
                )
                continue
            }
            throw UnixSocketError.readFailed
        }
    }

    public func readExactly(
        byteCount: Int,
        timeoutMilliseconds: Int? = nil
    ) throws -> Data {
        guard byteCount >= 0,
              byteCount <= configuration.maximumReadBytes
        else {
            throw UnixSocketError.sizeLimitExceeded
        }
        guard byteCount > 0 else { return Data() }

        let timeout = timeoutMilliseconds ?? configuration.readTimeoutMilliseconds
        let deadline = try MonotonicDeadline(milliseconds: timeout)
        var result = Data()
        result.reserveCapacity(byteCount)
        while result.count < byteCount {
            guard let remainingTimeout = deadline.remainingMilliseconds() else {
                throw UnixSocketError.readTimedOut
            }
            let chunk = try read(
                maximumBytes: byteCount - result.count,
                timeoutMilliseconds: remainingTimeout
            )
            result.append(chunk)
        }
        return result
    }

    public func write(
        _ bytes: Data,
        timeoutMilliseconds: Int? = nil
    ) throws {
        guard descriptor >= 0 else { throw UnixSocketError.closed }
        guard bytes.count <= configuration.maximumWriteBytes else {
            throw UnixSocketError.sizeLimitExceeded
        }
        guard !bytes.isEmpty else { return }

        let timeout = timeoutMilliseconds ?? configuration.writeTimeoutMilliseconds
        let deadline = try MonotonicDeadline(milliseconds: timeout)
        var offset = 0
        while offset < bytes.count {
            try Self.wait(
                descriptor: descriptor,
                events: Int16(POLLOUT),
                deadline: deadline,
                timeoutError: .writeTimedOut,
                failureError: .writeFailed
            )
            let sent = bytes.withUnsafeBytes { buffer -> Int in
                guard let baseAddress = buffer.baseAddress else { return 0 }
                return Darwin.send(
                    descriptor,
                    baseAddress.advanced(by: offset),
                    bytes.count - offset,
                    0
                )
            }
            if sent > 0 {
                offset += sent
                continue
            }
            if sent == 0 {
                throw UnixSocketError.writeFailed
            }
            if errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK {
                continue
            }
            throw UnixSocketError.writeFailed
        }
    }

    private static func wait(
        descriptor: Int32,
        events: Int16,
        deadline: MonotonicDeadline,
        timeoutError: UnixSocketError,
        failureError: UnixSocketError
    ) throws {
        while true {
            guard let timeout = deadline.remainingMilliseconds() else {
                throw timeoutError
            }
            var pollDescriptor = pollfd(fd: descriptor, events: events, revents: 0)
            let result = Darwin.poll(&pollDescriptor, 1, Int32(timeout))
            if result > 0 {
                if pollDescriptor.revents & Int16(POLLNVAL | POLLERR) != 0 {
                    throw failureError
                }
                if pollDescriptor.revents & events != 0 || pollDescriptor.revents & Int16(POLLHUP) != 0 {
                    return
                }
                continue
            }
            if result == 0 {
                throw timeoutError
            }
            if errno == EINTR {
                continue
            }
            throw failureError
        }
    }
}
