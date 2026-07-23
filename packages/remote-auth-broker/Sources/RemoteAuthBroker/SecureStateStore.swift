import Darwin
import Foundation

@_silgen_name("flock")
private func remoteAuthFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

public enum SecureStateStoreError: Error, Equatable, Sendable {
    case invalidConfiguration
    case unsafeDirectory
    case unsafeLockFile
    case unsafeStateFile
    case stateTooLarge
    case invalidState
    case encodingFailed
    case ioFailure
}

public final class SecureStateStore<State: Codable> {
    public static var defaultMaximumBytes: Int { 1_048_576 }

    private static var absoluteMaximumBytes: Int { 16 * 1_048_576 }
    private static var maximumFileNameBytes: Int { 180 }
    private static var jsonMaximumDepth: Int { 128 }
    private static var ioBufferSize: Int { 64 * 1_024 }

    private let directoryDescriptor: Int32
    private let stateFileName: String
    private let lockFileName: String
    private let maximumBytes: Int

    public init(
        directoryURL: URL,
        fileName: String,
        maximumBytes: Int = SecureStateStore.defaultMaximumBytes
    ) throws {
        guard directoryURL.isFileURL,
              directoryURL.path.hasPrefix("/"),
              Self.isSafeFileName(fileName),
              maximumBytes > 0,
              maximumBytes <= Self.absoluteMaximumBytes
        else {
            throw SecureStateStoreError.invalidConfiguration
        }

        let descriptor = try Self.openValidatedDirectory(directoryURL)
        directoryDescriptor = descriptor
        stateFileName = fileName
        lockFileName = ".\(fileName).lock"
        self.maximumBytes = maximumBytes
    }

    deinit {
        Darwin.close(directoryDescriptor)
    }

    public func read() throws -> State? {
        try withLock(exclusive: false) {
            try readUnlocked()
        }
    }

    @discardableResult
    public func transaction(_ update: (State?) throws -> State) throws -> State {
        try withLock(exclusive: true) {
            let current = try readUnlocked()
            let updated = try update(current)
            let encoded = try encodeAndValidate(updated)
            try replaceState(with: encoded)
            return updated
        }
    }

    private static func isSafeFileName(_ fileName: String) -> Bool {
        !fileName.isEmpty
            && fileName != "."
            && fileName != ".."
            && !fileName.contains("/")
            && !fileName.utf8.contains(0)
            && fileName.utf8.count <= maximumFileNameBytes
    }

