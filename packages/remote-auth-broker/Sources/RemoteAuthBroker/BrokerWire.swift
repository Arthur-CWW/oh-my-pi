import Foundation
import RemoteAuthProtocol

public enum BrokerAcknowledgedOperation: String, Codable, Sendable {
    case cancel
    case grantCreate = "grant-create"
    case grantExpand = "grant-expand"
    case grantRevoke = "grant-revoke"
    case grantExpire = "grant-expire"
    case credentialEnroll = "credential-enroll"
    case credentialForget = "credential-forget"
    case emergencyDisable = "emergency-disable"
    case reEnable = "re-enable"
}

public struct BrokerAcknowledgement: Codable, Sendable, Equatable {
    public let operation: BrokerAcknowledgedOperation
    public let identifier: String?

    public init(operation: BrokerAcknowledgedOperation, identifier: String?) {
        self.operation = operation
        self.identifier = identifier
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case operation, identifier
    }

    public init(from decoder: Decoder) throws {
        try decoder.brokerRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        operation = try container.decode(BrokerAcknowledgedOperation.self, forKey: .operation)
        guard container.contains(.identifier) else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        identifier = try container.decodeIfPresent(String.self, forKey: .identifier)
        switch operation {
        case .cancel, .grantCreate, .grantExpand, .grantRevoke, .grantExpire, .credentialEnroll, .credentialForget:
            guard let identifier, !identifier.isEmpty else {
                throw RemoteAuthProtocolError(.protocolInvalid)
            }
        case .emergencyDisable, .reEnable:
            guard identifier == nil else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(operation, forKey: .operation)
        try container.encode(identifier, forKey: .identifier)
    }
}

public struct BrokerErrorResponse: Codable, Sendable, Equatable {
    public let code: PublicError

    public init(code: PublicError) {
        self.code = code
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case code
    }

    public init(from decoder: Decoder) throws {
        try decoder.brokerRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try container.decode(PublicError.self, forKey: .code)
    }
}

public struct BrokerGrantProposal: Codable, Sendable {
    public let principalSelector: PrincipalSelector
    public let domain: AuthorizationDomain
    public let operation: AuthorizationOperation
    public let targetPredicate: ExecutionTarget
    public let riskCeiling: RiskLevel
    public let durationSeconds: UInt64

    public init(
        principalSelector: PrincipalSelector,
        domain: AuthorizationDomain,
        operation: AuthorizationOperation,
        targetPredicate: ExecutionTarget,
        riskCeiling: RiskLevel,
        durationSeconds: UInt64
    ) {
        self.principalSelector = principalSelector
        self.domain = domain
        self.operation = operation
        self.targetPredicate = targetPredicate
        self.riskCeiling = riskCeiling
        self.durationSeconds = durationSeconds
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case principalSelector, domain, operation, targetPredicate, riskCeiling, durationSeconds
    }

    public init(from decoder: Decoder) throws {
        try decoder.brokerRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        principalSelector = try container.decode(PrincipalSelector.self, forKey: .principalSelector)
        domain = try container.decode(AuthorizationDomain.self, forKey: .domain)
        operation = try container.decode(AuthorizationOperation.self, forKey: .operation)
        targetPredicate = try container.decode(ExecutionTarget.self, forKey: .targetPredicate)
        riskCeiling = try container.decode(RiskLevel.self, forKey: .riskCeiling)
        durationSeconds = try container.decode(UInt64.self, forKey: .durationSeconds)
        try validate()
    }

    public func encode(to encoder: Encoder) throws {
        try validate()
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(principalSelector, forKey: .principalSelector)
        try container.encode(domain, forKey: .domain)
        try container.encode(operation, forKey: .operation)
        try container.encode(targetPredicate, forKey: .targetPredicate)
        try container.encode(riskCeiling, forKey: .riskCeiling)
        try container.encode(durationSeconds, forKey: .durationSeconds)
    }

    public func validate() throws {
        try principalSelector.validate()
        try targetPredicate.validate()
        guard durationSeconds > 0 else {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        switch (domain, operation, targetPredicate) {
        case (.desktopBrowser, .gdmLogin, .gdm),
             (.desktopBrowser, .bitwardenUnlock, .bitwarden),
             (.desktopBrowser, .websiteAutofill, .website),
             (.sudo, .sudo, .sudo):
            break
        default:
            throw RemoteAuthProtocolError(.domainMismatch)
        }
    }
}

public enum BrokerCredentialKind: String, Codable, Sendable {
    case jetKVM = "jetkvm"
    case bitwarden
}

public final class BrokerSecret: Codable, @unchecked Sendable {
    private var storage: [UInt8]

