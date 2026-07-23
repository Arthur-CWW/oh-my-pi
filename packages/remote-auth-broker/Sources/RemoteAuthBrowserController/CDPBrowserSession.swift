import Foundation

internal struct BrowserCDPTarget: Equatable, Sendable {
    internal let targetID: String
    internal let type: String
    internal let url: String
    internal let attached: Bool
}

internal struct BrowserCDPFrameSnapshot: Equatable, Sendable {
    internal let frameID: String
    internal let loaderID: String
    internal let url: String
    internal let iframeCount: Int
}

internal struct BrowserCDPPoint: Equatable, Sendable {
    internal let x: Double
    internal let y: Double
}

internal struct BrowserUnlockDOMResult: Equatable, Sendable {
    internal let route: String
    internal let passwordInputCount: Int
    internal let submitButtonCount: Int
    internal let warningCount: Int
    internal let errorCount: Int
    internal let lockedIndicatorCount: Int
    internal let loggedOutIndicatorCount: Int
    internal let accountSwitcherCount: Int
    internal let passwordRepromptCount: Int
    internal let inputPoint: BrowserCDPPoint?
    internal let submitPoint: BrowserCDPPoint?
}

internal struct BrowserPopupSelection: Equatable, Sendable {
    internal let result: BitwardenPopupDOMResult
    internal let fillPoint: BrowserCDPPoint?
}

internal final class BrowserCDPSession {
    internal let connection: CDPConnection
    private let configuration: BrowserControllerConfiguration

    internal init(socketPath: String, configuration: BrowserControllerConfiguration) throws {
        self.configuration = configuration
        let socketConfiguration = UnixSocketConfiguration(
            connectTimeoutMilliseconds: configuration.operationTimeoutMilliseconds,
            readTimeoutMilliseconds: configuration.operationTimeoutMilliseconds,
            writeTimeoutMilliseconds: configuration.operationTimeoutMilliseconds,
            maximumReadBytes: configuration.cdpMessageMaximumBytes + 16,
            maximumWriteBytes: configuration.cdpMessageMaximumBytes + 16
        )
        let httpLimits = HTTPResponseLimits(
            maximumHeaderBytes: 16 * 1_024,
            maximumBodyBytes: configuration.jsonVersionMaximumBytes,
            readChunkBytes: min(8 * 1_024, configuration.jsonVersionMaximumBytes)
        )
        let webSocketLimits = WebSocketLimits(
            maximumHandshakeBytes: 16 * 1_024,
            maximumFramePayloadBytes: configuration.cdpMessageMaximumBytes,
            maximumMessageBytes: configuration.cdpMessageMaximumBytes,
            readChunkBytes: min(16 * 1_024, configuration.cdpMessageMaximumBytes)
        )
        let transportConfiguration = CDPConnectionConfiguration(
            socket: socketConfiguration,
            http: httpLimits,
            webSocket: WebSocketConfiguration(
                limits: webSocketLimits,
                messageTimeoutMilliseconds: configuration.operationTimeoutMilliseconds
            ),
            cdp: CDPConnectionLimits(
                maximumJSONMessageBytes: configuration.cdpMessageMaximumBytes,
                maximumJSONDepth: 64,
                maximumJSONNodes: 100_000,
                maximumJSONStringBytes: min(256 * 1_024, configuration.cdpMessageMaximumBytes),
                maximumQueuedEvents: 512,
                maximumQueuedEventBytes: min(8 * 1_024 * 1_024, configuration.cdpMessageMaximumBytes * 4)
            ),
            requestTimeoutMilliseconds: configuration.operationTimeoutMilliseconds
        )

        let version = try CDPHTTPProtocol.fetchVersion(
            socketPath: socketPath,
            socketConfiguration: socketConfiguration,
            limits: httpLimits
        )
        guard let browser = version.browser,
              let protocolVersion = version.protocolVersion,
              let userAgent = version.userAgent,
              let v8Version = version.v8Version,
              let webKitVersion = version.webKitVersion
        else { throw BrowserControllerError.invalidJSON }
        try BrowserValidation.validate(
            chromeVersion: ChromeVersionResponse(
                browser: browser,
                protocolVersion: protocolVersion,
                userAgent: userAgent,
                v8Version: v8Version,
                webKitVersion: webKitVersion,
                webSocketDebuggerURL: version.webSocketDebuggerURL
            ),
            expectedProduct: configuration.expectedChromeProduct
        )
        connection = try CDPConnection.connect(
            socketPath: socketPath,
            configuration: transportConfiguration
        )
    }

