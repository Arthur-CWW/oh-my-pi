import Foundation

internal struct BrowserHostAttestation: Decodable, Equatable, Sendable {
    internal let schemaVersion: Int
    internal let hostIdentity: String
    internal let executablePath: String
    internal let profilePath: String
    internal let graphicalSession: String
    internal let processCount: Int
    internal let debuggingAddress: String
    internal let debuggingPort: Int
    internal let extensionMetadata: BrowserExtensionMetadata

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion
        case hostIdentity
        case executablePath
        case profilePath
        case graphicalSession
        case processCount
        case debuggingAddress
        case debuggingPort
        case extensionMetadata
    }

    internal init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: HostCodingKey.self)
        let expected = Set(CodingKeys.allCases.map(\.stringValue))
        guard Set(dynamic.allKeys.map(\.stringValue)) == expected else {
            throw BrowserControllerError.sshAttestationRejected
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        hostIdentity = try container.decode(String.self, forKey: .hostIdentity)
        executablePath = try container.decode(String.self, forKey: .executablePath)
        profilePath = try container.decode(String.self, forKey: .profilePath)
        graphicalSession = try container.decode(String.self, forKey: .graphicalSession)
        processCount = try container.decode(Int.self, forKey: .processCount)
        debuggingAddress = try container.decode(String.self, forKey: .debuggingAddress)
        debuggingPort = try container.decode(Int.self, forKey: .debuggingPort)
        extensionMetadata = try container.decode(
            BrowserExtensionMetadata.self,
            forKey: .extensionMetadata
        )
    }

    internal static func decode(
        _ data: Data,
        maximumBytes: Int,
        configuration: BrowserControllerConfiguration
    ) throws -> BrowserHostAttestation {
        guard !data.isEmpty, data.count <= maximumBytes else {
            throw BrowserControllerError.sshAttestationRejected
        }
        let value: BrowserHostAttestation
        do {
            value = try JSONDecoder().decode(BrowserHostAttestation.self, from: data)
        } catch let error as BrowserControllerError {
            throw error
        } catch {
            throw BrowserControllerError.sshAttestationRejected
        }
        try value.validate(configuration: configuration)
        return value
    }

    internal func validate(configuration: BrowserControllerConfiguration) throws {
        guard schemaVersion == 1,
              hostIdentity == configuration.expectedHostIdentity,
              executablePath == BrowserControllerContract.chromeExecutablePath,
              profilePath == configuration.expectedProfilePath,
              graphicalSession == configuration.expectedGraphicalSession,
              processCount == 1,
              debuggingAddress == "127.0.0.1",
              debuggingPort == BrowserControllerContract.chromeDebuggingPort,
              extensionMetadata.manifestSHA256 == configuration.expectedManifestSHA256
        else { throw BrowserControllerError.sshAttestationRejected }
        try BrowserValidation.validate(extension: extensionMetadata)
    }
}

private struct HostCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil

    init?(stringValue: String) {
        self.stringValue = stringValue
    }

    init?(intValue: Int) {
        return nil
    }
}
