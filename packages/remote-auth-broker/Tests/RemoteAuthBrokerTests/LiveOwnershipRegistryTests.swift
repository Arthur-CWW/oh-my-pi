import Darwin
import Foundation
import SQLite3
import XCTest
@testable import RemoteAuthBroker

final class LiveOwnershipRegistryTests: XCTestCase {
    func testCurrentExactRowResolvesFromRealSQLiteDatabase() throws {
        let fixture = try LiveRegistryFixture()
        defer { fixture.close() }

        let row = try fixture.reader.resolve(sessionId: fixture.sessionId, ownerUID: getuid())
        XCTAssertEqual(row.sessionId, fixture.sessionId)
        XCTAssertEqual(row.pid, fixture.pid)
        XCTAssertEqual(row.canonicalSessionFile, fixture.sessionFileURL.path)
        XCTAssertEqual(row.ownerEpoch, fixture.ownerEpoch)
        XCTAssertEqual(row.buildDigest, fixture.digest)
        XCTAssertEqual(row.ownershipSocketPath, fixture.socketPath)
        XCTAssertThrowsError(
            try fixture.reader.resolve(sessionId: "missing-session", ownerUID: getuid())
        )
    }

    func testStaleAndFencedRowsFailClosed() throws {
        let fixture = try LiveRegistryFixture()
        defer { fixture.close() }

        try fixture.update(column: "last_seen", text: fixture.timestamp(Date(timeIntervalSinceNow: -601)))
        XCTAssertThrowsError(try fixture.reader.resolve(sessionId: fixture.sessionId, ownerUID: getuid()))

        try fixture.update(column: "last_seen", text: fixture.timestamp(Date()))
        try fixture.update(column: "state", text: "paused")
        XCTAssertThrowsError(try fixture.reader.resolve(sessionId: fixture.sessionId, ownerUID: getuid()))

        try fixture.update(column: "state", text: "unknown")
        XCTAssertThrowsError(try fixture.reader.resolve(sessionId: fixture.sessionId, ownerUID: getuid()))
    }

    func testMalformedTypedRowAndDuplicateExactRowsFailClosed() throws {
        let malformed = try LiveRegistryFixture()
        defer { malformed.close() }
        try malformed.updatePIDAsText("not-an-integer")
        XCTAssertThrowsError(try malformed.reader.resolve(sessionId: malformed.sessionId, ownerUID: getuid()))

        let malformedSchema = try LiveRegistryFixture(pidDeclaredType: "TEXT")
        defer { malformedSchema.close() }
        XCTAssertThrowsError(
            try malformedSchema.reader.resolve(
                sessionId: malformedSchema.sessionId,
                ownerUID: getuid()
            )
        )

        let duplicate = try LiveRegistryFixture(sessionIDIsPrimaryKey: false)
        defer { duplicate.close() }
        try duplicate.insertCurrentRow()
        XCTAssertThrowsError(try duplicate.reader.resolve(sessionId: duplicate.sessionId, ownerUID: getuid()))
    }

    func testUnsafeRegistryMetadataAndSymlinkSessionFileFailClosed() throws {
        let registryLink = try LiveRegistryFixture()
        defer { registryLink.close() }
        try registryLink.replaceRegistryWithSymlink()
        XCTAssertThrowsError(try registryLink.reader.resolve(sessionId: registryLink.sessionId, ownerUID: getuid()))

        let writableRegistry = try LiveRegistryFixture()
        defer { writableRegistry.close() }
        try writableRegistry.makeRegistryGroupWritable()
        XCTAssertThrowsError(
            try writableRegistry.reader.resolve(
                sessionId: writableRegistry.sessionId,
                ownerUID: getuid()
            )
        )

        let sessionLink = try LiveRegistryFixture()
        defer { sessionLink.close() }
        try sessionLink.replaceSessionFileWithSymlink()
        XCTAssertThrowsError(try sessionLink.reader.resolve(sessionId: sessionLink.sessionId, ownerUID: getuid()))
    }
}