    deinit {
        connection.close()
    }

    internal func targets() throws -> [BrowserCDPTarget] {
        let response = try connection.request(method: "Target.getTargets")
        let values = try response.requiredObject()["targetInfos"]?.requiredArray()
            ?? { throw BrowserControllerError.invalidJSON }()
        guard values.count <= 4_096 else { throw BrowserControllerError.responseTooLarge }
        return try values.map { value in
            let object = try value.requiredObject()
            return BrowserCDPTarget(
                targetID: try object.requiredString("targetId", maximumBytes: 256),
                type: try object.requiredString("type", maximumBytes: 64),
                url: try object.requiredString("url", maximumBytes: 4_096),
                attached: try object.requiredBool("attached")
            )
        }
    }

    internal func target(_ targetID: String) throws -> BrowserCDPTarget {
        let matches = try targets().filter { $0.targetID == targetID }
        guard matches.count == 1 else { throw BrowserControllerError.targetIdentityMismatch }
        return matches[0]
    }

    internal func attach(targetID: String) throws -> String {
        let result = try connection.request(
            method: "Target.attachToTarget",
            params: ["targetId": .string(targetID), "flatten": .boolean(true)]
        )
        return try result.requiredObject().requiredString("sessionId", maximumBytes: 256)
    }

    internal func detach(sessionID: String) {
        _ = try? connection.request(
            method: "Target.detachFromTarget",
            params: ["sessionId": .string(sessionID)]
        )
    }

    internal func enablePage(sessionID: String) throws {
        _ = try connection.request(method: "Page.enable", sessionId: sessionID)
        _ = try connection.request(method: "Runtime.enable", sessionId: sessionID)
        _ = try connection.request(
            method: "Page.setLifecycleEventsEnabled",
            params: ["enabled": .boolean(true)],
            sessionId: sessionID
        )
    }

    internal func assertWindowID(targetID: String, expectedWindowID: String) throws {
        let expected = try BrowserValidation.cdpWindowID(expectedWindowID)
        let result = try connection.request(
            method: "Browser.getWindowForTarget",
            params: ["targetId": .string(targetID)]
        )
        let actual = try result.requiredObject().requiredInt64("windowId")
        guard actual > 0, actual == expected else {
            throw BrowserControllerError.targetIdentityMismatch
        }
    }

    internal func frameSnapshot(sessionID: String) throws -> BrowserCDPFrameSnapshot {
        let result = try connection.request(method: "Page.getFrameTree", sessionId: sessionID)
        let root = try result.requiredObject().requiredObject("frameTree")
        let frame = try root.requiredObject("frame")
        return BrowserCDPFrameSnapshot(
            frameID: try frame.requiredString("id", maximumBytes: 256),
            loaderID: try frame.requiredString("loaderId", maximumBytes: 256),
            url: try frame.requiredString("url", maximumBytes: 4_096),
            iframeCount: try Self.countChildFrames(root)
        )
    }

    internal func isolatedWorld(frameID: String, sessionID: String) throws -> Int64 {
        let result = try connection.request(
            method: "Page.createIsolatedWorld",
            params: [
                "frameId": .string(frameID),
                "worldName": .string("remote-auth-browser-controller"),
                "grantUniveralAccess": .boolean(false),
            ],
            sessionId: sessionID
        )
        return try result.requiredObject().requiredInt64("executionContextId")
    }

