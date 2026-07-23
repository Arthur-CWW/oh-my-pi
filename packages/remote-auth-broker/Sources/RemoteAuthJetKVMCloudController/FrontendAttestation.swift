import CryptoKit
import Foundation

enum FrontendAttestation {
    static let vendoredSourcePaths = [
        "ui/src/routes/devices.$id.tsx",
        "ui/src/components/WebRTCVideo.tsx",
        "ui/src/components/Header.tsx",
        "ui/src/components/PeerConnectionStatusCard.tsx",
        "ui/src/routes/login.tsx",
        "cloud.go",
    ]

    static func validatePinnedSource(commit: String, digest: String) throws {
        guard commit == JetKVMCloudContract.vendoredFrontendCommit,
              digest == JetKVMCloudContract.vendoredFrontendDigest
        else {
            throw JetKVMCloudError.configurationInvalid
        }
    }

    private static let maximumAssetCount = 128
    private static let maximumAssetURLBytes = 2_048

    static let deterministicICEBootstrapExpression = #"""
    (() => {
      "use strict";
      const marker = "__remoteAuthCanonicalICEV1";
      if (window[marker] === true) return true;
      const NativePeerConnection = window.RTCPeerConnection;
      if (typeof NativePeerConnection !== "function") return false;
      const canonicalConfiguration = (configuration) => {
        if (!configuration || !Array.isArray(configuration.iceServers)) {
          return configuration;
        }
        const iceServers = configuration.iceServers.map((server) => {
          if (!server || typeof server !== "object") return server;
          const sourceURLs = typeof server.urls === "string"
            ? [server.urls]
            : Array.isArray(server.urls) ? server.urls.slice() : [];
          const urls = sourceURLs.every((url) => typeof url === "string")
            ? sourceURLs.sort()
            : sourceURLs;
          return { ...server, urls };
        });
        iceServers.sort((left, right) => {
          const leftURLs = JSON.stringify(left?.urls ?? []);
          const rightURLs = JSON.stringify(right?.urls ?? []);
          return leftURLs < rightURLs ? -1 : leftURLs > rightURLs ? 1 : 0;
        });
        return { ...configuration, iceServers };
      };
      function CanonicalRTCPeerConnection(configuration, constraints) {
        return new NativePeerConnection(
          canonicalConfiguration(configuration),
          constraints
        );
      }
      Object.setPrototypeOf(CanonicalRTCPeerConnection, NativePeerConnection);
      CanonicalRTCPeerConnection.prototype = NativePeerConnection.prototype;
      Object.defineProperty(window, "RTCPeerConnection", {
        value: CanonicalRTCPeerConnection,
        configurable: false,
        enumerable: true,
        writable: false
      });
      Object.defineProperty(window, marker, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
      return true;
    })()
    """#

    static func assetManifestSHA256(_ assetURLs: [String]) throws -> String {
        try validateAssetURLs(assetURLs)
        let canonical = assetURLs.joined(separator: "\n")
        let digest = SHA256.hash(data: Data(canonical.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func attestAssetManifest(_ assetURLs: [String], expectedSHA256: String) throws {
        let actual = try assetManifestSHA256(assetURLs)
        guard actual == expectedSHA256 else {
            throw JetKVMCloudError.frontendAttestationRejected
        }
    }

    static func validateAssetURLs(_ assetURLs: [String]) throws {
        guard (1...maximumAssetCount).contains(assetURLs.count),
              assetURLs == assetURLs.sorted(),
              Set(assetURLs).count == assetURLs.count
        else {
            throw JetKVMCloudError.frontendAttestationRejected
        }
        for value in assetURLs {
            guard (1...maximumAssetURLBytes).contains(value.utf8.count),
                  value.utf8.allSatisfy({ $0 >= 0x21 && $0 <= 0x7e }),
                  let components = URLComponents(string: value),
                  components.scheme == "https",
                  components.host == "app.jetkvm.com",
                  components.port == nil,
                  components.user == nil,
                  components.password == nil,
                  components.query == nil,
                  components.fragment == nil,
                  components.string == value
            else {
                throw JetKVMCloudError.frontendAttestationRejected
            }
        }
    }

    // Returns a fixed schema of readiness booleans, bounded DOM numbers, and
    // same-origin build asset URLs. It never returns page text, markup, account
    // data, WebRTC objects, credentials, or browser storage.
    static let runtimeEvaluateExpression = #"""
    (() => {
      "use strict";
      let assetInventoryValid = true;
      const assetURLs = [];
      const appendAsset = (raw) => {
        if (typeof raw !== "string" || raw.length === 0) {
          assetInventoryValid = false;
          return;
        }
        try {
          assetURLs.push(new URL(raw, document.baseURI).href);
        } catch {
          assetInventoryValid = false;
        }
      };
      for (const script of document.querySelectorAll("script[src]")) {
        appendAsset(script.getAttribute("src"));
      }
      for (const link of document.querySelectorAll(
        'link[rel="stylesheet"][href],link[rel="modulepreload"][href]'
      )) {
        appendAsset(link.getAttribute("href"));
      }
      assetURLs.sort();
      const exactTextCount = (selector, expected) => {
        let count = 0;
        for (const element of document.querySelectorAll(selector)) {
          if (element.textContent?.trim() === expected) count += 1;
        }
        return count;
      };
      const videos = document.querySelectorAll("video");
      const video = videos.length === 1 ? videos[0] : null;
      const source = video?.srcObject;
      const tracks = source && typeof source.getVideoTracks === "function"
        ? source.getVideoTracks()
        : [];
      return {
        schemaVersion: 2,
        isTopLevel: window.top === window,
        originMatches: location.origin === "https://app.jetkvm.com",
        devicePathMatches: /^\/devices\/[A-Za-z0-9_-]{1,128}$/.test(location.pathname),
        canonicalICEInstalled: window.__remoteAuthCanonicalICEV1 === true,
        assetInventoryValid,
        assetURLs,
        focusTrapCount: document.querySelectorAll("#videoFocusTrap").length,
        devicesLinkCount: document.querySelectorAll('a[href="/devices"]').length,
        connectedTextCount: exactTextCount("span", "Connected"),
        loginHeadingCount: exactTextCount("h1,h2,h3,h4,h5,h6", "Log in to your JetKVM account"),
        takeoverHeadingCount: exactTextCount("h1,h2,h3,h4,h5,h6", "Another Active Session Detected"),
        videoCount: videos.length,
        videoReadyState: video?.readyState ?? 0,
        videoPaused: video?.paused ?? true,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        hasLiveVideoTrack: tracks.some((track) => track.readyState === "live"),
        focusOnTrap: document.activeElement?.id === "videoFocusTrap"
      };
    })()
    """#
}

enum FrontendPageState: String, Codable, CaseIterable, Equatable, Sendable {
    case ready
    case waiting
    case loginRequired = "login-required"
    case takeoverRequired = "takeover-required"
    case rejected
}

struct FrontendSnapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let isTopLevel: Bool
    let originMatches: Bool
    let devicePathMatches: Bool
    let canonicalICEInstalled: Bool
    let assetInventoryValid: Bool
    let assetURLs: [String]
    let focusTrapCount: Int
    let devicesLinkCount: Int
    let connectedTextCount: Int
    let loginHeadingCount: Int
    let takeoverHeadingCount: Int
    let videoCount: Int
    let videoReadyState: Int
    let videoPaused: Bool
    let videoWidth: Int
    let videoHeight: Int
    let hasLiveVideoTrack: Bool
    let focusOnTrap: Bool

    init(
        schemaVersion: Int,
        isTopLevel: Bool,
        originMatches: Bool,
        devicePathMatches: Bool,
        canonicalICEInstalled: Bool,
        assetInventoryValid: Bool,
        assetURLs: [String],
        focusTrapCount: Int,
        devicesLinkCount: Int,
        connectedTextCount: Int,
        loginHeadingCount: Int,
        takeoverHeadingCount: Int,
        videoCount: Int,
        videoReadyState: Int,
        videoPaused: Bool,
        videoWidth: Int,
        videoHeight: Int,
        hasLiveVideoTrack: Bool,
        focusOnTrap: Bool
    ) throws {
        try FrontendAttestation.validateAssetURLs(assetURLs)
        guard schemaVersion == 2,
              Self.validDOMCount(focusTrapCount),
              Self.validDOMCount(devicesLinkCount),
              Self.validDOMCount(connectedTextCount),
              Self.validDOMCount(loginHeadingCount),
              Self.validDOMCount(takeoverHeadingCount),
              Self.validDOMCount(videoCount),
              (0...4).contains(videoReadyState),
              (0...65_535).contains(videoWidth),
              (0...65_535).contains(videoHeight)
        else {
            throw JetKVMCloudError.frontendAttestationRejected
        }
        self.schemaVersion = schemaVersion
        self.isTopLevel = isTopLevel
        self.originMatches = originMatches
        self.devicePathMatches = devicePathMatches
        self.canonicalICEInstalled = canonicalICEInstalled
        self.assetInventoryValid = assetInventoryValid
        self.assetURLs = assetURLs
        self.focusTrapCount = focusTrapCount
        self.devicesLinkCount = devicesLinkCount
        self.connectedTextCount = connectedTextCount
        self.loginHeadingCount = loginHeadingCount
        self.takeoverHeadingCount = takeoverHeadingCount
        self.videoCount = videoCount
        self.videoReadyState = videoReadyState
        self.videoPaused = videoPaused
        self.videoWidth = videoWidth
        self.videoHeight = videoHeight
        self.hasLiveVideoTrack = hasLiveVideoTrack
        self.focusOnTrap = focusOnTrap
    }

    init(cdpValue: CloudCDPValue) throws {
        guard case let .object(object) = cdpValue,
              Set(object.keys) == Set(Self.CodingKeys.allCases.map(\.stringValue))
        else {
            throw JetKVMCloudError.cdpEvaluationRejected
        }
        try self.init(
            schemaVersion: Self.integer("schemaVersion", in: object),
            isTopLevel: Self.boolean("isTopLevel", in: object),
            originMatches: Self.boolean("originMatches", in: object),
            devicePathMatches: Self.boolean("devicePathMatches", in: object),
            canonicalICEInstalled: Self.boolean("canonicalICEInstalled", in: object),
            assetInventoryValid: Self.boolean("assetInventoryValid", in: object),
            assetURLs: Self.stringArray("assetURLs", in: object),
            focusTrapCount: Self.integer("focusTrapCount", in: object),
            devicesLinkCount: Self.integer("devicesLinkCount", in: object),
            connectedTextCount: Self.integer("connectedTextCount", in: object),
            loginHeadingCount: Self.integer("loginHeadingCount", in: object),
            takeoverHeadingCount: Self.integer("takeoverHeadingCount", in: object),
            videoCount: Self.integer("videoCount", in: object),
            videoReadyState: Self.integer("videoReadyState", in: object),
            videoPaused: Self.boolean("videoPaused", in: object),
            videoWidth: Self.integer("videoWidth", in: object),
            videoHeight: Self.integer("videoHeight", in: object),
            hasLiveVideoTrack: Self.boolean("hasLiveVideoTrack", in: object),
            focusOnTrap: Self.boolean("focusOnTrap", in: object)
        )
    }

    var state: FrontendPageState {
        if loginHeadingCount > 1 || takeoverHeadingCount > 1 {
            return .rejected
        }
        if loginHeadingCount == 1, takeoverHeadingCount == 0 {
            return .loginRequired
        }
        if takeoverHeadingCount == 1, loginHeadingCount == 0 {
            return .takeoverRequired
        }
        guard loginHeadingCount == 0, takeoverHeadingCount == 0,
              isTopLevel, originMatches, devicePathMatches,
              canonicalICEInstalled, assetInventoryValid
        else {
            return .rejected
        }
        guard focusTrapCount <= 1, devicesLinkCount <= 1,
              connectedTextCount <= 1, videoCount <= 1
        else {
            return .rejected
        }
        guard focusTrapCount == 1,
              devicesLinkCount == 1,
              connectedTextCount == 1,
              videoCount == 1,
              videoReadyState >= 2,
              !videoPaused,
              videoWidth > 0,
              videoHeight > 0,
              hasLiveVideoTrack,
              focusOnTrap
        else {
            return .waiting
        }
        return .ready
    }

    var isAttested: Bool { state == .ready }

    func attest() throws {
        switch state {
        case .ready:
            return
        case .waiting:
            throw JetKVMCloudError.frontendNotReady
        case .loginRequired:
            throw JetKVMCloudError.loginRequired
        case .takeoverRequired:
            throw JetKVMCloudError.takeoverRequired
        case .rejected:
            throw JetKVMCloudError.frontendAttestationRejected
        }
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion
        case isTopLevel
        case originMatches
        case devicePathMatches
        case canonicalICEInstalled
        case assetInventoryValid
        case assetURLs
        case focusTrapCount
        case devicesLinkCount
        case connectedTextCount
        case loginHeadingCount
        case takeoverHeadingCount
        case videoCount
        case videoReadyState
        case videoPaused
        case videoWidth
        case videoHeight
        case hasLiveVideoTrack
        case focusOnTrap
    }

    init(from decoder: Decoder) throws {
        try decoder.frontendRejectUnknownKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            schemaVersion: container.decode(Int.self, forKey: .schemaVersion),
            isTopLevel: container.decode(Bool.self, forKey: .isTopLevel),
            originMatches: container.decode(Bool.self, forKey: .originMatches),
            devicePathMatches: container.decode(Bool.self, forKey: .devicePathMatches),
            canonicalICEInstalled: container.decode(Bool.self, forKey: .canonicalICEInstalled),
            assetInventoryValid: container.decode(Bool.self, forKey: .assetInventoryValid),
            assetURLs: container.decode([String].self, forKey: .assetURLs),
            focusTrapCount: container.decode(Int.self, forKey: .focusTrapCount),
            devicesLinkCount: container.decode(Int.self, forKey: .devicesLinkCount),
            connectedTextCount: container.decode(Int.self, forKey: .connectedTextCount),
            loginHeadingCount: container.decode(Int.self, forKey: .loginHeadingCount),
            takeoverHeadingCount: container.decode(Int.self, forKey: .takeoverHeadingCount),
            videoCount: container.decode(Int.self, forKey: .videoCount),
            videoReadyState: container.decode(Int.self, forKey: .videoReadyState),
            videoPaused: container.decode(Bool.self, forKey: .videoPaused),
            videoWidth: container.decode(Int.self, forKey: .videoWidth),
            videoHeight: container.decode(Int.self, forKey: .videoHeight),
            hasLiveVideoTrack: container.decode(Bool.self, forKey: .hasLiveVideoTrack),
            focusOnTrap: container.decode(Bool.self, forKey: .focusOnTrap)
        )
    }

    private static func validDOMCount(_ value: Int) -> Bool {
        (0...256).contains(value)
    }

    private static func integer(_ key: String, in object: [String: CloudCDPValue]) throws -> Int {
        guard case let .integer(value)? = object[key],
              value >= Int64(Int.min), value <= Int64(Int.max)
        else {
            throw JetKVMCloudError.cdpEvaluationRejected
        }
        return Int(value)
    }

    private static func stringArray(
        _ key: String,
        in object: [String: CloudCDPValue]
    ) throws -> [String] {
        guard case let .array(values)? = object[key] else {
            throw JetKVMCloudError.cdpEvaluationRejected
        }
        return try values.map { value in
            guard case let .string(string) = value else {
                throw JetKVMCloudError.cdpEvaluationRejected
            }
            return string
        }
    }

    private static func boolean(_ key: String, in object: [String: CloudCDPValue]) throws -> Bool {
        guard case let .boolean(value)? = object[key] else {
            throw JetKVMCloudError.cdpEvaluationRejected
        }
        return value
    }
}

private struct FrontendAnyCodingKey: CodingKey {
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
    func frontendRejectUnknownKeys<Key>(_ keyType: Key.Type) throws
    where Key: CodingKey & CaseIterable {
        let container = try self.container(keyedBy: FrontendAnyCodingKey.self)
        for key in container.allKeys {
            guard Key.allCases.contains(where: { $0.stringValue == key.stringValue }) else {
                throw JetKVMCloudError.invalidJSON
            }
        }
    }
}
