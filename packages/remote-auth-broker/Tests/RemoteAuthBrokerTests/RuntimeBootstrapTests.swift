import Darwin
import Foundation
import RemoteAuthProtocol
@testable import RemoteAuthBroker
import XCTest

final class RuntimeBootstrapTests: XCTestCase {
    func testInstalledPathsAreFixedAndOwnerScoped() {
        let paths = BrokerRuntimePaths()
        let root = "/Users/arthur/Library/Application Support/RemoteAuthBroker"

        XCTAssertEqual(paths.supportRootURL.path, root)
        XCTAssertEqual(paths.policyURL.path, root + "/config/policy.json")
        XCTAssertEqual(paths.stateDirectoryURL.path, root + "/state")
        XCTAssertEqual(paths.knownHostsURL.path, root + "/config/known_hosts")
        XCTAssertEqual(paths.browserConfigurationURL.path, root + "/config/browser-controller.json")
        XCTAssertEqual(paths.browserRuntimeDirectoryURL.path, root + "/run/browser")
    }

    func testStrictPolicyLoadRequiresOwnerOnlyFileMode() throws {
        let fixture = try makeInstalledInactivePolicy(mode: 0o644)
        defer { try? FileManager.default.removeItem(at: fixture.root) }

        XCTAssertThrowsError(try PolicyConfigurationStore(paths: fixture.paths).load()) { error in
            XCTAssertEqual(error as? RuntimeBootstrapError, .unsafePolicy)
        }

        XCTAssertEqual(chmod(fixture.paths.policyURL.path, 0o600), 0)
        let loaded = try PolicyConfigurationStore(paths: fixture.paths).load()
        XCTAssertEqual(loaded.document.canonicalStatus, .designInactive)
        XCTAssertFalse(loaded.document.permitsEffects)
    }

    func testStrictPolicyLoadRequiresOwnerOnlyConfigurationDirectory() throws {
        let fixture = try makeInstalledInactivePolicy(mode: 0o600)
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let config = fixture.paths.policyURL.deletingLastPathComponent()
        XCTAssertEqual(chmod(config.path, 0o755), 0)

        XCTAssertThrowsError(try PolicyConfigurationStore(paths: fixture.paths).load()) { error in
            XCTAssertEqual(error as? RuntimeBootstrapError, .unsafePath)
        }
    }

    func testPolicyDigestUsesZeroedDigestMaterial() throws {
        let original = try PolicyLoader.load(inactivePolicyData())
        var renamed = original.document
        renamed.policyId = "inactive-policy-renamed"
        let changed = try PolicyLoader.load(document: renamed)

        XCTAssertEqual(original.document.policyDigest, BrokerPolicy.inactiveDigestPlaceholder)
        XCTAssertEqual(changed.document.policyDigest, BrokerPolicy.inactiveDigestPlaceholder)
        XCTAssertNotEqual(original.digest, BrokerPolicy.inactiveDigestPlaceholder)
        XCTAssertNotEqual(original.digest, changed.digest)
        XCTAssertEqual(original.digest.utf8.count, 64)
        XCTAssertEqual(changed.digest.utf8.count, 64)
    }

    func testInactiveBootstrapConstructsNoActiveRuntimeAndReportsInactive() throws {
        let fixture = try makeInstalledInactivePolicy(mode: 0o600)
        defer { try? FileManager.default.removeItem(at: fixture.root) }

        let service = try RuntimeBootstrap(paths: fixture.paths).makeService()
        XCTAssertFalse(service.active)
        let status = try service.publicStatus(socketPosture: .ownerOnly)
        XCTAssertEqual(status.canonicalStatus, .designInactive)
        XCTAssertNil(status.policyDigest)
        XCTAssertEqual(status.errors, [.inactive])
        XCTAssertFalse(status.gdm.ready)
        XCTAssertFalse(status.browser.ready)
        XCTAssertFalse(status.sudo.ready)
    }

    func testProductionBootstrapUsesLiveOwnershipProof() {
        XCTAssertTrue(RuntimeBootstrap().ownershipProvider is LiveOwnershipProvider)
    }