final class LiveRegistryFixture: @unchecked Sendable {
    let rootURL: URL
    let registryURL: URL
    let ownershipRootURL: URL
    let sessionFileURL: URL
    let sessionId = "session-1"
    let ownerEpoch = "00112233-4455-4677-8899-aabbccddeeff"
    let runner = "11112222-3333-4444-8555-666677778888"
    let digest = String(repeating: "a", count: 64)
    let pid = UInt32(getpid())

    var reader: LiveOwnershipRegistryReader {
        LiveOwnershipRegistryReader(databaseURL: registryURL, ownershipRootURL: ownershipRootURL)
    }

    var socketPath: String {
        try! LiveOwnershipRegistryReader.deriveOwnershipSocketPath(
            canonicalSessionFile: sessionFileURL.path,
            sessionId: sessionId,
            ownershipRootPath: ownershipRootURL.path
        )
    }


    init(sessionIDIsPrimaryKey: Bool = true, pidDeclaredType: String = "INTEGER") throws {
        guard pidDeclaredType == "INTEGER" || pidDeclaredType == "TEXT" else {
            throw TestSQLiteError.io
        }
        let requestedRoot = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Caches/remote-auth-live-registry-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: requestedRoot, withIntermediateDirectories: true)
        rootURL = try Self.canonicalDirectoryURL(requestedRoot)
        guard chmod(rootURL.path, 0o700) == 0 else { throw TestSQLiteError.io }
        registryURL = rootURL.appendingPathComponent("irc-bus.sqlite", isDirectory: false)
        ownershipRootURL = try Self.makeShortOwnershipRoot()
        sessionFileURL = rootURL.appendingPathComponent("session.jsonl", isDirectory: false)
        try Self.writeSessionFile(at: sessionFileURL)

