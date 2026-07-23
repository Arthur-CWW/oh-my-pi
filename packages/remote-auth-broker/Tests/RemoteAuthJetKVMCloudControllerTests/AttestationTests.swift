@testable import RemoteAuthJetKVMCloudController
import Foundation
import XCTest

final class FrontendAttestationTests: XCTestCase {
    private let assets = [
        "https://app.jetkvm.com/assets/app-123.css",
        "https://app.jetkvm.com/assets/app-456.js",
    ]

    func testCanonicalAssetManifestDigestAndAttestation() throws {
        let expected = "215dd48b8448aade6ef77bfa6318b5b980c687d49dc597611b80014a262ad05f"
        XCTAssertEqual(try FrontendAttestation.assetManifestSHA256(assets), expected)
        XCTAssertNoThrow(try FrontendAttestation.attestAssetManifest(
            assets,
            expectedSHA256: expected
        ))
        XCTAssertThrowsError(try FrontendAttestation.attestAssetManifest(
            assets,
            expectedSHA256: String(repeating: "0", count: 64)
        )) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .frontendAttestationRejected)
        }
    }

    func testAssetManifestRejectsNoncanonicalOrCrossOriginInventory() {
        XCTAssertThrowsError(try FrontendAttestation.assetManifestSHA256(Array(assets.reversed())))
        XCTAssertThrowsError(try FrontendAttestation.assetManifestSHA256([assets[0], assets[0]]))
        XCTAssertThrowsError(try FrontendAttestation.assetManifestSHA256([
            "https://example.com/assets/app.js",
        ]))
        XCTAssertThrowsError(try FrontendAttestation.assetManifestSHA256([
            "https://app.jetkvm.com/assets/app.js?mutable=1",
        ]))
    }

    func testReadySnapshotRequiresBootstrapAndCanonicalAssetInventory() throws {
        let ready = try snapshot(canonicalICEInstalled: true, assetInventoryValid: true)
        XCTAssertEqual(ready.state, .ready)
        XCTAssertNoThrow(try ready.attest())

        let missingBootstrap = try snapshot(
            canonicalICEInstalled: false,
            assetInventoryValid: true
        )
        XCTAssertEqual(missingBootstrap.state, .rejected)

        let invalidInventory = try snapshot(
            canonicalICEInstalled: true,
            assetInventoryValid: false
        )
        XCTAssertEqual(invalidInventory.state, .rejected)
    }

    func testConfigurationRequiresBothLowercasePins() throws {
        XCTAssertNoThrow(try configuration(
            tlsPin: String(repeating: "a", count: 64),
            assetPin: String(repeating: "b", count: 64)
        ))
        XCTAssertThrowsError(try configuration(
            tlsPin: String(repeating: "A", count: 64),
            assetPin: String(repeating: "b", count: 64)
        ))
        XCTAssertThrowsError(try configuration(
            tlsPin: String(repeating: "a", count: 64),
            assetPin: String(repeating: "b", count: 63)
        ))
    }

    private func snapshot(
        canonicalICEInstalled: Bool,
        assetInventoryValid: Bool
    ) throws -> FrontendSnapshot {
        try FrontendSnapshot(
            schemaVersion: 2,
            isTopLevel: true,
            originMatches: true,
            devicePathMatches: true,
            canonicalICEInstalled: canonicalICEInstalled,
            assetInventoryValid: assetInventoryValid,
            assetURLs: assets,
            focusTrapCount: 1,
            devicesLinkCount: 1,
            connectedTextCount: 1,
            loginHeadingCount: 0,
            takeoverHeadingCount: 0,
            videoCount: 1,
            videoReadyState: 4,
            videoPaused: false,
            videoWidth: 1_920,
            videoHeight: 1_080,
            hasLiveVideoTrack: true,
            focusOnTrap: true
        )
    }

    private func configuration(
        tlsPin: String,
        assetPin: String
    ) throws -> JetKVMCloudConfiguration {
        try JetKVMCloudConfiguration(
            chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            profileDirectoryPath: "/tmp/remote-auth-cloud-profile",
            deviceId: "device-1",
            tlsSPKISHA256: tlsPin,
            frontendAssetManifestSHA256: assetPin
        )
    }
}

final class TLSCertificateAttestationTests: XCTestCase {
    func testExtractsAndPinsLeafSubjectPublicKeyInfo() throws {
        let subjectPublicKeyInfo: [UInt8] = [
            0x30, 0x0c,
            0x30, 0x05, 0x06, 0x03, 0x2a, 0x03, 0x04,
            0x03, 0x03, 0x00, 0x01, 0x02,
        ]
        let certificate = syntheticCertificate(subjectPublicKeyInfo: subjectPublicKeyInfo)
        let expectedDigest = "576ae295decb861f0ef784333c6e649cef7964b7b44ecf83e259541f687b18b0"

        XCTAssertEqual(
            try TLSCertificateAttestation.subjectPublicKeyInfoDER(in: certificate),
            Data(subjectPublicKeyInfo)
        )
        XCTAssertEqual(
            try TLSCertificateAttestation.spkiSHA256Hex(certificateDER: certificate),
            expectedDigest
        )
        XCTAssertNoThrow(try TLSCertificateAttestation.attest(
            certificateChainBase64: [certificate.base64EncodedString()],
            expectedSPKISHA256: expectedDigest
        ))
        XCTAssertThrowsError(try TLSCertificateAttestation.attest(
            certificateChainBase64: [certificate.base64EncodedString()],
            expectedSPKISHA256: String(repeating: "0", count: 64)
        )) { error in
            XCTAssertEqual(error as? JetKVMCloudError, .tlsIdentityRejected)
        }
    }

    func testRejectsNoncanonicalBase64AndMalformedDER() {
        let certificate = syntheticCertificate(subjectPublicKeyInfo: [0x30, 0x00])
        XCTAssertThrowsError(try TLSCertificateAttestation.attest(
            certificateChainBase64: [certificate.base64EncodedString() + "\n"],
            expectedSPKISHA256: String(repeating: "0", count: 64)
        ))
        XCTAssertThrowsError(try TLSCertificateAttestation.subjectPublicKeyInfoDER(
            in: Data([0x30, 0x80, 0x00, 0x00])
        ))
    }

    private func syntheticCertificate(subjectPublicKeyInfo: [UInt8]) -> Data {
        let version = tlv(tag: 0xa0, content: tlv(tag: 0x02, content: [0x02]))
        let serial = tlv(tag: 0x02, content: [0x01])
        let emptySequence = tlv(tag: 0x30, content: [])
        let tbs = tlv(
            tag: 0x30,
            content: version
                + serial
                + emptySequence
                + emptySequence
                + emptySequence
                + emptySequence
                + subjectPublicKeyInfo
        )
        return Data(tlv(
            tag: 0x30,
            content: tbs + emptySequence + tlv(tag: 0x03, content: [0x00])
        ))
    }

    private func tlv(tag: UInt8, content: [UInt8]) -> [UInt8] {
        precondition(content.count < 128)
        return [tag, UInt8(content.count)] + content
    }
}
