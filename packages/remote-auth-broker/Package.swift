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