    public init(taking bytes: inout [UInt8]) throws {
        guard !bytes.isEmpty, bytes.count <= 4_096 else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        storage = bytes
        bytes.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
        bytes.removeAll(keepingCapacity: false)
    }

    public required init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        storage = try container.decode([UInt8].self)
        guard !storage.isEmpty, storage.count <= 4_096 else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
    }

    deinit {
        storage.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }

    public var count: Int { storage.count }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(storage)
    }

    public func withMutableBytes<T>(_ body: (inout [UInt8]) throws -> T) rethrows -> T {
        try body(&storage)
    }
}

public enum BrokerControlRequest: Codable, Sendable {
    case requestState(requestId: String)
    case cancel(requestId: String)
    case grantList
    case grantCreate(proposal: BrokerGrantProposal)
    case grantExpand(grantId: String, proposal: BrokerGrantProposal)
    case grantRevoke(grantId: String)
    case grantExpire(grantId: String)
    case credentialEnroll(kind: BrokerCredentialKind, credentialId: String, secret: BrokerSecret)
    case credentialForget(credentialId: String)
    case emergencyDisable(reason: String)
    case reEnable
    case status

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case action, requestId, grantId, proposal, kind, credentialId, secret, reason
    }

    private enum Action: String, Codable {
        case requestState = "request-state"
        case cancel
        case grantList = "grant-list"
        case grantCreate = "grant-create"
        case grantExpand = "grant-expand"
        case grantRevoke = "grant-revoke"
        case grantExpire = "grant-expire"
        case credentialEnroll = "credential-enroll"
        case credentialForget = "credential-forget"
        case emergencyDisable = "emergency-disable"
        case reEnable = "re-enable"
        case status
    }

    public init(_ request: ControlRequest) {
        switch request {
        case .requestState(let requestId): self = .requestState(requestId: requestId)
        case .cancel(let requestId): self = .cancel(requestId: requestId)
        case .grantList: self = .grantList
        case .grantRevoke(let grantId): self = .grantRevoke(grantId: grantId)
        case .grantExpire(let grantId): self = .grantExpire(grantId: grantId)
        case .credentialForget(let credentialId): self = .credentialForget(credentialId: credentialId)
        case .emergencyDisable(let reason): self = .emergencyDisable(reason: reason)
        case .reEnable: self = .reEnable
        case .status: self = .status
        }
    }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: BrokerAnyCodingKey.self)
        guard let actionKey = BrokerAnyCodingKey(stringValue: "action") else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        let action = try dynamic.decode(Action.self, forKey: actionKey)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch action {
        case .requestState:
            try decoder.brokerRequireKeys(["action", "requestId"])
            self = .requestState(requestId: try container.decode(String.self, forKey: .requestId))
        case .cancel:
            try decoder.brokerRequireKeys(["action", "requestId"])
            self = .cancel(requestId: try container.decode(String.self, forKey: .requestId))
        case .grantList:
            try decoder.brokerRequireKeys(["action"])
            self = .grantList
        case .grantCreate:
            try decoder.brokerRequireKeys(["action", "proposal"])
            self = .grantCreate(proposal: try container.decode(BrokerGrantProposal.self, forKey: .proposal))
        case .grantExpand:
            try decoder.brokerRequireKeys(["action", "grantId", "proposal"])
            self = .grantExpand(
                grantId: try container.decode(String.self, forKey: .grantId),
                proposal: try container.decode(BrokerGrantProposal.self, forKey: .proposal)
            )
        case .grantRevoke:
            try decoder.brokerRequireKeys(["action", "grantId"])
            self = .grantRevoke(grantId: try container.decode(String.self, forKey: .grantId))
        case .grantExpire:
            try decoder.brokerRequireKeys(["action", "grantId"])
            self = .grantExpire(grantId: try container.decode(String.self, forKey: .grantId))
        case .credentialEnroll:
            try decoder.brokerRequireKeys(["action", "kind", "credentialId", "secret"])
            self = .credentialEnroll(
                kind: try container.decode(BrokerCredentialKind.self, forKey: .kind),
                credentialId: try container.decode(String.self, forKey: .credentialId),
                secret: try container.decode(BrokerSecret.self, forKey: .secret)
            )
        case .credentialForget:
            try decoder.brokerRequireKeys(["action", "credentialId"])
            self = .credentialForget(credentialId: try container.decode(String.self, forKey: .credentialId))
        case .emergencyDisable:
            try decoder.brokerRequireKeys(["action", "reason"])
            self = .emergencyDisable(reason: try container.decode(String.self, forKey: .reason))
        case .reEnable:
            try decoder.brokerRequireKeys(["action"])
            self = .reEnable
        case .status:
            try decoder.brokerRequireKeys(["action"])
            self = .status
        }
        try validate()
    }

    public func encode(to encoder: Encoder) throws {
        try validate()
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .requestState(let requestId):
            try container.encode(Action.requestState, forKey: .action)
            try container.encode(requestId, forKey: .requestId)
        case .cancel(let requestId):
            try container.encode(Action.cancel, forKey: .action)
            try container.encode(requestId, forKey: .requestId)
        case .grantList:
            try container.encode(Action.grantList, forKey: .action)
        case .grantCreate(let proposal):
            try container.encode(Action.grantCreate, forKey: .action)
            try container.encode(proposal, forKey: .proposal)
        case .grantExpand(let grantId, let proposal):
            try container.encode(Action.grantExpand, forKey: .action)
            try container.encode(grantId, forKey: .grantId)
            try container.encode(proposal, forKey: .proposal)
        case .grantRevoke(let grantId):
            try container.encode(Action.grantRevoke, forKey: .action)
            try container.encode(grantId, forKey: .grantId)
        case .grantExpire(let grantId):
            try container.encode(Action.grantExpire, forKey: .action)
            try container.encode(grantId, forKey: .grantId)
        case .credentialEnroll(let kind, let credentialId, let secret):
            try container.encode(Action.credentialEnroll, forKey: .action)
            try container.encode(kind, forKey: .kind)
            try container.encode(credentialId, forKey: .credentialId)
            try container.encode(secret, forKey: .secret)
        case .credentialForget(let credentialId):
            try container.encode(Action.credentialForget, forKey: .action)
            try container.encode(credentialId, forKey: .credentialId)
        case .emergencyDisable(let reason):
            try container.encode(Action.emergencyDisable, forKey: .action)
            try container.encode(reason, forKey: .reason)
        case .reEnable:
            try container.encode(Action.reEnable, forKey: .action)
        case .status:
            try container.encode(Action.status, forKey: .action)
        }
    }

    public func validate() throws {
        switch self {
        case .requestState(let requestId):
            try ControlRequest.requestState(requestId: requestId).validate()
        case .cancel(let requestId):
            try ControlRequest.cancel(requestId: requestId).validate()
        case .grantList:
            break
        case .grantCreate(let proposal):
            try proposal.validate()
        case .grantExpand(let grantId, let proposal):
            try ControlRequest.grantRevoke(grantId: grantId).validate()
            try proposal.validate()
        case .grantRevoke(let grantId):
            try ControlRequest.grantRevoke(grantId: grantId).validate()
        case .grantExpire(let grantId):
            try ControlRequest.grantExpire(grantId: grantId).validate()
        case .credentialEnroll(_, let credentialId, let secret):
            try ControlRequest.credentialForget(credentialId: credentialId).validate()
            guard secret.count > 0, secret.count <= 4_096 else {
                throw RemoteAuthProtocolError(.protocolInvalid)
            }
        case .credentialForget(let credentialId):
            try ControlRequest.credentialForget(credentialId: credentialId).validate()
        case .emergencyDisable(let reason):
            try ControlRequest.emergencyDisable(reason: reason).validate()
        case .reEnable, .status:
            break
        }
    }
}

