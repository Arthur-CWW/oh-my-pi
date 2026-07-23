import CryptoKit
import Darwin
import Foundation
import Security

public struct ExpectedPeerIdentity: Equatable, Sendable {
    public let uid: uid_t
    public let signingIdentifier: String
    public let teamIdentifier: String
    public let executableSHA256: String

    public init(
        uid: uid_t,
        signingIdentifier: String,
        teamIdentifier: String,
        executableSHA256: String
    ) {
        self.uid = uid
        self.signingIdentifier = signingIdentifier
        self.teamIdentifier = teamIdentifier
        self.executableSHA256 = executableSHA256
    }
}

public struct AttestedPeer: Equatable, Sendable {
    public let uid: uid_t
    public let gid: gid_t
    public let pid: pid_t
    public let signingIdentifier: String
    public let teamIdentifier: String
    public let designatedRequirement: String
    public let executableSHA256: String

    public init(
        uid: uid_t,
        gid: gid_t,
        pid: pid_t,
        signingIdentifier: String,
        teamIdentifier: String,
        designatedRequirement: String,
        executableSHA256: String
    ) {
        self.uid = uid
        self.gid = gid
        self.pid = pid
        self.signingIdentifier = signingIdentifier
        self.teamIdentifier = teamIdentifier
        self.designatedRequirement = designatedRequirement
        self.executableSHA256 = executableSHA256
    }
}

public enum PeerIdentityComparator {
    public static func matches(_ attested: AttestedPeer, expected: ExpectedPeerIdentity) -> Bool {
        attested.uid == expected.uid
            && attested.signingIdentifier == expected.signingIdentifier
            && attested.teamIdentifier == expected.teamIdentifier
            && attested.executableSHA256 == expected.executableSHA256
    }
}

public enum PeerAttestationError: Error, Equatable, Sendable {
    case peerUnavailable
    case codeUnavailable
    case invalidCode
    case incompleteCodeIdentity
    case unsafeExecutable
    case executableReadFailed
    case identityMismatch
    case identityDrifted
}

public struct PeerAttestation: Sendable {
    private static let identityLimit = 4_096
    private static let requirementLimit = 65_536
    private static let hashBufferSize = 64 * 1_024

    public init() {}

    public func attest(
        socketDescriptor: Int32,
        expected: ExpectedPeerIdentity
    ) throws -> AttestedPeer {
        let firstPeer = try readPeer(from: socketDescriptor)
        guard firstPeer.uid == expected.uid else {
            throw PeerAttestationError.identityMismatch
        }

        let firstCode = try readLiveCode(for: firstPeer.pid)
        guard firstCode.signingIdentifier == expected.signingIdentifier else {
            throw PeerAttestationError.identityMismatch
        }
        guard firstCode.teamIdentifier == expected.teamIdentifier else {
            throw PeerAttestationError.identityMismatch
        }

        let executable = try openExecutable(firstCode.mainExecutable)
        defer { Darwin.close(executable.descriptor) }
        let digest = try hashExecutable(
            descriptor: executable.descriptor,
            initial: executable.snapshot
        )
        guard digest == expected.executableSHA256 else {
            throw PeerAttestationError.identityMismatch
        }

        let secondPeer = try readPeer(from: socketDescriptor)
        guard secondPeer == firstPeer else {
            throw PeerAttestationError.identityDrifted
        }

        let secondCode = try readLiveCode(for: secondPeer.pid)
        guard firstCode.sameIdentity(as: secondCode) else {
            throw PeerAttestationError.identityDrifted
        }

        let revalidatedExecutable = try openExecutable(secondCode.mainExecutable)
        defer { Darwin.close(revalidatedExecutable.descriptor) }
        guard revalidatedExecutable.snapshot == executable.snapshot else {
            throw PeerAttestationError.identityDrifted
        }

        let result = AttestedPeer(
            uid: firstPeer.uid,
            gid: firstPeer.gid,
            pid: firstPeer.pid,
            signingIdentifier: firstCode.signingIdentifier,
            teamIdentifier: firstCode.teamIdentifier,
            designatedRequirement: firstCode.designatedRequirement,
            executableSHA256: digest
        )
        guard PeerIdentityComparator.matches(result, expected: expected) else {
            throw PeerAttestationError.identityMismatch
        }
        return result
    }

    @discardableResult
    public func revalidate(
        attested: AttestedPeer,
        socketDescriptor: Int32,
        expected: ExpectedPeerIdentity
    ) throws -> AttestedPeer {
        let current = try attest(socketDescriptor: socketDescriptor, expected: expected)
        guard current == attested else {
            throw PeerAttestationError.identityDrifted
        }
        return current
    }

