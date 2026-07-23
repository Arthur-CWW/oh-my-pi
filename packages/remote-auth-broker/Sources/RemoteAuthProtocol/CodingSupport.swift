import Foundation

public let remoteAuthProtocolVersionV1: UInt32 = 1
public let remoteAuthMaximumFrameBytes = 262_144
public let remoteAuthMaximumRequestLifetimeMilliseconds: UInt64 = 120_000
public let remoteAuthMaximumGDMChallengeLifetimeMilliseconds: UInt64 = 20_000

public enum PublicError: String, Codable, CaseIterable, Sendable {
    case inactive
    case disabled
    case unavailable
    case timeout
    case cancelled
    case protocolInvalid = "protocol-invalid"
    case frameInvalid = "frame-invalid"
    case excessField = "excess-field"
    case noncanonicalValue = "noncanonical-value"
    case principalInvalid = "principal-invalid"
    case ownerStale = "owner-stale"
    case peerMismatch = "peer-mismatch"
    case requestExpired = "request-expired"
    case requestReplayed = "request-replayed"
    case bodyConflict = "body-conflict"
    case grantRequired = "grant-required"
    case grantForbidden = "grant-forbidden"
    case grantInvalid = "grant-invalid"
    case policyMismatch = "policy-mismatch"
    case domainMismatch = "domain-mismatch"
    case targetMismatch = "target-mismatch"
    case reviewBlocked = "review-blocked"
    case signatureInvalid = "signature-invalid"
    case ciphertextInvalid = "ciphertext-invalid"
    case challengeInvalid = "challenge-invalid"
    case claimRejected = "claim-rejected"
    case executionFailed = "execution-failed"
    case integrityFailure = "integrity-failure"
    case `internal`
}

public struct RemoteAuthProtocolError: Error, Equatable, Sendable {
    public let publicError: PublicError

    public init(_ publicError: PublicError) {
        self.publicError = publicError
    }
}

public protocol ProtocolValidatable: Sendable {
    func validate() throws
}

public protocol WireMessage: Codable, ProtocolValidatable {}

public enum ProtocolJSON {
    public static func decode<T: WireMessage>(_ type: T.Type, from data: Data) throws -> T {
        do {
            let value = try JSONDecoder().decode(type, from: data)
            try value.validate()
            return value
        } catch let error as RemoteAuthProtocolError {
            throw error
        } catch {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
    }

    public static func encode<T: WireMessage>(_ value: T) throws -> Data {
        do {
            try value.validate()
            return try JSONEncoder().encode(value)
        } catch let error as RemoteAuthProtocolError {
            throw error
        } catch {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
    }
}

public enum MetadataJSONEncoder {
    public static func encode(_ metadata: ReceiptMetadata) throws -> Data {
        try ProtocolJSON.encode(metadata)
    }

    public static func encode(_ metadata: PublicStatusMetadata) throws -> Data {
        try ProtocolJSON.encode(metadata)
    }
}

struct AnyCodingKey: CodingKey, Hashable {
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

extension Decoder {
    func rejectUnknownKeys<K>(_ keyType: K.Type) throws where K: CodingKey & CaseIterable, K.AllCases: Collection {
        let container = try self.container(keyedBy: AnyCodingKey.self)
        let allowed = Set(K.allCases.map(\.stringValue))
        guard container.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw RemoteAuthProtocolError(.excessField)
        }
    }
}

extension KeyedDecodingContainer {
    func decodeTime(forKey key: Key) throws -> UInt64 {
        let value = try decode(UInt64.self, forKey: key)
        guard value <= 9_007_199_254_740_991 else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        return value
    }

    func decodeOptionalTime(forKey key: Key) throws -> UInt64? {
        guard contains(key) else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        guard try !decodeNil(forKey: key) else { return nil }
        return try decodeTime(forKey: key)
    }

    func decodeRequiredNullable<T>(_ type: T.Type, forKey key: Key) throws -> T? where T: Decodable {
        guard contains(key) else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        guard try !decodeNil(forKey: key) else { return nil }
        return try decode(type, forKey: key)
    }
}

extension KeyedEncodingContainer {
    mutating func encodeRequiredNullable<T>(_ value: T?, forKey key: Key) throws where T: Encodable {
        if let value {
            try encode(value, forKey: key)
        } else {
            try encodeNil(forKey: key)
        }
    }
}
