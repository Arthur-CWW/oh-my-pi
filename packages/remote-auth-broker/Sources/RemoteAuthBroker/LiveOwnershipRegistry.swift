import CryptoKit
import Darwin
import Foundation
import SQLite3

struct LiveOwnershipRegistryRecord: Equatable, Sendable {
    let sessionId: String
    let pid: UInt32
    let canonicalSessionFile: String
    let ownerEpoch: String
    let buildDigest: String
    let ownershipSocketPath: String
    let registryFileIdentity: LiveOwnershipFileIdentity
    let sessionFileIdentity: LiveOwnershipFileIdentity
}

struct LiveOwnershipFileIdentity: Equatable, Sendable {
    let device: UInt64
    let inode: UInt64
}

struct LiveOwnershipRegistryReader: Sendable {
    static let staleInterval: TimeInterval = 10 * 60
    static let maximumFutureSkew: TimeInterval = 30

    static let fixedDatabaseURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".omp/agent/irc-bus.sqlite", isDirectory: false)
        .standardizedFileURL
    static let fixedOwnershipRootURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".agent-mux", isDirectory: true)
        .standardizedFileURL

    let databaseURL: URL
    let ownershipRootURL: URL

    init(
        databaseURL: URL = LiveOwnershipRegistryReader.fixedDatabaseURL,
        ownershipRootURL: URL = LiveOwnershipRegistryReader.fixedOwnershipRootURL
    ) {
        self.databaseURL = databaseURL
        self.ownershipRootURL = ownershipRootURL
    }

    func resolve(
        sessionId: String,
        ownerUID: uid_t,
        now: Date = Date()
    ) throws -> LiveOwnershipRegistryRecord {
        guard databaseURL.isFileURL,
              ownershipRootURL.isFileURL,
              Self.isCanonicalAbsolutePath(databaseURL.path),
              Self.isCanonicalAbsolutePath(ownershipRootURL.path),
              sessionId.utf8.count > 0,
              sessionId.utf8.count <= 256,
              sessionId.unicodeScalars.allSatisfy({ $0.properties.generalCategory != .control })
        else { throw LiveOwnershipRegistryError.invalidAuthority }

        let databaseBefore = try inspectCanonicalRegularFile(
            at: databaseURL.path,
            ownerUID: ownerUID,
            requireOwnerControlled: true
        )
        var database: OpaquePointer?
        guard sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX,
            nil
        ) == SQLITE_OK,
              let database
        else {
            if let database { sqlite3_close(database) }
            throw LiveOwnershipRegistryError.invalidAuthority
        }
        defer { sqlite3_close(database) }
        sqlite3_extended_result_codes(database, 1)
        sqlite3_busy_timeout(database, 250)
        guard sqlite3_exec(database, "PRAGMA query_only=ON", nil, nil, nil) == SQLITE_OK,
              sqlite3_exec(database, "PRAGMA trusted_schema=OFF", nil, nil, nil) == SQLITE_OK
        else { throw LiveOwnershipRegistryError.invalidAuthority }

        try validateSchema(database)
        let row = try readUniqueRow(database, sessionId: sessionId, now: now)
        let sessionFile = try inspectCanonicalRegularFile(
            at: row.sessionFile,
            ownerUID: ownerUID,
            requireOwnerControlled: false
        )
        let canonicalSessionFile = sessionFile.canonicalPath
        let socketPath = try Self.deriveOwnershipSocketPath(
            canonicalSessionFile: canonicalSessionFile,
            sessionId: row.sessionId,
            ownershipRootPath: ownershipRootURL.path
        )
        let databaseAfter = try inspectCanonicalRegularFile(
            at: databaseURL.path,
            ownerUID: ownerUID,
            requireOwnerControlled: true
        )
        guard databaseBefore == databaseAfter else {
            throw LiveOwnershipRegistryError.invalidAuthority
        }
        return LiveOwnershipRegistryRecord(
            sessionId: row.sessionId,
            pid: row.pid,
            canonicalSessionFile: canonicalSessionFile,
            ownerEpoch: row.ownerEpoch,
            buildDigest: row.buildDigest,
            ownershipSocketPath: socketPath,
            registryFileIdentity: databaseBefore.identity,
            sessionFileIdentity: sessionFile.identity
        )
    }

    static func deriveOwnershipSocketPath(
        canonicalSessionFile: String,
        sessionId: String,
        ownershipRootPath: String
    ) throws -> String {
        guard Self.isCanonicalAbsolutePath(canonicalSessionFile),
              Self.isCanonicalAbsolutePath(ownershipRootPath),
              !sessionId.isEmpty
        else { throw LiveOwnershipRegistryError.invalidAuthority }
        var material = Data(canonicalSessionFile.utf8)
        material.append(0)
        material.append(contentsOf: sessionId.utf8)
        let digest = SHA256.hash(data: material)
        let hexDigits = Array("0123456789abcdef".utf8)
        var hexadecimal = [UInt8]()
        hexadecimal.reserveCapacity(64)
        for byte in digest {
            hexadecimal.append(hexDigits[Int(byte >> 4)])
            hexadecimal.append(hexDigits[Int(byte & 0x0f)])
        }
        let namespace = String(decoding: hexadecimal, as: UTF8.self)
        return URL(fileURLWithPath: ownershipRootPath, isDirectory: true)
            .appendingPathComponent("owners-v1", isDirectory: true)
            .appendingPathComponent(namespace, isDirectory: true)
            .appendingPathComponent("claim", isDirectory: true)
            .appendingPathComponent("owner.sock", isDirectory: false)
            .path
    }

    private func validateSchema(_ database: OpaquePointer) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            database,
            "SELECT type FROM sqlite_schema WHERE name='peers'",
            -1,
            &statement,
            nil
        ) == SQLITE_OK,
              let statement
        else { throw LiveOwnershipRegistryError.invalidAuthority }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW,
              try text(statement, column: 0, maximumBytes: 16) == "table",
              sqlite3_step(statement) == SQLITE_DONE
        else { throw LiveOwnershipRegistryError.invalidAuthority }

        var tableInfo: OpaquePointer?
        guard sqlite3_prepare_v2(database, "PRAGMA table_info(peers)", -1, &tableInfo, nil) == SQLITE_OK,
              let tableInfo
        else { throw LiveOwnershipRegistryError.invalidAuthority }
        defer { sqlite3_finalize(tableInfo) }
        var columns: [String: String] = [:]
        while true {
            let result = sqlite3_step(tableInfo)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW,
                  sqlite3_column_type(tableInfo, 1) == SQLITE_TEXT,
                  sqlite3_column_type(tableInfo, 2) == SQLITE_TEXT
            else { throw LiveOwnershipRegistryError.invalidAuthority }
            let name = try text(tableInfo, column: 1, maximumBytes: 128)
            let type = try text(tableInfo, column: 2, maximumBytes: 32).uppercased()
            guard columns.updateValue(type, forKey: name) == nil else {
                throw LiveOwnershipRegistryError.invalidAuthority
            }
        }
        guard columns["session_id"] == "TEXT",
              columns["pid"] == "INTEGER",
              columns["session_file"] == "TEXT",
              columns["owner_epoch"] == "TEXT",
              columns["build_digest"] == "TEXT",
              columns["last_seen"] == "TEXT",
              columns["state"] == "TEXT"
        else { throw LiveOwnershipRegistryError.invalidAuthority }
    }

    private func readUniqueRow(
        _ database: OpaquePointer,
        sessionId: String,
        now: Date
    ) throws -> RegistryRow {
        var statement: OpaquePointer?
        let sql = "SELECT session_id,pid,session_file,owner_epoch,build_digest,last_seen,state FROM peers WHERE session_id=?1"
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement
        else { throw LiveOwnershipRegistryError.invalidAuthority }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(statement, 1, sessionId, -1, transient) == SQLITE_OK,
              sqlite3_step(statement) == SQLITE_ROW,
              sqlite3_column_type(statement, 0) == SQLITE_TEXT,
              sqlite3_column_type(statement, 1) == SQLITE_INTEGER,
              sqlite3_column_type(statement, 2) == SQLITE_TEXT,
              sqlite3_column_type(statement, 3) == SQLITE_TEXT,
              sqlite3_column_type(statement, 4) == SQLITE_TEXT,
              sqlite3_column_type(statement, 5) == SQLITE_TEXT,
              sqlite3_column_type(statement, 6) == SQLITE_TEXT
        else { throw LiveOwnershipRegistryError.invalidAuthority }

        let exactSessionId = try text(statement, column: 0, maximumBytes: 256)
        let pidValue = sqlite3_column_int64(statement, 1)
        let sessionFile = try text(statement, column: 2, maximumBytes: Int(PATH_MAX) - 1)
        let ownerEpoch = try text(statement, column: 3, maximumBytes: 36)
        let buildDigest = try text(statement, column: 4, maximumBytes: 64)
        let lastSeen = try text(statement, column: 5, maximumBytes: 64)
        let state = try text(statement, column: 6, maximumBytes: 32)
        guard sqlite3_step(statement) == SQLITE_DONE,
              exactSessionId == sessionId,
              pidValue > 0,
              pidValue <= Int64(UInt32.max),
              isCanonicalOwnerEpoch(ownerEpoch),
              isCanonicalDigest(buildDigest),
              state == "working" || state == "waiting_input" || state == "idle",
              let lastSeenDate = parseOMPTime(lastSeen),
              lastSeenDate.timeIntervalSince(now) <= Self.maximumFutureSkew,
              now.timeIntervalSince(lastSeenDate) <= Self.staleInterval
        else { throw LiveOwnershipRegistryError.invalidAuthority }
        return RegistryRow(
            sessionId: exactSessionId,
            pid: UInt32(pidValue),
            sessionFile: sessionFile,
            ownerEpoch: ownerEpoch,
            buildDigest: buildDigest
        )
    }

    private func text(_ statement: OpaquePointer, column: Int32, maximumBytes: Int) throws -> String {
        let count = Int(sqlite3_column_bytes(statement, column))
        guard count > 0,
              count <= maximumBytes,
              let base = sqlite3_column_text(statement, column)
        else { throw LiveOwnershipRegistryError.invalidAuthority }
        let bytes = UnsafeBufferPointer(start: base, count: count)
        guard !bytes.contains(0), let value = String(bytes: bytes, encoding: .utf8) else {
            throw LiveOwnershipRegistryError.invalidAuthority
        }
        return value
    }

    private func parseOMPTime(_ value: String) -> Date? {
        let bytes = Array(value.utf8)
        guard bytes.count == 24,
              bytes[4] == 45,
              bytes[7] == 45,
              bytes[10] == 84,
              bytes[13] == 58,
              bytes[16] == 58,
              bytes[19] == 46,
              bytes[23] == 90
        else { return nil }
        for index in 0..<bytes.count {
            switch index {
            case 4, 7, 10, 13, 16, 19, 23:
                continue
            default:
                guard (48...57).contains(bytes[index]) else { return nil }
            }
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    private func inspectCanonicalRegularFile(
        at path: String,
        ownerUID: uid_t,
        requireOwnerControlled: Bool
    ) throws -> FileSnapshot {
        guard Self.isCanonicalAbsolutePath(path) else {
            throw LiveOwnershipRegistryError.invalidAuthority
        }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count > 1,
              components[0].isEmpty,
              components.dropFirst().allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
        else { throw LiveOwnershipRegistryError.invalidAuthority }

        var descriptor = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw LiveOwnershipRegistryError.invalidAuthority }
        defer { Darwin.close(descriptor) }
        for (index, component) in components.dropFirst().enumerated() {
            let isFinal = index == components.count - 2
            if isFinal, requireOwnerControlled {
                var parentStatus = stat()
                guard Darwin.fstat(descriptor, &parentStatus) == 0,
                      (parentStatus.st_mode & S_IFMT) == S_IFDIR,
                      parentStatus.st_uid == ownerUID,
                      (parentStatus.st_mode & 0o077) == 0
                else { throw LiveOwnershipRegistryError.invalidAuthority }
            }
            let flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | (isFinal ? 0 : O_DIRECTORY)
            let next = component.withCString { Darwin.openat(descriptor, $0, flags) }
            guard next >= 0 else { throw LiveOwnershipRegistryError.invalidAuthority }
            Darwin.close(descriptor)
            descriptor = next
        }
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              status.st_uid == ownerUID,
              status.st_nlink == 1,
              !requireOwnerControlled || (
                  (status.st_mode & 0o7777) == 0o600 &&
                  status.st_size > 0 &&
                  status.st_size <= off_t(1_073_741_824)
              )
        else { throw LiveOwnershipRegistryError.invalidAuthority }
        var pathInfo = vnode_fdinfowithpath()
        let pathInfoSize = MemoryLayout<vnode_fdinfowithpath>.size
        let result = Darwin.proc_pidfdinfo(
            getpid(),
            descriptor,
            PROC_PIDFDVNODEPATHINFO,
            &pathInfo,
            Int32(pathInfoSize)
        )
        guard result == Int32(pathInfoSize) else {
            throw LiveOwnershipRegistryError.invalidAuthority
        }
        let canonicalPath = withUnsafePointer(to: pathInfo.pvip.vip_path) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) {
                String(cString: $0)
            }
        }
        guard canonicalPath == path else { throw LiveOwnershipRegistryError.invalidAuthority }
        return FileSnapshot(status: status, canonicalPath: canonicalPath)
    }

    private static func isCanonicalAbsolutePath(_ path: String) -> Bool {
        guard path.first == "/", path.last != "/", !path.utf8.contains(0) else { return false }
        return URL(fileURLWithPath: path).standardizedFileURL.path == path
    }

    private func isCanonicalOwnerEpoch(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count == 36 else { return false }
        for (index, byte) in bytes.enumerated() {
            switch index {
            case 8, 13, 18, 23:
                guard byte == 45 else { return false }
            case 14:
                guard (49...56).contains(byte) else { return false }
            case 19:
                guard byte == 56 || byte == 57 || byte == 97 || byte == 98 else { return false }
            default:
                guard (48...57).contains(byte) || (97...102).contains(byte) else { return false }
            }
        }
        return true
    }

    private func isCanonicalDigest(_ value: String) -> Bool {
        let bytes = value.utf8
        return bytes.count == 64 && bytes.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }

    private struct RegistryRow {
        let sessionId: String
        let pid: UInt32
        let sessionFile: String
        let ownerEpoch: String
        let buildDigest: String
    }

    private struct FileSnapshot: Equatable {
        let device: UInt64
        let inode: UInt64
        let size: Int64
        let mode: UInt32
        let owner: UInt32
        let links: UInt64
        let modifiedSeconds: Int64
        let modifiedNanoseconds: Int64
        let changedSeconds: Int64
        let changedNanoseconds: Int64
        let canonicalPath: String

        var identity: LiveOwnershipFileIdentity {
            LiveOwnershipFileIdentity(device: device, inode: inode)
        }

        init(status: stat, canonicalPath: String) {
            device = UInt64(truncatingIfNeeded: status.st_dev)
            inode = UInt64(truncatingIfNeeded: status.st_ino)
            size = Int64(status.st_size)
            mode = UInt32(status.st_mode)
            owner = UInt32(status.st_uid)
            links = UInt64(status.st_nlink)
            modifiedSeconds = Int64(status.st_mtimespec.tv_sec)
            modifiedNanoseconds = Int64(status.st_mtimespec.tv_nsec)
            changedSeconds = Int64(status.st_ctimespec.tv_sec)
            changedNanoseconds = Int64(status.st_ctimespec.tv_nsec)
            self.canonicalPath = canonicalPath
        }
    }
}

private enum LiveOwnershipRegistryError: Error {
    case invalidAuthority
}
