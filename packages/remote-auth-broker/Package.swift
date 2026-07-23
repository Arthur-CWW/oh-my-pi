// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "RemoteAuthBroker",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(name: "RemoteAuthProtocol", targets: ["RemoteAuthProtocol"]),
        .library(name: "RemoteAuthBrowserController", targets: ["RemoteAuthBrowserController"]),
        .library(name: "RemoteAuthJetKVMCloudController", targets: ["RemoteAuthJetKVMCloudController"]),
        .executable(name: "remote-authd", targets: ["RemoteAuthBroker"]),
        .executable(name: "remote-authctl", targets: ["RemoteAuthBroker"]),
    ],
    targets: [
        .target(name: "RemoteAuthProtocol"),
        .target(name: "RemoteAuthBrowserController"),
        .target(name: "RemoteAuthJetKVMCloudController"),
        .executableTarget(
            name: "RemoteAuthBroker",
            dependencies: ["RemoteAuthProtocol", "RemoteAuthBrowserController", "RemoteAuthJetKVMCloudController"],
            path: "Sources/RemoteAuthBroker",
            sources: [
                "AuthorityState.swift",
                "AutoReviewer.swift",
                "BiometricAuthority.swift",
                "BitwardenSessionStore.swift",
                "BrokerService.swift",
                "BrokerWire.swift",
                "BrowserGoogleLogin.swift",
                "CLI.swift",
                "CryptoAuthority.swift",
                "ExecutionCoordinator.swift",
                "GDMActivation.swift",
                "KeychainAuthority.swift",
                "LiveOwnershipProvider.swift",
                "LiveOwnershipRegistry.swift",
                "PeerAttestation.swift",
                "Policy.swift",
                "RemoteEndpointClient.swift",
                "RuntimeBootstrap.swift",
                "SecureStateStore.swift",
                "UnixSocket.swift",
                "main.swift",
            ],
            linkerSettings: [
                .linkedLibrary("sqlite3", .when(platforms: [.macOS])),
            ]
        ),
        .testTarget(
            name: "RemoteAuthProtocolTests",
            dependencies: ["RemoteAuthProtocol"]
        ),
        .testTarget(
            name: "RemoteAuthBrowserControllerTests",
            dependencies: ["RemoteAuthBrowserController"]
        ),
        .testTarget(
            name: "RemoteAuthJetKVMCloudControllerTests",
            dependencies: ["RemoteAuthJetKVMCloudController"]
        ),
        .testTarget(
            name: "RemoteAuthBrokerTests",
            dependencies: ["RemoteAuthBroker", "RemoteAuthProtocol", "RemoteAuthJetKVMCloudController"]
        ),
    ]
)
