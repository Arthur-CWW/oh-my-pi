import Foundation

public enum BrowserControllerContract {
    public static let extensionID = "nngceckbapebfimnlniiiahkandclblb"
    public static let extensionVersion = "2026.6.1"
    public static let extensionSource = "official-chrome-web-store"
    public static let extensionSourceTag = "browser-v2026.6.1"
    public static let extensionDefaultPopup = "popup/index.html"
    public static let extensionLocale = "en"
    public static let unlockedVaultRoute = "/tabs/current"
    public static let chromeDebuggingPort = 9222
    public static let sshExecutablePath = "/usr/bin/ssh"
    public static let chromeExecutablePath = "/usr/bin/google-chrome-stable"
    public static let remoteAttestationCommand = "/usr/local/libexec/remote-auth-browser-attest"
    public static let defaultJSONVersionMaximumBytes = 16_384
    public static let defaultCDPMessageMaximumBytes = 1_048_576
    public static let defaultOperationTimeoutMilliseconds = 20_000
}

public enum BrowserControllerError: String, Error, Codable, CaseIterable, Sendable, CustomStringConvertible {
    case unavailable
    case timeout
    case cancelled
    case transportRejected = "transport-rejected"
    case operationInProgress = "operation-in-progress"
    case secretInvalid = "secret-invalid"
    case targetQuarantineRejected = "target-quarantine-rejected"
    case sshAttestationRejected = "ssh-attestation-rejected"
    case configurationInvalid = "configuration-invalid"
    case requestInvalid = "request-invalid"
    case invalidJSON = "invalid-json"
    case responseTooLarge = "response-too-large"
    case chromeProductMismatch = "chrome-product-mismatch"
    case chromeProtocolMismatch = "chrome-protocol-mismatch"
    case debuggerEndpointRejected = "debugger-endpoint-rejected"
    case extensionAttestationRejected = "extension-attestation-rejected"
    case targetIdentityMismatch = "target-identity-mismatch"
    case targetOriginMismatch = "target-origin-mismatch"
    case targetNotAttached = "target-not-attached"
    case browserDialogObserved = "browser-dialog-observed"
    case browserNavigationObserved = "browser-navigation-observed"
    case iframeObserved = "iframe-observed"
    case focusDriftObserved = "focus-drift-observed"
    case originDriftObserved = "origin-drift-observed"
    case formActionRejected = "form-action-rejected"
    case popupStateRejected = "popup-state-rejected"
    case autofillSelectionRejected = "autofill-selection-rejected"
    case cdpCommandRejected = "cdp-command-rejected"
    case cdpEvaluationRejected = "cdp-evaluation-rejected"
    case requestBindingMismatch = "request-binding-mismatch"
    case targetGenerationInvalid = "target-generation-invalid"
    case invalidStateTransition = "invalid-state-transition"
    case releaseAttestationInvalid = "release-attestation-invalid"

    public var description: String { rawValue }
}

public struct BrowserControllerConfiguration: Codable, Equatable, Sendable {
    public let runtimeDirectoryPath: String
    public let sshDestination: String
    public let expectedChromeProduct: String
    public let expectedHostIdentity: String
    public let expectedProfilePath: String
    public let expectedGraphicalSession: String
    public let expectedManifestSHA256: String
    public let jsonVersionMaximumBytes: Int
    public let cdpMessageMaximumBytes: Int
    public let operationTimeoutMilliseconds: Int

