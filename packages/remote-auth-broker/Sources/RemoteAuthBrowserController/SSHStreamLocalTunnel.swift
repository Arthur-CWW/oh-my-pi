import Darwin
import Foundation
import Security

internal final class SSHStreamLocalTunnel {
    internal let streamSocketPath: String
    private let controlSocketPath: String
    private let configuration: BrowserControllerConfiguration
    private var master: Process?
    private var ownsStreamSocket = false
    private var ownsControlSocket = false

    internal init(configuration: BrowserControllerConfiguration) throws {
        self.configuration = configuration
        try Self.prepareRuntimeDirectory(configuration.runtimeDirectoryPath)
        let token = try Self.randomToken()
        streamSocketPath = configuration.runtimeDirectoryPath + "/cdp-" + token
        controlSocketPath = configuration.runtimeDirectoryPath + "/ctl-" + token
        guard streamSocketPath.utf8.count < MemoryLayout<sockaddr_un>.size - 2,
              controlSocketPath.utf8.count < MemoryLayout<sockaddr_un>.size - 2,
              Self.pathIsAbsent(streamSocketPath),
              Self.pathIsAbsent(controlSocketPath)
        else { throw BrowserControllerError.sshAttestationRejected }
    }

    deinit {
        stop()
    }

    internal func start() throws {
        guard master == nil else { throw BrowserControllerError.operationInProgress }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: BrowserControllerContract.sshExecutablePath)
        process.arguments = [
            "-o", "BatchMode=yes",
            "-o", "ClearAllForwardings=yes",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ForwardAgent=no",
            "-o", "ForwardX11=no",
            "-o", "PermitLocalCommand=no",
            "-o", "ControlMaster=yes",
            "-o", "ControlPersist=no",
            "-o", "ControlPath=\(controlSocketPath)",
            "-o", "StreamLocalBindMask=0177",
            "-o", "StreamLocalBindUnlink=no",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=1",
            "-L", "\(streamSocketPath):127.0.0.1:\(BrowserControllerContract.chromeDebuggingPort)",
            "-N",
            configuration.sshDestination,
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            throw BrowserControllerError.unavailable
        }
        master = process

        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            guard process.isRunning else {
                stop()
                throw BrowserControllerError.transportRejected
            }
            if Self.pathExists(streamSocketPath), Self.pathExists(controlSocketPath) {
                do {
                    try Self.validateOwnedSocket(streamSocketPath)
                    ownsStreamSocket = true
                    try Self.validateOwnedSocket(controlSocketPath)
                    ownsControlSocket = true
                    try checkMaster()
                    return
                } catch {
                    stop()
                    throw BrowserControllerError.sshAttestationRejected
                }
            }
            usleep(10_000)
        }
        stop()
        throw BrowserControllerError.timeout
    }

    internal func fetchHostAttestation() throws -> Data {
        try checkMaster()
        return try Self.runBounded(
            arguments: [
                "-S", controlSocketPath,
                "-o", "BatchMode=yes",
                "-o", "ControlMaster=no",
                configuration.sshDestination,
                BrowserControllerContract.remoteAttestationCommand,
            ],
            maximumOutputBytes: configuration.jsonVersionMaximumBytes,
            timeoutMilliseconds: configuration.operationTimeoutMilliseconds
        )
    }

    internal func stop() {
        if master != nil, ownsControlSocket {
            _ = try? Self.runBounded(
                arguments: [
                    "-S", controlSocketPath,
                    "-O", "exit",
                    configuration.sshDestination,
                ],
                maximumOutputBytes: 1_024,
                timeoutMilliseconds: 2_000
            )
        }
        if let process = master {
            Self.terminate(process)
            master = nil
        }
        if ownsStreamSocket {
            Self.unlinkOwnedSocket(streamSocketPath)
            ownsStreamSocket = false
        }
        if ownsControlSocket {
            Self.unlinkOwnedSocket(controlSocketPath)
            ownsControlSocket = false
        }
    }

    private func checkMaster() throws {
        _ = try Self.runBounded(
            arguments: [
                "-S", controlSocketPath,
                "-O", "check",
                configuration.sshDestination,
            ],
            maximumOutputBytes: 1_024,
            timeoutMilliseconds: 2_000
        )
    }

    private static func prepareRuntimeDirectory(_ path: String) throws {
        var status = stat()
        if lstat(path, &status) != 0 {
            guard errno == ENOENT, mkdir(path, 0o700) == 0 else {
                throw BrowserControllerError.sshAttestationRejected
            }
            guard lstat(path, &status) == 0 else {
                throw BrowserControllerError.sshAttestationRejected
            }
        }
        let kind = status.st_mode & mode_t(S_IFMT)
        let permissions = status.st_mode & mode_t(0o777)
        guard kind == mode_t(S_IFDIR),
              status.st_uid == getuid(),
              permissions == mode_t(0o700)
        else { throw BrowserControllerError.sshAttestationRejected }
    }

    private static func validateOwnedSocket(_ path: String) throws {
        var status = stat()
        guard lstat(path, &status) == 0,
              status.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK),
              status.st_uid == getuid(),
              status.st_mode & mode_t(0o077) == 0,
              status.st_mode & mode_t(0o600) == mode_t(0o600)
        else { throw BrowserControllerError.sshAttestationRejected }
    }

    private static func pathIsAbsent(_ path: String) -> Bool {
        var status = stat()
        if lstat(path, &status) == 0 { return false }
        return errno == ENOENT
    }

    private static func pathExists(_ path: String) -> Bool {
        var status = stat()
        return lstat(path, &status) == 0
    }

    private static func unlinkOwnedSocket(_ path: String) {
        guard (try? validateOwnedSocket(path)) != nil else { return }
        _ = Darwin.unlink(path)
    }

    private static func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw BrowserControllerError.unavailable
        }
        defer {
            bytes.withUnsafeMutableBytes { buffer in
                _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        let alphabet = Array("0123456789abcdef".utf8)
        var result = [UInt8]()
        result.reserveCapacity(bytes.count * 2)
        for byte in bytes {
            result.append(alphabet[Int(byte >> 4)])
            result.append(alphabet[Int(byte & 0x0f)])
        }
        return String(decoding: result, as: UTF8.self)
    }

    private static func runBounded(
        arguments: [String],
        maximumOutputBytes: Int,
        timeoutMilliseconds: Int
    ) throws -> Data {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: BrowserControllerContract.sshExecutablePath)
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            throw BrowserControllerError.transportRejected
        }
        output.fileHandleForWriting.closeFile()
        let descriptor = output.fileHandleForReading.fileDescriptor
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0 else {
            terminate(process)
            throw BrowserControllerError.transportRejected
        }

        let limit = max(1, maximumOutputBytes)
        let deadline = deadline(milliseconds: timeoutMilliseconds)
        var result = Data()
        result.reserveCapacity(min(limit, 16_384))
        var buffer = [UInt8](repeating: 0, count: 4_096)
        defer {
            buffer.withUnsafeMutableBytes { rawBuffer in
                _ = rawBuffer.initializeMemory(as: UInt8.self, repeating: 0)
            }
            output.fileHandleForReading.closeFile()
        }

        while true {
            var reachedEOF = false
            while true {
                let count = Darwin.read(descriptor, &buffer, buffer.count)
                if count > 0 {
                    guard count <= limit - result.count else {
                        terminate(process)
                        throw BrowserControllerError.responseTooLarge
                    }
                    result.append(buffer, count: count)
                    continue
                }
                if count == 0 {
                    reachedEOF = true
                    break
                }
                if errno == EINTR { continue }
                if errno == EAGAIN || errno == EWOULDBLOCK { break }
                terminate(process)
                throw BrowserControllerError.transportRejected
            }

            if !process.isRunning, reachedEOF {
                process.waitUntilExit()
                guard process.terminationReason == .exit, process.terminationStatus == 0 else {
                    throw BrowserControllerError.transportRejected
                }
                return result
            }
            if DispatchTime.now().uptimeNanoseconds >= deadline {
                terminate(process)
                throw BrowserControllerError.timeout
            }
            usleep(10_000)
        }
    }

    private static func terminate(_ process: Process) {
        guard process.isRunning else {
            process.waitUntilExit()
            return
        }
        process.terminate()
        let deadline = deadline(milliseconds: 500)
        while process.isRunning, DispatchTime.now().uptimeNanoseconds < deadline {
            usleep(5_000)
        }
        if process.isRunning {
            _ = Darwin.kill(process.processIdentifier, SIGKILL)
        }
        process.waitUntilExit()
    }

    private static func deadline(milliseconds: Int) -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        let delta = UInt64(max(1, milliseconds)) * 1_000_000
        return now > UInt64.max - delta ? UInt64.max : now + delta
    }
}