    private static func openValidatedDirectory(_ url: URL) throws -> Int32 {
        let path = url.path
        var pathStatus = stat()
        var statusResult = path.withCString { Darwin.lstat($0, &pathStatus) }
        if statusResult != 0 {
            guard errno == ENOENT else {
                throw SecureStateStoreError.unsafeDirectory
            }
            let creationResult = path.withCString { Darwin.mkdir($0, 0o700) }
            guard creationResult == 0 || errno == EEXIST else {
                throw SecureStateStoreError.unsafeDirectory
            }
            statusResult = path.withCString { Darwin.lstat($0, &pathStatus) }
        }
        guard statusResult == 0,
              Self.isOwnerOnlyDirectory(pathStatus)
        else {
            throw SecureStateStoreError.unsafeDirectory
        }

        let descriptor = path.withCString {
            Darwin.open($0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else {
            throw SecureStateStoreError.unsafeDirectory
        }

        var descriptorStatus = stat()
        guard Darwin.fstat(descriptor, &descriptorStatus) == 0,
              Self.isOwnerOnlyDirectory(descriptorStatus),
              descriptorStatus.st_dev == pathStatus.st_dev,
              descriptorStatus.st_ino == pathStatus.st_ino
        else {
            Darwin.close(descriptor)
            throw SecureStateStoreError.unsafeDirectory
        }
        return descriptor
    }

    private static func isOwnerOnlyDirectory(_ status: stat) -> Bool {
        (status.st_mode & S_IFMT) == S_IFDIR
            && status.st_uid == geteuid()
            && (status.st_mode & 0o7777) == 0o700
    }

    private func withLock<Result>(
        exclusive: Bool,
        _ operation: () throws -> Result
    ) throws -> Result {
        let descriptor = try openLockFile()
        defer { Darwin.close(descriptor) }

        let mode = exclusive ? LOCK_EX : LOCK_SH
        while remoteAuthFlock(descriptor, mode) != 0 {
            guard errno == EINTR else {
                throw SecureStateStoreError.ioFailure
            }
        }
        defer { _ = remoteAuthFlock(descriptor, LOCK_UN) }
        return try operation()
    }

    private func openLockFile() throws -> Int32 {
        var created = false
        var descriptor = Darwin.openat(
            directoryDescriptor,
            lockFileName,
            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            0o600
        )
        if descriptor >= 0 {
            created = true
        } else if errno == EEXIST {
            descriptor = Darwin.openat(
                directoryDescriptor,
                lockFileName,
                O_RDWR | O_NOFOLLOW | O_CLOEXEC
            )
        }
        guard descriptor >= 0 else {
            throw SecureStateStoreError.unsafeLockFile
        }

        if created, Darwin.fchmod(descriptor, 0o600) != 0 {
            Darwin.close(descriptor)
            _ = Darwin.unlinkat(directoryDescriptor, lockFileName, 0)
            throw SecureStateStoreError.unsafeLockFile
        }
        do {
            _ = try validateOwnedRegularFile(
                descriptor,
                error: .unsafeLockFile,
                enforceSizeLimit: false
            )
            return descriptor
        } catch {
            Darwin.close(descriptor)
            if created {
                _ = Darwin.unlinkat(directoryDescriptor, lockFileName, 0)
            }
            throw error
        }
    }

    private func readUnlocked() throws -> State? {
        let descriptor = Darwin.openat(
            directoryDescriptor,
            stateFileName,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC
        )
        if descriptor < 0 {
            if errno == ENOENT { return nil }
            throw SecureStateStoreError.unsafeStateFile
        }
        defer { Darwin.close(descriptor) }

        let initial = try validateOwnedRegularFile(
            descriptor,
            error: .unsafeStateFile,
            enforceSizeLimit: true
        )
        var data = Data()
        data.reserveCapacity(Int(initial.size))
        var buffer = [UInt8](repeating: 0, count: Self.ioBufferSize)
        while true {
            let count = buffer.withUnsafeMutableBytes {
                Darwin.read(descriptor, $0.baseAddress, $0.count)
            }
            if count > 0 {
                guard data.count <= maximumBytes - count else {
                    throw SecureStateStoreError.stateTooLarge
                }
                data.append(contentsOf: buffer[..<count])
                continue
            }
            if count == 0 { break }
            if errno == EINTR { continue }
            throw SecureStateStoreError.ioFailure
        }

        let final = try validateOwnedRegularFile(
            descriptor,
            error: .unsafeStateFile,
            enforceSizeLimit: true
        )
        guard initial == final, data.count == Int(final.size) else {
            throw SecureStateStoreError.unsafeStateFile
        }
        return try decodeStrict(data)
    }

    private func validateOwnedRegularFile(
        _ descriptor: Int32,
        error: SecureStateStoreError,
        enforceSizeLimit: Bool
    ) throws -> FileSnapshot {
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              status.st_uid == geteuid(),
              (status.st_mode & 0o7777) == 0o600,
              status.st_nlink == 1,
              status.st_size >= 0
        else {
            throw error
        }
        if enforceSizeLimit, status.st_size > off_t(maximumBytes) {
            throw SecureStateStoreError.stateTooLarge
        }
        return FileSnapshot(status)
    }

    private func decodeStrict(_ data: Data) throws -> State {
        let inputStructure: StrictJSONValue
        do {
            var parser = StrictJSONParser(
                data: data,
                maximumDepth: Self.jsonMaximumDepth
            )
            inputStructure = try parser.parse()
        } catch {
            throw SecureStateStoreError.invalidState
        }

        let state: State
        do {
            state = try JSONDecoder().decode(State.self, from: data)
        } catch {
            throw SecureStateStoreError.invalidState
        }

        let canonical: Data
        do {
            canonical = try encode(state)
        } catch {
            throw SecureStateStoreError.invalidState
        }
        guard canonical.count <= maximumBytes else {
            throw SecureStateStoreError.stateTooLarge
        }

        let canonicalStructure: StrictJSONValue
        do {
            var parser = StrictJSONParser(
                data: canonical,
                maximumDepth: Self.jsonMaximumDepth
            )
            canonicalStructure = try parser.parse()
        } catch {
            throw SecureStateStoreError.invalidState
        }
        guard inputStructure == canonicalStructure else {
            throw SecureStateStoreError.invalidState
        }
        return state
    }

    private func encodeAndValidate(_ state: State) throws -> Data {
        let data: Data
        do {
            data = try encode(state)
        } catch {
            throw SecureStateStoreError.encodingFailed
        }
        guard data.count <= maximumBytes else {
            throw SecureStateStoreError.stateTooLarge
        }
        do {
            var parser = StrictJSONParser(
                data: data,
                maximumDepth: Self.jsonMaximumDepth
            )
            _ = try parser.parse()
        } catch {
            throw SecureStateStoreError.encodingFailed
        }
        return data
    }

    private func encode(_ state: State) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(state)
    }

    private func replaceState(with data: Data) throws {
        let temporaryName = ".\(stateFileName).tmp.\(UUID().uuidString)"
        let descriptor = Darwin.openat(
            directoryDescriptor,
            temporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            0o600
        )
        guard descriptor >= 0 else {
            throw SecureStateStoreError.ioFailure
        }

        var openDescriptor: Int32? = descriptor
        var renamed = false
        defer {
            if let openDescriptor { Darwin.close(openDescriptor) }
            if !renamed {
                _ = Darwin.unlinkat(directoryDescriptor, temporaryName, 0)
            }
        }

        guard Darwin.fchmod(descriptor, 0o600) == 0 else {
            throw SecureStateStoreError.ioFailure
        }
        _ = try validateOwnedRegularFile(
            descriptor,
            error: .ioFailure,
            enforceSizeLimit: true
        )

        try writeAll(data, to: descriptor)
        try synchronize(descriptor)
        guard Darwin.close(descriptor) == 0 else {
            openDescriptor = nil
            throw SecureStateStoreError.ioFailure
        }
        openDescriptor = nil

        guard Darwin.renameat(
            directoryDescriptor,
            temporaryName,
            directoryDescriptor,
            stateFileName
        ) == 0 else {
            throw SecureStateStoreError.ioFailure
        }
        renamed = true
        try synchronize(directoryDescriptor)
    }

    private func writeAll(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(
                    descriptor,
                    bytes.baseAddress?.advanced(by: offset),
                    bytes.count - offset
                )
                if count > 0 {
                    offset += count
                    continue
                }
                if count < 0, errno == EINTR { continue }
                throw SecureStateStoreError.ioFailure
            }
        }
    }

    private func synchronize(_ descriptor: Int32) throws {
        while Darwin.fsync(descriptor) != 0 {
            guard errno == EINTR else {
                throw SecureStateStoreError.ioFailure
            }
        }
    }
}

