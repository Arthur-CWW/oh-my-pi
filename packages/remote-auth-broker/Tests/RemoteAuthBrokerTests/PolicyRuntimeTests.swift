import Foundation
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class PolicyRuntimeTests: XCTestCase {
    private let zeroDigest = String(repeating: "0", count: 64)
    private let brokerExecutableDigest = String(repeating: "a", count: 64)
    private let brokerBuildDigest = String(repeating: "b", count: 64)
    private let callerDigest = String(repeating: "c", count: 64)
    private let extensionSourceDigest = String(repeating: "d", count: 64)
    private let extensionManifestDigest = String(repeating: "e", count: 64)
    private let actionDigest = String(repeating: "f", count: 64)
    private let pinnedHostKey = String(repeating: "8", count: 64)
    private let extensionId = String(repeating: "a", count: 32)
    private let jetKVMTLSSPKIDigest = String(repeating: "9", count: 64)
    private let frontendAssetManifestDigest = String(repeating: "5", count: 64)

    func testCanonicalInactivePolicyHasNoCloudControllerConfigurationAndDeniesEffects() throws {
        let policyURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("config/policy-inactive.json")
        let loaded = try PolicyLoader.load(Data(contentsOf: policyURL))

        XCTAssertEqual(loaded.document.canonicalStatus, .designInactive)
        XCTAssertEqual(loaded.document.policyDigestState, .inactivePlaceholder)
        XCTAssertEqual(loaded.document.maximumBiometricAgeMilliseconds, 0)
        XCTAssertFalse(loaded.document.active)
        XCTAssertFalse(loaded.document.permitsEffects)
        XCTAssertNil(loaded.document.verifiers.gdm)
        XCTAssertNil(loaded.document.verifiers.sudo)
        XCTAssertNil(loaded.document.authorityKeys.desktopBrowserSigningKeyId)
        XCTAssertNil(loaded.document.authorityKeys.sudoSigningKeyId)
        XCTAssertEqual(loaded.document.brokerIdentity.designatedRequirement, "INACTIVE-NO-REQUIREMENT")
        XCTAssertEqual(loaded.document.brokerIdentity.buildDigest, zeroDigest)
        XCTAssertEqual(loaded.document.caller.uid, UInt32.max)
        XCTAssertEqual(loaded.document.caller.codeIdentity, "INACTIVE-NO-CALLER")
        XCTAssertEqual(loaded.document.reviewer.retryBackoffMilliseconds, [250, 1_000])
        XCTAssertEqual(loaded.document.reviewer.exactEnvironment.path, "/usr/bin:/bin")
        XCTAssertTrue(loaded.document.jetKVM.hasNoConfiguration)
        XCTAssertNil(loaded.document.jetKVM.activeConfiguration)

        var partiallyConfigured = loaded.document
        partiallyConfigured.jetKVM.deviceId = "jetkvm-desktop"
        XCTAssertThrowsError(try partiallyConfigured.validate()) { error in
            XCTAssertEqual(error as? PolicyLoadError, .invalidActivationState)
        }
    }

    func testReviewedPolicyDigestMismatchIsRejected() throws {
        let document = activeDocument(policyDigest: String(repeating: "1", count: 64))

        XCTAssertThrowsError(try PolicyLoader.load(document: document)) { error in
            XCTAssertEqual(error as? PolicyLoadError, .digestMismatch)
        }
    }

    func testCompletePinnedCloudPolicyConstructsConfigurationLosslessly() throws {
        let policy = activeJetKVMPolicy()
        var document = activeDocument(policyDigest: String(repeating: "1", count: 64))
        document.jetKVM = policy

        XCTAssertNoThrow(try document.validate())
        let configuration = try XCTUnwrap(policy.activeConfiguration)
        XCTAssertEqual(configuration.chromeExecutablePath, policy.chromeExecutablePath)
        XCTAssertEqual(configuration.profileDirectoryPath, policy.profileDirectoryPath)
        XCTAssertEqual(configuration.deviceId, policy.deviceId)
        XCTAssertEqual(configuration.tlsSPKISHA256, policy.tlsSPKISHA256)
        XCTAssertEqual(configuration.frontendAssetManifestSHA256, policy.frontendAssetManifestSHA256)
        XCTAssertEqual(configuration.vendoredFrontendCommit, policy.vendoredFrontendCommit)
        XCTAssertEqual(configuration.vendoredFrontendDigest, policy.vendoredFrontendDigest)
        XCTAssertEqual(configuration.launchTimeoutSeconds, policy.launchTimeoutSeconds)
        XCTAssertEqual(configuration.cdpTimeoutSeconds, policy.cdpTimeoutSeconds)
        XCTAssertEqual(configuration.readinessTimeoutSeconds, policy.readinessTimeoutSeconds)
        XCTAssertEqual(configuration.replacementGraceSeconds, policy.replacementGraceSeconds)
        XCTAssertEqual(configuration.keyIntervalSeconds, policy.keyIntervalSeconds)
        XCTAssertEqual(configuration.maximumCDPMessageBytes, policy.maximumCDPMessageBytes)
        XCTAssertEqual(configuration.maximumCDPJSONDepth, policy.maximumCDPJSONDepth)
        XCTAssertEqual(configuration.maximumCDPJSONNodes, policy.maximumCDPJSONNodes)
        XCTAssertEqual(configuration.maximumCDPJSONStringBytes, policy.maximumCDPJSONStringBytes)
        XCTAssertEqual(configuration.maximumQueuedEvents, policy.maximumQueuedEvents)
        XCTAssertEqual(configuration.maximumQueuedEventBytes, policy.maximumQueuedEventBytes)
    }

    func testCloudPolicyRejectsPartialNoncanonicalUnpinnedAndOutOfBoundsConfigurations() throws {
        let valid = activeJetKVMPolicy()
        var partial = valid
        partial.maximumQueuedEventBytes = nil
        var relativeChrome = valid
        relativeChrome.chromeExecutablePath = "Applications/Google Chrome"
        var dotSegmentChrome = valid
        dotSegmentChrome.chromeExecutablePath = "/Applications/../Google Chrome"
        var repeatedSeparatorProfile = valid
        repeatedSeparatorProfile.profileDirectoryPath = "/tmp//jetkvm-profile"
        var trailingSeparatorProfile = valid
        trailingSeparatorProfile.profileDirectoryPath = "/tmp/jetkvm-profile/"
        var invalidDevice = valid
        invalidDevice.deviceId = "jetkvm.desktop"
        var emptyDevice = valid
        emptyDevice.deviceId = ""
        var oversizedDevice = valid
        oversizedDevice.deviceId = String(repeating: "a", count: 129)
        var uppercaseTLSPin = valid
        uppercaseTLSPin.tlsSPKISHA256 = String(repeating: "A", count: 64)
        var uppercaseAssetPin = valid
        uppercaseAssetPin.frontendAssetManifestSHA256 = String(repeating: "B", count: 64)
        var zeroTLSPin = valid
        zeroTLSPin.tlsSPKISHA256 = zeroDigest
        var zeroAssetPin = valid
        zeroAssetPin.frontendAssetManifestSHA256 = zeroDigest
        var unpinnedCommit = valid
        unpinnedCommit.vendoredFrontendCommit = String(repeating: "a", count: 40)
        var unpinnedDigest = valid
        unpinnedDigest.vendoredFrontendDigest = String(repeating: "b", count: 64)
        var launchTimeout = valid
        launchTimeout.launchTimeoutSeconds = 0
        var cdpTimeout = valid
        cdpTimeout.cdpTimeoutSeconds = 0.1
        var readinessTimeout = valid
        readinessTimeout.readinessTimeoutSeconds = 5
        readinessTimeout.cdpTimeoutSeconds = 10
        var replacementGrace = valid
        replacementGrace.replacementGraceSeconds = 1
        var keyInterval = valid
        keyInterval.keyIntervalSeconds = 0.01
        var messageBytes = valid
        messageBytes.maximumCDPMessageBytes = 4_095
        var jsonDepth = valid
        jsonDepth.maximumCDPJSONDepth = 3
        var jsonNodes = valid
        jsonNodes.maximumCDPJSONNodes = 255
        var jsonStringBytes = valid
        jsonStringBytes.maximumCDPMessageBytes = 4_096
        jsonStringBytes.maximumCDPJSONStringBytes = 4_097
        var queuedEvents = valid
        queuedEvents.maximumQueuedEvents = 0
        var queuedEventBytes = valid
        queuedEventBytes.maximumCDPMessageBytes = 8_192
        queuedEventBytes.maximumQueuedEventBytes = 4_096

        let invalidPolicies = [
            partial,
            relativeChrome,
            dotSegmentChrome,
            repeatedSeparatorProfile,
            trailingSeparatorProfile,
            invalidDevice,
            emptyDevice,
            oversizedDevice,
            uppercaseTLSPin,
            uppercaseAssetPin,
            zeroTLSPin,
            zeroAssetPin,
            unpinnedCommit,
            unpinnedDigest,
            launchTimeout,
            cdpTimeout,
            readinessTimeout,
            replacementGrace,
            keyInterval,
            messageBytes,
            jsonDepth,
            jsonNodes,
            jsonStringBytes,
            queuedEvents,
            queuedEventBytes,
        ]
        for invalidPolicy in invalidPolicies {
            XCTAssertNil(invalidPolicy.activeConfiguration)
            var document = activeDocument(policyDigest: String(repeating: "1", count: 64))
            document.jetKVM = invalidPolicy
            XCTAssertThrowsError(try document.validate()) { error in
                XCTAssertEqual(error as? PolicyLoadError, .invalidValue("jetKVM"))
            }
        }
    }

    func testCloudPolicyDecoderRejectsMissingFields() throws {
        let encoded = try JSONEncoder().encode(activeJetKVMPolicy())
        var partial = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        partial.removeValue(forKey: "maximumQueuedEventBytes")
        XCTAssertThrowsError(try JSONDecoder().decode(
            JetKVMPolicy.self,
            from: JSONSerialization.data(withJSONObject: partial)
        )) { error in
            XCTAssertEqual(error as? PolicyLoadError, .invalidValue("jetKVM"))
        }
    }

    func testGDMPolicyDeniesEveryNonGDMCapability() throws {
        let loaded = try loadedActivePolicy()

        XCTAssertNoThrow(try loaded.document.decision(
            for: gdmRequest(),
            policyDigest: loaded.digest
        ))
        assertRemoteError(.inactive) {
            try loaded.document.decision(
                for: bitwardenRequest(),
                policyDigest: loaded.digest
            )
        }
        assertRemoteError(.inactive) {
            try loaded.document.decision(
                for: websiteRequest(),
                policyDigest: loaded.digest
            )
        }
        assertRemoteError(.inactive) {
            try loaded.document.decision(
                for: sudoRequest(policyDigest: loaded.digest),
                policyDigest: loaded.digest
            )
        }

        assertRemoteError(.policyMismatch) {
            try loaded.document.decision(
                for: gdmRequest(),
                policyDigest: String(repeating: "9", count: 64)
            )
        }

        var gdm = gdmTarget()
        gdm.seat = "seat1"
        assertRemoteError(.targetMismatch) {
            try loaded.document.decision(
                for: request(
                    operation: .gdmLogin,
                    domain: .desktopBrowser,
                    target: .gdm(gdm)
                ),
                policyDigest: loaded.digest
            )
        }
    }

    private func loadedActivePolicy() throws -> LoadedPolicy {
        var document = activeDocument(policyDigest: String(repeating: "1", count: 64))
        var digestMaterial = document
        digestMaterial.policyDigest = zeroDigest
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        document.policyDigest = ProtocolCrypto.sha256Hex(try encoder.encode(digestMaterial))
        return try PolicyLoader.load(document: document)
    }

    private func activeDocument(policyDigest: String) -> BrokerPolicy {
        BrokerPolicy(
            policyId: "remote-auth-broker.active.tests.v1",
            policyDigest: policyDigest,
            policyDigestState: .reviewed,
            canonicalStatus: .active,
            active: true,
            maximumBiometricAgeMilliseconds: 5_000,
            brokerIdentity: BrokerIdentityPolicy(
                signingIdentifier: "com.example.remote-auth-broker",
                teamIdentifier: "TEAMID1234",
                designatedRequirement: "identifier com.example.remote-auth-broker and anchor apple generic",
                executableSHA256: brokerExecutableDigest,
                buildDigest: brokerBuildDigest
            ),
            sockets: SocketPolicy(
                brokerSocketPath: SocketPolicy.canonicalBrokerSocketPath,
                browserControllerSocketPath: SocketPolicy.canonicalBrowserControllerSocketPath
            ),
            reviewer: ReviewerPolicy(
                ompPath: "/Users/arthur/.local/bin/omp",
                reviewedPolicyModel: "openai-codex/gpt-5.6",
                fixedPrompt: "Review only the exact registered remote authentication operation and deny every mismatch.",
                promptPolicyDigest: String(repeating: "6", count: 64),
                reviewerBuildDigest: String(repeating: "7", count: 64),
                reviewedWorkingDirectory: "/Users/arthur/agents",
                exactEnvironment: ReviewerEnvironment(
                    home: "/Users/arthur",
                    temporaryDirectory: "/tmp",
                    locale: "C.UTF-8"
                ),
                retryBackoffMilliseconds: [250, 1_000],
                breakerConsecutiveThreshold: 3,
                breakerRollingThreshold: 5,
                breakerRollingWindow: 20
            ),
            jetKVM: activeJetKVMPolicy(),
            verifiers: VerifierPolicy(
                gdm: GDMVerifierPolicy(
                    verifierId: "desktop-gdm-verifier",
                    endpoint: "ubuntu-desktop.tailnet",
                    pinnedHostKeySHA256: pinnedHostKey,
                    recipientKeyId: "gdm-recipient-key",
                    recipientPublicKey: String(repeating: "A", count: 43)
                ),
                sudo: nil
            ),
            trustedOmpCallers: [
                TrustedOmpCaller(
                    uid: 501,
                    signingIdentifier: "com.openai.omp",
                    teamIdentifier: "OMPTEAM123",
                    executableSHA256: callerDigest,
                    buildDigest: callerDigest,
                    designatedRequirement: "identifier com.openai.omp and anchor apple generic"
                )
            ],
            credentialTargets: [
                .gdm(GDMCredentialTargetPolicy(
                    credentialId: "desktop-login",
                    account: "arthur-login",
                    verifierId: "desktop-gdm-verifier",
                    machineId: "ubuntu-desktop",
                    username: "arthur",
                    uid: 1_000,
                    seat: "seat0",
                    jetKVMDeviceId: "jetkvm-desktop"
                )),
            ],
            operations: [
                OperationPolicy(domain: .desktopBrowser, operation: .gdmLogin, risk: .medium, biometricPolicy: .standingGrantOrOneShot, maximumGrantLifetimeMilliseconds: 60_000),
            ],
            actions: [],
            caller: CallerPolicy(uid: 501, codeIdentity: "com.openai.omp", buildDigest: callerDigest),
            authorityKeys: AuthorityKeysPolicy(
                desktopBrowserSigningKeyId: "desktop-signing-key",
                sudoSigningKeyId: nil
            )
        )
    }

    private func activeJetKVMPolicy() -> JetKVMPolicy {
        JetKVMPolicy(
            chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            profileDirectoryPath: "/Users/arthur/Library/Application Support/RemoteAuthBroker/jetkvm-cloud-profile",
            deviceId: "jetkvm-desktop",
            tlsSPKISHA256: jetKVMTLSSPKIDigest,
            frontendAssetManifestSHA256: frontendAssetManifestDigest,
            vendoredFrontendCommit: "fe77acd5f00300a4ab9acd5da57d7bb0916351d9",
            vendoredFrontendDigest: "0ad51887f89bd16da9cec1931e9f3a982091881abdb7648e8de944f8306258d7",
            launchTimeoutSeconds: 30,
            cdpTimeoutSeconds: 10,
            readinessTimeoutSeconds: 45,
            replacementGraceSeconds: 1.25,
            keyIntervalSeconds: 0.035,
            maximumCDPMessageBytes: 1_048_576,
            maximumCDPJSONDepth: 64,
            maximumCDPJSONNodes: 100_000,
            maximumCDPJSONStringBytes: 262_144,
            maximumQueuedEvents: 256,
            maximumQueuedEventBytes: 2_097_152
        )
    }

    private func gdmRequest() -> ExecutionRequest {
        request(operation: .gdmLogin, domain: .desktopBrowser, target: .gdm(gdmTarget()))
    }

    private func bitwardenRequest() -> ExecutionRequest {
        request(operation: .bitwardenUnlock, domain: .desktopBrowser, target: .bitwarden(bitwardenTarget()))
    }

    private func websiteRequest() -> ExecutionRequest {
        request(operation: .websiteAutofill, domain: .desktopBrowser, target: .website(websiteTarget()))
    }

    private func sudoRequest(policyDigest: String) -> ExecutionRequest {
        request(operation: .sudo, domain: .sudo, target: .sudo(sudoTarget(policyDigest: policyDigest)))
    }

    private func gdmTarget() -> GDMTarget {
        GDMTarget(
            sshHostKeyDigest: pinnedHostKey,
            machineId: "ubuntu-desktop",
            bootId: "01890f3c-0000-7000-8000-000000000010",
            username: "arthur",
            uid: 1_000,
            seat: "seat0",
            tty: "tty1",
            rhost: .empty,
            greeterGeneration: 1,
            jetkvmDeviceId: "jetkvm-desktop",
            controllerGeneration: 1
        )
    }

    private func bitwardenTarget() -> BitwardenTarget {
        BitwardenTarget(
            hostIdentity: "macbook",
            graphicalSessionId: "console-1",
            chromeService: "com.google.Chrome.remote-auth",
            chromeExecutableDigest: extensionSourceDigest,
            chromePid: 42,
            profileIdentity: "remote-auth-profile",
            browserTargetId: "browser-target-1",
            windowId: "window-1",
            extensionId: extensionId,
            extensionVersion: "2026.7.1",
            manifestDigest: extensionManifestDigest,
            uiTarget: "popup"
        )
    }

    private func websiteTarget() -> WebsiteTarget {
        WebsiteTarget(
            hostIdentity: "macbook",
            graphicalSessionId: "console-1",
            chromeService: "com.google.Chrome.remote-auth",
            chromeExecutableDigest: extensionSourceDigest,
            chromePid: 42,
            profileIdentity: "remote-auth-profile",
            browserTargetId: "browser-target-1",
            windowId: "window-1",
            extensionId: extensionId,
            extensionVersion: "2026.7.1",
            manifestDigest: extensionManifestDigest,
            uiTarget: "active-tab",
            originSet: ["https://example.com:443"],
            activeTabId: "tab-1",
            frameId: "frame-1",
            formActionOrigin: "https://example.com:443",
            foregroundWindowId: "window-1",
            credentialPairingId: "example-pairing"
        )
    }

    private func sudoTarget(policyDigest: String) -> SudoTarget {
        SudoTarget(
            sshHostKeyDigest: pinnedHostKey,
            machineId: "ubuntu-desktop",
            bootId: "01890f3c-0000-7000-8000-000000000010",
            username: "arthur",
            uid: 1_000,
            sudoPolicyDigest: policyDigest,
            actionId: "restart-networking",
            executable: "/usr/bin/systemctl",
            argvDigest: actionDigest
        )
    }

    private func request(operation: AuthorizationOperation, domain: AuthorizationDomain, target: ExecutionTarget) -> ExecutionRequest {
        ExecutionRequest(
            requestId: "01890f3c-0000-7000-8000-000000000001",
            nonce: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            createdAt: 1_000,
            expiresAt: 2_000,
            principal: Principal(
                sessionId: "session-1",
                ownerEpoch: "01890f3c-0000-7000-8000-000000000002",
                pid: 42,
                uid: 501,
                codeIdentity: "com.openai.omp",
                buildDigest: callerDigest,
                runnerInstanceIdentity: "runner-1",
                ownershipSocketPath: "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock"
            ),
            authorizationModeRequested: .biometricOneShot,
            domain: domain,
            operation: operation,
            target: target,
            purpose: "Exercise exact policy binding",
            grantId: nil
        )
    }

    private func assertRemoteError<T>(_ expected: PublicError, _ body: () throws -> T, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try body(), file: file, line: line) { error in
            XCTAssertEqual(error as? RemoteAuthProtocolError, RemoteAuthProtocolError(expected), file: file, line: line)
        }
    }
}
