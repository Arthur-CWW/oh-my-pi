import Foundation

public enum BrowserValidation {
    public static func validate(configuration: BrowserControllerConfiguration) throws {
        let destinationBytes = configuration.sshDestination.utf8
        guard configuration.runtimeDirectoryPath.first == "/",
              !configuration.runtimeDirectoryPath.utf8.contains(0),
              (2...72).contains(configuration.runtimeDirectoryPath.utf8.count),
              !destinationBytes.isEmpty,
              destinationBytes.count <= 255,
              destinationBytes.first != 45,
              destinationBytes.allSatisfy({
                  (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
                      || $0 == 45 || $0 == 46 || $0 == 58 || $0 == 64 || $0 == 95
              }),
              chromeVersion(in: configuration.expectedChromeProduct) != nil,
              isBoundedIdentifier(configuration.expectedHostIdentity, maximumBytes: 255),
              configuration.expectedProfilePath.first == "/",
              isBoundedText(configuration.expectedProfilePath, maximumBytes: 1_024),
              isBoundedIdentifier(configuration.expectedGraphicalSession, maximumBytes: 128),
              configuration.expectedManifestSHA256.utf8.count == 64,
              configuration.expectedManifestSHA256.utf8.allSatisfy({
                  (48...57).contains($0) || (97...102).contains($0)
              }),
              (1_024...65_536).contains(configuration.jsonVersionMaximumBytes),
              (4_096...BrowserControllerContract.defaultCDPMessageMaximumBytes)
                  .contains(configuration.cdpMessageMaximumBytes),
              (1_000...120_000).contains(configuration.operationTimeoutMilliseconds)
        else { throw BrowserControllerError.configurationInvalid }
    }

    public static func validate(request: BrowserControllerRequest) throws {
        guard isBoundedIdentifier(request.requestID, maximumBytes: 128),
              request.targetGeneration > 0,
              isBoundedIdentifier(request.target.targetID, maximumBytes: 256),
              isCanonicalCDPWindowID(request.target.windowID),
              let topFrameID = request.target.topFrameID,
              isBoundedIdentifier(topFrameID, maximumBytes: 256),
              let origin = request.target.origin,
              request.allowedFormActionOrigins.count >= 1,
              request.allowedFormActionOrigins.count <= 16,
              request.itemAlias.utf8.count <= 256,
              !request.itemAlias.isEmpty,
              !request.itemAlias.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              !request.itemAlias.allSatisfy({ $0.isWhitespace })
        else { throw BrowserControllerError.requestInvalid }

        let targetOrigin = try canonicalHTTPSOrigin(origin)
        guard targetOrigin == origin else {
            throw BrowserControllerError.requestInvalid
        }

        var seenOrigins = Set<String>()
        seenOrigins.reserveCapacity(request.allowedFormActionOrigins.count)
        var previousOrigin: String?
        for allowedOrigin in request.allowedFormActionOrigins {
            let canonical = try canonicalHTTPSOrigin(allowedOrigin)
            guard canonical == allowedOrigin,
                  seenOrigins.insert(allowedOrigin).inserted,
                  previousOrigin.map({ $0 < allowedOrigin }) ?? true
            else { throw BrowserControllerError.requestInvalid }
            previousOrigin = allowedOrigin
        }
        guard seenOrigins.contains(origin) else {
            throw BrowserControllerError.requestInvalid
        }
    }

    internal static func validate(bitwardenTarget target: BrowserTargetIdentity) throws {
        guard isBoundedIdentifier(target.targetID, maximumBytes: 256),
              isCanonicalCDPWindowID(target.windowID),
              target.topFrameID == nil,
              target.origin == nil
        else { throw BrowserControllerError.requestInvalid }
    }

    internal static func cdpWindowID(_ windowID: String) throws -> Int64 {
        guard isCanonicalCDPWindowID(windowID), let value = Int64(windowID), value > 0 else {
            throw BrowserControllerError.requestInvalid
        }
        return value
    }

    public static func validate(
        chromeVersion response: ChromeVersionResponse,
        expectedProduct: String
    ) throws {
        guard let expectedVersion = chromeVersion(in: expectedProduct),
              response.browser == expectedProduct,
              chromeVersion(in: response.browser) == expectedVersion
        else { throw BrowserControllerError.chromeProductMismatch }
        let expectedMajor = expectedVersion.prefix(while: { $0 != "." })
        guard !response.userAgent.contains("HeadlessChrome/"),
              !response.userAgent.contains("Chromium/"),
              userAgent(response.userAgent, containsChromeVersion: expectedVersion) ||
                userAgent(response.userAgent, containsChromeVersion: "\(expectedMajor).0.0.0")
        else { throw BrowserControllerError.chromeProductMismatch }

        guard response.protocolVersion == "1.3" else {
            throw BrowserControllerError.chromeProtocolMismatch
        }
        guard isBoundedText(response.userAgent, maximumBytes: 1_024),
              isBoundedText(response.v8Version, maximumBytes: 128),
              isBoundedText(response.webKitVersion, maximumBytes: 256)
        else { throw BrowserControllerError.invalidJSON }

        try validateDebuggerEndpoint(response.webSocketDebuggerURL)
    }

    public static func validate(extension metadata: BrowserExtensionMetadata) throws {
        guard metadata.extensionID == BrowserControllerContract.extensionID,
              metadata.version == BrowserControllerContract.extensionVersion,
              metadata.source == BrowserControllerContract.extensionSource,
              metadata.sourceTag == BrowserControllerContract.extensionSourceTag,
              metadata.manifestSHA256.utf8.count == 64,
              metadata.manifestSHA256.utf8.allSatisfy({
                  (48...57).contains($0) || (97...102).contains($0)
              }),
              metadata.defaultPopup == BrowserControllerContract.extensionDefaultPopup,
              metadata.defaultLocale == BrowserControllerContract.extensionLocale,
              metadata.activeLocale == BrowserControllerContract.extensionLocale
        else { throw BrowserControllerError.extensionAttestationRejected }
    }

    public static func validate(
        target snapshot: BrowserTargetSnapshot,
        for request: BrowserControllerRequest
    ) throws {
        guard snapshot.targetGeneration == request.targetGeneration else {
            throw BrowserControllerError.targetGenerationInvalid
        }
        guard snapshot.identity.targetID == request.target.targetID,
              snapshot.identity.windowID == request.target.windowID,
              snapshot.identity.topFrameID == request.target.topFrameID,
              snapshot.targetType == "page"
        else { throw BrowserControllerError.targetIdentityMismatch }
        guard snapshot.isAttached else { throw BrowserControllerError.targetNotAttached }
        guard let expectedOrigin = request.target.origin,
              snapshot.identity.origin == expectedOrigin,
              try origin(ofAbsoluteHTTPSURL: snapshot.targetURL) == expectedOrigin
        else { throw BrowserControllerError.targetOriginMismatch }
        guard snapshot.isTopLevel, snapshot.iframeCount == 0 else {
            throw BrowserControllerError.iframeObserved
        }
        guard snapshot.isFocused else { throw BrowserControllerError.focusDriftObserved }
        guard !snapshot.isNavigating, isBoundedIdentifier(snapshot.loaderID, maximumBytes: 256) else {
            throw BrowserControllerError.browserNavigationObserved
        }
        guard snapshot.openDialogCount == 0 else {
            throw BrowserControllerError.browserDialogObserved
        }
    }

    public static func validate(
        page result: BrowserPageDOMResult,
        for request: BrowserControllerRequest
    ) throws {
        guard result.isTopLevel, result.iframeCount == 0 else {
            throw BrowserControllerError.iframeObserved
        }
        guard let expectedOrigin = request.target.origin,
              result.documentOrigin == expectedOrigin,
              try canonicalHTTPSOrigin(result.documentOrigin) == expectedOrigin,
              try origin(ofAbsoluteHTTPSURL: result.documentURL) == expectedOrigin
        else { throw BrowserControllerError.targetOriginMismatch }
        guard (1...256).contains(result.formActions.count) else {
            throw BrowserControllerError.formActionRejected
        }

        let allowedOrigins = Set(request.allowedFormActionOrigins)
        var exactFormActionObserved = false
        for action in result.formActions {
            guard action.utf8.count <= 2_048 else {
                throw BrowserControllerError.formActionRejected
            }
            let actionOrigin = action.isEmpty
                ? result.documentOrigin
                : try resolvedHTTPSOrigin(action, relativeTo: result.documentURL)
            guard allowedOrigins.contains(actionOrigin) else {
                throw BrowserControllerError.formActionRejected
            }
            exactFormActionObserved = exactFormActionObserved || actionOrigin == expectedOrigin
        }
        guard exactFormActionObserved else {
            throw BrowserControllerError.formActionRejected
        }
    }

    public static func validateStability(
        before: BrowserTargetSnapshot,
        after: BrowserTargetSnapshot,
        for request: BrowserControllerRequest
    ) throws {
        try validate(target: before, for: request)
        try validate(target: after, for: request)

        guard before.identity == after.identity,
              before.targetGeneration == after.targetGeneration
        else { throw BrowserControllerError.targetIdentityMismatch }
        guard before.identity.origin == after.identity.origin,
              before.originSequence == after.originSequence
        else { throw BrowserControllerError.originDriftObserved }
        guard before.loaderID == after.loaderID,
              before.targetURL == after.targetURL,
              before.navigationSequence == after.navigationSequence
        else { throw BrowserControllerError.browserNavigationObserved }
        guard before.dialogSequence == after.dialogSequence else {
            throw BrowserControllerError.browserDialogObserved
        }
        guard before.frameSequence == after.frameSequence,
              before.iframeCount == after.iframeCount
        else { throw BrowserControllerError.iframeObserved }
        guard before.focusSequence == after.focusSequence,
              before.isFocused == after.isFocused
        else { throw BrowserControllerError.focusDriftObserved }
    }

    public static func validate(
        popup result: BitwardenPopupDOMResult,
        expectedAlias: String
    ) throws {
        guard !expectedAlias.isEmpty,
              expectedAlias.utf8.count <= 256,
              !expectedAlias.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              !expectedAlias.allSatisfy({ $0.isWhitespace })
        else { throw BrowserControllerError.requestInvalid }

        guard result.autofillSuggestionsHeadingCount >= 0,
              result.autofillSuggestionsDisplayedCount >= 0,
              result.autofillSuggestionRowCount >= 0,
              result.exactItemNameMatchCount >= 0,
              result.officialFillActionCount >= 0,
              result.warningCount >= 0,
              result.errorCount >= 0,
              result.duplicateCount >= 0,
              result.lockedIndicatorCount >= 0,
              result.loggedOutIndicatorCount >= 0,
              result.accountSwitcherCount >= 0,
              result.passwordRepromptCount >= 0
        else { throw BrowserControllerError.invalidJSON }
        guard result.route == BrowserControllerContract.unlockedVaultRoute,
              result.vaultUnlocked,
              result.lockedIndicatorCount == 0,
              result.loggedOutIndicatorCount == 0,
              result.accountSwitcherCount == 0,
              result.passwordRepromptCount == 0,
              result.warningCount == 0,
              result.errorCount == 0,
              result.duplicateCount == 0
        else { throw BrowserControllerError.popupStateRejected }
        guard result.autofillSuggestionsHeadingCount == 1,
              result.autofillSuggestionsDisplayedCount == 1,
              result.autofillSuggestionRowCount == 1,
              result.exactItemNameMatchCount == 1,
              result.officialFillActionCount == 1
        else { throw BrowserControllerError.autofillSelectionRejected }
    }

    public static func validate(releaseAttestation: BrowserReleaseAttestation) throws {
        guard isBoundedIdentifier(releaseAttestation.requestID, maximumBytes: 128),
              releaseAttestation.targetGeneration > 0,
              releaseAttestation.navigationDestroyed,
              releaseAttestation.inputDestroyed,
              releaseAttestation.requestDestroyed,
              releaseAttestation.networkDestroyed
        else { throw BrowserControllerError.releaseAttestationInvalid }
    }

    private static func validateDebuggerEndpoint(_ value: String) throws {
        guard value.utf8.count <= 1_024,
              let components = URLComponents(string: value),
              components.scheme == "ws",
              components.host == "127.0.0.1",
              components.port == BrowserControllerContract.chromeDebuggingPort,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.hasPrefix("/devtools/browser/")
        else { throw BrowserControllerError.debuggerEndpointRejected }

        let identifier = components.path.dropFirst("/devtools/browser/".count)
        guard !identifier.isEmpty,
              !identifier.contains("/"),
              identifier.utf8.count <= 256
        else { throw BrowserControllerError.debuggerEndpointRejected }
    }

    private static func chromeVersion(in product: String) -> String? {
        let prefix = "Chrome/"
        guard product.hasPrefix(prefix), product.utf8.count <= 64 else { return nil }
        let version = product.dropFirst(prefix.count)
        let components = version.split(separator: ".", omittingEmptySubsequences: false)
        guard components.count == 4 else { return nil }
        for component in components {
            guard !component.isEmpty,
                  component.allSatisfy({ $0.isASCII && $0.isNumber }),
                  component.count == 1 || component.first != "0",
                  UInt32(component) != nil
            else { return nil }
        }
        return String(version)
    }

    private static func canonicalHTTPSOrigin(_ value: String) throws -> String {
        guard value.utf8.count <= 253,
              let components = URLComponents(string: value),
              components.scheme == "https",
              let host = components.host,
              validDNSHost(host),
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/"
        else { throw BrowserControllerError.targetOriginMismatch }

        if let port = components.port, !(1...65_535).contains(port) {
            throw BrowserControllerError.targetOriginMismatch
        }
        if components.port == 443 {
            return "https://\(host)"
        }
        if let port = components.port {
            return "https://\(host):\(port)"
        }
        return "https://\(host)"
    }

    private static func origin(ofAbsoluteHTTPSURL value: String) throws -> String {
        guard value.utf8.count <= 4_096,
              let components = URLComponents(string: value),
              components.scheme == "https",
              let host = components.host,
              validDNSHost(host),
              components.user == nil,
              components.password == nil
        else { throw BrowserControllerError.targetOriginMismatch }

        guard let port = components.port else {
            return "https://\(host)"
        }
        guard (1...65_535).contains(port) else {
            throw BrowserControllerError.targetOriginMismatch
        }
        if port == 443 {
            return "https://\(host)"
        }
        return "https://\(host):\(port)"
    }

    private static func resolvedHTTPSOrigin(_ action: String, relativeTo documentURL: String) throws -> String {
        guard let baseURL = URL(string: documentURL),
              let resolvedURL = URL(string: action, relativeTo: baseURL)?.absoluteURL,
              let components = URLComponents(url: resolvedURL, resolvingAgainstBaseURL: false),
              components.scheme == "https",
              let host = components.host,
              validDNSHost(host),
              components.user == nil,
              components.password == nil
        else { throw BrowserControllerError.formActionRejected }

        guard let port = components.port else {
            return "https://\(host)"
        }
        guard (1...65_535).contains(port) else {
            throw BrowserControllerError.formActionRejected
        }
        if port == 443 {
            return "https://\(host)"
        }
        return "https://\(host):\(port)"
    }

    private static func validDNSHost(_ host: String) -> Bool {
        guard !host.isEmpty,
              host.utf8.count <= 253,
              host == host.lowercased(),
              !host.hasPrefix("."),
              !host.hasSuffix(".")
        else { return false }

        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        return labels.allSatisfy { label in
            guard !label.isEmpty,
                  label.utf8.count <= 63,
                  label.first != "-",
                  label.last != "-"
            else { return false }
            return label.allSatisfy { character in
                character.isASCII && (character.isLetter || character.isNumber || character == "-")
            }
        }
    }

    private static func isCanonicalCDPWindowID(_ value: String) -> Bool {
        let bytes = value.utf8
        guard !bytes.isEmpty,
              bytes.count <= 19,
              let first = bytes.first,
              (49...57).contains(first),
              bytes.dropFirst().allSatisfy({ (48...57).contains($0) })
        else { return false }
        return bytes.count < 19 || value <= "9223372036854775807"
    }

    private static func isBoundedIdentifier(_ value: String, maximumBytes: Int) -> Bool {
        !value.isEmpty &&
            value.utf8.count <= maximumBytes &&
            !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) &&
            !value.allSatisfy({ $0.isWhitespace })
    }

    private static func userAgent(_ userAgent: String, containsChromeVersion version: String) -> Bool {
        let token = "Chrome/\(version)"
        guard let range = userAgent.range(of: token) else { return false }
        return range.upperBound == userAgent.endIndex || userAgent[range.upperBound] == " "
    }

    private static func isBoundedText(_ value: String, maximumBytes: Int) -> Bool {
        !value.isEmpty &&
            value.utf8.count <= maximumBytes &&
            !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    }
}
