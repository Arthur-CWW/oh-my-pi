import Foundation
import XCTest
@testable import RemoteAuthBrowserController

final class RemoteBrowserControllerTests: XCTestCase {
    func testHostAttestationParserAcceptsPinnedChromeAndExtension() throws {
        let attestation = try BrowserHostAttestation.decode(
            Data(Self.hostAttestationJSON.utf8),
            maximumBytes: 16_384,
            configuration: try Self.configuration()
        )

        XCTAssertEqual(attestation.schemaVersion, 1)
        XCTAssertEqual(attestation.executablePath, BrowserControllerContract.chromeExecutablePath)
        XCTAssertEqual(attestation.extensionMetadata.extensionID, BrowserControllerContract.extensionID)
        XCTAssertEqual(attestation.extensionMetadata.version, BrowserControllerContract.extensionVersion)
    }

    func testHostAttestationParserRejectsUnknownFieldsAndVersionDrift() throws {
        let configuration = try Self.configuration()
        let unknownField = Self.hostAttestationJSON.replacingOccurrences(
            of: "\"schemaVersion\":1,",
            with: "\"schemaVersion\":1,\"unexpected\":true,"
        )
        XCTAssertThrowsError(
            try BrowserHostAttestation.decode(
                Data(unknownField.utf8),
                maximumBytes: 16_384,
                configuration: configuration
            )
        ) { error in
            XCTAssertEqual(error as? BrowserControllerError, .sshAttestationRejected)
        }

        let versionDrift = Self.hostAttestationJSON.replacingOccurrences(
            of: "\"version\":\"2026.6.1\"",
            with: "\"version\":\"2026.7.0\""
        )
        XCTAssertThrowsError(
            try BrowserHostAttestation.decode(
                Data(versionDrift.utf8),
                maximumBytes: 16_384,
                configuration: configuration
            )
        ) { error in
            XCTAssertEqual(error as? BrowserControllerError, .extensionAttestationRejected)
        }
    }
    func testBitwardenTargetPreservesStringWindowWithoutInventedSiteIdentity() throws {
        let target = BrowserTargetIdentity(
            bitwardenTargetID: "extension-target",
            windowID: "9223372036854775807"
        )

        XCTAssertEqual(target.targetID, "extension-target")
        XCTAssertEqual(target.windowID, "9223372036854775807")
        XCTAssertNil(target.topFrameID)
        XCTAssertNil(target.origin)
        XCTAssertNoThrow(
            try BrowserOperationBinding(
                requestID: "unlock-request",
                targetGeneration: 7,
                target: target
            )
        )

        let encoded = try JSONEncoder().encode(target)
        XCTAssertEqual(try JSONDecoder().decode(BrowserTargetIdentity.self, from: encoded), target)
    }

    func testWebsiteTargetPreservesExactActiveTabFrameFormOriginAndOriginSet() throws {
        let target = BrowserTargetIdentity(
            websiteActiveTabID: "active-tab-17",
            windowID: "42",
            topFrameID: "top-frame-9",
            formActionOrigin: "https://example.test"
        )
        let request = try BrowserControllerRequest(
            requestID: "fill-request",
            targetGeneration: 11,
            target: target,
            allowedFormActionOrigins: ["https://example.test"],
            itemAlias: "pairing-alias-01"
        )

        XCTAssertEqual(request.target.targetID, "active-tab-17")
        XCTAssertEqual(request.target.topFrameID, "top-frame-9")
        XCTAssertEqual(request.target.origin, "https://example.test")
        XCTAssertEqual(request.allowedFormActionOrigins, ["https://example.test"])
        XCTAssertThrowsError(
            try BrowserOperationBinding(
                requestID: "unlock-request",
                targetGeneration: 7,
                target: target
            )
        ) { error in
            XCTAssertEqual(error as? BrowserControllerError, .requestInvalid)
        }

        XCTAssertNoThrow(
            try BrowserValidation.validate(
                page: BrowserPageDOMResult(
                    documentURL: "https://example.test/login",
                    documentOrigin: "https://example.test",
                    isTopLevel: true,
                    iframeCount: 0,
                    formActions: ["/session"]
                ),
                for: request
            )
        )
    }

