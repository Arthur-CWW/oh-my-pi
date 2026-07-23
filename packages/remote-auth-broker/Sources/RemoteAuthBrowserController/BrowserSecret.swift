import Foundation

public final class BrowserSecret: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [UInt8]
    private var consumed = false

    public init(taking bytes: inout [UInt8]) throws {
        guard !bytes.isEmpty, bytes.count <= 4_096,
              String(bytes: bytes, encoding: .utf8) != nil
        else { throw BrowserControllerError.secretInvalid }
        storage = bytes
        bytes.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
        bytes.removeAll(keepingCapacity: false)
    }

    deinit {
        lock.lock()
        storage.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
        storage.removeAll(keepingCapacity: false)
        lock.unlock()
    }

    internal func take() throws -> [UInt8] {
        lock.lock()
        defer { lock.unlock() }
        guard !consumed, !storage.isEmpty else {
            throw BrowserControllerError.secretInvalid
        }
        consumed = true
        var result = storage
        storage.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
        storage.removeAll(keepingCapacity: false)
        return result
    }
}