        try withDatabase { database in
            let primaryKey = sessionIDIsPrimaryKey ? " PRIMARY KEY" : ""
            try execute(
                database,
                """
                CREATE TABLE peers (
                    session_id TEXT\(primaryKey),
                    pid \(pidDeclaredType),
                    session_file TEXT,
                    owner_epoch TEXT,
                    build_digest TEXT,
                    last_seen TEXT,
                    state TEXT
                )
                """
            )
        }
        try insertCurrentRow()
    }

    func close() {
        try? FileManager.default.removeItem(at: rootURL)
        try? FileManager.default.removeItem(at: ownershipRootURL)
    }

    func makeSessionFile(named name: String) throws -> URL {
        guard !name.isEmpty, !name.contains("/") else { throw TestSQLiteError.io }
        let url = rootURL.appendingPathComponent(name, isDirectory: false)
        try Self.writeSessionFile(at: url)
        return url
    }

    func insertCurrentRow() throws {
        try withDatabase { database in
            var statement: OpaquePointer?
            let sql = "INSERT INTO peers(session_id,pid,session_file,owner_epoch,build_digest,last_seen,state) VALUES(?1,?2,?3,?4,?5,?6,?7)"
            guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
                  let statement
            else { throw TestSQLiteError.sqlite }
            defer { sqlite3_finalize(statement) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(statement, 1, sessionId, -1, transient) == SQLITE_OK,
                  sqlite3_bind_int64(statement, 2, Int64(pid)) == SQLITE_OK,
                  sqlite3_bind_text(statement, 3, sessionFileURL.path, -1, transient) == SQLITE_OK,
                  sqlite3_bind_text(statement, 4, ownerEpoch, -1, transient) == SQLITE_OK,
                  sqlite3_bind_text(statement, 5, digest, -1, transient) == SQLITE_OK,
                  sqlite3_bind_text(statement, 6, timestamp(Date()), -1, transient) == SQLITE_OK,
                  sqlite3_bind_text(statement, 7, "working", -1, transient) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_DONE
            else { throw TestSQLiteError.sqlite }
        }
    }

    func update(column: String, text: String) throws {
        let permitted = ["session_file", "owner_epoch", "build_digest", "last_seen", "state"]
        guard permitted.contains(column) else { throw TestSQLiteError.io }
        try withDatabase { database in
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, "UPDATE peers SET \(column)=?1", -1, &statement, nil) == SQLITE_OK,
                  let statement
            else { throw TestSQLiteError.sqlite }
            defer { sqlite3_finalize(statement) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(statement, 1, text, -1, transient) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_DONE
            else { throw TestSQLiteError.sqlite }
        }
    }

    func updatePID(_ value: UInt32) throws {
        try withDatabase { database in
            try execute(database, "UPDATE peers SET pid=\(value)")
        }
    }

    func updatePIDAsText(_ value: String) throws {
        try withDatabase { database in
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, "UPDATE peers SET pid=?1", -1, &statement, nil) == SQLITE_OK,
                  let statement
            else { throw TestSQLiteError.sqlite }
            defer { sqlite3_finalize(statement) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(statement, 1, value, -1, transient) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_DONE
            else { throw TestSQLiteError.sqlite }
        }
    }

    func makeRegistryGroupWritable() throws {
        guard chmod(registryURL.path, 0o620) == 0 else { throw TestSQLiteError.io }
    }

    func replaceRegistryWithSymlink() throws {
        let backing = rootURL.appendingPathComponent("registry-backing.sqlite")
        try FileManager.default.moveItem(at: registryURL, to: backing)
        try FileManager.default.createSymbolicLink(at: registryURL, withDestinationURL: backing)
    }

    func replaceSessionFileWithSymlink() throws {
        let backing = rootURL.appendingPathComponent("session-backing.jsonl")
        try FileManager.default.moveItem(at: sessionFileURL, to: backing)
        try FileManager.default.createSymbolicLink(at: sessionFileURL, withDestinationURL: backing)
    }

    func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func withDatabase(_ body: (OpaquePointer) throws -> Void) throws {
        var database: OpaquePointer?
        guard sqlite3_open_v2(registryURL.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK,
              let database
        else {
            if let database { sqlite3_close(database) }
            throw TestSQLiteError.sqlite
        }
        var operationError: Error?
        do {
            try execute(database, "PRAGMA journal_mode=DELETE")
            try body(database)
        } catch {
            operationError = error
        }
        guard sqlite3_close(database) == SQLITE_OK else { throw TestSQLiteError.sqlite }
        try sealRegistry()
        if let operationError { throw operationError }
    }

    private func execute(_ database: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw TestSQLiteError.sqlite
        }
    }

    private func sealRegistry() throws {
        guard chmod(rootURL.path, 0o700) == 0,
              chmod(registryURL.path, 0o600) == 0
        else { throw TestSQLiteError.io }
        for suffix in ["-journal", "-wal", "-shm"] {
            let sidecar = registryURL.path + suffix
            guard unlink(sidecar) == 0 || errno == ENOENT else {
                throw TestSQLiteError.io
            }
        }
    }

    private static func writeSessionFile(at url: URL) throws {
        try Data("{}\n".utf8).write(to: url, options: .withoutOverwriting)
        guard chmod(url.path, 0o600) == 0 else { throw TestSQLiteError.io }
    }

    private static func canonicalDirectoryURL(_ url: URL) throws -> URL {
        var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
        let resolved = url.path.withCString { source in
            buffer.withUnsafeMutableBufferPointer { destination in
                Darwin.realpath(source, destination.baseAddress)
            }
        }
        guard resolved != nil else { throw TestSQLiteError.io }
        return URL(
            fileURLWithPath: String(cString: buffer),
            isDirectory: true
        )
    }

    private static func makeShortOwnershipRoot() throws -> URL {
        for _ in 0..<32 {
            let suffix = UUID().uuidString.lowercased().prefix(3)
            let url = URL(fileURLWithPath: "/tmp/r\(suffix)", isDirectory: true)
            do {
                try FileManager.default.createDirectory(
                    at: url,
                    withIntermediateDirectories: false
                )
                return url.standardizedFileURL
            } catch CocoaError.fileWriteFileExists {
                continue
            }
        }
        throw TestSQLiteError.io
    }

    private enum TestSQLiteError: Error {
        case sqlite
        case io
    }
}