    public init(
        runtimeDirectoryPath: String,
        sshDestination: String,
        expectedChromeProduct: String,
        expectedHostIdentity: String,
        expectedProfilePath: String,
        expectedGraphicalSession: String,
        expectedManifestSHA256: String,
        jsonVersionMaximumBytes: Int = BrowserControllerContract.defaultJSONVersionMaximumBytes,
        cdpMessageMaximumBytes: Int = BrowserControllerContract.defaultCDPMessageMaximumBytes,
        operationTimeoutMilliseconds: Int = BrowserControllerContract.defaultOperationTimeoutMilliseconds
    ) throws {
        self.runtimeDirectoryPath = runtimeDirectoryPath
        self.sshDestination = sshDestination
        self.expectedChromeProduct = expectedChromeProduct
        self.expectedHostIdentity = expectedHostIdentity
        self.expectedProfilePath = expectedProfilePath
        self.expectedGraphicalSession = expectedGraphicalSession
        self.expectedManifestSHA256 = expectedManifestSHA256
        self.jsonVersionMaximumBytes = jsonVersionMaximumBytes
        self.cdpMessageMaximumBytes = cdpMessageMaximumBytes
        self.operationTimeoutMilliseconds = operationTimeoutMilliseconds
        try BrowserValidation.validate(configuration: self)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case runtimeDirectoryPath
        case sshDestination
        case expectedChromeProduct
        case expectedHostIdentity
        case expectedProfilePath
        case expectedGraphicalSession
        case expectedManifestSHA256
        case jsonVersionMaximumBytes
        case cdpMessageMaximumBytes
        case operationTimeoutMilliseconds
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            runtimeDirectoryPath: container.decode(String.self, forKey: .runtimeDirectoryPath),
            sshDestination: container.decode(String.self, forKey: .sshDestination),
            expectedChromeProduct: container.decode(String.self, forKey: .expectedChromeProduct),
            expectedHostIdentity: container.decode(String.self, forKey: .expectedHostIdentity),
            expectedProfilePath: container.decode(String.self, forKey: .expectedProfilePath),
            expectedGraphicalSession: container.decode(String.self, forKey: .expectedGraphicalSession),
            expectedManifestSHA256: container.decode(String.self, forKey: .expectedManifestSHA256),
            jsonVersionMaximumBytes: container.decode(Int.self, forKey: .jsonVersionMaximumBytes),
            cdpMessageMaximumBytes: container.decode(Int.self, forKey: .cdpMessageMaximumBytes),
            operationTimeoutMilliseconds: container.decode(
                Int.self,
                forKey: .operationTimeoutMilliseconds
            )
        )
    }
}

public struct BrowserTargetIdentity: Codable, Equatable, Sendable {
    public let targetID: String
    public let windowID: String
    public let topFrameID: String?
    public let origin: String?

    public init(bitwardenTargetID: String, windowID: String) {
        targetID = bitwardenTargetID
        self.windowID = windowID
        topFrameID = nil
        origin = nil
    }

    public init(
        websiteActiveTabID: String,
        windowID: String,
        topFrameID: String,
        formActionOrigin: String
    ) {
        targetID = websiteActiveTabID
        self.windowID = windowID
        self.topFrameID = topFrameID
        origin = formActionOrigin
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case targetID = "targetId"
        case windowID = "windowId"
        case topFrameID = "topFrameId"
        case origin
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        targetID = try container.decode(String.self, forKey: .targetID)
        windowID = try container.decode(String.self, forKey: .windowID)
        topFrameID = try container.decodeIfPresent(String.self, forKey: .topFrameID)
        origin = try container.decodeIfPresent(String.self, forKey: .origin)
    }
}

public struct BrowserControllerRequest: Codable, Equatable, Sendable {
    public let requestID: String
    public let targetGeneration: UInt64
    public let target: BrowserTargetIdentity
    public let allowedFormActionOrigins: [String]
    public let itemAlias: String

    public init(
        requestID: String,
        targetGeneration: UInt64,
        target: BrowserTargetIdentity,
        allowedFormActionOrigins: [String],
        itemAlias: String
    ) throws {
        self.requestID = requestID
        self.targetGeneration = targetGeneration
        self.target = target
        self.allowedFormActionOrigins = allowedFormActionOrigins
        self.itemAlias = itemAlias
        try BrowserValidation.validate(request: self)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requestID = "requestId"
        case targetGeneration = "generation"
        case target, allowedFormActionOrigins, itemAlias
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            requestID: container.decode(String.self, forKey: .requestID),
            targetGeneration: container.decode(UInt64.self, forKey: .targetGeneration),
            target: container.decode(BrowserTargetIdentity.self, forKey: .target),
            allowedFormActionOrigins: container.decode([String].self, forKey: .allowedFormActionOrigins),
            itemAlias: container.decode(String.self, forKey: .itemAlias)
        )
    }
}

public enum BrowserControllerOutcome: String, Codable, CaseIterable, Sendable {
    case fillDispatched = "fill-dispatched"
}

public enum BrowserReleaseDisposition: String, Codable, CaseIterable, Sendable {
    case destroyed
    case closed
}