private struct FileSnapshot: Equatable {
    let device: UInt64
    let inode: UInt64
    let size: UInt64
    let modifiedSeconds: Int64
    let modifiedNanoseconds: Int64
    let changedSeconds: Int64
    let changedNanoseconds: Int64

    init(_ status: stat) {
        device = UInt64(truncatingIfNeeded: status.st_dev)
        inode = UInt64(truncatingIfNeeded: status.st_ino)
        size = UInt64(status.st_size)
        modifiedSeconds = Int64(status.st_mtimespec.tv_sec)
        modifiedNanoseconds = Int64(status.st_mtimespec.tv_nsec)
        changedSeconds = Int64(status.st_ctimespec.tv_sec)
        changedNanoseconds = Int64(status.st_ctimespec.tv_nsec)
    }
}

private indirect enum StrictJSONValue: Equatable {
    case object([String: StrictJSONValue])
    case array([StrictJSONValue])
    case string(String)
    case number(String)
    case boolean(Bool)
    case null
}

private enum StrictJSONError: Error {
    case invalid
}

private struct StrictJSONParser {
    private let bytes: [UInt8]
    private let maximumDepth: Int
    private var index = 0

    init(data: Data, maximumDepth: Int) {
        bytes = Array(data)
        self.maximumDepth = maximumDepth
    }

