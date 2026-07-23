import Darwin
import Foundation

internal enum ChromePipeProcessError: Error, Equatable, Sendable {
    case invalidExecutable
    case unsafeProfileDirectory
    case invalidArgument
    case transportClosed
    case invalidTimeout
    case launchFailed(Int32)
    case systemCall(String, Int32)
}

/// A narrowly configured Chrome child using only the documented DevTools pipe descriptors.
///
/// The descriptor pair is transferred exactly once to `CDPNullPipeConnection`. The process
/// remains responsible for child lifetime even after that transfer.
internal final class ChromePipeProcess: @unchecked Sendable {
    internal static let childReadDescriptor: Int32 = 3
    internal static let childWriteDescriptor: Int32 = 4

    internal let launchArguments: [String]

    private let lock = NSLock()
    private var processIdentifier: pid_t?
    private var parentReadDescriptor: Int32
    private var parentWriteDescriptor: Int32


    internal init(
        executablePath: String,
        profileDirectoryPath: String,
        initialURL: String
    ) throws {
        try Self.attestExecutable(at: executablePath)
        try Self.createAndAttestProfileDirectory(at: profileDirectoryPath)
        guard Self.isSafeArgument(initialURL) else {
            throw ChromePipeProcessError.invalidArgument
        }

        let arguments = [
            executablePath,
            "--remote-debugging-pipe",
            "--user-data-dir=\(profileDirectoryPath)",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-breakpad",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-domain-reliability",
            "--disable-extensions",
            "--disable-sync",
            "--force-webrtc-ip-handling-policy=default_public_interface_only",
            "--metrics-recording-only",
            initialURL,
        ]
        guard arguments.allSatisfy(Self.isSafeArgument) else {
            throw ChromePipeProcessError.invalidArgument
        }

        var toChild = try Self.makePipe()
        do {
            try Self.normalizePipeDescriptors(&toChild)
            try Self.configurePipeDescriptors(toChild)
        } catch {
            Self.closePipe(toChild)
            throw error
        }

        var fromChild: (read: Int32, write: Int32)
        do {
            fromChild = try Self.makePipe()
        } catch {
            Self.closePipe(toChild)
            throw error
        }
        do {
            try Self.normalizePipeDescriptors(&fromChild)
            try Self.configurePipeDescriptors(fromChild)
            guard Darwin.fcntl(toChild.write, F_SETNOSIGPIPE, 1) == 0 else {
                throw ChromePipeProcessError.systemCall("fcntl(F_SETNOSIGPIPE)", errno)
            }
        } catch {
            Self.closePipe(toChild)
            Self.closePipe(fromChild)
            throw error
        }

        let pid: pid_t
        do {
            pid = try Self.spawn(
                executablePath: executablePath,
                arguments: arguments,
                childReadSource: toChild.read,
                childWriteSource: fromChild.write,
                allPipeDescriptors: [toChild.read, toChild.write, fromChild.read, fromChild.write]
            )
        } catch {
            Self.closePipe(toChild)
            Self.closePipe(fromChild)
            throw error
        }

        Darwin.close(toChild.read)
        Darwin.close(fromChild.write)
        launchArguments = arguments
        processIdentifier = pid
        parentReadDescriptor = fromChild.read
        parentWriteDescriptor = toChild.write
    }

    deinit {
        closeTransport()
        try? terminateAndWait()
    }

    /// Transfers the only parent-side references to the DevTools pipe.
    internal func takeTransportDescriptors() throws -> (read: Int32, write: Int32) {
        lock.lock()
        defer { lock.unlock() }
        guard parentReadDescriptor >= 0, parentWriteDescriptor >= 0 else {
            throw ChromePipeProcessError.transportClosed
        }
        let descriptors = (read: parentReadDescriptor, write: parentWriteDescriptor)
        parentReadDescriptor = -1
        parentWriteDescriptor = -1
        return descriptors
    }

