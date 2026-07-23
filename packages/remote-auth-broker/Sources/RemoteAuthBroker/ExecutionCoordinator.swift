import CryptoKit
import Darwin
import Foundation
import RemoteAuthBrowserController
import RemoteAuthJetKVMCloudController
import RemoteAuthProtocol
import Security

public protocol BrokerExecutionCoordinating: Sendable {
    func execute(_ request: ExecutionRequest, peer: BrokerPeer) throws -> ReceiptMetadata
}

public protocol LivePeerOwnershipProviding: Sendable {
    func ownership(for attestedPeer: AttestedPeer, principal: Principal) throws -> LivePeerOwnership
}

public struct LivePeerOwnership: Equatable, Sendable {
    public let sessionId: String
    public let ownerEpoch: String
    public let runnerInstanceIdentity: String

    public init(sessionId: String, ownerEpoch: String, runnerInstanceIdentity: String) {
        self.sessionId = sessionId
        self.ownerEpoch = ownerEpoch
        self.runnerInstanceIdentity = runnerInstanceIdentity
    }
}


public protocol BrokerPeerValidating: Sendable {
    func executionPeer(_ peer: BrokerPeer, principal: Principal) throws -> PeerMatchInput
    func validateControlPeer(_ peer: BrokerPeer) throws
}

public final class ExactBrokerPeerValidator: BrokerPeerValidating, @unchecked Sendable {
    private let policy: BrokerPolicy
    private let ownership: any LivePeerOwnershipProviding
    private let attestation: PeerAttestation

    public init(
        policy: BrokerPolicy,
        ownership: any LivePeerOwnershipProviding,
        attestation: PeerAttestation = PeerAttestation()
    ) {
        self.policy = policy
        self.ownership = ownership
        self.attestation = attestation
    }

    public func executionPeer(_ peer: BrokerPeer, principal: Principal) throws -> PeerMatchInput {
        let attested = try attest(peer)
        let live = try ownership.ownership(for: attested, principal: principal)
        let input = try makeInput(attested: attested, live: live)
        guard input.matches(principal), policy.trustedCaller(matching: input) != nil else {
            throw RemoteAuthProtocolError(.peerMismatch)
        }
        return input
    }

    public func validateControlPeer(_ peer: BrokerPeer) throws {
        _ = try attest(peer)
    }

    private func attest(_ peer: BrokerPeer) throws -> AttestedPeer {
        guard peer.pid > 0, peer.uid <= uid_t(UInt32.max) else {
            throw RemoteAuthProtocolError(.peerMismatch)
        }
        for caller in policy.trustedOmpCallers where caller.uid == UInt32(peer.uid) {
            let expected = ExpectedPeerIdentity(
                uid: peer.uid,
                signingIdentifier: caller.signingIdentifier,
                teamIdentifier: caller.teamIdentifier,
                executableSHA256: caller.executableSHA256
            )
            guard let candidate = try? attestation.attest(
                socketDescriptor: peer.socketDescriptor,
                expected: expected
            ) else { continue }
            guard candidate.pid == peer.pid,
                  candidate.uid == peer.uid,
                  candidate.gid == peer.gid,
                  candidate.designatedRequirement == caller.designatedRequirement
            else { continue }
            return candidate
        }
        throw RemoteAuthProtocolError(.peerMismatch)
    }

    private func makeInput(attested: AttestedPeer, live: LivePeerOwnership) throws -> PeerMatchInput {
        guard attested.pid > 0,
              UInt64(attested.pid) <= UInt64(UInt32.max),
              UInt64(attested.uid) <= UInt64(UInt32.max),
              !live.sessionId.isEmpty,
              !live.ownerEpoch.isEmpty,
              !live.runnerInstanceIdentity.isEmpty
        else { throw RemoteAuthProtocolError(.peerMismatch) }
        return PeerMatchInput(
            pid: UInt32(attested.pid),
            uid: UInt32(attested.uid),
            signingIdentifier: attested.signingIdentifier,
            teamIdentifier: attested.teamIdentifier,
            executableSHA256: attested.executableSHA256,
            designatedRequirement: attested.designatedRequirement,
            liveSessionId: live.sessionId,
            liveOwnerEpoch: live.ownerEpoch,
            liveRunnerInstanceIdentity: live.runnerInstanceIdentity
        )
    }
}

