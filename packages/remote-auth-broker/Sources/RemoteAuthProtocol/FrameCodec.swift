import Foundation

public enum FrameCodec {
    private static let headerByteCount = 4

    public static func encode(payload: Data) throws -> Data {
        guard payload.count <= remoteAuthMaximumFrameBytes else {
            throw RemoteAuthProtocolError(.frameInvalid)
        }

        let length = UInt32(payload.count)
        var frame = Data()
        frame.reserveCapacity(headerByteCount + payload.count)
        frame.append(UInt8(truncatingIfNeeded: length >> 24))
        frame.append(UInt8(truncatingIfNeeded: length >> 16))
        frame.append(UInt8(truncatingIfNeeded: length >> 8))
        frame.append(UInt8(truncatingIfNeeded: length))
        frame.append(payload)
        return frame
    }

    public static func decodePayload(from frame: Data) throws -> Data {
        guard frame.count >= headerByteCount else {
            throw RemoteAuthProtocolError(.frameInvalid)
        }

        let payloadLength = frame.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> UInt32 in
            (UInt32(bytes[0]) << 24)
                | (UInt32(bytes[1]) << 16)
                | (UInt32(bytes[2]) << 8)
                | UInt32(bytes[3])
        }
        guard payloadLength <= UInt32(remoteAuthMaximumFrameBytes),
              frame.count == headerByteCount + Int(payloadLength)
        else {
            throw RemoteAuthProtocolError(.frameInvalid)
        }

        return frame.subdata(in: headerByteCount..<frame.count)
    }

    public static func encode<T: WireMessage>(_ value: T) throws -> Data {
        try encode(payload: ProtocolJSON.encode(value))
    }

    public static func decode<T: WireMessage>(_ frame: Data, as type: T.Type) throws -> T {
        try ProtocolJSON.decode(type, from: decodePayload(from: frame))
    }
}
