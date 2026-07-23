import Foundation

public actor RemoteBrowserController {
    private let configuration: BrowserControllerConfiguration
    private nonisolated let cancellation = BrowserCancellationRegistry()

    public init(configuration: BrowserControllerConfiguration) throws {
        try BrowserValidation.validate(configuration: configuration)
        self.configuration = configuration
    }

    public func unlockBitwarden(
        requestId: String,
        targetGeneration: UInt64,
        target: BrowserTargetIdentity,
        secret: BrowserSecret
    ) throws -> BrowserReleaseAttestation {
        let binding = try BrowserOperationBinding(
            requestID: requestId,
            targetGeneration: targetGeneration,
            target: target
        )
        try cancellation.begin(requestID: requestId)
        defer { cancellation.end(requestID: requestId) }

        do {
            return try performUnlock(binding: binding, secret: secret)
        } catch {
            throw Self.bounded(error)
        }
    }

    public func autofill(
        requestId: String,
        targetGeneration: UInt64,
        target: BrowserTargetIdentity,
        originSet: [String],
        credentialAlias: String,
        optionalSecretForUnlock: BrowserSecret? = nil
    ) throws -> BrowserReleaseAttestation {
        let request = try BrowserControllerRequest(
            requestID: requestId,
            targetGeneration: targetGeneration,
            target: target,
            allowedFormActionOrigins: originSet,
            itemAlias: credentialAlias
        )
        try cancellation.begin(requestID: requestId)
        defer { cancellation.end(requestID: requestId) }

        do {
            return try performAutofill(
                request: request,
                optionalSecretForUnlock: optionalSecretForUnlock
            )
        } catch {
            throw Self.bounded(error)
        }
    }

    public nonisolated func cancel(requestId: String) {
        cancellation.cancel(requestID: requestId)
    }

    public nonisolated func cleanup() {
        cancellation.cancelCurrent()
    }

    private func performUnlock(
        binding: BrowserOperationBinding,
        secret: BrowserSecret
    ) throws -> BrowserReleaseAttestation {
        var state = try BrowserStateMachine(
            requestID: binding.requestID,
            targetGeneration: binding.targetGeneration
        )
        let resources = try BrowserOperationResources(configuration: configuration)
        resources.addTarget(binding.target.targetID)
        defer { resources.shutdown() }

        try checkCancellation(binding.requestID)
        try resources.start()
        let host = try resources.attestHost(configuration: configuration)
        try checkCancellation(binding.requestID)

        let session = try resources.connect(configuration: configuration)
        let pageSessionID = try session.attach(targetID: binding.target.targetID)
        resources.addSession(pageSessionID)
        try session.enablePage(sessionID: pageSessionID)
        try state.transition(
            to: .attached,
            requestID: binding.requestID,
            targetGeneration: binding.targetGeneration
        )
        let boundTarget = try bindBitwardenTarget(
            binding.target,
            sessionID: pageSessionID,
            session: session
        )

        let popup = try openAttestedPopup(
            session: session,
            host: host,
            resources: resources,
            expectedWindowID: binding.target.windowID
        )
        try state.transition(
            to: .attested,
            requestID: binding.requestID,
            targetGeneration: binding.targetGeneration
        )
        try checkCancellation(binding.requestID)

        let prompt = try waitForUnlockPrompt(session: session, popupSessionID: popup.sessionID)
        _ = try BitwardenPopupCommandPlan.unlock(prompt: prompt)
        guard let inputPoint = prompt.inputPoint, let submitPoint = prompt.submitPoint else {
            throw BrowserControllerError.popupStateRejected
        }
        try session.click(inputPoint, sessionID: popup.sessionID)
        try attestBoundBitwardenTarget(
            boundTarget,
            sessionID: pageSessionID,
            session: session
        )
        try attestBoundBitwardenTarget(
            popup.boundTarget,
            sessionID: popup.sessionID,
            session: session
        )
        var secretBytes = try secret.take()
        defer { Self.zero(&secretBytes) }
        try checkCancellation(binding.requestID)
        try session.insertSecret(&secretBytes, sessionID: popup.sessionID)
        try session.click(submitPoint, sessionID: popup.sessionID)
        try state.transition(
            to: .inputDispatched,
            requestID: binding.requestID,
            targetGeneration: binding.targetGeneration
        )
        try waitForUnlockedVault(session: session, popupSessionID: popup.sessionID)
        try checkCancellation(binding.requestID)

        try resources.closeTarget(popup.targetID)
        try resources.closeTarget(binding.target.targetID)
        try state.transition(
            to: .closed,
            requestID: binding.requestID,
            targetGeneration: binding.targetGeneration
        )
        return try state.makeReleaseAttestation(
            navigationDestroyed: true,
            inputDestroyed: true,
            requestDestroyed: true,
            networkDestroyed: true
        )
    }

    private func performAutofill(
        request: BrowserControllerRequest,
        optionalSecretForUnlock: BrowserSecret?
    ) throws -> BrowserReleaseAttestation {
        guard let topFrameID = request.target.topFrameID else {
            throw BrowserControllerError.requestInvalid
        }
        var state = try BrowserStateMachine(
            requestID: request.requestID,
            targetGeneration: request.targetGeneration
        )
        let resources = try BrowserOperationResources(configuration: configuration)
        resources.addTarget(request.target.targetID)
        defer { resources.shutdown() }

        try checkCancellation(request.requestID)
        try resources.start()
        let host = try resources.attestHost(configuration: configuration)
        let session = try resources.connect(configuration: configuration)

        let pageSessionID = try session.attach(targetID: request.target.targetID)
        resources.addSession(pageSessionID)
        try session.enablePage(sessionID: pageSessionID)
        try state.transition(
            to: .attached,
            requestID: request.requestID,
            targetGeneration: request.targetGeneration
        )

        _ = session.drainEvents()
        let initial = try targetSnapshot(
            request: request,
            pageSessionID: pageSessionID,
            ledger: BrowserEventLedger(),
            session: session
        )
        try BrowserValidation.validate(target: initial, for: request)
        try BrowserValidation.validate(
            page: session.pageDOM(
                sessionID: pageSessionID,
                contextID: session.isolatedWorld(
                    frameID: topFrameID,
                    sessionID: pageSessionID
                )
            ),
            for: request
        )

        let popup = try openAttestedPopup(
            session: session,
            host: host,
            resources: resources,
            expectedWindowID: request.target.windowID
        )
        try state.transition(
            to: .attested,
            requestID: request.requestID,
            targetGeneration: request.targetGeneration
        )
        try checkCancellation(request.requestID)

        let route = try waitForPopupRoute(session: session, popupSessionID: popup.sessionID)
        if route == "/lock" {
            guard let optionalSecretForUnlock else {
                throw BrowserControllerError.popupStateRejected
            }
            let prompt = try waitForUnlockPrompt(session: session, popupSessionID: popup.sessionID)
            _ = try BitwardenPopupCommandPlan.unlock(prompt: prompt)
            guard let inputPoint = prompt.inputPoint, let submitPoint = prompt.submitPoint else {
                throw BrowserControllerError.popupStateRejected
            }
            try session.click(inputPoint, sessionID: popup.sessionID)
            try attestBoundBitwardenTarget(
                popup.boundTarget,
                sessionID: popup.sessionID,
                session: session
            )
            var secretBytes = try optionalSecretForUnlock.take()
            defer { Self.zero(&secretBytes) }
            try checkCancellation(request.requestID)
            try session.insertSecret(&secretBytes, sessionID: popup.sessionID)
            try session.click(submitPoint, sessionID: popup.sessionID)
            try state.transition(
                to: .inputDispatched,
                requestID: request.requestID,
                targetGeneration: request.targetGeneration
            )
            try waitForUnlockedVault(session: session, popupSessionID: popup.sessionID)
        } else if route != BrowserControllerContract.unlockedVaultRoute {
            throw BrowserControllerError.popupStateRejected
        }

        let searchPoint = try waitForSearchPoint(session: session, popupSessionID: popup.sessionID)
        try session.click(searchPoint, sessionID: popup.sessionID)
        try replaceFocusedText(request.itemAlias, sessionID: popup.sessionID, session: session)
        let selection = try waitForExactSelection(
            session: session,
            popupSessionID: popup.sessionID,
            alias: request.itemAlias
        )
        _ = try BitwardenPopupCommandPlan.autofill(
            selection: selection.result,
            alias: request.itemAlias
        )
        guard let fillPoint = selection.fillPoint else {
            throw BrowserControllerError.autofillSelectionRejected
        }

        var beforeLedger = BrowserEventLedger()
        beforeLedger.ingest(session.drainEvents(), targetID: request.target.targetID, sessionID: pageSessionID)
        let before = try targetSnapshot(
            request: request,
            pageSessionID: pageSessionID,
            ledger: beforeLedger,
            session: session
        )
        try BrowserValidation.validateStability(before: initial, after: before, for: request)
        let beforeContext = try session.isolatedWorld(
            frameID: topFrameID,
            sessionID: pageSessionID
        )
        try BrowserValidation.validate(
            page: session.pageDOM(sessionID: pageSessionID, contextID: beforeContext),
            for: request
        )
        try checkCancellation(request.requestID)

        try session.click(fillPoint, sessionID: popup.sessionID)
        try state.transition(
            to: .fillDispatched,
            requestID: request.requestID,
            targetGeneration: request.targetGeneration
        )
        try waitForClosedTarget(popup.targetID, session: session)
        resources.forgetTarget(popup.targetID)

        var afterLedger = beforeLedger
        afterLedger.ingest(session.drainEvents(), targetID: request.target.targetID, sessionID: pageSessionID)
        let after = try targetSnapshot(
            request: request,
            pageSessionID: pageSessionID,
            ledger: afterLedger,
            session: session
        )
        try BrowserValidation.validateStability(before: before, after: after, for: request)
        try checkCancellation(request.requestID)

        try resources.closeTarget(request.target.targetID)
        try state.transition(
            to: .closed,
            requestID: request.requestID,
            targetGeneration: request.targetGeneration
        )
        return try state.makeReleaseAttestation(
            navigationDestroyed: true,
            inputDestroyed: true,
            requestDestroyed: true,
            networkDestroyed: true
        )
    }

    private func bindBitwardenTarget(
        _ identity: BrowserTargetIdentity,
        sessionID: String,
        session: BrowserCDPSession
    ) throws -> BoundBitwardenTarget {
        try BrowserValidation.validate(bitwardenTarget: identity)
        let target = try session.target(identity.targetID)
        let frame = try session.frameSnapshot(sessionID: sessionID)
        try session.assertWindowID(
            targetID: identity.targetID,
            expectedWindowID: identity.windowID
        )
        let expectedOrigin = "chrome-extension://\(BrowserControllerContract.extensionID)"
        guard target.type == "page",
              target.attached,
              target.url.hasPrefix(expectedOrigin + "/"),
              frame.iframeCount == 0,
              try session.pageHasFocus(sessionID: sessionID, contextID: session.isolatedWorld(
                  frameID: frame.frameID,
                  sessionID: sessionID
              ))
        else { throw BrowserControllerError.targetIdentityMismatch }
        return BoundBitwardenTarget(
            targetID: identity.targetID,
            windowID: identity.windowID,
            topFrameID: frame.frameID,
            loaderID: frame.loaderID,
            origin: expectedOrigin
        )
    }

    private func attestBoundBitwardenTarget(
        _ boundTarget: BoundBitwardenTarget,
        sessionID: String,
        session: BrowserCDPSession
    ) throws {
        let target = try session.target(boundTarget.targetID)
        let frame = try session.frameSnapshot(sessionID: sessionID)
        try session.assertWindowID(
            targetID: boundTarget.targetID,
            expectedWindowID: boundTarget.windowID
        )
        guard target.type == "page",
              target.attached,
              target.url.hasPrefix(boundTarget.origin + "/"),
              frame.frameID == boundTarget.topFrameID,
              frame.loaderID == boundTarget.loaderID,
              frame.iframeCount == 0,
              try session.pageHasFocus(sessionID: sessionID, contextID: session.isolatedWorld(
                  frameID: frame.frameID,
                  sessionID: sessionID
              ))
        else { throw BrowserControllerError.targetIdentityMismatch }
    }

    private func openAttestedPopup(
        session: BrowserCDPSession,
        host: BrowserHostAttestation,
        resources: BrowserOperationResources,
        expectedWindowID: String
    ) throws -> (targetID: String, sessionID: String, boundTarget: BoundBitwardenTarget) {
        let targetID = try session.createBitwardenPopup()
        resources.addTarget(targetID)
        let target = try waitForPopupTarget(targetID, session: session)
        _ = try session.extensionRuntimeMetadata(target: target, hostMetadata: host.extensionMetadata)
        let sessionID = try session.attach(targetID: targetID)
        resources.addSession(sessionID)
        try session.enablePage(sessionID: sessionID)
        let identity = BrowserTargetIdentity(
            bitwardenTargetID: targetID,
            windowID: expectedWindowID
        )
        return (
            targetID,
            sessionID,
            try bindBitwardenTarget(identity, sessionID: sessionID, session: session)
        )
    }

    private func waitForPopupTarget(
        _ targetID: String,
        session: BrowserCDPSession
    ) throws -> BrowserCDPTarget {
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        let expectedPrefix = "chrome-extension://\(BrowserControllerContract.extensionID)/\(BrowserControllerContract.extensionDefaultPopup)"
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if let target = try session.targets().first(where: { $0.targetID == targetID }),
               target.type == "page",
               target.url.hasPrefix(expectedPrefix) {
                return target
            }
            usleep(10_000)
        }
        throw BrowserControllerError.timeout
    }

    private func waitForPopupRoute(
        session: BrowserCDPSession,
        popupSessionID: String
    ) throws -> String {
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            let result = try session.unlockDOM(sessionID: popupSessionID)
            switch result.route {
            case "/lock", "/login", BrowserControllerContract.unlockedVaultRoute:
                return result.route
            default:
                usleep(10_000)
            }
        }
        throw BrowserControllerError.timeout
    }

    private func waitForUnlockPrompt(
        session: BrowserCDPSession,
        popupSessionID: String
    ) throws -> BrowserUnlockDOMResult {
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            let result = try session.unlockDOM(sessionID: popupSessionID)
            if result.route == "/login" || result.route == BrowserControllerContract.unlockedVaultRoute {
                throw BrowserControllerError.popupStateRejected
            }
            if result.route == "/lock",
               result.passwordInputCount == 0,
               result.submitButtonCount == 0,
               result.warningCount == 0,
               result.errorCount == 0 {
                usleep(10_000)
                continue
            }
            if result.route == "/lock" {
                _ = try BitwardenPopupCommandPlan.unlock(prompt: result)
                return result
            }
            usleep(10_000)
        }
        throw BrowserControllerError.timeout
    }

    private func waitForUnlockedVault(
        session: BrowserCDPSession,
        popupSessionID: String
    ) throws {
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            let result = try session.unlockDOM(sessionID: popupSessionID)
            if result.route == BrowserControllerContract.unlockedVaultRoute,
               result.warningCount == 0,
               result.errorCount == 0,
               result.loggedOutIndicatorCount == 0,
               result.accountSwitcherCount == 0,
               result.passwordRepromptCount == 0 {
                return
            }
            if result.route == "/login" || result.warningCount > 0 || result.errorCount > 0 {
                throw BrowserControllerError.popupStateRejected
            }
            usleep(10_000)
        }
        throw BrowserControllerError.timeout
    }

    private func waitForSearchPoint(
        session: BrowserCDPSession,
        popupSessionID: String
    ) throws -> BrowserCDPPoint {
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            let value = try session.evaluate(
                Self.searchPointExpression,
                sessionID: popupSessionID
            )
            if let point = try Self.point(from: value) { return point }
            usleep(10_000)
        }
        throw BrowserControllerError.popupStateRejected
    }

    private func replaceFocusedText(
        _ text: String,
        sessionID: String,
        session: BrowserCDPSession
    ) throws {
        guard !text.isEmpty,
              text.utf8.count <= 256,
              !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        else { throw BrowserControllerError.requestInvalid }

        for type in ["rawKeyDown", "keyUp"] {
            _ = try session.connection.request(
                method: "Input.dispatchKeyEvent",
                params: [
                    "type": .string(type),
                    "modifiers": .integer(2),
                    "key": .string("a"),
                    "code": .string("KeyA"),
                ],
                sessionId: sessionID
            )
        }
        for type in ["rawKeyDown", "keyUp"] {
            _ = try session.connection.request(
                method: "Input.dispatchKeyEvent",
                params: [
                    "type": .string(type),
                    "key": .string("Backspace"),
                    "code": .string("Backspace"),
                ],
                sessionId: sessionID
            )
        }
        _ = try session.connection.request(
            method: "Input.insertText",
            params: ["text": .string(text)],
            sessionId: sessionID
        )
    }

    private func waitForExactSelection(
        session: BrowserCDPSession,
        popupSessionID: String,
        alias: String
    ) throws -> BrowserPopupSelection {
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        var lastError: BrowserControllerError = .autofillSelectionRejected
        while DispatchTime.now().uptimeNanoseconds < deadline {
            let selection = try session.popupSelection(sessionID: popupSessionID, alias: alias)
            do {
                try BrowserValidation.validate(popup: selection.result, expectedAlias: alias)
                return selection
            } catch let error as BrowserControllerError {
                switch error {
                case .autofillSelectionRejected:
                    lastError = error
                    usleep(10_000)
                default:
                    throw error
                }
            }
        }
        throw lastError
    }

    private func waitForClosedTarget(
        _ targetID: String,
        session: BrowserCDPSession
    ) throws {
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if try !session.targets().contains(where: { $0.targetID == targetID }) { return }
            usleep(10_000)
        }
        throw BrowserControllerError.releaseAttestationInvalid
    }

    private func targetSnapshot(
        request: BrowserControllerRequest,
        pageSessionID: String,
        ledger: BrowserEventLedger,
        session: BrowserCDPSession
    ) throws -> BrowserTargetSnapshot {
        guard let expectedFrameID = request.target.topFrameID,
              let expectedOrigin = request.target.origin
        else { throw BrowserControllerError.requestInvalid }
        let target = try session.target(request.target.targetID)
        let frame = try session.frameSnapshot(sessionID: pageSessionID)
        let context = try session.isolatedWorld(frameID: frame.frameID, sessionID: pageSessionID)
        let page = try session.pageDOM(sessionID: pageSessionID, contextID: context)
        try session.assertWindowID(
            targetID: target.targetID,
            expectedWindowID: request.target.windowID
        )
        guard frame.frameID == expectedFrameID, page.documentOrigin == expectedOrigin else {
            throw BrowserControllerError.targetIdentityMismatch
        }
        let liveIdentity = BrowserTargetIdentity(
            websiteActiveTabID: target.targetID,
            windowID: request.target.windowID,
            topFrameID: frame.frameID,
            formActionOrigin: page.documentOrigin
        )
        return BrowserTargetSnapshot(
            identity: liveIdentity,
            targetGeneration: request.targetGeneration,
            targetType: target.type,
            targetURL: target.url,
            loaderID: frame.loaderID,
            isAttached: target.attached,
            isFocused: try session.pageHasFocus(sessionID: pageSessionID, contextID: context),
            isTopLevel: page.isTopLevel,
            isNavigating: ledger.isNavigating,
            openDialogCount: ledger.openDialogCount,
            iframeCount: max(frame.iframeCount, page.iframeCount),
            navigationSequence: ledger.navigationSequence,
            dialogSequence: ledger.dialogSequence,
            frameSequence: ledger.frameSequence,
            focusSequence: ledger.focusSequence,
            originSequence: ledger.originSequence
        )
    }

    private func checkCancellation(_ requestID: String) throws {
        guard !cancellation.isCancelled(requestID: requestID) else {
            throw BrowserControllerError.cancelled
        }
    }

    private static func bounded(_ error: Error) -> BrowserControllerError {
        if let error = error as? BrowserControllerError { return error }
        if let error = error as? CDPConnectionError {
            return error == .timedOut ? .timeout : .transportRejected
        }
        if error is CancellationError { return .cancelled }
        return .unavailable
    }

    private static func point(from value: CDPJSONValue) throws -> BrowserCDPPoint? {
        guard case let .object(object) = value else {
            throw BrowserControllerError.invalidJSON
        }
        guard case let .integer(count)? = object["count"] else {
            throw BrowserControllerError.invalidJSON
        }
        guard count == 1 else { return nil }
        return try BrowserCDPPoint(
            x: number(object["x"]),
            y: number(object["y"])
        )
    }

    private static func number(_ value: CDPJSONValue?) throws -> Double {
        guard let value else { throw BrowserControllerError.invalidJSON }
        switch value {
        case .number(let number): return number
        case .integer(let number): return Double(number)
        case .unsignedInteger(let number): return Double(number)
        default: throw BrowserControllerError.invalidJSON
        }
    }

    private static func zero(_ bytes: inout [UInt8]) {
        bytes.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
        bytes.removeAll(keepingCapacity: false)
    }

    private static func deadline(milliseconds: Int) -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        let delta = UInt64(max(1, milliseconds)) * 1_000_000
        return now > UInt64.max - delta ? UInt64.max : now + delta
    }

    private static let searchPointExpression = #"""
    (() => {
      const route = location.hash.startsWith("#/") ? location.hash.slice(1).split("?")[0] : "/";
      const inputs = document.querySelectorAll('bit-search input[type="search"][name="searchText"]');
      if (route !== "/tabs/current" || inputs.length !== 1) return { count: 0 };
      const rect = inputs[0].getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { count: 0 };
      return { count: 1, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
    """#
}

private struct BoundBitwardenTarget: Equatable, Sendable {
    let targetID: String
    let windowID: String
    let topFrameID: String
    let loaderID: String
    let origin: String
}

internal struct BrowserOperationBinding: Equatable, Sendable {
    internal let requestID: String
    internal let targetGeneration: UInt64
    internal let target: BrowserTargetIdentity

    internal init(
        requestID: String,
        targetGeneration: UInt64,
        target: BrowserTargetIdentity
    ) throws {
        guard !requestID.isEmpty,
              requestID.utf8.count <= 128,
              !requestID.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              targetGeneration > 0
        else { throw BrowserControllerError.requestInvalid }
        try BrowserValidation.validate(bitwardenTarget: target)
        self.requestID = requestID
        self.targetGeneration = targetGeneration
        self.target = target
    }
}

internal enum BitwardenPopupCommand: Equatable, Sendable {
    case focusMasterPassword
    case insertSecret
    case submitUnlock
    case fillExactAlias(String)
}

internal enum BitwardenPopupCommandPlan {
    internal static func unlock(prompt: BrowserUnlockDOMResult) throws -> [BitwardenPopupCommand] {
        guard prompt.route == "/lock",
              prompt.passwordInputCount == 1,
              prompt.submitButtonCount == 1,
              prompt.warningCount == 0,
              prompt.errorCount == 0,
              prompt.lockedIndicatorCount == 1,
              prompt.loggedOutIndicatorCount == 0,
              prompt.accountSwitcherCount == 0,
              prompt.passwordRepromptCount == 0,
              prompt.inputPoint != nil,
              prompt.submitPoint != nil
        else { throw BrowserControllerError.popupStateRejected }
        return [.focusMasterPassword, .insertSecret, .submitUnlock]
    }

    internal static func autofill(
        selection: BitwardenPopupDOMResult,
        alias: String
    ) throws -> [BitwardenPopupCommand] {
        try BrowserValidation.validate(popup: selection, expectedAlias: alias)
        return [.fillExactAlias(alias)]
    }
}

internal struct BrowserEventLedger: Equatable, Sendable {
    internal private(set) var navigationSequence: UInt64 = 0
    internal private(set) var dialogSequence: UInt64 = 0
    internal private(set) var frameSequence: UInt64 = 0
    internal private(set) var focusSequence: UInt64 = 0
    internal private(set) var originSequence: UInt64 = 0
    internal private(set) var openDialogCount: Int = 0
    internal private(set) var isNavigating = false

    internal mutating func ingest(
        _ events: [CDPTransportEvent],
        targetID: String,
        sessionID: String
    ) {
        for event in events where event.sessionId == sessionID || Self.targets(event, targetID: targetID) {
            switch event.method {
            case "Page.frameStartedLoading", "Page.frameNavigated", "Page.navigatedWithinDocument",
                 "Page.documentOpened", "Page.frameStoppedLoading":
                navigationSequence &+= 1
                isNavigating = true
            case "Page.javascriptDialogOpening":
                dialogSequence &+= 1
                openDialogCount += 1
            case "Page.javascriptDialogClosed":
                dialogSequence &+= 1
                openDialogCount = max(0, openDialogCount - 1)
            case "Page.frameAttached", "Page.frameDetached", "Page.frameSubtreeWillBeDetached":
                frameSequence &+= 1
            case "Target.targetInfoChanged":
                originSequence &+= 1
            case "Page.windowOpen", "Page.windowClosed":
                focusSequence &+= 1
            default:
                break
            }
        }
    }

    private static func targets(_ event: CDPTransportEvent, targetID: String) -> Bool {
        guard event.method.hasPrefix("Target."),
              case let .object(parameters)? = event.params
        else { return false }
        if case let .string(value)? = parameters["targetId"] { return value == targetID }
        guard case let .object(info)? = parameters["targetInfo"],
              case let .string(value)? = info["targetId"]
        else { return false }
        return value == targetID
    }
}

private final class BrowserCancellationRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var currentRequestID: String?
    private var cancelled = false

    func begin(requestID: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard currentRequestID == nil else {
            throw BrowserControllerError.operationInProgress
        }
        currentRequestID = requestID
        cancelled = false
    }

    func cancel(requestID: String) {
        lock.lock()
        if currentRequestID == requestID { cancelled = true }
        lock.unlock()
    }

    func cancelCurrent() {
        lock.lock()
        if currentRequestID != nil { cancelled = true }
        lock.unlock()
    }

    func isCancelled(requestID: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return currentRequestID == requestID && cancelled
    }

    func end(requestID: String) {
        lock.lock()
        if currentRequestID == requestID {
            currentRequestID = nil
            cancelled = false
        }
        lock.unlock()
    }
}

private final class BrowserOperationResources {
    private let tunnel: SSHStreamLocalTunnel
    private var session: BrowserCDPSession?
    private var targetIDs: [String] = []
    private var sessionIDs: [String] = []

    init(configuration: BrowserControllerConfiguration) throws {
        tunnel = try SSHStreamLocalTunnel(configuration: configuration)
    }

    func start() throws {
        try tunnel.start()
    }

    func attestHost(configuration: BrowserControllerConfiguration) throws -> BrowserHostAttestation {
        try BrowserHostAttestation.decode(
            tunnel.fetchHostAttestation(),
            maximumBytes: configuration.jsonVersionMaximumBytes,
            configuration: configuration
        )
    }

    func connect(configuration: BrowserControllerConfiguration) throws -> BrowserCDPSession {
        guard session == nil else { throw BrowserControllerError.operationInProgress }
        let value = try BrowserCDPSession(
            socketPath: tunnel.streamSocketPath,
            configuration: configuration
        )
        session = value
        return value
    }

    func addTarget(_ targetID: String) {
        guard !targetIDs.contains(targetID) else { return }
        targetIDs.append(targetID)
    }

    func forgetTarget(_ targetID: String) {
        targetIDs.removeAll(where: { $0 == targetID })
    }

    func addSession(_ sessionID: String) {
        sessionIDs.append(sessionID)
    }

    func closeTarget(_ targetID: String) throws {
        guard let session else { throw BrowserControllerError.targetNotAttached }
        try session.closeTarget(targetID)
        forgetTarget(targetID)
    }

    func shutdown() {
        if let session {
            for targetID in targetIDs.reversed() {
                try? session.closeTarget(targetID)
            }
            for sessionID in sessionIDs.reversed() {
                session.detach(sessionID: sessionID)
            }
            session.connection.close()
        }
        targetIDs.removeAll(keepingCapacity: false)
        sessionIDs.removeAll(keepingCapacity: false)
        session = nil
        tunnel.stop()
    }
}
