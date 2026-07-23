import Darwin
import Foundation
import RemoteAuthProtocol

public enum BrokerSocketError: Error, Equatable, Sendable {
    case unsafePath
    case alreadyRunning
    case peerRejected
    case unexpectedEOF
    case trailingData
    case frameTooLarge
    case systemCall(String, Int32)
}

public struct BrokerPeer: Equatable, Sendable {
    public let uid: uid_t
    public let gid: gid_t
    public let pid: pid_t
    public let socketDescriptor: Int32

    public init(uid: uid_t, gid: gid_t, pid: pid_t, socketDescriptor: Int32) {
        self.uid = uid
        self.gid = gid
        self.pid = pid
        self.socketDescriptor = socketDescriptor
    }
}

public enum BrokerPaths {
    public static var supportDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("RemoteAuthBroker", isDirectory: true)
    }

    public static var runtimeDirectory: URL {
        supportDirectory.appendingPathComponent("run", isDirectory: true)
    }

    public static var socketURL: URL {
        runtimeDirectory.appendingPathComponent("remote-authd.sock", isDirectory: false)
    }

}

public final class OwnerOnlyUnixServer: @unchecked Sendable {
    public typealias Handler = @Sendable (BrokerPeer, Data) -> Data

    private let descriptor: Int32
    private let socketPath: String
    private let socketDevice: dev_t
    private let socketInode: ino_t
    private let handlerSlots: DispatchSemaphore
    private let handlerQueue = DispatchQueue(
        label: "com.arthur.remote-auth-broker.unix-clients",
        qos: .userInitiated,
        attributes: .concurrent
    )
    private let stateLock = NSLock()
    private var clientDescriptors = Set<Int32>()
    private var closed = false

    public init(
        socketURL: URL = BrokerPaths.socketURL,
        backlog: Int32 = 16,
        maximumConcurrentClients: Int = 8
    ) throws {
        guard socketURL == BrokerPaths.socketURL,
              (1...64).contains(maximumConcurrentClients)
        else {
            throw BrokerSocketError.unsafePath
        }
        handlerSlots = DispatchSemaphore(value: maximumConcurrentClients)
        try BrokerSocketPath.preparePrivateRuntimeDirectory()
        let path = socketURL.path
        try BrokerSocketPath.validateSocketPathLength(path)
        try BrokerSocketPath.removeStaleOwnedSocket(at: path)

        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw BrokerSocketError.systemCall("socket", errno)
        }
        do {
            try BrokerSocketIO.configure(fd)
            var address = try BrokerSocketPath.address(for: path)
            let result = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard result == 0 else {
                if errno == EADDRINUSE {
                    throw BrokerSocketError.alreadyRunning
                }
                throw BrokerSocketError.systemCall("bind", errno)
            }
            guard Darwin.chmod(path, S_IRUSR | S_IWUSR) == 0 else {
                throw BrokerSocketError.systemCall("chmod", errno)
            }
            let identity = try BrokerSocketPath.validateOwnedSocket(at: path)
            guard Darwin.listen(fd, backlog) == 0 else {
                throw BrokerSocketError.systemCall("listen", errno)
            }
            descriptor = fd
            socketPath = path
            socketDevice = identity.st_dev
            socketInode = identity.st_ino
        } catch {
            Darwin.close(fd)
            _ = path.withCString { Darwin.unlink($0) }
            throw error
        }
    }

    deinit {
        close()
    }

    public func run(handler: @escaping Handler) throws -> Never {
        while true {
            var storage = sockaddr_storage()
            var length = socklen_t(MemoryLayout<sockaddr_storage>.size)
            let client = withUnsafeMutablePointer(to: &storage) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.accept(descriptor, $0, &length)
                }
            }
            if client < 0 {
                if errno == EINTR { continue }
                throw BrokerSocketError.systemCall("accept", errno)
            }

            handlerSlots.wait()
            guard beginClient(client) else {
                Darwin.close(client)
                handlerSlots.signal()
                continue
            }
            handlerQueue.async { [self] in
                autoreleasepool {
                    defer {
                        _ = Darwin.shutdown(client, SHUT_RDWR)
                        Darwin.close(client)
                        finishClient(client)
                        handlerSlots.signal()
                    }
                    do {
                        try BrokerSocketIO.configure(client)
                        let peer = try BrokerSocketIO.ownerPeer(of: client)
                        let payload = try BrokerSocketIO.readSinglePayload(from: client)
                        let response = handler(peer, payload)
                        try BrokerSocketIO.writeFrame(payload: response, to: client)
                        _ = Darwin.shutdown(client, SHUT_WR)
                    } catch {
                        _ = Darwin.shutdown(client, SHUT_RDWR)
                    }
                }
            }
        }
    }

    public func close() {
        let clients: [Int32]
        stateLock.lock()
        if closed {
            stateLock.unlock()
            return
        }
        closed = true
        clients = Array(clientDescriptors)
        stateLock.unlock()

        _ = Darwin.shutdown(descriptor, SHUT_RDWR)
        Darwin.close(descriptor)
        for client in clients {
            _ = Darwin.shutdown(client, SHUT_RDWR)
        }
        guard let identity = try? BrokerSocketPath.lstat(path: socketPath),
              identity.st_dev == socketDevice,
              identity.st_ino == socketInode
        else { return }
        _ = socketPath.withCString { Darwin.unlink($0) }
    }

    private func beginClient(_ descriptor: Int32) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !closed else { return false }
        return clientDescriptors.insert(descriptor).inserted
    }

    private func finishClient(_ descriptor: Int32) {
        stateLock.lock()
        clientDescriptors.remove(descriptor)
        stateLock.unlock()
    }
}