enum GDMExecutionEffect: CaseIterable, Equatable, Sendable {
    case verifierChallenge
    case keychainEnvelope
    case forcedEndpointIngest
    case markReleased
    case sentinelActuation
    case authenticatedCompletion
}

struct GDMExecutionSequence: Sendable {
    private(set) var completedEffectCount = 0

    var nextEffect: GDMExecutionEffect? {
        guard completedEffectCount < GDMExecutionEffect.allCases.count else { return nil }
        return GDMExecutionEffect.allCases[completedEffectCount]
    }

    mutating func perform<Value>(
        _ effect: GDMExecutionEffect,
        operation: () throws -> Value
    ) throws -> Value {
        guard nextEffect == effect else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
        let value = try operation()
        completedEffectCount += 1
        return value
    }
}

public protocol JetKVMSentinelActuating: Sendable {
    func typeGDMSentinel(_ sentinel: String, expectedGeneration: UInt64) async throws
    func cancel() async
}

public actor CloudJetKVMSentinelActuator: JetKVMSentinelActuating {
    private let controller: RemoteAuthJetKVMCloudController
    private var preparedLease: JetKVMCloudLease?

    public init(controller: RemoteAuthJetKVMCloudController) {
        self.controller = controller
    }

    public func prepare() async throws -> UInt64 {
        if let preparedLease {
            let status = await controller.status()
            try Self.validateGeneration(
                expected: preparedLease.generation,
                lease: preparedLease.generation,
                status: status.generation,
                phase: status.phase
            )
            return preparedLease.generation
        }

        let lease = try await controller.acquire()
        do {
            let status = await controller.status()
            try Self.validateGeneration(
                expected: lease.generation,
                lease: lease.generation,
                status: status.generation,
                phase: status.phase
            )
            preparedLease = lease
            return lease.generation
        } catch {
            _ = await controller.release(lease)
            throw error
        }
    }

    public func typeGDMSentinel(_ sentinel: String, expectedGeneration: UInt64) async throws {
        let lease: JetKVMCloudLease
        if let preparedLease {
            lease = preparedLease
            self.preparedLease = nil
        } else {
            lease = try await controller.acquire()
        }
        let status = await controller.status()
        do {
            try Self.validateGeneration(
                expected: expectedGeneration,
                lease: lease.generation,
                status: status.generation,
                phase: status.phase
            )
        } catch {
            _ = await controller.release(lease)
            throw error
        }
        do {
            let typed = try await controller.typeGDMSentinel(sentinel, lease: lease)
            guard typed.disposition == .sentinelTyped,
                  typed.generation == expectedGeneration
            else { throw RemoteAuthProtocolError(.integrityFailure) }
            let released = await controller.release(lease)
            guard released.disposition == .released,
                  released.generation == expectedGeneration
            else { throw RemoteAuthProtocolError(.integrityFailure) }
        } catch {
            _ = await controller.release(lease)
            throw error
        }
    }

    static func validateGeneration(
        expected: UInt64,
        lease: UInt64,
        status: UInt64,
        phase: JetKVMCloudPhase
    ) throws {
        guard phase == .leased, lease == expected, status == expected else {
            throw RemoteAuthProtocolError(.targetMismatch)
        }
    }

    public func cancel() async {
        preparedLease = nil
        await controller.shutdown()
    }
}

public protocol BrowserSecretActuating: Sendable {
    func unlock(
        requestId: String,
        generation: UInt64,
        target: BrowserTargetIdentity,
        secret: BrowserSecret
    ) async throws -> TargetReleaseDisposition
    func autofill(
        requestId: String,
        generation: UInt64,
        target: BrowserTargetIdentity,
        originSet: [String],
        credentialAlias: String,
        unlockSecret: BrowserSecret?
    ) async throws -> TargetReleaseDisposition
    func cancel(requestId: String)
    func cancelAll()
}

public final class RemoteBrowserSecretActuator: BrowserSecretActuating, @unchecked Sendable {
    private let controller: RemoteBrowserController

    public init(controller: RemoteBrowserController) {
        self.controller = controller
    }

    public func unlock(
        requestId: String,
        generation: UInt64,
        target: BrowserTargetIdentity,
        secret: BrowserSecret
    ) async throws -> TargetReleaseDisposition {
        let release = try await controller.unlockBitwarden(
            requestId: requestId,
            targetGeneration: generation,
            target: target,
            secret: secret
        )
        return Self.disposition(release.disposition)
    }