    mutating func parse() throws -> StrictJSONValue {
        skipWhitespace()
        let value = try parseValue(depth: 0)
        skipWhitespace()
        guard index == bytes.count else { throw StrictJSONError.invalid }
        return value
    }

    private mutating func parseValue(depth: Int) throws -> StrictJSONValue {
        guard depth <= maximumDepth, index < bytes.count else {
            throw StrictJSONError.invalid
        }
        switch bytes[index] {
        case 0x7b:
            return try parseObject(depth: depth)
        case 0x5b:
            return try parseArray(depth: depth)
        case 0x22:
            return .string(try parseString())
        case 0x74:
            try consumeLiteral([0x74, 0x72, 0x75, 0x65])
            return .boolean(true)
        case 0x66:
            try consumeLiteral([0x66, 0x61, 0x6c, 0x73, 0x65])
            return .boolean(false)
        case 0x6e:
            try consumeLiteral([0x6e, 0x75, 0x6c, 0x6c])
            return .null
        case 0x2d, 0x30 ... 0x39:
            return .number(try parseNumber())
        default:
            throw StrictJSONError.invalid
        }
    }

    private mutating func parseObject(depth: Int) throws -> StrictJSONValue {
        index += 1
        skipWhitespace()
        if consume(0x7d) { return .object([:]) }

        var result: [String: StrictJSONValue] = [:]
        while true {
            guard index < bytes.count, bytes[index] == 0x22 else {
                throw StrictJSONError.invalid
            }
            let key = try parseString()
            guard result[key] == nil else { throw StrictJSONError.invalid }
            skipWhitespace()
            guard consume(0x3a) else { throw StrictJSONError.invalid }
            skipWhitespace()
            result[key] = try parseValue(depth: depth + 1)
            skipWhitespace()
            if consume(0x7d) { break }
            guard consume(0x2c) else { throw StrictJSONError.invalid }
            skipWhitespace()
        }
        return .object(result)
    }

    private mutating func parseArray(depth: Int) throws -> StrictJSONValue {
        index += 1
        skipWhitespace()
        if consume(0x5d) { return .array([]) }

        var result: [StrictJSONValue] = []
        while true {
            result.append(try parseValue(depth: depth + 1))
            skipWhitespace()
            if consume(0x5d) { break }
            guard consume(0x2c) else { throw StrictJSONError.invalid }
            skipWhitespace()
        }
        return .array(result)
    }