public enum OwnerOnlyUnixClient {
    public static func exchange(
        requestFrame: Data,
        socketURL: URL = BrokerPaths.socketURL
    ) throws -> Data {
        let path = socketURL.path
        try BrokerSocketPath.validateSocketPathLength(path)
        let pathIdentity = try BrokerSocketPath.validateOwnedSocket(at: path)

        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw BrokerSocketError.systemCall("socket", errno)
        }
        defer { Darwin.close(fd) }
        try BrokerSocketIO.configure(fd)
        var address = try BrokerSocketPath.address(for: path)
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            throw BrokerSocketError.systemCall("connect", errno)
        }
        let peer = try BrokerSocketIO.ownerPeer(of: fd)
        guard peer.uid == geteuid() else {
            throw BrokerSocketError.peerRejected
        }
        var connectedIdentity = stat()
        guard Darwin.fstat(fd, &connectedIdentity) == 0 else {
            throw BrokerSocketError.systemCall("fstat", errno)
        }
        let currentPathIdentity = try BrokerSocketPath.lstat(path: path)
        guard currentPathIdentity.st_dev == pathIdentity.st_dev,
              currentPathIdentity.st_ino == pathIdentity.st_ino,
              (currentPathIdentity.st_mode & S_IFMT) == S_IFSOCK,
              (connectedIdentity.st_mode & S_IFMT) == S_IFSOCK
        else {
            throw BrokerSocketError.unsafePath
        }

        try BrokerSocketIO.writeAll(requestFrame, to: fd)
        guard Darwin.shutdown(fd, SHUT_WR) == 0 else {
            throw BrokerSocketError.systemCall("shutdown", errno)
        }
        let payload = try BrokerSocketIO.readSinglePayload(from: fd)
        return try FrameCodec.encode(payload: payload)
    }
}

private enum BrokerSocketPath {
    static func preparePrivateRuntimeDirectory() throws {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let library = home.appendingPathComponent("Library", isDirectory: true)
        let applicationSupport = library.appendingPathComponent("Application Support", isDirectory: true)
        try validateOwnedDirectory(path: home.path, privateOnly: false)
        try validateOwnedDirectory(path: library.path, privateOnly: false)
        try validateOwnedDirectory(path: applicationSupport.path, privateOnly: false)
        try createOrValidatePrivateDirectory(BrokerPaths.supportDirectory.path)
        try createOrValidatePrivateDirectory(BrokerPaths.runtimeDirectory.path)
    }

    static func validateSocketPathLength(_ path: String) throws {
        let address = sockaddr_un()
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard !path.isEmpty, path.utf8.count < capacity else {
            throw BrokerSocketError.unsafePath
        }
    }

    static func address(for path: String) throws -> sockaddr_un {
        try validateSocketPathLength(path)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let bytes = Array(path.utf8)
        withUnsafeMutableBytes(of: &address.sun_path) { destination in
            _ = destination.initializeMemory(as: UInt8.self, repeating: 0)
            destination.copyBytes(from: bytes)
        }
        return address
    }

    static func createOrValidatePrivateDirectory(_ path: String) throws {
        do {
            try validateOwnedDirectory(path: path, privateOnly: true)
        } catch let error as BrokerSocketError {
            guard error == .systemCall("lstat", ENOENT) else { throw error }
            guard path.withCString({ Darwin.mkdir($0, S_IRWXU) }) == 0 else {
                if errno == EEXIST {
                    try validateOwnedDirectory(path: path, privateOnly: true)
                    return
                }
                throw BrokerSocketError.systemCall("mkdir", errno)
            }
            try validateOwnedDirectory(path: path, privateOnly: true)
        }
    }

    static func validateOwnedDirectory(path: String, privateOnly: Bool) throws {
        let information = try lstat(path: path)
        guard (information.st_mode & S_IFMT) == S_IFDIR,
              information.st_uid == geteuid()
        else {
            throw BrokerSocketError.unsafePath
        }
        if privateOnly, information.st_mode & (S_IRWXG | S_IRWXO) != 0 {
            throw BrokerSocketError.unsafePath
        }
    }

