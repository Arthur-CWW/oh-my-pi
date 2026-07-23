import Darwin
import Foundation
import RemoteAuthProtocol

public protocol BrokerControlCoordinating: Sendable {
    func receipt(requestId: String, peer: BrokerPeer) throws -> ReceiptMetadata
    func cancel(requestId: String, peer: BrokerPeer) throws
    func listGrants(peer: BrokerPeer) throws -> [Grant]
    func createGrant(proposal: BrokerGrantProposal, peer: BrokerPeer) throws -> String
    func expandGrant(grantId: String, proposal: BrokerGrantProposal, peer: BrokerPeer) throws -> String
    func revokeGrant(grantId: String, peer: BrokerPeer) throws
    func expireGrant(grantId: String, peer: BrokerPeer) throws
    func enrollCredential(kind: BrokerCredentialKind, credentialId: String, secret: BrokerSecret, peer: BrokerPeer) throws -> String
    func forgetCredential(credentialId: String, peer: BrokerPeer) throws
    func emergencyDisable(reason: String, peer: BrokerPeer) throws
    func reEnable(peer: BrokerPeer) throws
}

public protocol BrokerPublicStatusProviding: Sendable {
    func status(socketPosture: SocketPosture, pid: UInt32) throws -> PublicStatusMetadata
}

public struct BrokerDispatchCapabilities: Equatable, Sendable {
    public static let inactive = Self(gdmLogin: false)
    public static let gdmOnly = Self(gdmLogin: true)

    public let gdmLogin: Bool

    public init(gdmLogin: Bool) {
        self.gdmLogin = gdmLogin
    }

    public func permits(_ request: ExecutionRequest) -> Bool {
        guard gdmLogin,
              request.operation == .gdmLogin,
              request.domain == .desktopBrowser,
              case .gdm = request.target
        else {
            return false
        }
        return true
    }
}


public struct InactiveBrokerStatusProvider: BrokerPublicStatusProviding, Sendable {
    public init() {}

    public func status(socketPosture: SocketPosture, pid: UInt32) throws -> PublicStatusMetadata {
        let unavailable = EndpointStatus(ready: false, errorCode: .inactive)
        let status = PublicStatusMetadata(
            canonicalStatus: .designInactive,
            policyDigest: nil,
            installedBuildDigest: nil,
            runningBuildDigest: nil,
            codeIdentity: nil,
            pid: pid,
            socketPosture: socketPosture,
            jetkvmControllerGeneration: nil,
            gdm: unavailable,
            browser: unavailable,
            sudo: unavailable,
            errors: [.inactive]
        )
        try status.validate()
        return status
    }
}

public final class BrokerService: @unchecked Sendable {
    public let active: Bool

    private let executor: (any BrokerExecutionCoordinating)?
    private let controls: (any BrokerControlCoordinating)?
    private let statusProvider: any BrokerPublicStatusProviding
    private let dispatchCapabilities: BrokerDispatchCapabilities

    public init(
        active: Bool,
        executor: (any BrokerExecutionCoordinating)? = nil,
        controls: (any BrokerControlCoordinating)? = nil,
        statusProvider: any BrokerPublicStatusProviding = InactiveBrokerStatusProvider(),
        dispatchCapabilities: BrokerDispatchCapabilities? = nil
    ) {
        self.active = active
        self.executor = executor
        self.controls = controls
        self.statusProvider = statusProvider
        self.dispatchCapabilities = dispatchCapabilities ?? (active ? .gdmOnly : .inactive)
    }

    public func handle(
        _ request: BrokerWireRequest,
        peer: BrokerPeer,
        socketPosture: SocketPosture = .ownerOnly
    ) -> BrokerWireResponse {
        do {
            switch request {
            case .execution(let execution):
                return .receipt(try execute(execution, peer: peer, socketPosture: socketPosture))
            case .control(let control):
                return try handle(control, peer: peer, socketPosture: socketPosture)
            }
        } catch let error as RemoteAuthProtocolError {
            return .error(BrokerErrorResponse(code: error.publicError))
        } catch let error as BrokerServiceError {
            return .error(BrokerErrorResponse(code: error.publicError))
        } catch {
            return .error(BrokerErrorResponse(code: .internal))
        }
    }

    public func publicStatus(socketPosture: SocketPosture = .ownerOnly) throws -> PublicStatusMetadata {
        let rawPID = getpid()
        guard rawPID > 0, UInt64(rawPID) <= UInt64(UInt32.max) else {
            throw BrokerServiceError(.internal)
        }
        let status = try statusProvider.status(socketPosture: socketPosture, pid: UInt32(rawPID))
        try status.validate()
        return status
    }

    private func execute(
        _ request: ExecutionRequest,
        peer: BrokerPeer,
        socketPosture: SocketPosture
    ) throws -> ReceiptMetadata {
        switch try publicStatus(socketPosture: socketPosture).canonicalStatus {
        case .active:
            guard let executor else { throw BrokerServiceError(.unavailable) }
            guard dispatchCapabilities.permits(request) else {
                throw BrokerServiceError(.inactive)
            }
            return try executor.execute(request, peer: peer)
        case .designInactive:
            throw BrokerServiceError(.inactive)
        case .disabled:
            throw BrokerServiceError(.disabled)
        case .degraded:
            throw BrokerServiceError(.integrityFailure)
        }
    }