public struct BrowserReleaseAttestation: Codable, Equatable, Sendable {
    public let requestID: String
    public let targetGeneration: UInt64
    public let disposition: BrowserReleaseDisposition
    public let navigationDestroyed: Bool
    public let inputDestroyed: Bool
    public let requestDestroyed: Bool
    public let networkDestroyed: Bool

    public init(
        requestID: String,
        targetGeneration: UInt64,
        disposition: BrowserReleaseDisposition,
        navigationDestroyed: Bool,
        inputDestroyed: Bool,
        requestDestroyed: Bool,
        networkDestroyed: Bool
    ) throws {
        self.requestID = requestID
        self.targetGeneration = targetGeneration
        self.disposition = disposition
        self.navigationDestroyed = navigationDestroyed
        self.inputDestroyed = inputDestroyed
        self.requestDestroyed = requestDestroyed
        self.networkDestroyed = networkDestroyed
        try BrowserValidation.validate(releaseAttestation: self)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requestID = "requestId"
        case targetGeneration = "generation"
        case disposition
        case navigationDestroyed, inputDestroyed, requestDestroyed, networkDestroyed
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            requestID: container.decode(String.self, forKey: .requestID),
            targetGeneration: container.decode(UInt64.self, forKey: .targetGeneration),
            disposition: container.decode(BrowserReleaseDisposition.self, forKey: .disposition),
            navigationDestroyed: container.decode(Bool.self, forKey: .navigationDestroyed),
            inputDestroyed: container.decode(Bool.self, forKey: .inputDestroyed),
            requestDestroyed: container.decode(Bool.self, forKey: .requestDestroyed),
            networkDestroyed: container.decode(Bool.self, forKey: .networkDestroyed)
        )
    }
}

public struct BrowserControllerResult: Codable, Equatable, Sendable {
    public let requestID: String
    public let targetGeneration: UInt64
    public let outcome: BrowserControllerOutcome
    public let releaseAttestation: BrowserReleaseAttestation

    public init(
        requestID: String,
        targetGeneration: UInt64,
        outcome: BrowserControllerOutcome,
        releaseAttestation: BrowserReleaseAttestation
    ) throws {
        guard requestID == releaseAttestation.requestID,
              targetGeneration == releaseAttestation.targetGeneration
        else { throw BrowserControllerError.releaseAttestationInvalid }
        self.requestID = requestID
        self.targetGeneration = targetGeneration
        self.outcome = outcome
        self.releaseAttestation = releaseAttestation
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requestID = "requestId"
        case targetGeneration = "generation"
        case outcome, releaseAttestation
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            requestID: container.decode(String.self, forKey: .requestID),
            targetGeneration: container.decode(UInt64.self, forKey: .targetGeneration),
            outcome: container.decode(BrowserControllerOutcome.self, forKey: .outcome),
            releaseAttestation: container.decode(BrowserReleaseAttestation.self, forKey: .releaseAttestation)
        )
    }
}

public struct ChromeVersionResponse: Codable, Equatable, Sendable {
    public let browser: String
    public let protocolVersion: String
    public let userAgent: String
    public let v8Version: String
    public let webKitVersion: String
    public let webSocketDebuggerURL: String

    public init(
        browser: String,
        protocolVersion: String,
        userAgent: String,
        v8Version: String,
        webKitVersion: String,
        webSocketDebuggerURL: String
    ) {
        self.browser = browser
        self.protocolVersion = protocolVersion
        self.userAgent = userAgent
        self.v8Version = v8Version
        self.webKitVersion = webKitVersion
        self.webSocketDebuggerURL = webSocketDebuggerURL
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case browser = "Browser"
        case protocolVersion = "Protocol-Version"
        case userAgent = "User-Agent"
        case v8Version = "V8-Version"
        case webKitVersion = "WebKit-Version"
        case webSocketDebuggerURL = "webSocketDebuggerUrl"
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        browser = try container.decode(String.self, forKey: .browser)
        protocolVersion = try container.decode(String.self, forKey: .protocolVersion)
        userAgent = try container.decode(String.self, forKey: .userAgent)
        v8Version = try container.decode(String.self, forKey: .v8Version)
        webKitVersion = try container.decode(String.self, forKey: .webKitVersion)
        webSocketDebuggerURL = try container.decode(String.self, forKey: .webSocketDebuggerURL)
    }
}