    internal func closeTransport() {
        lock.lock()
        let readDescriptor = parentReadDescriptor
        let writeDescriptor = parentWriteDescriptor
        parentReadDescriptor = -1
        parentWriteDescriptor = -1
        lock.unlock()

        if readDescriptor >= 0 { Darwin.close(readDescriptor) }
        if writeDescriptor >= 0 { Darwin.close(writeDescriptor) }
    }

    internal func terminateAndWait(graceTimeoutSeconds: Double) throws {
        guard graceTimeoutSeconds.isFinite,
              graceTimeoutSeconds > 0,
              graceTimeoutSeconds <= 300
        else {
            try terminateAndWait(graceMilliseconds: 0)
            return
        }
        let milliseconds = Int((graceTimeoutSeconds * 1_000).rounded(.up))
        try terminateAndWait(graceMilliseconds: milliseconds)
    }

    /// Sends SIGTERM, waits for a bounded grace period, then uses SIGKILL and reaps the child.
    /// Invalid timing input still kills and reaps before returning an error.
    internal func terminateAndWait(graceMilliseconds: Int = 2_000) throws {
        closeTransport()

        lock.lock()
        guard let pid = processIdentifier else {
            lock.unlock()
            return
        }
        processIdentifier = nil
        lock.unlock()

        guard (1...300_000).contains(graceMilliseconds) else {
            let reapError = Self.killAndReap(pid)
            if let reapError { throw reapError }
            throw ChromePipeProcessError.invalidTimeout
        }

        var firstError: ChromePipeProcessError?
        if Darwin.kill(pid, SIGTERM) != 0, errno != ESRCH {
            firstError = .systemCall("kill(SIGTERM)", errno)
        }

        let deadline: UInt64
        do {
            deadline = try Self.deadline(afterMilliseconds: graceMilliseconds)
        } catch let error as ChromePipeProcessError {
            firstError = firstError ?? error
            if let reapError = Self.killAndReap(pid) { throw firstError ?? reapError }
            throw firstError ?? error
        }

        while Self.monotonicNanoseconds() < deadline {
            var status: Int32 = 0
            let result = Darwin.waitpid(pid, &status, WNOHANG)
            if result == pid {
                if let firstError { throw firstError }
                return
            }
            if result < 0 {
                if errno == EINTR { continue }
                if errno == ECHILD {
                    if let firstError { throw firstError }
                    return
                }
                firstError = firstError ?? .systemCall("waitpid", errno)
                break
            }
            Darwin.usleep(10_000)
        }

        if let reapError = Self.killAndReap(pid) {
            throw firstError ?? reapError
        }
        if let firstError { throw firstError }
    }

    /// Reaps a child that exited independently. A nil result means it is still running.
    internal func pollExitStatus() throws -> Int32? {
        lock.lock()
        guard let pid = processIdentifier else {
            lock.unlock()
            return nil
        }
        var status: Int32 = 0
        var result: pid_t
        repeat {
            result = Darwin.waitpid(pid, &status, WNOHANG)
        } while result < 0 && errno == EINTR
        if result == pid || (result < 0 && errno == ECHILD) {
            processIdentifier = nil
        }
        lock.unlock()

        if result == pid { return status }
        if result == 0 { return nil }
        if errno == ECHILD { return status }
        let waitError = ChromePipeProcessError.systemCall("waitpid", errno)
        closeTransport()
        try? terminateAndWait(graceMilliseconds: 1)
        throw waitError
    }

    private static func attestExecutable(at path: String) throws {
        guard path.utf8.first == UInt8(ascii: "/"), isSafeArgument(path) else {
            throw ChromePipeProcessError.invalidExecutable
        }
        var information = stat()
        guard path.withCString({ Darwin.lstat($0, &information) }) == 0,
              (information.st_mode & S_IFMT) == S_IFREG,
              path.withCString({ Darwin.access($0, X_OK) }) == 0
        else {
            throw ChromePipeProcessError.invalidExecutable
        }
    }