    static func validateOwnedSocket(at path: String) throws -> stat {
        let information = try lstat(path: path)
        guard (information.st_mode & S_IFMT) == S_IFSOCK,
              information.st_uid == geteuid(),
              information.st_mode & (S_IRWXG | S_IRWXO) == 0,
              information.st_mode & (S_IRUSR | S_IWUSR) == (S_IRUSR | S_IWUSR)
        else {
            throw BrokerSocketError.unsafePath
        }
        return information
    }

    static func removeStaleOwnedSocket(at path: String) throws {
        let information: stat
        do {
            information = try validateOwnedSocket(at: path)
        } catch let error as BrokerSocketError {
            guard error == .systemCall("lstat", ENOENT) else { throw error }
            return
        }
        let probe = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard probe >= 0 else {
            throw BrokerSocketError.systemCall("socket", errno)
        }
        defer { Darwin.close(probe) }
        var address = try self.address(for: path)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(probe, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if connected == 0 {
            throw BrokerSocketError.alreadyRunning
        }
        guard errno == ECONNREFUSED || errno == ENOENT else {
            throw BrokerSocketError.systemCall("connect", errno)
        }
        let current = try lstat(path: path)
        guard current.st_dev == information.st_dev, current.st_ino == information.st_ino else {
            throw BrokerSocketError.unsafePath
        }
        guard path.withCString({ Darwin.unlink($0) }) == 0 else {
            throw BrokerSocketError.systemCall("unlink", errno)
        }
    }

    static func lstat(path: String) throws -> stat {
        var information = stat()
        guard path.withCString({ Darwin.lstat($0, &information) }) == 0 else {
            throw BrokerSocketError.systemCall("lstat", errno)
        }
        return information
    }
}

private enum BrokerSocketIO {
    private static let frameHeaderBytes = 4
    private static let timeoutSeconds = 10

    static func configure(_ descriptor: Int32) throws {
        var enabled: Int32 = 1
        guard Darwin.setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &enabled, socklen_t(MemoryLayout<Int32>.size)) == 0 else {
            throw BrokerSocketError.systemCall("setsockopt", errno)
        }
        var timeout = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
        guard Darwin.setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0,
              Darwin.setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0
        else {
            throw BrokerSocketError.systemCall("setsockopt", errno)
        }
    }

    static func ownerPeer(of descriptor: Int32) throws -> BrokerPeer {
        var uid: uid_t = 0
        var gid: gid_t = 0
        guard getpeereid(descriptor, &uid, &gid) == 0 else {
            throw BrokerSocketError.systemCall("getpeereid", errno)
        }
        guard uid == geteuid() else {
            throw BrokerSocketError.peerRejected
        }
        var pid: pid_t = 0
        var length = socklen_t(MemoryLayout<pid_t>.size)
        guard Darwin.getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &pid, &length) == 0,
              pid > 0
        else {
            throw BrokerSocketError.systemCall("getsockopt", errno)
        }
        return BrokerPeer(uid: uid, gid: gid, pid: pid, socketDescriptor: descriptor)
    }

    static func readSinglePayload(from descriptor: Int32) throws -> Data {
        var header = Data(count: frameHeaderBytes)
        try header.withUnsafeMutableBytes { bytes in
            try readExactly(bytes, from: descriptor)
        }
        let length = header.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> UInt32 in
            (UInt32(bytes[0]) << 24)
                | (UInt32(bytes[1]) << 16)
                | (UInt32(bytes[2]) << 8)
                | UInt32(bytes[3])
        }
        guard length > 0, length <= UInt32(remoteAuthMaximumFrameBytes) else {
            throw BrokerSocketError.frameTooLarge
        }
        var payload = Data(count: Int(length))
        try payload.withUnsafeMutableBytes { bytes in
            try readExactly(bytes, from: descriptor)
        }
        var extra: UInt8 = 0
        while true {
            let count = Darwin.read(descriptor, &extra, 1)
            if count == 0 { return payload }
            if count > 0 { throw BrokerSocketError.trailingData }
            if errno == EINTR { continue }
            throw BrokerSocketError.systemCall("read", errno)
        }
    }

    static func writeFrame(payload: Data, to descriptor: Int32) throws {
        try writeAll(FrameCodec.encode(payload: payload), to: descriptor)
    }

    static func writeAll(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count > 0 {
                    offset += count
                    continue
                }
                if count < 0, errno == EINTR { continue }
                throw BrokerSocketError.systemCall("write", errno)
            }
        }
    }

    private static func readExactly(_ destination: UnsafeMutableRawBufferPointer, from descriptor: Int32) throws {
        var offset = 0
        while offset < destination.count {
            let count = Darwin.read(descriptor, destination.baseAddress!.advanced(by: offset), destination.count - offset)
            if count > 0 {
                offset += count
                continue
            }
            if count == 0 { throw BrokerSocketError.unexpectedEOF }
            if errno == EINTR { continue }
            throw BrokerSocketError.systemCall("read", errno)
        }
    }
}