    internal func evaluate(
        _ expression: String,
        sessionID: String,
        contextID: Int64? = nil
    ) throws -> CDPJSONValue {
        var parameters: [String: CDPJSONValue] = [
            "expression": .string(expression),
            "returnByValue": .boolean(true),
            "awaitPromise": .boolean(false),
            "userGesture": .boolean(false),
        ]
        if let contextID { parameters["contextId"] = .integer(contextID) }
        let response = try connection.request(
            method: "Runtime.evaluate",
            params: parameters,
            sessionId: sessionID
        )
        let envelope = try response.requiredObject()
        guard envelope["exceptionDetails"] == nil else {
            throw BrowserControllerError.cdpEvaluationRejected
        }
        let remoteObject = try envelope.requiredObject("result")
        guard try remoteObject.requiredString("type", maximumBytes: 32) != "undefined",
              let value = remoteObject["value"]
        else { throw BrowserControllerError.cdpEvaluationRejected }
        return value
    }

    internal func pageDOM(
        sessionID: String,
        contextID: Int64
    ) throws -> BrowserPageDOMResult {
        let value = try evaluate(Self.pageDOMExpression, sessionID: sessionID, contextID: contextID)
        let object = try value.requiredObject()
        return BrowserPageDOMResult(
            documentURL: try object.requiredString("documentURL", maximumBytes: 4_096),
            documentOrigin: try object.requiredString("documentOrigin", maximumBytes: 2_048),
            isTopLevel: try object.requiredBool("isTopLevel"),
            iframeCount: try object.requiredInt("iframeCount"),
            formActions: try object.requiredStringArray("formActions", maximumCount: 256, maximumBytes: 2_048)
        )
    }

    internal func pageHasFocus(sessionID: String, contextID: Int64) throws -> Bool {
        let value = try evaluate(Self.focusExpression, sessionID: sessionID, contextID: contextID)
        return try value.requiredBool()
    }

    internal func extensionRuntimeMetadata(
        target: BrowserCDPTarget,
        hostMetadata: BrowserExtensionMetadata
    ) throws -> BrowserExtensionMetadata {
        let sessionID = try attach(targetID: target.targetID)
        defer { detach(sessionID: sessionID) }
        _ = try connection.request(method: "Runtime.enable", sessionId: sessionID)
        let value = try evaluate(Self.extensionMetadataExpression, sessionID: sessionID)
        let object = try value.requiredObject()
        let runtimeID = try object.requiredString("extensionId", maximumBytes: 128)
        let version = try object.requiredString("version", maximumBytes: 64)
        let defaultPopup = try object.requiredString("defaultPopup", maximumBytes: 256)
        let defaultLocale = try object.requiredString("defaultLocale", maximumBytes: 32)
        let activeLocale = try object.requiredString("activeLocale", maximumBytes: 32)
        guard runtimeID == hostMetadata.extensionID,
              version == hostMetadata.version,
              defaultPopup == hostMetadata.defaultPopup,
              defaultLocale == hostMetadata.defaultLocale,
              activeLocale == hostMetadata.activeLocale
        else { throw BrowserControllerError.extensionAttestationRejected }
        return BrowserExtensionMetadata(
            extensionID: runtimeID,
            version: version,
            source: hostMetadata.source,
            sourceTag: hostMetadata.sourceTag,
            manifestSHA256: hostMetadata.manifestSHA256,
            defaultPopup: defaultPopup,
            defaultLocale: defaultLocale,
            activeLocale: activeLocale
        )
    }

    internal func createBitwardenPopup() throws -> String {
        let result = try connection.request(
            method: "Target.createTarget",
            params: [
                "url": .string(
                    "chrome-extension://\(BrowserControllerContract.extensionID)/\(BrowserControllerContract.extensionDefaultPopup)"
                ),
                "newWindow": .boolean(true),
                "background": .boolean(false),
            ]
        )
        return try result.requiredObject().requiredString("targetId", maximumBytes: 256)
    }

    internal func unlockDOM(sessionID: String) throws -> BrowserUnlockDOMResult {
        let value = try evaluate(Self.unlockDOMExpression, sessionID: sessionID)
        let object = try value.requiredObject()
        return BrowserUnlockDOMResult(
            route: try object.requiredString("route", maximumBytes: 128),
            passwordInputCount: try object.requiredInt("passwordInputCount"),
            submitButtonCount: try object.requiredInt("submitButtonCount"),
            warningCount: try object.requiredInt("warningCount"),
            errorCount: try object.requiredInt("errorCount"),
            lockedIndicatorCount: try object.requiredInt("lockedIndicatorCount"),
            loggedOutIndicatorCount: try object.requiredInt("loggedOutIndicatorCount"),
            accountSwitcherCount: try object.requiredInt("accountSwitcherCount"),
            passwordRepromptCount: try object.requiredInt("passwordRepromptCount"),
            inputPoint: try object.optionalPoint("inputPoint"),
            submitPoint: try object.optionalPoint("submitPoint")
        )
    }