    func testWindowIDRejectsLossyNumericConversionsAndNoncanonicalStrings() throws {
        XCTAssertEqual(
            try BrowserValidation.cdpWindowID("9223372036854775807"),
            Int64.max
        )
        for invalid in ["0", "-1", "+1", "01", " 1", "1 ", "9223372036854775808"] {
            XCTAssertThrowsError(try BrowserValidation.cdpWindowID(invalid)) { error in
                XCTAssertEqual(error as? BrowserControllerError, .requestInvalid)
            }
        }

        let numericWindowJSON = Data(
            #"{"targetId":"extension-target","windowId":42}"#.utf8
        )
        XCTAssertThrowsError(
            try JSONDecoder().decode(BrowserTargetIdentity.self, from: numericWindowJSON)
        )
    }


    func testUnlockCommandPlanRequiresExactOfficialPrompt() throws {
        let prompt = Self.unlockPrompt()
        XCTAssertEqual(
            try BitwardenPopupCommandPlan.unlock(prompt: prompt),
            [.focusMasterPassword, .insertSecret, .submitUnlock]
        )

        let drifted = BrowserUnlockDOMResult(
            route: "/lock",
            passwordInputCount: 2,
            submitButtonCount: 1,
            warningCount: 0,
            errorCount: 0,
            lockedIndicatorCount: 1,
            loggedOutIndicatorCount: 0,
            accountSwitcherCount: 0,
            passwordRepromptCount: 0,
            inputPoint: BrowserCDPPoint(x: 10, y: 20),
            submitPoint: BrowserCDPPoint(x: 30, y: 40)
        )
        XCTAssertThrowsError(try BitwardenPopupCommandPlan.unlock(prompt: drifted)) { error in
            XCTAssertEqual(error as? BrowserControllerError, .popupStateRejected)
        }
    }

    func testAutofillCommandPlanRequiresOneExactAliasAndOfficialFillAction() throws {
        let alias = "pairing-alias-01"
        let exact = Self.popupResult()
        XCTAssertEqual(
            try BitwardenPopupCommandPlan.autofill(selection: exact, alias: alias),
            [.fillExactAlias(alias)]
        )

        let duplicate = BitwardenPopupDOMResult(
            route: BrowserControllerContract.unlockedVaultRoute,
            vaultUnlocked: true,
            autofillSuggestionsHeadingCount: 1,
            autofillSuggestionsDisplayedCount: 2,
            autofillSuggestionRowCount: 2,
            exactItemNameMatchCount: 2,
            officialFillActionCount: 2,
            warningCount: 0,
            errorCount: 0,
            duplicateCount: 1,
            lockedIndicatorCount: 0,
            loggedOutIndicatorCount: 0,
            accountSwitcherCount: 0,
            passwordRepromptCount: 0
        )
        XCTAssertThrowsError(
            try BitwardenPopupCommandPlan.autofill(selection: duplicate, alias: alias)
        ) { error in
            XCTAssertEqual(error as? BrowserControllerError, .popupStateRejected)
        }
    }

    func testAutofillDriftRejectsNavigationOriginDialogFrameAndFocusChanges() throws {
        let request = try Self.autofillRequest()
        let before = Self.snapshot(request: request)
        let cases: [(BrowserTargetSnapshot, BrowserControllerError)] = [
            (Self.snapshot(request: request, navigationSequence: 1), .browserNavigationObserved),
            (Self.snapshot(request: request, dialogSequence: 1), .browserDialogObserved),
            (Self.snapshot(request: request, frameSequence: 1), .iframeObserved),
            (Self.snapshot(request: request, focusSequence: 1), .focusDriftObserved),
            (Self.snapshot(request: request, originSequence: 1), .originDriftObserved),
        ]

        for (after, expected) in cases {
            XCTAssertThrowsError(
                try BrowserValidation.validateStability(before: before, after: after, for: request)
            ) { error in
                XCTAssertEqual(error as? BrowserControllerError, expected)
            }
        }
        let identityDrifts: [(BrowserTargetIdentity, BrowserControllerError)] = [
            (
                BrowserTargetIdentity(
                    websiteActiveTabID: "page-target",
                    windowID: "43",
                    topFrameID: "top-frame",
                    formActionOrigin: "https://example.test"
                ),
                .targetIdentityMismatch
            ),
            (
                BrowserTargetIdentity(
                    websiteActiveTabID: "page-target",
                    windowID: "42",
                    topFrameID: "other-frame",
                    formActionOrigin: "https://example.test"
                ),
                .targetIdentityMismatch
            ),
            (
                BrowserTargetIdentity(
                    websiteActiveTabID: "page-target",
                    windowID: "42",
                    topFrameID: "top-frame",
                    formActionOrigin: "https://other.test"
                ),
                .targetOriginMismatch
            ),
        ]
        for (identity, expected) in identityDrifts {
            XCTAssertThrowsError(
                try BrowserValidation.validate(
                    target: Self.snapshot(request: request, identity: identity),
                    for: request
                )
            ) { error in
                XCTAssertEqual(error as? BrowserControllerError, expected)
            }
        }
    }