    private mutating func parseString() throws -> String {
        guard consume(0x22) else { throw StrictJSONError.invalid }
        var output: [UInt8] = []
        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if byte == 0x22 {
                guard let value = String(bytes: output, encoding: .utf8) else {
                    throw StrictJSONError.invalid
                }
                return value
            }
            guard byte >= 0x20 else { throw StrictJSONError.invalid }
            if byte != 0x5c {
                output.append(byte)
                continue
            }

            guard index < bytes.count else { throw StrictJSONError.invalid }
            let escaped = bytes[index]
            index += 1
            switch escaped {
            case 0x22, 0x2f, 0x5c:
                output.append(escaped)
            case 0x62:
                output.append(0x08)
            case 0x66:
                output.append(0x0c)
            case 0x6e:
                output.append(0x0a)
            case 0x72:
                output.append(0x0d)
            case 0x74:
                output.append(0x09)
            case 0x75:
                var codePoint = UInt32(try parseHexQuad())
                if codePoint >= 0xd800, codePoint <= 0xdbff {
                    guard consume(0x5c), consume(0x75) else {
                        throw StrictJSONError.invalid
                    }
                    let low = UInt32(try parseHexQuad())
                    guard low >= 0xdc00, low <= 0xdfff else {
                        throw StrictJSONError.invalid
                    }
                    codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00)
                } else if codePoint >= 0xdc00, codePoint <= 0xdfff {
                    throw StrictJSONError.invalid
                }
                try appendUTF8(codePoint, to: &output)
            default:
                throw StrictJSONError.invalid
            }
        }
        throw StrictJSONError.invalid
    }

    private mutating func parseHexQuad() throws -> UInt16 {
        guard index <= bytes.count - 4 else { throw StrictJSONError.invalid }
        var value: UInt16 = 0
        for _ in 0..<4 {
            value <<= 4
            let byte = bytes[index]
            index += 1
            switch byte {
            case 0x30 ... 0x39:
                value |= UInt16(byte - 0x30)
            case 0x41 ... 0x46:
                value |= UInt16(byte - 0x41 + 10)
            case 0x61 ... 0x66:
                value |= UInt16(byte - 0x61 + 10)
            default:
                throw StrictJSONError.invalid
            }
        }
        return value
    }

    private func appendUTF8(_ codePoint: UInt32, to output: inout [UInt8]) throws {
        switch codePoint {
        case 0 ... 0x7f:
            output.append(UInt8(codePoint))
        case 0x80 ... 0x7ff:
            output.append(UInt8(0xc0 | (codePoint >> 6)))
            output.append(UInt8(0x80 | (codePoint & 0x3f)))
        case 0x800 ... 0xffff:
            output.append(UInt8(0xe0 | (codePoint >> 12)))
            output.append(UInt8(0x80 | ((codePoint >> 6) & 0x3f)))
            output.append(UInt8(0x80 | (codePoint & 0x3f)))
        case 0x10000 ... 0x10ffff:
            output.append(UInt8(0xf0 | (codePoint >> 18)))
            output.append(UInt8(0x80 | ((codePoint >> 12) & 0x3f)))
            output.append(UInt8(0x80 | ((codePoint >> 6) & 0x3f)))
            output.append(UInt8(0x80 | (codePoint & 0x3f)))
        default:
            throw StrictJSONError.invalid
        }
    }

    private mutating func parseNumber() throws -> String {
        let start = index
        _ = consume(0x2d)
        guard index < bytes.count else { throw StrictJSONError.invalid }

        if consume(0x30) {
            if index < bytes.count, bytes[index] >= 0x30, bytes[index] <= 0x39 {
                throw StrictJSONError.invalid
            }
        } else {
            guard consumeDigit(from: 0x31, through: 0x39) else {
                throw StrictJSONError.invalid
            }
            while consumeDigit(from: 0x30, through: 0x39) {}
        }

        if consume(0x2e) {
            guard consumeDigit(from: 0x30, through: 0x39) else {
                throw StrictJSONError.invalid
            }
            while consumeDigit(from: 0x30, through: 0x39) {}
        }

        if consume(0x65) || consume(0x45) {
            if !consume(0x2b) { _ = consume(0x2d) }
            guard consumeDigit(from: 0x30, through: 0x39) else {
                throw StrictJSONError.invalid
            }
            while consumeDigit(from: 0x30, through: 0x39) {}
        }
        return String(decoding: bytes[start..<index], as: UTF8.self)
    }

    private mutating func consumeLiteral(_ literal: [UInt8]) throws {
        guard index <= bytes.count - literal.count,
              bytes[index..<(index + literal.count)].elementsEqual(literal)
        else {
            throw StrictJSONError.invalid
        }
        index += literal.count
    }

    private mutating func consume(_ byte: UInt8) -> Bool {
        guard index < bytes.count, bytes[index] == byte else { return false }
        index += 1
        return true
    }

    private mutating func consumeDigit(from lower: UInt8, through upper: UInt8) -> Bool {
        guard index < bytes.count,
              bytes[index] >= lower,
              bytes[index] <= upper
        else {
            return false
        }
        index += 1
        return true
    }

    private mutating func skipWhitespace() {
        while index < bytes.count {
            switch bytes[index] {
            case 0x09, 0x0a, 0x0d, 0x20:
                index += 1
            default:
                return
            }
        }
    }
}