public struct BrowserExtensionMetadata: Codable, Equatable, Sendable {
    public let extensionID: String
    public let version: String
    public let source: String
    public let sourceTag: String
    public let manifestSHA256: String
    public let defaultPopup: String
    public let defaultLocale: String
    public let activeLocale: String

    public init(
        extensionID: String,
        version: String,
        source: String,
        sourceTag: String,
        manifestSHA256: String,
        defaultPopup: String,
        defaultLocale: String,
        activeLocale: String
    ) {
        self.extensionID = extensionID
        self.version = version
        self.source = source
        self.sourceTag = sourceTag
        self.manifestSHA256 = manifestSHA256
        self.defaultPopup = defaultPopup
        self.defaultLocale = defaultLocale
        self.activeLocale = activeLocale
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case extensionID = "extensionId"
        case version, source, sourceTag, manifestSHA256, defaultPopup, defaultLocale, activeLocale
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        extensionID = try container.decode(String.self, forKey: .extensionID)
        version = try container.decode(String.self, forKey: .version)
        source = try container.decode(String.self, forKey: .source)
        sourceTag = try container.decode(String.self, forKey: .sourceTag)
        manifestSHA256 = try container.decode(String.self, forKey: .manifestSHA256)
        defaultPopup = try container.decode(String.self, forKey: .defaultPopup)
        defaultLocale = try container.decode(String.self, forKey: .defaultLocale)
        activeLocale = try container.decode(String.self, forKey: .activeLocale)
    }
}

public struct BrowserTargetSnapshot: Codable, Equatable, Sendable {
    public let identity: BrowserTargetIdentity
    public let targetGeneration: UInt64
    public let targetType: String
    public let targetURL: String
    public let loaderID: String
    public let isAttached: Bool
    public let isFocused: Bool
    public let isTopLevel: Bool
    public let isNavigating: Bool
    public let openDialogCount: Int
    public let iframeCount: Int
    public let navigationSequence: UInt64
    public let dialogSequence: UInt64
    public let frameSequence: UInt64
    public let focusSequence: UInt64
    public let originSequence: UInt64

    public init(
        identity: BrowserTargetIdentity,
        targetGeneration: UInt64,
        targetType: String,
        targetURL: String,
        loaderID: String,
        isAttached: Bool,
        isFocused: Bool,
        isTopLevel: Bool,
        isNavigating: Bool,
        openDialogCount: Int,
        iframeCount: Int,
        navigationSequence: UInt64,
        dialogSequence: UInt64,
        frameSequence: UInt64,
        focusSequence: UInt64,
        originSequence: UInt64
    ) {
        self.identity = identity
        self.targetGeneration = targetGeneration
        self.targetType = targetType
        self.targetURL = targetURL
        self.loaderID = loaderID
        self.isAttached = isAttached
        self.isFocused = isFocused
        self.isTopLevel = isTopLevel
        self.isNavigating = isNavigating
        self.openDialogCount = openDialogCount
        self.iframeCount = iframeCount
        self.navigationSequence = navigationSequence
        self.dialogSequence = dialogSequence
        self.frameSequence = frameSequence
        self.focusSequence = focusSequence
        self.originSequence = originSequence
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case identity
        case targetGeneration = "generation"
        case targetType
        case targetURL = "targetUrl"
        case loaderID = "loaderId"
        case isAttached, isFocused, isTopLevel, isNavigating, openDialogCount, iframeCount
        case navigationSequence, dialogSequence, frameSequence, focusSequence, originSequence
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        identity = try container.decode(BrowserTargetIdentity.self, forKey: .identity)
        targetGeneration = try container.decode(UInt64.self, forKey: .targetGeneration)
        targetType = try container.decode(String.self, forKey: .targetType)
        targetURL = try container.decode(String.self, forKey: .targetURL)
        loaderID = try container.decode(String.self, forKey: .loaderID)
        isAttached = try container.decode(Bool.self, forKey: .isAttached)
        isFocused = try container.decode(Bool.self, forKey: .isFocused)
        isTopLevel = try container.decode(Bool.self, forKey: .isTopLevel)
        isNavigating = try container.decode(Bool.self, forKey: .isNavigating)
        openDialogCount = try container.decode(Int.self, forKey: .openDialogCount)
        iframeCount = try container.decode(Int.self, forKey: .iframeCount)
        navigationSequence = try container.decode(UInt64.self, forKey: .navigationSequence)
        dialogSequence = try container.decode(UInt64.self, forKey: .dialogSequence)
        frameSequence = try container.decode(UInt64.self, forKey: .frameSequence)
        focusSequence = try container.decode(UInt64.self, forKey: .focusSequence)
        originSequence = try container.decode(UInt64.self, forKey: .originSequence)
    }
}