    func testEventLedgerBindsOnlyTheQuarantinedTargetAndSession() {
        let matchingNavigation = CDPTransportEvent(
            method: "Page.frameNavigated",
            params: nil,
            sessionId: "page-session",
            wireByteCount: 32
        )
        let unrelatedDialog = CDPTransportEvent(
            method: "Page.javascriptDialogOpening",
            params: nil,
            sessionId: "other-session",
            wireByteCount: 32
        )
        let matchingOrigin = CDPTransportEvent(
            method: "Target.targetInfoChanged",
            params: .object([
                "targetInfo": .object(["targetId": .string("page-target")]),
            ]),
            sessionId: nil,
            wireByteCount: 64
        )

        var ledger = BrowserEventLedger()
        ledger.ingest(
            [matchingNavigation, unrelatedDialog, matchingOrigin],
            targetID: "page-target",
            sessionID: "page-session"
        )

        XCTAssertEqual(ledger.navigationSequence, 1)
        XCTAssertEqual(ledger.originSequence, 1)
        XCTAssertEqual(ledger.dialogSequence, 0)
        XCTAssertTrue(ledger.isNavigating)
    }

    func testUnlockAndAutofillCloseWithFullyDestroyedReleaseAttestations() throws {
        var unlock = try BrowserStateMachine(requestID: "unlock-request", targetGeneration: 9)
        try unlock.transition(to: .attached, requestID: "unlock-request", targetGeneration: 9)
        try unlock.transition(to: .attested, requestID: "unlock-request", targetGeneration: 9)
        try unlock.transition(to: .inputDispatched, requestID: "unlock-request", targetGeneration: 9)
        try unlock.transition(to: .closed, requestID: "unlock-request", targetGeneration: 9)
        let unlockRelease = try unlock.makeReleaseAttestation(
            navigationDestroyed: true,
            inputDestroyed: true,
            requestDestroyed: true,
            networkDestroyed: true
        )
        XCTAssertEqual(unlockRelease.disposition, .closed)

        var autofill = try BrowserStateMachine(requestID: "fill-request", targetGeneration: 10)
        try autofill.transition(to: .attached, requestID: "fill-request", targetGeneration: 10)
        try autofill.transition(to: .attested, requestID: "fill-request", targetGeneration: 10)
        try autofill.transition(to: .fillDispatched, requestID: "fill-request", targetGeneration: 10)
        try autofill.transition(to: .closed, requestID: "fill-request", targetGeneration: 10)
        let fillRelease = try autofill.makeReleaseAttestation(
            navigationDestroyed: true,
            inputDestroyed: true,
            requestDestroyed: true,
            networkDestroyed: true
        )
        XCTAssertEqual(fillRelease.disposition, .closed)
        XCTAssertNoThrow(try BrowserValidation.validate(releaseAttestation: fillRelease))
    }

    func testBrowserSecretMovesAndCanBeConsumedOnlyOnce() throws {
        var bytes = Array("static-nonsecret-fixture".utf8)
        let secret = try BrowserSecret(taking: &bytes)
        XCTAssertTrue(bytes.isEmpty)
        var consumed = try secret.take()
        XCTAssertEqual(String(bytes: consumed, encoding: .utf8), "static-nonsecret-fixture")
        consumed.withUnsafeMutableBytes { buffer in
            _ = buffer.initializeMemory(as: UInt8.self, repeating: 0)
        }
        XCTAssertThrowsError(try secret.take()) { error in
            XCTAssertEqual(error as? BrowserControllerError, .secretInvalid)
        }
    }