    func testGDMReadinessPublishesGenerationOnlyWhenEveryDependencyIsReady() {
        let ready = RuntimeGDMReadiness.evaluate(
            socketPosture: .ownerOnly,
            keychainMetadataReady: true,
            remoteEndpointReady: true,
            controllerGeneration: 42
        )
        XCTAssertTrue(ready.endpoint.ready)
        XCTAssertNil(ready.endpoint.errorCode)
        XCTAssertEqual(ready.controllerGeneration, 42)

        let degradedCases = [
            RuntimeGDMReadiness.evaluate(
                socketPosture: .invalid,
                keychainMetadataReady: true,
                remoteEndpointReady: true,
                controllerGeneration: 42
            ),
            RuntimeGDMReadiness.evaluate(
                socketPosture: .ownerOnly,
                keychainMetadataReady: false,
                remoteEndpointReady: true,
                controllerGeneration: 42
            ),
            RuntimeGDMReadiness.evaluate(
                socketPosture: .ownerOnly,
                keychainMetadataReady: true,
                remoteEndpointReady: false,
                controllerGeneration: 42
            ),
            RuntimeGDMReadiness.evaluate(
                socketPosture: .ownerOnly,
                keychainMetadataReady: true,
                remoteEndpointReady: true,
                controllerGeneration: nil
            ),
        ]
        for degraded in degradedCases {
            XCTAssertFalse(degraded.endpoint.ready)
            XCTAssertEqual(degraded.endpoint.errorCode, .unavailable)
            XCTAssertNil(degraded.controllerGeneration)
        }
    }

    func testLocalAdministrationCommandParsingAndHelp() throws {
        XCTAssertEqual(
            try RemoteAuthCLI.parseLocalAdministration(["credential", "migrate-legacy"]),
            .migrateLegacyCredential
        )
        XCTAssertEqual(
            try RemoteAuthCLI.parseLocalAdministration(["credential", "migration-status"]),
            .legacyMigrationStatus
        )
        XCTAssertEqual(
            try RemoteAuthCLI.parseLocalAdministration(["credential", "finalize-cutover"]),
            .finalizeCredentialCutover
        )
        XCTAssertEqual(
            try RemoteAuthCLI.parseLocalAdministration(["activate", "--policy", "/tmp/reviewed.json"]),
            .activate(policyPath: "/tmp/reviewed.json")
        )
        XCTAssertEqual(try RemoteAuthCLI.parseLocalAdministration(["deactivate"]), .deactivate)
        XCTAssertNil(try RemoteAuthCLI.parseLocalAdministration(["status"]))
        XCTAssertThrowsError(try RemoteAuthCLI.parseLocalAdministration(["activate"]))
        XCTAssertThrowsError(
            try RemoteAuthCLI.parseLocalAdministration(["credential", "migrate-legacy", "extra"])
        )

        for command in [
            "credential migrate-legacy",
            "credential migration-status",
            "credential finalize-cutover",
            "activate --policy <owner-only-json>",
            "deactivate",
        ] {
            XCTAssertTrue(RemoteAuthCLI.help.contains(command), "missing help command: \(command)")
        }
    }

    func testMigrationStatusIsMetadataOnlyAndCoversCutoverPhases() {
        let cases: [(LegacyCredentialMigrationStatus, String, String)] = [
            (.notPrepared(destination: .absent), "not-prepared", "absent"),
            (.ready(destination: .verified), "ready", "verified"),
            (
                .finalizationPending(destination: .presentUnverified),
                "finalization-pending",
                "present-unverified"
            ),
            (.finalized(destination: .verified), "finalized", "verified"),
        ]

        for (status, phase, destination) in cases {
            let metadata = LegacyMigrationMetadata(status: status)
            XCTAssertEqual(metadata.phase, phase)
            XCTAssertEqual(metadata.destination, destination)
        }
    }

    private func makeInstalledInactivePolicy(
        mode: mode_t
    ) throws -> (root: URL, paths: BrokerRuntimePaths) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("remote-auth-bootstrap-\(UUID().uuidString)", isDirectory: true)
        let paths = BrokerRuntimePaths(supportRootURL: root)
        let config = paths.policyURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: config,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        XCTAssertEqual(chmod(root.path, 0o700), 0)
        XCTAssertEqual(chmod(config.path, 0o700), 0)
        try inactivePolicyData().write(to: paths.policyURL)
        XCTAssertEqual(chmod(paths.policyURL.path, mode), 0)
        return (root, paths)
    }

    private func inactivePolicyData() throws -> Data {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try Data(contentsOf: packageRoot.appendingPathComponent("config/policy-inactive.json"))
    }
}