public struct BrowserPageDOMResult: Codable, Equatable, Sendable {
    public let documentURL: String
    public let documentOrigin: String
    public let isTopLevel: Bool
    public let iframeCount: Int
    public let formActions: [String]

    public init(
        documentURL: String,
        documentOrigin: String,
        isTopLevel: Bool,
        iframeCount: Int,
        formActions: [String]
    ) {
        self.documentURL = documentURL
        self.documentOrigin = documentOrigin
        self.isTopLevel = isTopLevel
        self.iframeCount = iframeCount
        self.formActions = formActions
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case documentURL, documentOrigin, isTopLevel, iframeCount, formActions
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        documentURL = try container.decode(String.self, forKey: .documentURL)
        documentOrigin = try container.decode(String.self, forKey: .documentOrigin)
        isTopLevel = try container.decode(Bool.self, forKey: .isTopLevel)
        iframeCount = try container.decode(Int.self, forKey: .iframeCount)
        formActions = try container.decode([String].self, forKey: .formActions)
    }
}

public struct BitwardenPopupDOMResult: Codable, Equatable, Sendable {
    public let route: String
    public let vaultUnlocked: Bool
    public let autofillSuggestionsHeadingCount: Int
    public let autofillSuggestionsDisplayedCount: Int
    public let autofillSuggestionRowCount: Int
    public let exactItemNameMatchCount: Int
    public let officialFillActionCount: Int
    public let warningCount: Int
    public let errorCount: Int
    public let duplicateCount: Int
    public let lockedIndicatorCount: Int
    public let loggedOutIndicatorCount: Int
    public let accountSwitcherCount: Int
    public let passwordRepromptCount: Int

    public init(
        route: String,
        vaultUnlocked: Bool,
        autofillSuggestionsHeadingCount: Int,
        autofillSuggestionsDisplayedCount: Int,
        autofillSuggestionRowCount: Int,
        exactItemNameMatchCount: Int,
        officialFillActionCount: Int,
        warningCount: Int,
        errorCount: Int,
        duplicateCount: Int,
        lockedIndicatorCount: Int,
        loggedOutIndicatorCount: Int,
        accountSwitcherCount: Int,
        passwordRepromptCount: Int
    ) {
        self.route = route
        self.vaultUnlocked = vaultUnlocked
        self.autofillSuggestionsHeadingCount = autofillSuggestionsHeadingCount
        self.autofillSuggestionsDisplayedCount = autofillSuggestionsDisplayedCount
        self.autofillSuggestionRowCount = autofillSuggestionRowCount
        self.exactItemNameMatchCount = exactItemNameMatchCount
        self.officialFillActionCount = officialFillActionCount
        self.warningCount = warningCount
        self.errorCount = errorCount
        self.duplicateCount = duplicateCount
        self.lockedIndicatorCount = lockedIndicatorCount
        self.loggedOutIndicatorCount = loggedOutIndicatorCount
        self.accountSwitcherCount = accountSwitcherCount
        self.passwordRepromptCount = passwordRepromptCount
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case route, vaultUnlocked, autofillSuggestionsHeadingCount, autofillSuggestionsDisplayedCount
        case autofillSuggestionRowCount, exactItemNameMatchCount, officialFillActionCount
        case warningCount, errorCount, duplicateCount, lockedIndicatorCount, loggedOutIndicatorCount
        case accountSwitcherCount, passwordRepromptCount
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        route = try container.decode(String.self, forKey: .route)
        vaultUnlocked = try container.decode(Bool.self, forKey: .vaultUnlocked)
        autofillSuggestionsHeadingCount = try container.decode(Int.self, forKey: .autofillSuggestionsHeadingCount)
        autofillSuggestionsDisplayedCount = try container.decode(Int.self, forKey: .autofillSuggestionsDisplayedCount)
        autofillSuggestionRowCount = try container.decode(Int.self, forKey: .autofillSuggestionRowCount)
        exactItemNameMatchCount = try container.decode(Int.self, forKey: .exactItemNameMatchCount)
        officialFillActionCount = try container.decode(Int.self, forKey: .officialFillActionCount)
        warningCount = try container.decode(Int.self, forKey: .warningCount)
        errorCount = try container.decode(Int.self, forKey: .errorCount)
        duplicateCount = try container.decode(Int.self, forKey: .duplicateCount)
        lockedIndicatorCount = try container.decode(Int.self, forKey: .lockedIndicatorCount)
        loggedOutIndicatorCount = try container.decode(Int.self, forKey: .loggedOutIndicatorCount)
        accountSwitcherCount = try container.decode(Int.self, forKey: .accountSwitcherCount)
        passwordRepromptCount = try container.decode(Int.self, forKey: .passwordRepromptCount)
    }
}