    private static func configuration() throws -> BrowserControllerConfiguration {
        try BrowserControllerConfiguration(
            runtimeDirectoryPath: "/tmp/remote-auth-browser-tests",
            sshDestination: "desktop",
            expectedChromeProduct: "Chrome/140.0.7339.1",
            expectedHostIdentity: "desktop-host",
            expectedProfilePath: "/home/arthur/.config/google-chrome-remote-auth",
            expectedGraphicalSession: "session-01",
            expectedManifestSHA256: String(repeating: "a", count: 64)
        )
    }

    private static func unlockPrompt() -> BrowserUnlockDOMResult {
        BrowserUnlockDOMResult(
            route: "/lock",
            passwordInputCount: 1,
            submitButtonCount: 1,
            warningCount: 0,
            errorCount: 0,
            lockedIndicatorCount: 1,
            loggedOutIndicatorCount: 0,
            accountSwitcherCount: 0,
            passwordRepromptCount: 0,
            inputPoint: BrowserCDPPoint(x: 10, y: 20),
            submitPoint: BrowserCDPPoint(x: 30, y: 40)
        )
    }

    private static func popupResult() -> BitwardenPopupDOMResult {
        BitwardenPopupDOMResult(
            route: BrowserControllerContract.unlockedVaultRoute,
            vaultUnlocked: true,
            autofillSuggestionsHeadingCount: 1,
            autofillSuggestionsDisplayedCount: 1,
            autofillSuggestionRowCount: 1,
            exactItemNameMatchCount: 1,
            officialFillActionCount: 1,
            warningCount: 0,
            errorCount: 0,
            duplicateCount: 0,
            lockedIndicatorCount: 0,
            loggedOutIndicatorCount: 0,
            accountSwitcherCount: 0,
            passwordRepromptCount: 0
        )
    }

    private static func autofillRequest() throws -> BrowserControllerRequest {
        try BrowserControllerRequest(
            requestID: "fill-request",
            targetGeneration: 11,
            target: BrowserTargetIdentity(
                websiteActiveTabID: "page-target",
                windowID: "42",
                topFrameID: "top-frame",
                formActionOrigin: "https://example.test"
            ),
            allowedFormActionOrigins: ["https://example.test"],
            itemAlias: "pairing-alias-01"
        )
    }

    private static func snapshot(
        request: BrowserControllerRequest,
        identity: BrowserTargetIdentity? = nil,
        navigationSequence: UInt64 = 0,
        dialogSequence: UInt64 = 0,
        frameSequence: UInt64 = 0,
        focusSequence: UInt64 = 0,
        originSequence: UInt64 = 0
    ) -> BrowserTargetSnapshot {
        BrowserTargetSnapshot(
            identity: identity ?? request.target,
            targetGeneration: request.targetGeneration,
            targetType: "page",
            targetURL: "https://example.test/login",
            loaderID: "loader-01",
            isAttached: true,
            isFocused: true,
            isTopLevel: true,
            isNavigating: false,
            openDialogCount: 0,
            iframeCount: 0,
            navigationSequence: navigationSequence,
            dialogSequence: dialogSequence,
            frameSequence: frameSequence,
            focusSequence: focusSequence,
            originSequence: originSequence
        )
    }

    private static let hostAttestationJSON = #"""
    {
      "schemaVersion":1,
      "hostIdentity":"desktop-host",
      "executablePath":"/usr/bin/google-chrome-stable",
      "profilePath":"/home/arthur/.config/google-chrome-remote-auth",
      "graphicalSession":"session-01",
      "processCount":1,
      "debuggingAddress":"127.0.0.1",
      "debuggingPort":9222,
      "extensionMetadata":{
        "extensionId":"nngceckbapebfimnlniiiahkandclblb",
        "version":"2026.6.1",
        "source":"official-chrome-web-store",
        "sourceTag":"browser-v2026.6.1",
        "manifestSHA256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "defaultPopup":"popup/index.html",
        "defaultLocale":"en",
        "activeLocale":"en"
      }
    }
    """#
}