public enum BrokerWireRequest: Codable, Sendable {
    case execution(ExecutionRequest)
    case control(BrokerControlRequest)

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case type, request, control
    }

    private enum Kind: String, Codable {
        case execution, control
    }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: BrokerAnyCodingKey.self)
        guard let typeKey = BrokerAnyCodingKey(stringValue: "type") else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        let kind = try dynamic.decode(Kind.self, forKey: typeKey)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch kind {
        case .execution:
            try decoder.brokerRequireKeys(["type", "request"])
            let request = try container.decode(ExecutionRequest.self, forKey: .request)
            try request.validate()
            self = .execution(request)
        case .control:
            try decoder.brokerRequireKeys(["type", "control"])
            let control = try container.decode(BrokerControlRequest.self, forKey: .control)
            try control.validate()
            self = .control(control)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .execution(let request):
            try request.validate()
            try container.encode(Kind.execution, forKey: .type)
            try container.encode(request, forKey: .request)
        case .control(let control):
            try control.validate()
            try container.encode(Kind.control, forKey: .type)
            try container.encode(control, forKey: .control)
        }
    }
}

public enum BrokerWireResponse: Codable, Sendable {
    case status(PublicStatusMetadata)
    case receipt(ReceiptMetadata)
    case grants([Grant])
    case ack(BrokerAcknowledgement)
    case error(BrokerErrorResponse)

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case type, status, receipt, grants, ack, error
    }

    private enum Kind: String, Codable {
        case status, receipt, grants, ack, error
    }

    public init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: BrokerAnyCodingKey.self)
        guard let typeKey = BrokerAnyCodingKey(stringValue: "type") else {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
        let kind = try dynamic.decode(Kind.self, forKey: typeKey)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch kind {
        case .status:
            try decoder.brokerRequireKeys(["type", "status"])
            let status = try container.decode(PublicStatusMetadata.self, forKey: .status)
            try status.validate()
            self = .status(status)
        case .receipt:
            try decoder.brokerRequireKeys(["type", "receipt"])
            let receipt = try container.decode(ReceiptMetadata.self, forKey: .receipt)
            try receipt.validate()
            self = .receipt(receipt)
        case .grants:
            try decoder.brokerRequireKeys(["type", "grants"])
            let grants = try container.decode([Grant].self, forKey: .grants)
            try grants.forEach { try $0.validate() }
            self = .grants(grants)
        case .ack:
            try decoder.brokerRequireKeys(["type", "ack"])
            self = .ack(try container.decode(BrokerAcknowledgement.self, forKey: .ack))
        case .error:
            try decoder.brokerRequireKeys(["type", "error"])
            self = .error(try container.decode(BrokerErrorResponse.self, forKey: .error))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .status(let status):
            try status.validate()
            try container.encode(Kind.status, forKey: .type)
            try container.encode(status, forKey: .status)
        case .receipt(let receipt):
            try receipt.validate()
            try container.encode(Kind.receipt, forKey: .type)
            try container.encode(receipt, forKey: .receipt)
        case .grants(let grants):
            try grants.forEach { try $0.validate() }
            try container.encode(Kind.grants, forKey: .type)
            try container.encode(grants, forKey: .grants)
        case .ack(let acknowledgement):
            try container.encode(Kind.ack, forKey: .type)
            try container.encode(acknowledgement, forKey: .ack)
        case .error(let error):
            try container.encode(Kind.error, forKey: .type)
            try container.encode(error, forKey: .error)
        }
    }
}