public struct CDPCommand<Parameters: Codable & Sendable>: Codable, Sendable {
    public let id: UInt64
    public let method: String
    public let params: Parameters
    public let sessionID: String?

    public init(id: UInt64, method: String, params: Parameters, sessionID: String? = nil) throws {
        guard id > 0, !method.isEmpty, method.utf8.count <= 128 else {
            throw BrowserControllerError.cdpCommandRejected
        }
        self.id = id
        self.method = method
        self.params = params
        self.sessionID = sessionID
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case id, method, params
        case sessionID = "sessionId"
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: container.decode(UInt64.self, forKey: .id),
            method: container.decode(String.self, forKey: .method),
            params: container.decode(Parameters.self, forKey: .params),
            sessionID: container.decodeIfPresent(String.self, forKey: .sessionID)
        )
    }
}

public enum CDPResponse<Payload: Codable & Sendable>: Codable, Sendable {
    case result(id: UInt64, payload: Payload, sessionID: String?)
    case failure(id: UInt64, code: Int, sessionID: String?)

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case id, result, error
        case sessionID = "sessionId"
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(UInt64.self, forKey: .id)
        guard id > 0 else { throw BrowserControllerError.invalidJSON }
        let sessionID = try container.decodeIfPresent(String.self, forKey: .sessionID)
        let hasResult = container.contains(.result)
        let hasError = container.contains(.error)
        guard hasResult != hasError else { throw BrowserControllerError.invalidJSON }
        if hasResult {
            self = .result(
                id: id,
                payload: try container.decode(Payload.self, forKey: .result),
                sessionID: sessionID
            )
        } else {
            let wireError = try container.decode(CDPErrorWire.self, forKey: .error)
            self = .failure(id: id, code: wireError.code, sessionID: sessionID)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .result(id, payload, sessionID):
            try container.encode(id, forKey: .id)
            try container.encode(payload, forKey: .result)
            try container.encodeIfPresent(sessionID, forKey: .sessionID)
        case let .failure(id, code, sessionID):
            try container.encode(id, forKey: .id)
            try container.encode(CDPErrorWire(code: code), forKey: .error)
            try container.encodeIfPresent(sessionID, forKey: .sessionID)
        }
    }
}

public struct CDPEvent<Parameters: Codable & Sendable>: Codable, Sendable {
    public let method: String
    public let params: Parameters
    public let sessionID: String?

    public init(method: String, params: Parameters, sessionID: String? = nil) throws {
        guard !method.isEmpty, method.utf8.count <= 128 else {
            throw BrowserControllerError.invalidJSON
        }
        self.method = method
        self.params = params
        self.sessionID = sessionID
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case method, params
        case sessionID = "sessionId"
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            method: container.decode(String.self, forKey: .method),
            params: container.decode(Parameters.self, forKey: .params),
            sessionID: container.decodeIfPresent(String.self, forKey: .sessionID)
        )
    }
}

public struct CDPRemoteObject<Value: Codable & Sendable>: Codable, Sendable {
    public let type: String
    public let subtype: String?
    public let value: Value

    public init(type: String, subtype: String? = nil, value: Value) {
        self.type = type
        self.subtype = subtype
        self.value = value
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case type, subtype, className, value, unserializableValue, description, objectID = "objectId"
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard !container.contains(.objectID), !container.contains(.unserializableValue) else {
            throw BrowserControllerError.cdpEvaluationRejected
        }
        type = try container.decode(String.self, forKey: .type)
        subtype = try container.decodeIfPresent(String.self, forKey: .subtype)
        _ = try container.decodeIfPresent(String.self, forKey: .className)
        _ = try container.decodeIfPresent(String.self, forKey: .description)
        value = try container.decode(Value.self, forKey: .value)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encodeIfPresent(subtype, forKey: .subtype)
        try container.encode(value, forKey: .value)
    }
}