    private func readPeer(from descriptor: Int32) throws -> KernelPeer {
        var uid: uid_t = 0
        var gid: gid_t = 0
        guard getpeereid(descriptor, &uid, &gid) == 0 else {
            throw PeerAttestationError.peerUnavailable
        }

        var pid: pid_t = 0
        var length = socklen_t(MemoryLayout<pid_t>.size)
        guard Darwin.getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &pid, &length) == 0,
              length == socklen_t(MemoryLayout<pid_t>.size),
              pid > 0
        else {
            throw PeerAttestationError.peerUnavailable
        }
        return KernelPeer(uid: uid, gid: gid, pid: pid)
    }

    private func readLiveCode(for pid: pid_t) throws -> LiveCodeIdentity {
        let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &code) == errSecSuccess,
              let code
        else {
            throw PeerAttestationError.codeUnavailable
        }
        guard SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess else {
            throw PeerAttestationError.invalidCode
        }

        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess,
              let staticCode
        else {
            throw PeerAttestationError.invalidCode
        }

        let informationFlags = SecCSFlags(
            rawValue: kSecCSSigningInformation | kSecCSRequirementInformation
        )
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, informationFlags, &information) == errSecSuccess,
              let values = information as NSDictionary?
        else {
            throw PeerAttestationError.invalidCode
        }

        guard let signingIdentifier = values[kSecCodeInfoIdentifier] as? String,
              Self.isBounded(signingIdentifier, maximum: Self.identityLimit),
              let teamIdentifier = values[kSecCodeInfoTeamIdentifier] as? String,
              Self.isBounded(teamIdentifier, maximum: Self.identityLimit),
              let requirementObject = values[kSecCodeInfoDesignatedRequirement] as AnyObject?,
              CFGetTypeID(requirementObject) == SecRequirementGetTypeID(),
              let mainExecutable = values[kSecCodeInfoMainExecutable] as? URL,
              mainExecutable.isFileURL
        else {
            throw PeerAttestationError.incompleteCodeIdentity
        }
        let requirement = unsafeBitCast(requirementObject, to: SecRequirement.self)

        var requirementText: CFString?
        guard SecRequirementCopyString(requirement, SecCSFlags(), &requirementText) == errSecSuccess,
              let designatedRequirement = requirementText as String?,
              Self.isBounded(designatedRequirement, maximum: Self.requirementLimit)
        else {
            throw PeerAttestationError.incompleteCodeIdentity
        }

        return LiveCodeIdentity(
            signingIdentifier: signingIdentifier,
            teamIdentifier: teamIdentifier,
            designatedRequirement: designatedRequirement,
            mainExecutable: mainExecutable
        )
    }

    private func openExecutable(_ url: URL) throws -> OpenExecutable {
        let descriptor = url.withUnsafeFileSystemRepresentation { path -> Int32 in
            guard let path else { return -1 }
            return Darwin.open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        }
        guard descriptor >= 0 else {
            throw PeerAttestationError.unsafeExecutable
        }
        do {
            return OpenExecutable(
                descriptor: descriptor,
                snapshot: try executableSnapshot(descriptor)
            )
        } catch {
            Darwin.close(descriptor)
            throw error
        }
    }

    private func executableSnapshot(_ descriptor: Int32) throws -> ExecutableSnapshot {
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              status.st_size >= 0
        else {
            throw PeerAttestationError.unsafeExecutable
        }
        return ExecutableSnapshot(
            device: UInt64(truncatingIfNeeded: status.st_dev),
            inode: UInt64(truncatingIfNeeded: status.st_ino),
            size: UInt64(status.st_size),
            modifiedSeconds: Int64(status.st_mtimespec.tv_sec),
            modifiedNanoseconds: Int64(status.st_mtimespec.tv_nsec),
            changedSeconds: Int64(status.st_ctimespec.tv_sec),
            changedNanoseconds: Int64(status.st_ctimespec.tv_nsec)
        )
    }

    private func hashExecutable(
        descriptor: Int32,
        initial: ExecutableSnapshot
    ) throws -> String {
        var hasher = SHA256()
        var buffer = [UInt8](repeating: 0, count: Self.hashBufferSize)
        while true {
            let count = buffer.withUnsafeMutableBytes { bytes in
                Darwin.read(descriptor, bytes.baseAddress, bytes.count)
            }
            if count > 0 {
                buffer.withUnsafeBytes { bytes in
                    hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: bytes[..<count]))
                }
                continue
            }
            if count == 0 { break }
            if errno == EINTR { continue }
            throw PeerAttestationError.executableReadFailed
        }
        guard try executableSnapshot(descriptor) == initial else {
            throw PeerAttestationError.identityDrifted
        }

        let digest = hasher.finalize()
        return String(unsafeUninitializedCapacity: 64) { output in
            var index = 0
            for byte in digest {
                let high = byte >> 4
                let low = byte & 0x0f
                output[index] = high < 10 ? high + 0x30 : high + 0x57
                output[index + 1] = low < 10 ? low + 0x30 : low + 0x57
                index += 2
            }
            return index
        }
    }

    private static func isBounded(_ value: String, maximum: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= maximum && !value.utf8.contains(0)
    }
}

private struct KernelPeer: Equatable {
    let uid: uid_t
    let gid: gid_t
    let pid: pid_t
}

private struct LiveCodeIdentity {
    let signingIdentifier: String
    let teamIdentifier: String
    let designatedRequirement: String
    let mainExecutable: URL

    func sameIdentity(as other: LiveCodeIdentity) -> Bool {
        signingIdentifier == other.signingIdentifier
            && teamIdentifier == other.teamIdentifier
            && designatedRequirement == other.designatedRequirement
    }
}

private struct OpenExecutable {
    let descriptor: Int32
    let snapshot: ExecutableSnapshot
}

private struct ExecutableSnapshot: Equatable {
    let device: UInt64
    let inode: UInt64
    let size: UInt64
    let modifiedSeconds: Int64
    let modifiedNanoseconds: Int64
    let changedSeconds: Int64
    let changedNanoseconds: Int64
}