public enum BrokerWireCodec {
    public static func encode(_ request: BrokerWireRequest) throws -> Data {
        try FrameCodec.encode(payload: encodePayload(request))
    }

    public static func encode(_ response: BrokerWireResponse) throws -> Data {
        try FrameCodec.encode(payload: encodePayload(response))
    }

    public static func encodePayload(_ request: BrokerWireRequest) throws -> Data {
        try encodeJSON(request)
    }

    public static func encodePayload(_ response: BrokerWireResponse) throws -> Data {
        try encodeJSON(response)
    }

    public static func decodeRequest(frame: Data) throws -> BrokerWireRequest {
        try decode(BrokerWireRequest.self, payload: FrameCodec.decodePayload(from: frame))
    }

    public static func decodeResponse(frame: Data) throws -> BrokerWireResponse {
        try decode(BrokerWireResponse.self, payload: FrameCodec.decodePayload(from: frame))
    }

    public static func decodeRequest(payload: Data) throws -> BrokerWireRequest {
        try decode(BrokerWireRequest.self, payload: payload)
    }

    public static func decodeResponse(payload: Data) throws -> BrokerWireResponse {
        try decode(BrokerWireResponse.self, payload: payload)
    }

    private static func encodeJSON<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    private static func decode<T: Decodable>(_ type: T.Type, payload: Data) throws -> T {
        guard !payload.isEmpty, payload.count <= remoteAuthMaximumFrameBytes else {
            throw RemoteAuthProtocolError(.frameInvalid)
        }
        do {
            return try JSONDecoder().decode(type, from: payload)
        } catch let error as RemoteAuthProtocolError {
            throw error
        } catch {
            throw RemoteAuthProtocolError(.protocolInvalid)
        }
    }
}

private struct BrokerAnyCodingKey: CodingKey, Hashable {
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

private extension Decoder {
    func brokerRejectUnknownKeys<K: CodingKey & CaseIterable>(_ type: K.Type) throws where K.AllCases: Collection {
        let dynamic = try container(keyedBy: BrokerAnyCodingKey.self)
        let allowed = Set(type.allCases.map(\.stringValue))
        guard dynamic.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw RemoteAuthProtocolError(.excessField)
        }
    }

    func brokerRequireKeys(_ expected: Set<String>) throws {
        let dynamic = try container(keyedBy: BrokerAnyCodingKey.self)
        let actual = Set(dynamic.allKeys.map(\.stringValue))
        guard actual == expected else {
            if actual.subtracting(expected).isEmpty {
                throw RemoteAuthProtocolError(.protocolInvalid)
            }
            throw RemoteAuthProtocolError(.excessField)
        }
    }
}