public struct CDPRuntimeResult<Value: Codable & Sendable>: Codable, Sendable {
    public let result: CDPRemoteObject<Value>

    public init(result: CDPRemoteObject<Value>) {
        self.result = result
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case result, exceptionDetails
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.exceptionDetails), try !container.decodeNil(forKey: .exceptionDetails) {
            throw BrowserControllerError.cdpEvaluationRejected
        }
        result = try container.decode(CDPRemoteObject<Value>.self, forKey: .result)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(result, forKey: .result)
    }
}

public struct CDPTargetInfo: Codable, Equatable, Sendable {
    public let targetID: String
    public let type: String
    public let url: String
    public let attached: Bool
    public let openerID: String?
    public let canAccessOpener: Bool
    public let openerFrameID: String?
    public let browserContextID: String?
    public let subtype: String?

    public init(
        targetID: String,
        type: String,
        url: String,
        attached: Bool,
        openerID: String? = nil,
        canAccessOpener: Bool,
        openerFrameID: String? = nil,
        browserContextID: String? = nil,
        subtype: String? = nil
    ) {
        self.targetID = targetID
        self.type = type
        self.url = url
        self.attached = attached
        self.openerID = openerID
        self.canAccessOpener = canAccessOpener
        self.openerFrameID = openerFrameID
        self.browserContextID = browserContextID
        self.subtype = subtype
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case targetID = "targetId"
        case type, title, url, attached
        case openerID = "openerId"
        case canAccessOpener
        case openerFrameID = "openerFrameId"
        case browserContextID = "browserContextId"
        case subtype
    }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        targetID = try container.decode(String.self, forKey: .targetID)
        type = try container.decode(String.self, forKey: .type)
        _ = try container.decode(String.self, forKey: .title)
        url = try container.decode(String.self, forKey: .url)
        attached = try container.decode(Bool.self, forKey: .attached)
        openerID = try container.decodeIfPresent(String.self, forKey: .openerID)
        canAccessOpener = try container.decodeIfPresent(Bool.self, forKey: .canAccessOpener) ?? false
        openerFrameID = try container.decodeIfPresent(String.self, forKey: .openerFrameID)
        browserContextID = try container.decodeIfPresent(String.self, forKey: .browserContextID)
        subtype = try container.decodeIfPresent(String.self, forKey: .subtype)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(targetID, forKey: .targetID)
        try container.encode(type, forKey: .type)
        try container.encode("", forKey: .title)
        try container.encode(url, forKey: .url)
        try container.encode(attached, forKey: .attached)
        try container.encodeIfPresent(openerID, forKey: .openerID)
        try container.encode(canAccessOpener, forKey: .canAccessOpener)
        try container.encodeIfPresent(openerFrameID, forKey: .openerFrameID)
        try container.encodeIfPresent(browserContextID, forKey: .browserContextID)
        try container.encodeIfPresent(subtype, forKey: .subtype)
    }
}

public struct CDPGetTargetsResult: Codable, Equatable, Sendable {
    public let targetInfos: [CDPTargetInfo]

    public init(targetInfos: [CDPTargetInfo]) {
        self.targetInfos = targetInfos
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case targetInfos }

    public init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        targetInfos = try container.decode([CDPTargetInfo].self, forKey: .targetInfos)
    }
}

private struct CDPErrorWire: Codable, Sendable {
    let code: Int

    init(code: Int) {
        self.code = code
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case code, message
    }

    init(from decoder: Decoder) throws {
        try decoder.browserRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try container.decode(Int.self, forKey: .code)
        _ = try container.decode(String.self, forKey: .message)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encode("CDP command rejected", forKey: .message)
    }
}

private struct BrowserAnyCodingKey: CodingKey {
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
    func browserRejectUnknownKeys<Key>(_ keyType: Key.Type) throws
    where Key: CodingKey & CaseIterable {
        let container = try self.container(keyedBy: BrowserAnyCodingKey.self)
        for key in container.allKeys {
            guard Key.allCases.contains(where: { $0.stringValue == key.stringValue }) else {
                throw BrowserControllerError.invalidJSON
            }
        }
    }
}