    internal func popupSelection(sessionID: String, alias: String) throws -> BrowserPopupSelection {
        let aliasData = try JSONEncoder().encode(alias)
        guard let quotedAlias = String(data: aliasData, encoding: .utf8) else {
            throw BrowserControllerError.requestInvalid
        }
        let expression = Self.popupSelectionExpression.replacingOccurrences(
            of: "__REMOTE_AUTH_ALIAS__",
            with: quotedAlias
        )
        let value = try evaluate(expression, sessionID: sessionID)
        let object = try value.requiredObject()
        let result = BitwardenPopupDOMResult(
            route: try object.requiredString("route", maximumBytes: 128),
            vaultUnlocked: try object.requiredBool("vaultUnlocked"),
            autofillSuggestionsHeadingCount: try object.requiredInt("autofillSuggestionsHeadingCount"),
            autofillSuggestionsDisplayedCount: try object.requiredInt("autofillSuggestionsDisplayedCount"),
            autofillSuggestionRowCount: try object.requiredInt("autofillSuggestionRowCount"),
            exactItemNameMatchCount: try object.requiredInt("exactItemNameMatchCount"),
            officialFillActionCount: try object.requiredInt("officialFillActionCount"),
            warningCount: try object.requiredInt("warningCount"),
            errorCount: try object.requiredInt("errorCount"),
            duplicateCount: try object.requiredInt("duplicateCount"),
            lockedIndicatorCount: try object.requiredInt("lockedIndicatorCount"),
            loggedOutIndicatorCount: try object.requiredInt("loggedOutIndicatorCount"),
            accountSwitcherCount: try object.requiredInt("accountSwitcherCount"),
            passwordRepromptCount: try object.requiredInt("passwordRepromptCount")
        )
        return BrowserPopupSelection(result: result, fillPoint: try object.optionalPoint("fillPoint"))
    }

    internal func click(_ point: BrowserCDPPoint, sessionID: String) throws {
        for type in ["mousePressed", "mouseReleased"] {
            _ = try connection.request(
                method: "Input.dispatchMouseEvent",
                params: [
                    "type": .string(type),
                    "x": .number(point.x),
                    "y": .number(point.y),
                    "button": .string("left"),
                    "clickCount": .integer(1),
                ],
                sessionId: sessionID
            )
        }
    }

    internal func insertSecret(_ bytes: inout [UInt8], sessionID: String) throws {
        defer {
            bytes.withUnsafeMutableBytes { buffer in
                _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        guard let text = String(bytes: bytes, encoding: .utf8) else {
            throw BrowserControllerError.secretInvalid
        }
        _ = try connection.request(
            method: "Input.insertText",
            params: ["text": .string(text)],
            sessionId: sessionID
        )
    }

    internal func closeTarget(_ targetID: String) throws {
        let result = try connection.request(
            method: "Target.closeTarget",
            params: ["targetId": .string(targetID)]
        )
        guard try result.requiredObject().requiredBool("success") else {
            throw BrowserControllerError.releaseAttestationInvalid
        }
        let deadline = Self.deadline(milliseconds: configuration.operationTimeoutMilliseconds)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if try !targets().contains(where: { $0.targetID == targetID }) { return }
            usleep(10_000)
        }
        throw BrowserControllerError.releaseAttestationInvalid
    }

    internal func drainEvents() -> [CDPTransportEvent] {
        connection.drainEvents()
    }

    private static func countChildFrames(_ tree: [String: CDPJSONValue]) throws -> Int {
        guard let childrenValue = tree["childFrames"] else { return 0 }
        let children = try childrenValue.requiredArray()
        guard children.count <= 1_024 else { throw BrowserControllerError.responseTooLarge }
        var count = children.count
        for child in children {
            let nested = try child.requiredObject()
            let descendants = try countChildFrames(nested)
            guard count <= 1_024 - descendants else {
                throw BrowserControllerError.responseTooLarge
            }
            count += descendants
        }
        return count
    }

    private static func deadline(milliseconds: Int) -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        let delta = UInt64(max(1, milliseconds)) * 1_000_000
        return now > UInt64.max - delta ? UInt64.max : now + delta
    }