    private static func createAndAttestProfileDirectory(at path: String) throws {
        guard path.utf8.first == UInt8(ascii: "/"), isSafeArgument(path) else {
            throw ChromePipeProcessError.unsafeProfileDirectory
        }

        let createResult = path.withCString { Darwin.mkdir($0, S_IRWXU) }
        if createResult != 0, errno != EEXIST {
            throw ChromePipeProcessError.systemCall("mkdir", errno)
        }

        var information = stat()
        guard path.withCString({ Darwin.lstat($0, &information) }) == 0,
              (information.st_mode & S_IFMT) == S_IFDIR,
              information.st_uid == Darwin.geteuid(),
              information.st_mode & (S_IRWXG | S_IRWXO) == 0,
              information.st_mode & S_IRWXU == S_IRWXU
        else {
            throw ChromePipeProcessError.unsafeProfileDirectory
        }
    }

    private static func makePipe() throws -> (read: Int32, write: Int32) {
        var descriptors: [Int32] = [0, 0]
        guard Darwin.pipe(&descriptors) == 0 else {
            throw ChromePipeProcessError.systemCall("pipe", errno)
        }
        return (read: descriptors[0], write: descriptors[1])
    }

    private static func normalizePipeDescriptors(
        _ descriptors: inout (read: Int32, write: Int32)
    ) throws {
        descriptors.read = try normalizedDescriptor(descriptors.read)
        do {
            descriptors.write = try normalizedDescriptor(descriptors.write)
        } catch {
            Darwin.close(descriptors.read)
            descriptors.read = -1
            throw error
        }
    }

    private static func normalizedDescriptor(_ descriptor: Int32) throws -> Int32 {
        guard descriptor == childReadDescriptor || descriptor == childWriteDescriptor else {
            return descriptor
        }
        let replacement = Darwin.fcntl(descriptor, F_DUPFD_CLOEXEC, 5)
        guard replacement >= 0 else {
            throw ChromePipeProcessError.systemCall("fcntl(F_DUPFD_CLOEXEC)", errno)
        }
        Darwin.close(descriptor)
        return replacement
    }

    private static func configurePipeDescriptors(
        _ descriptors: (read: Int32, write: Int32)
    ) throws {
        try setCloseOnExec(descriptors.read)
        try setCloseOnExec(descriptors.write)
    }