    private func handle(
        _ control: BrokerControlRequest,
        peer: BrokerPeer,
        socketPosture: SocketPosture
    ) throws -> BrokerWireResponse {
        try control.validate()
        if case .status = control {
            return .status(try publicStatus(socketPosture: socketPosture))
        }
        let status = try publicStatus(socketPosture: socketPosture)
        switch status.canonicalStatus {
        case .active:
            break
        case .designInactive:
            throw BrokerServiceError(.inactive)
        case .disabled:
            guard Self.isLocalSafetyControl(control) else {
                throw BrokerServiceError(.disabled)
            }
        case .degraded:
            guard Self.isLocalSafetyControl(control) else {
                throw BrokerServiceError(.integrityFailure)
            }
        }
        guard let controls else {
            throw BrokerServiceError(.unavailable)
        }
        switch control {
        case .requestState(let requestId):
            return .receipt(try controls.receipt(requestId: requestId, peer: peer))
        case .cancel(let requestId):
            try controls.cancel(requestId: requestId, peer: peer)
            return .ack(BrokerAcknowledgement(operation: .cancel, identifier: requestId))
        case .grantList:
            return .grants(try controls.listGrants(peer: peer))
        case .grantCreate(let proposal):
            let grantId = try controls.createGrant(proposal: proposal, peer: peer)
            return .ack(BrokerAcknowledgement(operation: .grantCreate, identifier: grantId))
        case .grantExpand(let grantId, let proposal):
            let expandedGrantId = try controls.expandGrant(grantId: grantId, proposal: proposal, peer: peer)
            return .ack(BrokerAcknowledgement(operation: .grantExpand, identifier: expandedGrantId))
        case .grantRevoke(let grantId):
            try controls.revokeGrant(grantId: grantId, peer: peer)
            return .ack(BrokerAcknowledgement(operation: .grantRevoke, identifier: grantId))
        case .grantExpire(let grantId):
            try controls.expireGrant(grantId: grantId, peer: peer)
            return .ack(BrokerAcknowledgement(operation: .grantExpire, identifier: grantId))
        case .credentialEnroll(let kind, let credentialId, let secret):
            let enrolledId = try controls.enrollCredential(
                kind: kind,
                credentialId: credentialId,
                secret: secret,
                peer: peer
            )
            return .ack(BrokerAcknowledgement(operation: .credentialEnroll, identifier: enrolledId))
        case .credentialForget(let credentialId):
            try controls.forgetCredential(credentialId: credentialId, peer: peer)
            return .ack(BrokerAcknowledgement(operation: .credentialForget, identifier: credentialId))
        case .emergencyDisable(let reason):
            try controls.emergencyDisable(reason: reason, peer: peer)
            return .ack(BrokerAcknowledgement(operation: .emergencyDisable, identifier: nil))
        case .reEnable:
            try controls.reEnable(peer: peer)
            return .ack(BrokerAcknowledgement(operation: .reEnable, identifier: nil))
        case .status:
            return .status(try publicStatus(socketPosture: socketPosture))
        }
    }

    private static func isLocalSafetyControl(_ control: BrokerControlRequest) -> Bool {
        switch control {
        case .requestState, .cancel, .grantList, .grantRevoke, .grantExpire,
             .credentialForget, .emergencyDisable, .reEnable, .status:
            true
        case .grantCreate, .grantExpand, .credentialEnroll:
            false
        }
    }
}

public struct BrokerServiceError: Error, Equatable, Sendable {
    public let publicError: PublicError

    public init(_ publicError: PublicError) {
        self.publicError = publicError
    }
}

public final class BrokerDaemon {
    private let service: BrokerService

    public init(service: BrokerService) {
        self.service = service
    }

    public convenience init() throws {
        self.init(service: try RuntimeBootstrap().makeService())
    }

    public func serve() throws -> Never {
        let server = try OwnerOnlyUnixServer()
        return try server.run { [service] peer, payload in
            let response: BrokerWireResponse
            do {
                let request = try BrokerWireCodec.decodeRequest(payload: payload)
                response = service.handle(request, peer: peer, socketPosture: .ownerOnly)
            } catch let error as RemoteAuthProtocolError {
                response = .error(BrokerErrorResponse(code: error.publicError))
            } catch let error as BrokerSocketError {
                response = .error(BrokerErrorResponse(code: Self.publicError(for: error)))
            } catch {
                response = .error(BrokerErrorResponse(code: .protocolInvalid))
            }
            do {
                return try BrokerWireCodec.encodePayload(response)
            } catch {
                return Data(#"{"error":{"code":"internal"},"type":"error"}"#.utf8)
            }
        }
    }

    private static func publicError(for error: BrokerSocketError) -> PublicError {
        switch error {
        case .frameTooLarge, .unexpectedEOF, .trailingData:
            return .frameInvalid
        case .peerRejected:
            return .peerMismatch
        case .unsafePath, .alreadyRunning, .systemCall:
            return .unavailable
        }
    }
}