    private static let pageDOMExpression = #"""
    (() => {
      const getAttribute = Element.prototype.getAttribute;
      const queryAll = Document.prototype.querySelectorAll;
      const forms = Array.from(document.forms);
      return {
        documentURL: String(location.href),
        documentOrigin: String(location.origin),
        isTopLevel: window.top === window,
        iframeCount: queryAll.call(document, "iframe,frame").length,
        formActions: forms.slice(0, 257).map((form) => getAttribute.call(form, "action") || "")
      };
    })()
    """#

    private static let focusExpression = #"""
    (() => document.hasFocus() && document.visibilityState === "visible" && window.top === window)()
    """#

    private static let extensionMetadataExpression = #"""
    (() => {
      const manifest = chrome.runtime.getManifest();
      return {
        extensionId: chrome.runtime.id,
        version: manifest.version,
        defaultPopup: manifest.action && manifest.action.default_popup,
        defaultLocale: manifest.default_locale,
        activeLocale: chrome.i18n.getUILanguage().toLowerCase().split("-")[0]
      };
    })()
    """#

    private static let unlockDOMExpression = #"""
    (() => {
      const route = location.hash.startsWith("#/") ? location.hash.slice(1).split("?")[0] : "/";
      const root = document.querySelectorAll("bit-master-password-lock");
      const inputs = root.length === 1
        ? root[0].querySelectorAll('input[type="password"][name="masterPassword"]') : [];
      const submits = root.length === 1 ? root[0].querySelectorAll('button[type="submit"]') : [];
      const point = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return {
        route,
        passwordInputCount: inputs.length,
        submitButtonCount: submits.length,
        warningCount: document.querySelectorAll('bit-callout, [role="alert"]').length,
        errorCount: document.querySelectorAll('bit-toast[variant="error"], [data-variant="error"]').length,
        lockedIndicatorCount: route === "/lock" ? 1 : 0,
        loggedOutIndicatorCount: route === "/login" ? 1 : 0,
        accountSwitcherCount: document.querySelectorAll("app-account-switcher").length,
        passwordRepromptCount: document.querySelectorAll("app-password-reprompt").length,
        inputPoint: inputs.length === 1 ? point(inputs[0]) : null,
        submitPoint: submits.length === 1 ? point(submits[0]) : null
      };
    })()
    """#

    private static let popupSelectionExpression = #"""
    (() => {
      const alias = __REMOTE_AUTH_ALIAS__;
      const route = location.hash.startsWith("#/") ? location.hash.slice(1).split("?")[0] : "/";
      const sections = document.querySelectorAll("app-autofill-vault-list-items");
      const section = sections.length === 1 ? sections[0] : null;
      const headings = section ? Array.from(section.querySelectorAll("h2"))
        .filter((heading) => heading.textContent.trim() === "Autofill suggestions") : [];
      const rows = section ? Array.from(section.querySelectorAll("bit-item")) : [];
      const exactRows = rows.filter((row) => {
        const names = row.querySelectorAll('[data-testid="item-name"]');
        return names.length === 1 && names[0].textContent === alias;
      });
      const exactRow = exactRows.length === 1 ? exactRows[0] : null;
      const buttons = exactRow ? Array.from(exactRow.querySelectorAll("bit-item-action button")) : [];
      const official = buttons.filter((button) =>
        button.getAttribute("aria-label") === `Autofill - ${alias}` ||
        (!button.hasAttribute("aria-label") && button.textContent.trim() === "Fill")
      );
      const countSpans = section ? Array.from(section.querySelectorAll('bit-section-header span[slot="end"] span')) : [];
      const displayed = countSpans.filter((span) => span.textContent.trim() === "1").length;
      const point = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return {
        route,
        vaultUnlocked: route === "/tabs/current",
        autofillSuggestionsHeadingCount: headings.length,
        autofillSuggestionsDisplayedCount: displayed,
        autofillSuggestionRowCount: rows.length,
        exactItemNameMatchCount: exactRows.length,
        officialFillActionCount: official.length,
        warningCount: document.querySelectorAll('bit-callout, [role="alert"]').length,
        errorCount: document.querySelectorAll('bit-toast[variant="error"], [data-variant="error"]').length,
        duplicateCount: Math.max(0, exactRows.length - 1),
        lockedIndicatorCount: route === "/lock" ? 1 : 0,
        loggedOutIndicatorCount: route === "/login" ? 1 : 0,
        accountSwitcherCount: document.querySelectorAll("app-account-switcher").length,
        passwordRepromptCount: document.querySelectorAll("app-password-reprompt").length,
        fillPoint: official.length === 1 ? point(official[0]) : null
      };
    })()
    """#
}

private extension CDPJSONValue {
    func requiredObject() throws -> [String: CDPJSONValue] {
        guard case let .object(value) = self else { throw BrowserControllerError.invalidJSON }
        return value
    }

    func requiredArray() throws -> [CDPJSONValue] {
        guard case let .array(value) = self else { throw BrowserControllerError.invalidJSON }
        return value
    }

    func requiredBool() throws -> Bool {
        guard case let .boolean(value) = self else { throw BrowserControllerError.invalidJSON }
        return value
    }

    func requiredDouble() throws -> Double {
        switch self {
        case let .number(value) where value.isFinite: return value
        case let .integer(value): return Double(value)
        case let .unsignedInteger(value): return Double(value)
        default: throw BrowserControllerError.invalidJSON
        }
    }
}

private extension Dictionary where Key == String, Value == CDPJSONValue {
    func requiredObject(_ key: String) throws -> [String: CDPJSONValue] {
        guard let value = self[key] else { throw BrowserControllerError.invalidJSON }
        return try value.requiredObject()
    }

    func requiredString(_ key: String, maximumBytes: Int) throws -> String {
        guard let value = self[key], case let .string(string) = value,
              !string.utf8.contains(0), string.utf8.count <= maximumBytes
        else { throw BrowserControllerError.invalidJSON }
        return string
    }

    func requiredBool(_ key: String) throws -> Bool {
        guard let value = self[key] else { throw BrowserControllerError.invalidJSON }
        return try value.requiredBool()
    }

    func requiredInt(_ key: String) throws -> Int {
        let value = try requiredInt64(key)
        guard let result = Int(exactly: value) else { throw BrowserControllerError.invalidJSON }
        return result
    }

    func requiredInt64(_ key: String) throws -> Int64 {
        guard let value = self[key] else { throw BrowserControllerError.invalidJSON }
        switch value {
        case let .integer(number): return number
        case let .unsignedInteger(number):
            guard let exact = Int64(exactly: number) else { throw BrowserControllerError.invalidJSON }
            return exact
        default: throw BrowserControllerError.invalidJSON
        }
    }

    func requiredStringArray(
        _ key: String,
        maximumCount: Int,
        maximumBytes: Int
    ) throws -> [String] {
        guard let value = self[key] else { throw BrowserControllerError.invalidJSON }
        let array = try value.requiredArray()
        guard array.count <= maximumCount else { throw BrowserControllerError.responseTooLarge }
        return try array.map { element in
            guard case let .string(string) = element, string.utf8.count <= maximumBytes else {
                throw BrowserControllerError.invalidJSON
            }
            return string
        }
    }

    func optionalPoint(_ key: String) throws -> BrowserCDPPoint? {
        guard let value = self[key] else { throw BrowserControllerError.invalidJSON }
        if case .null = value { return nil }
        let object = try value.requiredObject()
        guard let x = object["x"], let y = object["y"] else {
            throw BrowserControllerError.invalidJSON
        }
        return BrowserCDPPoint(x: try x.requiredDouble(), y: try y.requiredDouble())
    }
}