    public func autofill(
        requestId: String,
        generation: UInt64,
        target: BrowserTargetIdentity,
        originSet: [String],
        credentialAlias: String,
        unlockSecret: BrowserSecret?
    ) async throws -> TargetReleaseDisposition {
        let release = try await controller.autofill(
            requestId: requestId,
            targetGeneration: generation,
            target: target,
            originSet: originSet,
            credentialAlias: credentialAlias,
            optionalSecretForUnlock: unlockSecret
        )
        return Self.disposition(release.disposition)
    }

    public func cancel(requestId: String) {
        controller.cancel(requestId: requestId)
    }

    public func cancelAll() {
        controller.cleanup()
    }

    private static func disposition(_ value: BrowserReleaseDisposition) -> TargetReleaseDisposition {
        switch value {
        case .destroyed: .destroyed
        case .closed: .closed
        }
    }
}

public final class ExecutionCoordinator: BrokerExecutionCoordinating, BrokerControlCoordinating, @unchecked Sendable {
    private let policy: LoadedPolicy
    private let runtime: RuntimeIdentity
    private let stateStore: SecureStateStore<AuthorityState>
    private let keychain: KeychainAuthority
    private let biometric: any BiometricAuthorizing
    private let peerValidator: any BrokerPeerValidating
    private let crypto: CryptoAuthority
    private let gdmEndpoint: RemoteEndpointClient
    private let sudoEndpoint: RemoteEndpointClient?
    private let jetKVM: any JetKVMSentinelActuating
    private let browser: (any BrowserSecretActuating)?
    private let executionLock = NSLock()
    private var executing = Set<String>()

    public init(
        policy: LoadedPolicy,
        runtime: RuntimeIdentity,
        stateStore: SecureStateStore<AuthorityState>,
        keychain: KeychainAuthority,
        biometric: any BiometricAuthorizing,
        peerValidator: any BrokerPeerValidating,
        gdmEndpoint: RemoteEndpointClient,
        sudoEndpoint: RemoteEndpointClient?,
        jetKVM: any JetKVMSentinelActuating,
        browser: (any BrowserSecretActuating)?
    ) {
        self.policy = policy
        self.runtime = runtime
        self.stateStore = stateStore
        self.keychain = keychain
        self.biometric = biometric
        self.peerValidator = peerValidator
        crypto = CryptoAuthority(keychainAuthority: keychain)
        self.gdmEndpoint = gdmEndpoint
        self.sudoEndpoint = sudoEndpoint
        self.jetKVM = jetKVM
        self.browser = browser
    }

    public func execute(_ request: ExecutionRequest, peer: BrokerPeer) throws -> ReceiptMetadata {
        try request.validate()
        let peerMatch = try peerValidator.executionPeer(peer, principal: request.principal)
        let browserGeneration = try Self.browserGeneration(request)
        let biometricAuthorization = try executionBiometricAuthorization(request)
        try begin(request, peer: peerMatch, browserGeneration: browserGeneration, biometric: biometricAuthorization)
        guard registerExecution(request.requestId) else {
            throw RemoteAuthProtocolError(.requestReplayed)
        }
        defer { unregisterExecution(request.requestId) }

        do {
            let release = try perform(request, browserGeneration: browserGeneration)
            return try finish(
                requestId: request.requestId,
                outcome: .succeeded,
                releaseDisposition: release
            )
        } catch {
            let publicError = Self.publicError(error)
            let release: TargetReleaseDisposition = browserGeneration == nil ? .notApplicable : .quarantined
            _ = try? finish(
                requestId: request.requestId,
                outcome: .failed(publicError),
                releaseDisposition: release
            )
            throw RemoteAuthProtocolError(publicError)
        }
    }

    public func receipt(requestId: String, peer: BrokerPeer) throws -> ReceiptMetadata {
        try peerValidator.validateControlPeer(peer)
        guard let state = try stateStore.read() else { throw RemoteAuthProtocolError(.protocolInvalid) }
        return try state.receipt(for: requestId)
    }

