import Foundation

public actor RemoteAuthJetKVMCloudController {
    private static let readinessPollSeconds = 0.1
    private static let terminationGraceMilliseconds = 2_000

    static let frontendResetExpression = #"""
    (() => {
      "use strict";
      const trap = document.querySelector("#videoFocusTrap");
      if (!(trap instanceof HTMLElement)) return false;
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      trap.focus({ preventScroll: true });
      return document.activeElement === trap;
    })()
    """#

    private let configuration: JetKVMCloudConfiguration
    private let limits: CloudCDPLimits
    private var lifecycle = CloudControllerStateMachine()
    private var process: ChromePipeProcess?
    private var connection: CDPNullPipeConnection?
    private var targetIdentifier: String?
    private var sessionIdentifier: String?
    private var frontendAttested = false
    private var activeOperationGeneration: UInt64?
    private var releaseTask: Task<JetKVMCloudReceipt, Never>?

    public init(configuration: JetKVMCloudConfiguration) throws {
        self.configuration = configuration
        try FrontendAttestation.validatePinnedSource(
            commit: configuration.vendoredFrontendCommit,
            digest: configuration.vendoredFrontendDigest
        )
        limits = try CloudCDPLimits(
            maximumMessageBytes: configuration.maximumCDPMessageBytes,
            maximumJSONDepth: configuration.maximumCDPJSONDepth,
            maximumJSONNodes: configuration.maximumCDPJSONNodes,
            maximumJSONStringBytes: configuration.maximumCDPJSONStringBytes,
            maximumIgnoredEventCount: configuration.maximumQueuedEvents,
            maximumIgnoredEventBytes: configuration.maximumQueuedEventBytes
        )
    }

    public func acquire() async throws -> JetKVMCloudLease {
        guard releaseTask == nil, activeOperationGeneration == nil else {
            throw JetKVMCloudError.operationInProgress
        }
        switch lifecycle.phase {
        case .idle:
            try lifecycle.beginConnecting()
        case .recoveryRequired:
            try lifecycle.beginRecovery()
        case .leased:
            throw JetKVMCloudError.leaseActive
        case .shutdown:
            throw JetKVMCloudError.shutdown
        case .connecting, .ready:
            throw JetKVMCloudError.operationInProgress
        }

        await tearDown(closeTarget: false)
        do {
            try Task.checkCancellation()
            let child = try ChromePipeProcess(
                executablePath: configuration.chromeExecutablePath,
                profileDirectoryPath: configuration.profileDirectoryPath,
                initialURL: "about:blank"
            )
            process = child

            let pipe = try CDPNullPipeConnection(process: child, limits: limits)
            connection = pipe

            let target = try await solePageTarget(
                expectedURL: "about:blank",
                timeoutSeconds: configuration.launchTimeoutSeconds
            )
            targetIdentifier = target
            sessionIdentifier = try await attach(to: target)
            try await installDeterministicICEBootstrap()
            try await navigateToDevice()

            try await waitUntilReady()
            try await sleep(seconds: configuration.replacementGraceSeconds)
            try await attestCurrentTarget()
            try await attestTLSIdentity()
            try await requireReadySnapshot()
            try await resetInputState()
            try await attestCurrentTarget()
            try await attestTLSIdentity()
            try await requireReadySnapshot()

            try lifecycle.markReady()
            return try lifecycle.acquireLease()
        } catch {
            let bounded = Self.bounded(error)
            await failClosed()
            throw bounded
        }
    }

    public func typeGDMSentinel(
        _ sentinel: String,
        lease: JetKVMCloudLease
    ) async throws -> JetKVMCloudReceipt {
        try lifecycle.validate(lease)
        guard releaseTask == nil, activeOperationGeneration == nil else {
            throw JetKVMCloudError.operationInProgress
        }
        guard GDMSentinelValidation.isValid(sentinel) else {
            throw JetKVMCloudError.sentinelInvalid
        }
        let plan = try SentinelKeyPlan(
            sentinel: sentinel,
            keyDelayMilliseconds: Self.milliseconds(configuration.keyIntervalSeconds)
        )
        var operation = SentinelSubmissionLifecycle(
            plan: plan,
            generation: lease.generation
        )
        activeOperationGeneration = lease.generation
        defer {
            if activeOperationGeneration == lease.generation {
                activeOperationGeneration = nil
            }
        }

        do {
            try Task.checkCancellation()
            try await attestCurrentTarget()
            try await attestTLSIdentity()
            try await requireReadySnapshot()
            while let event = try operation.nextSentinelEvent(
                activeGeneration: activeOperationGeneration
            ) {
                try lifecycle.validate(lease)
                try await dispatch(event)
            }

            try await attestCurrentTarget()
            try await attestTLSIdentity()
            try await requireReadySnapshot()
            try lifecycle.validate(lease)
            try operation.authorizeSubmission(
                activeGeneration: activeOperationGeneration
            )
            while let event = try operation.nextSubmissionEvent(
                activeGeneration: activeOperationGeneration
            ) {
                try lifecycle.validate(lease)
                try await dispatch(event)
            }
            return JetKVMCloudReceipt.sentinelTyped(for: lease)
        } catch {
            operation.fail()
            let bounded = Self.bounded(error)
            await failClosed()
            throw bounded
        }
    }

    public func release(_ lease: JetKVMCloudLease) async -> JetKVMCloudReceipt {
        if let releaseTask {
            guard (try? lifecycle.validate(lease)) != nil else {
                return lifecycle.release(lease)
            }
            return await releaseTask.value
        }
        do {
            try lifecycle.validate(lease)
        } catch {
            return lifecycle.release(lease)
        }
        if activeOperationGeneration != nil {
            await failClosed()
            return lifecycle.release(lease)
        }

        let task = Task { await self.performRelease(lease) }
        releaseTask = task
        let receipt = await task.value
        releaseTask = nil
        return receipt
    }

    private func performRelease(_ lease: JetKVMCloudLease) async -> JetKVMCloudReceipt {
        activeOperationGeneration = lease.generation
        defer {
            if activeOperationGeneration == lease.generation {
                activeOperationGeneration = nil
            }
        }
        do {
            try await attestCurrentTarget()
            try await attestTLSIdentity()
            try await requireReadySnapshot()
            try await resetInputState()
            try await requireReadySnapshot()
            try await closeCurrentTarget()
            closeProcess()
            frontendAttested = false
            return lifecycle.release(lease)
        } catch {
            await failClosed()
            return lifecycle.release(lease)
        }
    }

    public func shutdown() async {
        guard lifecycle.phase != .shutdown else { return }
        if let releaseTask {
            _ = await releaseTask.value
            self.releaseTask = nil
        }
        if connection != nil, sessionIdentifier != nil {
            do {
                try await attestCurrentTarget()
                try await attestTLSIdentity()
                try await requireReadySnapshot()
                try await resetInputState()
            } catch {
                // Shutdown remains fail closed: no unverified target receives HID.
            }
        }
        await tearDown(closeTarget: true)
        activeOperationGeneration = nil
        lifecycle.shutdown()
    }

    public func status() -> JetKVMCloudStatus {
        let base = lifecycle.status
        return JetKVMCloudStatus(
            phase: base.phase,
            generation: base.generation,
            processActive: process != nil,
            targetActive: targetIdentifier != nil,
            frontendAttested: frontendAttested
        )
    }

    private func solePageTarget(
        expectedURL: String,
        timeoutSeconds: Double
    ) async throws -> String {
        guard let pipe = connection else { throw JetKVMCloudError.transportRejected }
        let response = try await pipe.request(
            method: "Target.getTargets",
            params: nil,
            sessionIdentifier: nil,
            timeoutSeconds: timeoutSeconds
        )
        let root = try Self.object(response)
        guard root.keys.count == 1,
              case let .array(targets)? = root["targetInfos"]
        else {
            throw JetKVMCloudError.targetRejected
        }

        var pageIdentifier: String?
        var pageCount = 0
        for value in targets {
            let target = try Self.object(value)
            guard case let .string(type)? = target["type"] else {
                throw JetKVMCloudError.targetRejected
            }
            guard type == "page" else { continue }
            pageCount += 1
            guard case let .string(identifier)? = target["targetId"],
                  !identifier.isEmpty,
                  case let .string(url)? = target["url"],
                  url == expectedURL
            else {
                throw JetKVMCloudError.targetRejected
            }
            pageIdentifier = identifier
        }
        guard pageCount == 1, let pageIdentifier else {
            throw JetKVMCloudError.targetRejected
        }
        return pageIdentifier
    }

    private func attach(to target: String) async throws -> String {
        guard let pipe = connection else { throw JetKVMCloudError.transportRejected }
        let response = try await pipe.request(
            method: "Target.attachToTarget",
            params: [
                "targetId": .string(target),
                "flatten": .boolean(true),
            ],
            sessionIdentifier: nil,
            timeoutSeconds: configuration.cdpTimeoutSeconds
        )
        let root = try Self.object(response)
        guard root.keys.count == 1,
              case let .string(session)? = root["sessionId"],
              !session.isEmpty
        else {
            throw JetKVMCloudError.targetRejected
        }
        return session
    }

    private func installDeterministicICEBootstrap() async throws {
        guard let pipe = connection, let session = sessionIdentifier else {
            throw JetKVMCloudError.transportRejected
        }
        let response = try await pipe.request(
            method: "Page.addScriptToEvaluateOnNewDocument",
            params: [
                "source": .string(FrontendAttestation.deterministicICEBootstrapExpression),
            ],
            sessionIdentifier: session,
            timeoutSeconds: configuration.cdpTimeoutSeconds
        )
        let root = try Self.object(response)
        guard root.keys.count == 1,
              case let .string(identifier)? = root["identifier"],
              !identifier.isEmpty,
              identifier.utf8.count <= 256
        else {
            throw JetKVMCloudError.frontendAttestationRejected
        }
    }

    private func navigateToDevice() async throws {
        guard let pipe = connection, let session = sessionIdentifier else {
            throw JetKVMCloudError.transportRejected
        }
        let response = try await pipe.request(
            method: "Page.navigate",
            params: ["url": .string(configuration.deviceURL.absoluteString)],
            sessionIdentifier: session,
            timeoutSeconds: configuration.launchTimeoutSeconds
        )
        let root = try Self.object(response)
        let allowed = Set(["frameId", "loaderId", "errorText", "isDownload"])
        guard root.keys.allSatisfy(allowed.contains),
              case let .string(frameIdentifier)? = root["frameId"],
              !frameIdentifier.isEmpty,
              frameIdentifier.utf8.count <= 256,
              root["errorText"] == nil
        else {
            throw JetKVMCloudError.targetRejected
        }
        if let loader = root["loaderId"] {
            guard case let .string(identifier) = loader,
                  !identifier.isEmpty,
                  identifier.utf8.count <= 256
            else {
                throw JetKVMCloudError.targetRejected
            }
        }
        if let download = root["isDownload"] {
            guard case .boolean(false) = download else {
                throw JetKVMCloudError.targetRejected
            }
        }
    }

    private func attestTLSIdentity() async throws {
        guard let pipe = connection, let session = sessionIdentifier else {
            throw JetKVMCloudError.transportRejected
        }
        let response = try await pipe.request(
            method: "Network.getCertificate",
            params: ["origin": .string("https://app.jetkvm.com")],
            sessionIdentifier: session,
            timeoutSeconds: configuration.cdpTimeoutSeconds
        )
        let root = try Self.object(response)
        guard root.keys.count == 1,
              case let .array(encodedChain)? = root["tableNames"]
        else {
            throw JetKVMCloudError.tlsIdentityRejected
        }
        let chain = try encodedChain.map { value -> String in
            guard case let .string(certificate) = value else {
                throw JetKVMCloudError.tlsIdentityRejected
            }
            return certificate
        }
        try TLSCertificateAttestation.attest(
            certificateChainBase64: chain,
            expectedSPKISHA256: configuration.tlsSPKISHA256
        )
    }

    private func attestCurrentTarget() async throws {
        guard let expectedTarget = targetIdentifier,
              sessionIdentifier != nil,
              let process,
              try process.pollExitStatus() == nil
        else {
            throw JetKVMCloudError.targetRejected
        }
        let actualTarget = try await solePageTarget(
            expectedURL: configuration.deviceURL.absoluteString,
            timeoutSeconds: configuration.cdpTimeoutSeconds
        )
        guard actualTarget == expectedTarget else {
            throw JetKVMCloudError.targetRejected
        }
    }

    private func waitUntilReady() async throws {
        let deadline = ProcessInfo.processInfo.systemUptime + configuration.readinessTimeoutSeconds
        while true {
            try Task.checkCancellation()
            try await attestCurrentTarget()
            let snapshot = try await frontendSnapshot()
            switch snapshot.state {
            case .ready:
                try snapshot.attest()
                guard snapshot.isAttested else {
                    throw JetKVMCloudError.frontendAttestationRejected
                }
                try FrontendAttestation.attestAssetManifest(
                    snapshot.assetURLs,
                    expectedSHA256: configuration.frontendAssetManifestSHA256
                )
                frontendAttested = true
                return
            case .waiting:
                guard ProcessInfo.processInfo.systemUptime < deadline else {
                    throw JetKVMCloudError.frontendNotReady
                }
                try await sleep(seconds: min(
                    Self.readinessPollSeconds,
                    max(0, deadline - ProcessInfo.processInfo.systemUptime)
                ))
            case .loginRequired:
                throw JetKVMCloudError.loginRequired
            case .takeoverRequired:
                throw JetKVMCloudError.takeoverRequired
            case .rejected:
                throw JetKVMCloudError.frontendAttestationRejected
            }
        }
    }

    private func requireReadySnapshot() async throws {
        try Task.checkCancellation()
        let snapshot = try await frontendSnapshot()
        switch snapshot.state {
        case .ready:
            try snapshot.attest()
            guard snapshot.isAttested else {
                throw JetKVMCloudError.frontendAttestationRejected
            }
            try FrontendAttestation.attestAssetManifest(
                snapshot.assetURLs,
                expectedSHA256: configuration.frontendAssetManifestSHA256
            )
            frontendAttested = true
        case .loginRequired:
            throw JetKVMCloudError.loginRequired
        case .takeoverRequired:
            throw JetKVMCloudError.takeoverRequired
        case .waiting:
            throw JetKVMCloudError.frontendNotReady
        case .rejected:
            throw JetKVMCloudError.frontendAttestationRejected
        }
    }

    private func frontendSnapshot() async throws -> FrontendSnapshot {
        let value = try await evaluate(
            expression: FrontendAttestation.runtimeEvaluateExpression,
            expectedType: "object"
        )
        return try FrontendSnapshot(cdpValue: value)
    }

    private func resetInputState() async throws {
        for event in SentinelKeyPlan.resetKeyUps {
            try await dispatch(event)
        }
        let value = try await evaluate(
            expression: Self.frontendResetExpression,
            expectedType: "boolean"
        )
        guard case .boolean(true) = value else {
            throw JetKVMCloudError.inputDispatchRejected
        }
    }

    private func dispatch(_ event: SentinelKeyEventDescriptor) async throws {
        guard let pipe = connection, let session = sessionIdentifier else {
            throw JetKVMCloudError.transportRejected
        }
        try Task.checkCancellation()

        var parameters: [String: CloudCDPValue] = [
            "type": .string(event.type.rawValue),
            "key": .string(event.key),
            "code": .string(event.code),
            "windowsVirtualKeyCode": .integer(Int64(event.windowsVirtualKeyCode)),
            "nativeVirtualKeyCode": .integer(Int64(event.windowsVirtualKeyCode)),
            "location": .integer(Int64(event.location)),
            "modifiers": .integer(Int64(event.modifiers)),
            "autoRepeat": .boolean(false),
            "isKeypad": .boolean(false),
            "isSystemKey": .boolean(false),
        ]
        if let text = event.text { parameters["text"] = .string(text) }
        if let unmodifiedText = event.unmodifiedText {
            parameters["unmodifiedText"] = .string(unmodifiedText)
        }

        let response = try await pipe.request(
            method: "Input.dispatchKeyEvent",
            params: parameters,
            sessionIdentifier: session,
            timeoutSeconds: configuration.cdpTimeoutSeconds
        )
        guard case let .object(result) = response, result.isEmpty else {
            throw JetKVMCloudError.inputDispatchRejected
        }
        if event.delayAfterMilliseconds > 0 {
            try await sleep(seconds: Double(event.delayAfterMilliseconds) / 1_000)
        }
    }

    private func evaluate(expression: String, expectedType: String) async throws -> CloudCDPValue {
        guard let pipe = connection, let session = sessionIdentifier else {
            throw JetKVMCloudError.transportRejected
        }
        let response = try await pipe.request(
            method: "Runtime.evaluate",
            params: [
                "expression": .string(expression),
                "returnByValue": .boolean(true),
                "awaitPromise": .boolean(false),
                "userGesture": .boolean(false),
            ],
            sessionIdentifier: session,
            timeoutSeconds: configuration.cdpTimeoutSeconds
        )
        let evaluation = try Self.object(response)
        guard evaluation.keys.count == 1,
              case let .object(remote)? = evaluation["result"],
              remote.keys.count == 2,
              case let .string(type)? = remote["type"],
              type == expectedType,
              remote["subtype"] == nil,
              remote["unserializableValue"] == nil,
              remote["description"] == nil,
              let value = remote["value"]
        else {
            throw JetKVMCloudError.cdpEvaluationRejected
        }
        return value
    }

    private func closeCurrentTarget() async throws {
        guard let pipe = connection, let target = targetIdentifier else {
            throw JetKVMCloudError.transportRejected
        }
        let response = try await pipe.request(
            method: "Target.closeTarget",
            params: ["targetId": .string(target)],
            sessionIdentifier: nil,
            timeoutSeconds: configuration.cdpTimeoutSeconds
        )
        let root = try Self.object(response)
        guard root.keys.count == 1,
              case .boolean(true)? = root["success"]
        else {
            throw JetKVMCloudError.targetRejected
        }
        targetIdentifier = nil
        sessionIdentifier = nil
    }

    private func failClosed() async {
        await tearDown(closeTarget: true)
        lifecycle.recordInterruption()
    }

    private func tearDown(closeTarget: Bool) async {
        if closeTarget, let pipe = connection, let target = targetIdentifier {
            _ = try? await pipe.request(
                method: "Target.closeTarget",
                params: ["targetId": .string(target)],
                sessionIdentifier: nil,
                timeoutSeconds: configuration.cdpTimeoutSeconds
            )
        }
        targetIdentifier = nil
        sessionIdentifier = nil
        frontendAttested = false
        closeProcess()
    }

    private func closeProcess() {
        connection?.close()
        connection = nil
        process?.closeTransport()
        try? process?.terminateAndWait(graceMilliseconds: Self.terminationGraceMilliseconds)
        process = nil
    }

    private func sleep(seconds: Double) async throws {
        try Task.checkCancellation()
        guard seconds.isFinite, seconds >= 0 else {
            throw JetKVMCloudError.configurationInvalid
        }
        if seconds == 0 { return }
        let nanoseconds = UInt64((seconds * 1_000_000_000).rounded(.up))
        try await Task<Never, Never>.sleep(nanoseconds: nanoseconds)
    }

    private static func milliseconds(_ seconds: Double) -> Int {
        Int((seconds * 1_000).rounded(.up))
    }


    private static func object(_ value: CloudCDPValue) throws -> [String: CloudCDPValue] {
        guard case let .object(object) = value else {
            throw JetKVMCloudError.invalidJSON
        }
        return object
    }

    private static func bounded(_ error: Error) -> JetKVMCloudError {
        if error is CancellationError || Task.isCancelled {
            return .cancelled
        }
        if let error = error as? JetKVMCloudError {
            return error
        }
        if error is ChromePipeProcessError {
            return .unavailable
        }
        guard let error = error as? CDPNullPipeError else {
            return .transportRejected
        }
        switch error {
        case .timedOut, .invalidTimeout:
            return .timeout
        case .messageTooLarge, .bufferedDataLimit:
            return .responseTooLarge
        case .malformedJSON:
            return .invalidJSON
        case .commandFailed:
            return .cdpCommandRejected
        case .invalidLimits, .invalidRequest, .emptyFrame, .protocolViolation,
             .responseMismatch, .identifierExhausted, .ignoredEventLimit,
             .transportClosed, .systemCall:
            return .transportRejected
        }
    }
}