    private static func setCloseOnExec(_ descriptor: Int32) throws {
        let flags = Darwin.fcntl(descriptor, F_GETFD)
        guard flags >= 0,
              Darwin.fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC) == 0
        else {
            throw ChromePipeProcessError.systemCall("fcntl(FD_CLOEXEC)", errno)
        }
    }

    private static func setNonBlocking(_ descriptor: Int32) throws {
        let flags = Darwin.fcntl(descriptor, F_GETFL)
        guard flags >= 0,
              Darwin.fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0
        else {
            throw ChromePipeProcessError.systemCall("fcntl(O_NONBLOCK)", errno)
        }
    }

    private static func spawn(
        executablePath: String,
        arguments: [String],
        childReadSource: Int32,
        childWriteSource: Int32,
        allPipeDescriptors: [Int32]
    ) throws -> pid_t {
        var fileActions: posix_spawn_file_actions_t?
        let actionsResult = posix_spawn_file_actions_init(&fileActions)
        guard actionsResult == 0 else {
            throw ChromePipeProcessError.systemCall("posix_spawn_file_actions_init", actionsResult)
        }
        defer { posix_spawn_file_actions_destroy(&fileActions) }

        var actionResult = posix_spawn_file_actions_adddup2(
            &fileActions,
            childReadSource,
            childReadDescriptor
        )
        guard actionResult == 0 else {
            throw ChromePipeProcessError.systemCall("posix_spawn_file_actions_adddup2", actionResult)
        }
        actionResult = posix_spawn_file_actions_adddup2(
            &fileActions,
            childWriteSource,
            childWriteDescriptor
        )
        guard actionResult == 0 else {
            throw ChromePipeProcessError.systemCall("posix_spawn_file_actions_adddup2", actionResult)
        }
        for descriptor in allPipeDescriptors {
            actionResult = posix_spawn_file_actions_addclose(&fileActions, descriptor)
            guard actionResult == 0 else {
                throw ChromePipeProcessError.systemCall("posix_spawn_file_actions_addclose", actionResult)
            }
        }

        var attributes: posix_spawnattr_t?
        let attributesResult = posix_spawnattr_init(&attributes)
        guard attributesResult == 0 else {
            throw ChromePipeProcessError.systemCall("posix_spawnattr_init", attributesResult)
        }
        defer { posix_spawnattr_destroy(&attributes) }
        let flags = Int16(POSIX_SPAWN_CLOEXEC_DEFAULT)
        let flagsResult = posix_spawnattr_setflags(&attributes, flags)
        guard flagsResult == 0 else {
            throw ChromePipeProcessError.systemCall("posix_spawnattr_setflags", flagsResult)
        }

        let duplicatedArguments = arguments.map { argument in
            argument.withCString { strdup($0) }
        }
        defer {
            duplicatedArguments.forEach { pointer in
                if let pointer { free(pointer) }
            }
        }
        guard duplicatedArguments.allSatisfy({ $0 != nil }) else {
            throw ChromePipeProcessError.systemCall("strdup", ENOMEM)
        }

        var argv = duplicatedArguments
        argv.append(nil)
        var emptyEnvironment: [UnsafeMutablePointer<CChar>?] = [nil]
        var pid: pid_t = 0
        let spawnResult = executablePath.withCString { executable in
            argv.withUnsafeMutableBufferPointer { argumentBuffer in
                emptyEnvironment.withUnsafeMutableBufferPointer { environmentBuffer in
                    posix_spawn(
                        &pid,
                        executable,
                        &fileActions,
                        &attributes,
                        argumentBuffer.baseAddress,
                        environmentBuffer.baseAddress
                    )
                }
            }
        }
        guard spawnResult == 0 else {
            throw ChromePipeProcessError.launchFailed(spawnResult)
        }

        do {
            try setNonBlocking(allPipeDescriptors[1])
            try setNonBlocking(allPipeDescriptors[2])
        } catch {
            _ = Darwin.kill(pid, SIGKILL)
            var status: Int32 = 0
            while Darwin.waitpid(pid, &status, 0) < 0, errno == EINTR {}
            throw error
        }
        return pid
    }

    private static func killAndReap(_ pid: pid_t) -> ChromePipeProcessError? {
        var firstError: ChromePipeProcessError?
        if Darwin.kill(pid, SIGKILL) != 0, errno != ESRCH {
            firstError = .systemCall("kill(SIGKILL)", errno)
        }

        var status: Int32 = 0
        while true {
            let result = Darwin.waitpid(pid, &status, 0)
            if result == pid || (result < 0 && errno == ECHILD) { return firstError }
            if result < 0 && errno == EINTR { continue }
            if result < 0 {
                return firstError ?? .systemCall("waitpid", errno)
            }
        }
    }

    private static func deadline(afterMilliseconds milliseconds: Int) throws -> UInt64 {
        let now = monotonicNanoseconds()
        let delta = UInt64(milliseconds).multipliedReportingOverflow(by: 1_000_000)
        guard !delta.overflow else { throw ChromePipeProcessError.invalidTimeout }
        let sum = now.addingReportingOverflow(delta.partialValue)
        guard !sum.overflow else { throw ChromePipeProcessError.invalidTimeout }
        return sum.partialValue
    }

    private static func monotonicNanoseconds() -> UInt64 {
        var time = timespec()
        guard Darwin.clock_gettime(CLOCK_MONOTONIC, &time) == 0,
              time.tv_sec >= 0,
              time.tv_nsec >= 0
        else {
            return UInt64.max
        }
        return UInt64(time.tv_sec) * 1_000_000_000 + UInt64(time.tv_nsec)
    }

    private static func closePipe(_ descriptors: (read: Int32, write: Int32)) {
        if descriptors.read >= 0 { Darwin.close(descriptors.read) }
        if descriptors.write >= 0 { Darwin.close(descriptors.write) }
    }

    private static func isSafeArgument(_ value: String) -> Bool {
        !value.isEmpty && !value.utf8.contains(0)
    }
}