    public func cancel(requestId: String, peer: BrokerPeer) throws {
        try peerValidator.validateControlPeer(peer)
        let state = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try state.cancel(requestId: requestId, now: Self.now())
            return state
        }
        browser?.cancel(requestId: requestId)
        if state.requests[requestId]?.operation == .gdmLogin {
            try Self.waitForAsync { await self.jetKVM.cancel() }
        }
    }

    public func listGrants(peer: BrokerPeer) throws -> [Grant] {
        try peerValidator.validateControlPeer(peer)
        return try stateStore.read()?.grants.values.sorted { $0.grantId < $1.grantId } ?? []
    }

    public func createGrant(proposal: BrokerGrantProposal, peer: BrokerPeer) throws -> String {
        try peerValidator.validateControlPeer(peer)
        try proposal.validate()
        let grantId = UUID().uuidString.lowercased()
        let authorization = try controlBiometric(.grantCreation, scope: .createGrant(grantId: grantId))
        let internalProposal = try makeGrantProposal(proposal, grantId: grantId)
        _ = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try state.createGrant(internalProposal, authorization: authorization, policy: policy, runtime: runtime, now: Self.now())
            return state
        }
        return grantId
    }

    public func expandGrant(grantId: String, proposal: BrokerGrantProposal, peer: BrokerPeer) throws -> String {
        try peerValidator.validateControlPeer(peer)
        try proposal.validate()
        let authorization = try controlBiometric(.grantExpansion, scope: .expandGrant(grantId: grantId))
        let internalProposal = try makeGrantProposal(proposal, grantId: grantId)
        _ = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try state.expandGrant(internalProposal, authorization: authorization, policy: policy, runtime: runtime, now: Self.now())
            return state
        }
        return grantId
    }

    public func revokeGrant(grantId: String, peer: BrokerPeer) throws {
        try peerValidator.validateControlPeer(peer)
        _ = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try revokeGrant(in: &state, grantId: grantId, now: Self.now())
            return state
        }
    }

    public func expireGrant(grantId: String, peer: BrokerPeer) throws {
        try peerValidator.validateControlPeer(peer)
        _ = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try expireGrant(in: &state, grantId: grantId)
            return state
        }
    }

    public func enrollCredential(
        kind: BrokerCredentialKind,
        credentialId: String,
        secret: BrokerSecret,
        peer: BrokerPeer
    ) throws -> String {
        try peerValidator.validateControlPeer(peer)
        guard policy.document.credentialTargets.contains(where: { $0.credentialId == credentialId }) else {
            throw RemoteAuthProtocolError(.targetMismatch)
        }
        let evidence = try authorizeBiometric(.credentialEnrollment)
        try secret.withMutableBytes { bytes in
            _ = try keychain.enrollCredential(
                kind: KeychainCredentialKind(kind),
                credentialID: credentialId,
                secret: &bytes,
                evidence: evidence
            )
        }
        return credentialId
    }

    public func forgetCredential(credentialId: String, peer: BrokerPeer) throws {
        try peerValidator.validateControlPeer(peer)
        _ = try keychain.forgetCredential(credentialID: credentialId)
    }

    public func emergencyDisable(reason: String, peer: BrokerPeer) throws {
        try peerValidator.validateControlPeer(peer)
        _ = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try state.emergencyDisable(reasonCode: reason, now: Self.now())
            return state
        }
        browser?.cancelAll()
        try Self.waitForAsync { await self.jetKVM.cancel() }
    }

    public func reEnable(peer: BrokerPeer) throws {
        try peerValidator.validateControlPeer(peer)
        let transactionId = UUID().uuidString.lowercased()
        let authorization = try controlBiometric(.reEnable, scope: .reenable(transactionId: transactionId))
        _ = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try state.beginReenable(transactionId: transactionId, authorization: authorization, policy: policy, runtime: runtime, now: Self.now())
            try state.commitReenable(transactionId: transactionId, policy: policy, runtime: runtime, now: Self.now())
            return state
        }
    }

    public static func browserTarget(for target: ExecutionTarget) throws -> BrowserTargetIdentity {
        switch target {
        case .bitwarden(let value):
            return BrowserTargetIdentity(
                bitwardenTargetID: value.browserTargetId,
                windowID: value.windowId
            )
        case .website(let value):
            return BrowserTargetIdentity(
                websiteActiveTabID: value.activeTabId,
                windowID: value.foregroundWindowId,
                topFrameID: value.frameId,
                formActionOrigin: value.formActionOrigin
            )
        case .gdm, .sudo:
            throw RemoteAuthProtocolError(.targetMismatch)
        }
    }

    private func begin(
        _ request: ExecutionRequest,
        peer: PeerMatchInput,
        browserGeneration: UInt64?,
        biometric: BiometricAuthorization?
    ) throws {
        _ = try stateStore.transaction { current in
            var state = current ?? AuthorityState()
            _ = try state.admit(
                request,
                peer: peer,
                policy: policy,
                runtime: runtime,
                receiptId: UUID().uuidString.lowercased(),
                browserTargetGeneration: browserGeneration,
                now: Self.now()
            )
            switch request.authorizationModeRequested {
            case .delegated:
                _ = try state.authorizeDelegated(requestId: request.requestId, policy: policy, runtime: runtime, now: Self.now())
            case .biometricOneShot:
                guard let biometric else { throw RemoteAuthProtocolError(.grantInvalid) }
                _ = try state.authorizeBiometricOneShot(requestId: request.requestId, authorization: biometric, policy: policy, runtime: runtime, now: Self.now())
            }
            _ = try state.beginExecution(requestId: request.requestId, policy: policy, runtime: runtime, now: Self.now())
            return state
        }
    }

    private func perform(_ request: ExecutionRequest, browserGeneration: UInt64?) throws -> TargetReleaseDisposition {
        switch request.target {
        case .gdm(let target):
            try performGDM(request, target: target)
            return .notApplicable
        case .sudo:
            try performSudo(request)
            return .notApplicable
        case .bitwarden(let target):
            guard let browser, let generation = browserGeneration else {
                throw RemoteAuthProtocolError(.unavailable)
            }
            let credentialId = try bitwardenCredentialId(target)
            let identity = try Self.browserTarget(for: request.target)
            try markRemoteReleased(request.requestId)
            return try keychain.withCredential(credentialID: credentialId, expectedKind: .bitwarden) { bytes in
                let secret = try BrowserSecret(taking: &bytes)
                return try Self.waitForAsync {
                    try await browser.unlock(requestId: request.requestId, generation: generation, target: identity, secret: secret)
                }
            }
        case .website(let target):
            guard let browser, let generation = browserGeneration else {
                throw RemoteAuthProtocolError(.unavailable)
            }
            let policyTarget = try websiteCredentialTarget(target)
            let identity = try Self.browserTarget(for: request.target)
            try markRemoteReleased(request.requestId)
            return try keychain.withCredential(credentialID: policyTarget.unlockCredentialId, expectedKind: .bitwarden) { bytes in
                let unlockSecret = try BrowserSecret(taking: &bytes)
                return try Self.waitForAsync {
                    try await browser.autofill(
                        requestId: request.requestId,
                        generation: generation,
                        target: identity,
                        originSet: target.originSet,
                        credentialAlias: policyTarget.credentialId,
                        unlockSecret: unlockSecret
                    )
                }
            }
        }
    }

    private func performGDM(_ request: ExecutionRequest, target: GDMTarget) throws {
        guard let verifier = policy.document.verifiers.gdm else {
            throw RemoteAuthProtocolError(.challengeInvalid)
        }
        let token = try Self.randomBytes(count: 32)
        let issueId = AuthorityBase64URL.encode(Data(token))
        let sentinel = "gdm-broker-v1:\(issueId)"
        var sequence = GDMExecutionSequence()

        let challenge = try sequence.perform(.verifierChallenge) {
            let challenge = try gdmEndpoint.issueGDMChallenge()
            guard challenge.bootId == target.bootId,
                  challenge.policyDigest == policy.digest
            else {
                throw RemoteAuthProtocolError(.challengeInvalid)
            }
            return challenge
        }
        let recipientKey = try AuthorityBase64URL.decode(verifier.recipientPublicKey)
        let envelope = try sequence.perform(.keychainEnvelope) {
            try keychain.withGDMCredential { password in
                try crypto.makeGDMEnvelope(
                    for: request,
                    challenge: challenge,
                    issueID: issueId,
                    sentinel: sentinel,
                    password: &password,
                    recipientKeyID: verifier.recipientKeyId,
                    recipientPublicKey: recipientKey
                )
            }
        }
        _ = try sequence.perform(.forcedEndpointIngest) {
            try gdmEndpoint.ingestGDMEnvelope(envelope)
        }
        try sequence.perform(.markReleased) {
            try markRemoteReleased(request.requestId)
        }
        try sequence.perform(.sentinelActuation) {
            try Self.waitForAsync {
                try await self.jetKVM.typeGDMSentinel(
                    sentinel,
                    expectedGeneration: target.controllerGeneration
                )
            }
        }
        try sequence.perform(.authenticatedCompletion) {
            try gdmEndpoint.waitForGDMAuthentication(
                requestId: request.requestId,
                issueId: issueId,
                nonce: request.nonce,
                expiresAtMilliseconds: request.expiresAt
            )
        }
    }

    private func performSudo(_ request: ExecutionRequest) throws {
        guard let sudoEndpoint else {
            throw RemoteAuthProtocolError(.inactive)
        }
        let signed = try crypto.makeSudoSignedRequest(for: request)
        switch try sudoEndpoint.executeSudo(signed) {
        case .succeeded:
            return
        case .failed:
            throw RemoteAuthProtocolError(.executionFailed)
        case .rejected(_, let error):
            throw RemoteAuthProtocolError(error)
        }
    }

    private func markRemoteReleased(_ requestId: String) throws {
        _ = try stateStore.transaction { current in
            guard var state = current else { throw RemoteAuthProtocolError(.integrityFailure) }
            _ = try state.markRemoteReleased(requestId: requestId, policy: policy, runtime: runtime, now: Self.now())
            return state
        }
    }

    private func finish(
        requestId: String,
        outcome: RemoteExecutionOutcome,
        releaseDisposition: TargetReleaseDisposition
    ) throws -> ReceiptMetadata {
        let state = try stateStore.transaction { current in
            guard var state = current else { throw RemoteAuthProtocolError(.integrityFailure) }
            _ = try state.complete(requestId: requestId, outcome: outcome, releaseDisposition: releaseDisposition, now: Self.now())
            return state
        }
        return try state.receipt(for: requestId)
    }

    private func executionBiometricAuthorization(_ request: ExecutionRequest) throws -> BiometricAuthorization? {
        guard request.authorizationModeRequested == .biometricOneShot else { return nil }
        let evidence = try authorizeBiometric(.destructiveOneShot)
        let digest = ProtocolCrypto.sha256Hex(try ProtocolTranscript.executionRequest(request))
        return BiometricAuthorization(
            evidenceId: evidence.evidenceID,
            evaluatedAt: evidence.evaluatedAtMillis,
            scope: .execution(requestId: request.requestId, bodyDigest: digest)
        )
    }

    private func authorizeBiometric(_ operation: BiometricOperation) throws -> BiometricEvidence {
        try Self.waitForAsync { try await self.biometric.authorize(operation) }
    }

    private func controlBiometric(
        _ operation: BiometricOperation,
        scope: BiometricAuthorizationScope
    ) throws -> BiometricAuthorization {
        let evidence = try authorizeBiometric(operation)
        return BiometricAuthorization(evidenceId: evidence.evidenceID, evaluatedAt: evidence.evaluatedAtMillis, scope: scope)
    }

    private func makeGrantProposal(_ proposal: BrokerGrantProposal, grantId: String) throws -> GrantProposal {
        let now = Self.now()
        let duration = proposal.durationSeconds.multipliedReportingOverflow(by: 1_000)
        let expires = now.addingReportingOverflow(duration.partialValue)
        guard !duration.overflow, !expires.overflow else { throw RemoteAuthProtocolError(.grantInvalid) }
        return GrantProposal(
            grantId: grantId,
            principalSelector: proposal.principalSelector,
            domain: proposal.domain,
            operation: proposal.operation,
            targetPredicate: proposal.targetPredicate,
            riskCeiling: proposal.riskCeiling,
            expiresAt: expires.partialValue
        )
    }

    private func revokeGrant(in state: inout AuthorityState, grantId: String, now: UInt64) throws -> Grant {
        if let grant = state.grants.values.first(where: { $0.grantId == grantId && $0.lifecycleState == .active }) {
            return try state.revokeGrant(domain: grant.domain, grantId: grantId, now: now)
        }
        throw RemoteAuthProtocolError(.grantInvalid)
    }

    private func expireGrant(in state: inout AuthorityState, grantId: String) throws -> Grant {
        if let grant = state.grants.values.first(where: { $0.grantId == grantId && $0.lifecycleState == .active }) {
            return try state.expireGrant(domain: grant.domain, grantId: grantId)
        }
        throw RemoteAuthProtocolError(.grantInvalid)
    }


    private func bitwardenCredentialId(_ target: BitwardenTarget) throws -> String {
        for entry in policy.document.credentialTargets {
            guard case .bitwardenUnlock(let value) = entry,
                  value.browserProfileId == target.profileIdentity,
                  value.extensionId == target.extensionId,
                  value.extensionVersion == target.extensionVersion,
                  value.extensionManifestDigest == target.manifestDigest
            else { continue }
            return value.credentialId
        }
        throw RemoteAuthProtocolError(.targetMismatch)
    }

    private func websiteCredentialTarget(_ target: WebsiteTarget) throws -> WebsiteCredentialTargetPolicy {
        for entry in policy.document.credentialTargets {
            guard case .websiteAutofill(let value) = entry,
                  value.pairingId == target.credentialPairingId,
                  value.browserProfileId == target.profileIdentity,
                  value.extensionId == target.extensionId,
                  target.originSet == [value.origin.serialized]
            else { continue }
            return value
        }
        throw RemoteAuthProtocolError(.targetMismatch)
    }

    private static func browserGeneration(_ request: ExecutionRequest) throws -> UInt64? {
        switch request.target {
        case .bitwarden(let target):
            guard target.chromePid > 0 else { throw RemoteAuthProtocolError(.targetMismatch) }
            return UInt64(target.chromePid)
        case .website(let target):
            guard target.chromePid > 0 else { throw RemoteAuthProtocolError(.targetMismatch) }
            return UInt64(target.chromePid)
        case .gdm, .sudo:
            return nil
        }
    }

    private func registerExecution(_ requestId: String) -> Bool {
        executionLock.lock()
        defer { executionLock.unlock() }
        return executing.insert(requestId).inserted
    }

    private func unregisterExecution(_ requestId: String) {
        executionLock.lock()
        executing.remove(requestId)
        executionLock.unlock()
    }

    private static func publicError(_ error: Error) -> PublicError {
        if let error = error as? RemoteAuthProtocolError { return error.publicError }
        if let error = error as? RemoteEndpointError {
            switch error {
            case .timeout: return .timeout
            case .remoteRejected(let value): return value ?? .executionFailed
            case .requestMismatch, .pinnedHostKeyMismatch, .wrongForcedPrincipal: return .integrityFailure
            case .invalidFrame, .invalidResponse, .responseTooLarge: return .protocolInvalid
            case .invalidConfiguration, .transportRejected: return .unavailable
            }
        }
        if let error = error as? BrowserControllerError {
            switch error {
            case .timeout: return .timeout
            case .cancelled: return .cancelled
            case .unavailable, .transportRejected, .operationInProgress: return .unavailable
            case .targetIdentityMismatch, .targetOriginMismatch, .requestBindingMismatch, .targetGenerationInvalid: return .targetMismatch
            default: return .executionFailed
            }
        }
        if let error = error as? JetKVMCloudError {
            switch error {
            case .timeout: return .timeout
            case .cancelled: return .cancelled
            case .unavailable, .transportRejected, .operationInProgress, .leaseActive, .shutdown: return .unavailable
            case .targetRejected, .staleLease: return .targetMismatch
            default: return .executionFailed
            }
        }
        if error is KeychainAuthorityError { return .unavailable }
        if error is CryptoAuthorityError { return .integrityFailure }
        if error is BiometricAuthorityError { return .grantInvalid }
        return .internal
    }

    private static func now() -> UInt64 {
        let milliseconds = Date().timeIntervalSince1970 * 1_000
        return milliseconds > 0 && milliseconds < Double(UInt64.max) ? UInt64(milliseconds) : 0
    }

    private static func randomBytes(count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw RemoteAuthProtocolError(.internal)
        }
        return bytes
    }

    @discardableResult
    private static func waitForAsync<T: Sendable>(
        _ operation: @escaping @Sendable () async throws -> T
    ) throws -> T {
        let result = LockedAsyncResult<T>()
        let semaphore = DispatchSemaphore(value: 0)
        Task.detached {
            do { result.store(.success(try await operation())) }
            catch { result.store(.failure(error)) }
            semaphore.signal()
        }
        semaphore.wait()
        return try result.take().get()
    }
}

private final class LockedAsyncResult<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, Error>?

    func store(_ result: Result<Value, Error>) {
        lock.lock()
        self.result = result
        lock.unlock()
    }

    func take() -> Result<Value, Error> {
        lock.lock()
        defer { lock.unlock() }
        return result ?? .failure(RemoteAuthProtocolError(.internal))
    }
}
