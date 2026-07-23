import Foundation

enum WireValidation {
    static let maximumTime: UInt64 = 9_007_199_254_740_991

    static func protocolVersion(_ value: UInt32) throws {
        guard value == remoteAuthProtocolVersionV1 else { throw RemoteAuthProtocolError(.noncanonicalValue) }
    }

    static func time(_ value: UInt64) throws {
        guard value <= maximumTime else { throw RemoteAuthProtocolError(.noncanonicalValue) }
    }

    static func ownerEpoch(_ value: String) throws {
        let bytes = value.utf8
        guard bytes.count == 36 else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        for (index, byte) in bytes.enumerated() {
            switch index {
            case 8, 13, 18, 23:
                guard byte == 45 else { throw RemoteAuthProtocolError(.noncanonicalValue) }
            case 14:
                guard (49...56).contains(byte) else { throw RemoteAuthProtocolError(.noncanonicalValue) }
            case 19:
                guard byte == 56 || byte == 57 || byte == 97 || byte == 98 else {
                    throw RemoteAuthProtocolError(.noncanonicalValue)
                }
            default:
                guard (48...57).contains(byte) || (97...102).contains(byte) else {
                    throw RemoteAuthProtocolError(.noncanonicalValue)
                }
            }
        }
    }

    static func text(_ value: String) throws {
        let scalars = value.unicodeScalars
        guard !scalars.isEmpty, scalars.count <= 256 else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        guard scalars.allSatisfy({ $0.properties.generalCategory != .control }) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
    }

    static func digest(_ value: String) throws {
        let bytes = value.utf8
        guard bytes.count == 64, bytes.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
    }

    static func identifier(_ value: String) throws {
        try base64URL(value, minimum: 22, maximum: 86)
    }

    static func requestIdentifier(_ value: String) throws {
        try base64URL(value, minimum: 22, maximum: 64)
    }

    static func nonce(_ value: String) throws {
        try base64URL(value, minimum: 43, maximum: 43)
    }

    static func grantIdentifier(_ value: String) throws {
        let prefix = "grant-v1:"
        guard value.hasPrefix(prefix) else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        try base64URL(value.dropFirst(prefix.utf8.count), minimum: 22, maximum: 64)
    }

    @discardableResult
    private static func base64URL<S>(_ value: S, minimum: Int, maximum: Int) throws -> Int where S: StringProtocol {
        let bytes = value.utf8
        let count = bytes.count
        guard (minimum...maximum).contains(count) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }

        var lastSextet: UInt8?
        for byte in bytes {
            let sextet: UInt8
            switch byte {
            case 65...90: sextet = byte - 65
            case 97...122: sextet = byte - 97 + 26
            case 48...57: sextet = byte - 48 + 52
            case 45: sextet = 62
            case 95: sextet = 63
            default: throw RemoteAuthProtocolError(.noncanonicalValue)
            }
            lastSextet = sextet
        }

        guard let lastSextet else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        let remainder = count % 4
        guard remainder == 0
                || (remainder == 2 && lastSextet & 0x0f == 0)
                || (remainder == 3 && lastSextet & 0x03 == 0)
        else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        return (count / 4) * 3 + (remainder == 0 ? 0 : remainder - 1)
    }

    static func hpkeEncapsulatedKey(_ value: String) throws {
        guard try base64URL(value, minimum: 43, maximum: 43) == HPKEV1.encapsulatedKeyByteCount else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
    }

    static func ciphertext(_ value: String) throws {
        let byteCount = try base64URL(value, minimum: 22, maximum: 524_288)
        guard (HPKEV1.authenticationTagByteCount...HPKEV1.maximumCiphertextByteCount).contains(byteCount) else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
    }

    static func signature(_ value: String) throws {
        guard try base64URL(value, minimum: 86, maximum: 86) == 64 else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
    }

    static func origin(_ value: String) throws {
        guard value.utf8.count <= 253, value.hasPrefix("https://") else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        let authority = value.dropFirst(8)
        guard !authority.isEmpty else { throw RemoteAuthProtocolError(.noncanonicalValue) }

        let colon = authority.lastIndex(of: ":")
        let host = colon.map { authority[..<$0] } ?? authority[...]
        guard !host.isEmpty, !host.contains(":") else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }

        var labelLength = 0
        var firstByte: UInt8?
        var lastByte: UInt8?
        for byte in host.utf8 {
            if byte == 46 {
                guard (1...63).contains(labelLength), firstByte != 45, lastByte != 45 else {
                    throw RemoteAuthProtocolError(.noncanonicalValue)
                }
                labelLength = 0
                firstByte = nil
                lastByte = nil
                continue
            }
            guard (48...57).contains(byte) || (97...122).contains(byte) || byte == 45 else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
            if firstByte == nil { firstByte = byte }
            lastByte = byte
            labelLength += 1
            guard labelLength <= 63 else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        }
        guard labelLength > 0, firstByte != 45, lastByte != 45 else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }

        if let colon {
            let portText = authority[authority.index(after: colon)...]
            guard (1...5).contains(portText.utf8.count),
                  portText.utf8.allSatisfy({ (48...57).contains($0) }),
                  portText.utf8.first != 48
            else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
            var port = 0
            for byte in portText.utf8 { port = port * 10 + Int(byte - 48) }
            guard port <= 65_535, port != 443 else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
        }
    }

    static func executable(_ value: String) throws {
        let scalars = value.unicodeScalars
        guard scalars.count <= 512, scalars.first?.value == 47, scalars.last?.value != 47 else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        var previousWasSlash = false
        for scalar in scalars {
            guard !(scalar.value <= 0x1f || scalar.value == 0x7f) else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
            if scalar.value == 47 {
                guard !previousWasSlash else { throw RemoteAuthProtocolError(.noncanonicalValue) }
                previousWasSlash = true
            } else {
                previousWasSlash = false
            }
        }
    }

    static func ownershipSocketPath(_ value: String) throws {
        guard value.utf8.count <= 103,
              value.first == "/",
              value.last != "/",
              value.unicodeScalars.allSatisfy({ $0.properties.generalCategory != .control })
        else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        let components = value.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count >= 5,
              components[0].isEmpty,
              components.dropFirst().allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
              components[components.count - 4] == "owners-v1",
              components[components.count - 2] == "claim",
              components[components.count - 1] == "owner.sock"
        else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        let digest = components[components.count - 3].utf8
        guard digest.count == 64,
              digest.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        else { throw RemoteAuthProtocolError(.noncanonicalValue) }
    }

    static func agreement(domain: AuthorizationDomain, operation: AuthorizationOperation, target: ExecutionTarget) throws {
        let expectedDomain: AuthorizationDomain
        switch operation {
        case .sudo: expectedDomain = .sudo
        case .gdmLogin, .bitwardenUnlock, .websiteAutofill: expectedDomain = .desktopBrowser
        }
        guard domain.rawValue == expectedDomain.rawValue else { throw RemoteAuthProtocolError(.domainMismatch) }
        switch (operation, target) {
        case (.gdmLogin, .gdm), (.bitwardenUnlock, .bitwarden), (.websiteAutofill, .website), (.sudo, .sudo):
            return
        default:
            throw RemoteAuthProtocolError(.targetMismatch)
        }
    }
}

extension Principal: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.text(sessionId)
        try WireValidation.ownerEpoch(ownerEpoch)
        try WireValidation.text(codeIdentity)
        try WireValidation.digest(buildDigest)
        try WireValidation.text(runnerInstanceIdentity)
        try WireValidation.ownershipSocketPath(ownershipSocketPath)
    }
}

extension GDMTarget: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.digest(sshHostKeyDigest)
        try WireValidation.text(machineId)
        try WireValidation.text(bootId)
        try WireValidation.text(username)
        guard pamService == "gdm-password" else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        try WireValidation.text(seat)
        try WireValidation.text(tty)
        try WireValidation.time(greeterGeneration)
        try WireValidation.text(jetkvmDeviceId)
        try WireValidation.time(controllerGeneration)
    }
}

extension BitwardenTarget: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.text(hostIdentity)
        try WireValidation.text(graphicalSessionId)
        try WireValidation.text(chromeService)
        try WireValidation.digest(chromeExecutableDigest)
        try WireValidation.text(profileIdentity)
        try WireValidation.text(browserTargetId)
        try WireValidation.text(windowId)
        try WireValidation.text(extensionId)
        try WireValidation.text(extensionVersion)
        guard extensionSource == "official-chrome-web-store" else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        try WireValidation.digest(manifestDigest)
        try WireValidation.text(uiTarget)
    }
}

extension WebsiteTarget: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.text(hostIdentity)
        try WireValidation.text(graphicalSessionId)
        try WireValidation.text(chromeService)
        try WireValidation.digest(chromeExecutableDigest)
        try WireValidation.text(profileIdentity)
        try WireValidation.text(browserTargetId)
        try WireValidation.text(windowId)
        try WireValidation.text(extensionId)
        try WireValidation.text(extensionVersion)
        guard extensionSource == "official-chrome-web-store" else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        try WireValidation.digest(manifestDigest)
        try WireValidation.text(uiTarget)
        guard (1...16).contains(originSet.count) else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        var previous: String?
        for origin in originSet {
            try WireValidation.origin(origin)
            if let previous {
                guard previous < origin else { throw RemoteAuthProtocolError(.noncanonicalValue) }
            }
            previous = origin
        }
        try WireValidation.text(activeTabId)
        try WireValidation.text(frameId)
        try WireValidation.origin(formActionOrigin)
        guard originSet.contains(formActionOrigin) else { throw RemoteAuthProtocolError(.targetMismatch) }
        try WireValidation.text(foregroundWindowId)
        try WireValidation.text(credentialPairingId)
    }
}

extension SudoTarget: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.digest(sshHostKeyDigest)
        try WireValidation.text(machineId)
        try WireValidation.text(bootId)
        try WireValidation.text(username)
        try WireValidation.digest(sudoPolicyDigest)
        try WireValidation.text(actionId)
        try WireValidation.executable(executable)
        try WireValidation.digest(argvDigest)
    }
}

extension ExecutionTarget: ProtocolValidatable {
    public func validate() throws {
        switch self {
        case .gdm(let target): try target.validate()
        case .bitwarden(let target): try target.validate()
        case .website(let target): try target.validate()
        case .sudo(let target): try target.validate()
        }
    }
}

extension ExecutionRequest {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try WireValidation.requestIdentifier(requestId)
        try WireValidation.nonce(nonce)
        try WireValidation.time(createdAt)
        try WireValidation.time(expiresAt)
        try principal.validate()
        try target.validate()
        try WireValidation.text(purpose)
        if let grantId { try WireValidation.grantIdentifier(grantId) }
        try WireValidation.agreement(domain: domain, operation: operation, target: target)
        guard expiresAt > createdAt else { throw RemoteAuthProtocolError(.requestExpired) }
        guard expiresAt - createdAt <= remoteAuthMaximumRequestLifetimeMilliseconds else {
            throw RemoteAuthProtocolError(.noncanonicalValue)
        }
        switch authorizationModeRequested {
        case .delegated:
            guard grantId != nil else { throw RemoteAuthProtocolError(.grantRequired) }
        case .biometricOneShot:
            guard grantId == nil else { throw RemoteAuthProtocolError(.grantForbidden) }
        }
    }
}

extension PrincipalSelector: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.text(sessionId)
        try WireValidation.ownerEpoch(ownerEpoch)
        try WireValidation.text(codeIdentity)
        try WireValidation.digest(buildDigest)
    }
}

extension Grant {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try WireValidation.grantIdentifier(grantId)
        try principalSelector.validate()
        try targetPredicate.validate()
        try WireValidation.time(issuedAt)
        try WireValidation.time(expiresAt)
        if let revokedAt { try WireValidation.time(revokedAt) }
        if let consumedAt { try WireValidation.time(consumedAt) }
        try WireValidation.digest(policyDigest)
        try WireValidation.digest(brokerBuildDigest)
        try WireValidation.text(brokerCodeIdentity)
        try WireValidation.identifier(biometricEvidenceId)
        try WireValidation.time(biometricIssuedAt)
        try WireValidation.agreement(domain: domain, operation: operation, target: targetPredicate)
        guard expiresAt > issuedAt, biometricIssuedAt <= issuedAt else { throw RemoteAuthProtocolError(.grantInvalid) }
        if let revokedAt, !(issuedAt...expiresAt).contains(revokedAt) {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        if let consumedAt, !(issuedAt...expiresAt).contains(consumedAt) {
            throw RemoteAuthProtocolError(.grantInvalid)
        }
        switch lifecycleState {
        case .active:
            guard revokedAt == nil, consumedAt == nil else { throw RemoteAuthProtocolError(.grantInvalid) }
        case .consumed:
            guard consumedAt != nil, revokedAt == nil else { throw RemoteAuthProtocolError(.grantInvalid) }
        case .revoked:
            guard revokedAt != nil, consumedAt == nil else { throw RemoteAuthProtocolError(.grantInvalid) }
        case .expired, .invalidated:
            guard consumedAt == nil else { throw RemoteAuthProtocolError(.grantInvalid) }
        }
    }
}

extension ReceiptEvents: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.time(requestedAt)
        if let authorizedAt {
            try WireValidation.time(authorizedAt)
            guard authorizedAt >= requestedAt else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        }
        if let executingAt {
            try WireValidation.time(executingAt)
            guard let authorizedAt, executingAt >= authorizedAt else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        }
        if let terminalAt {
            try WireValidation.time(terminalAt)
            let predecessor = executingAt ?? authorizedAt ?? requestedAt
            guard terminalAt >= predecessor else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        }
    }
}

extension ReceiptMetadata {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try WireValidation.identifier(receiptId)
        try WireValidation.requestIdentifier(requestId)
        if let grantId { try WireValidation.grantIdentifier(grantId) }
        let expectedDomain: AuthorizationDomain
        switch operation {
        case .sudo: expectedDomain = .sudo
        case .gdmLogin, .bitwardenUnlock, .websiteAutofill: expectedDomain = .desktopBrowser
        }
        guard domain.rawValue == expectedDomain.rawValue else { throw RemoteAuthProtocolError(.domainMismatch) }
        switch authorizationModeUsed {
        case .delegated:
            guard grantId != nil else { throw RemoteAuthProtocolError(.grantRequired) }
        case .biometricOneShot:
            guard grantId == nil else { throw RemoteAuthProtocolError(.grantForbidden) }
        }
        try WireValidation.digest(targetFingerprint)
        try events.validate()
        try WireValidation.digest(policyDigest)
        try WireValidation.digest(brokerBuildDigest)
        try WireValidation.digest(brokerCodeDigest)
        if let browserTargetGeneration { try WireValidation.time(browserTargetGeneration) }
        switch state {
        case .requested:
            guard events.authorizedAt == nil, events.executingAt == nil, events.terminalAt == nil else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
        case .authorized:
            guard events.authorizedAt != nil, events.executingAt == nil, events.terminalAt == nil else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
        case .executing:
            guard events.authorizedAt != nil, events.executingAt != nil, events.terminalAt == nil else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
        case .succeeded, .failed, .cancelled, .expired, .revoked, .disabled:
            guard events.terminalAt != nil else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        }
        switch state {
        case .requested, .authorized, .executing, .succeeded:
            guard errorCode == nil else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        case .failed, .cancelled, .expired, .revoked, .disabled:
            guard errorCode != nil else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        }
        let releasesBrowserSecret = operation == .bitwardenUnlock || operation == .websiteAutofill
        if releasesBrowserSecret {
            guard targetReleaseDisposition != .notApplicable, browserTargetGeneration != nil else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
        } else {
            guard targetReleaseDisposition == .notApplicable, browserTargetGeneration == nil else {
                throw RemoteAuthProtocolError(.noncanonicalValue)
            }
        }
    }
}

extension EndpointStatus: ProtocolValidatable {
    public func validate() throws {
        guard ready == (errorCode == nil) else { throw RemoteAuthProtocolError(.noncanonicalValue) }
    }
}

extension PublicStatusMetadata {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        if let policyDigest { try WireValidation.digest(policyDigest) }
        if let installedBuildDigest { try WireValidation.digest(installedBuildDigest) }
        if let runningBuildDigest { try WireValidation.digest(runningBuildDigest) }
        if let codeIdentity { try WireValidation.text(codeIdentity) }
        if let jetkvmControllerGeneration { try WireValidation.time(jetkvmControllerGeneration) }
        try gdm.validate()
        try browser.validate()
        try sudo.validate()
        guard errors.count <= 8 else { throw RemoteAuthProtocolError(.noncanonicalValue) }
        for index in errors.indices {
            for earlier in errors[..<index] {
                guard earlier.rawValue != errors[index].rawValue else {
                    throw RemoteAuthProtocolError(.noncanonicalValue)
                }
            }
        }
    }
}

extension ControlRequest {
    public func validate() throws {
        switch self {
        case .requestState(let requestId), .cancel(let requestId):
            try WireValidation.requestIdentifier(requestId)
        case .grantRevoke(let grantId), .grantExpire(let grantId):
            try WireValidation.grantIdentifier(grantId)
        case .credentialForget(let credentialId):
            try WireValidation.identifier(credentialId)
        case .emergencyDisable(let reason):
            try WireValidation.text(reason)
        case .grantList, .reEnable, .status:
            break
        }
    }
}

extension GDMChallenge {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try WireValidation.identifier(challengeId)
        try WireValidation.nonce(challenge)
        try WireValidation.text(bootId)
        try WireValidation.time(issuedBoottimeMs)
        try WireValidation.time(expiresBoottimeMs)
        try WireValidation.digest(policyDigest)
        guard expiresBoottimeMs > issuedBoottimeMs,
              expiresBoottimeMs - issuedBoottimeMs <= remoteAuthMaximumGDMChallengeLifetimeMilliseconds
        else {
            throw RemoteAuthProtocolError(.challengeInvalid)
        }
    }
}

extension GDMEnvelope {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try request.validate()
        try challenge.validate()
        try WireValidation.identifier(issueId)
        try WireValidation.digest(sentinelHash)
        try WireValidation.hpkeEncapsulatedKey(hpkeEnc)
        try WireValidation.ciphertext(ciphertext)
        try WireValidation.identifier(signingKeyId)
        try WireValidation.signature(signature)
        guard request.operation == .gdmLogin else { throw RemoteAuthProtocolError(.targetMismatch) }
        guard case .gdm(let target) = request.target else { throw RemoteAuthProtocolError(.targetMismatch) }
        guard target.bootId == challenge.bootId else { throw RemoteAuthProtocolError(.challengeInvalid) }
    }
}

extension GDMClaim {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try WireValidation.requestIdentifier(requestId)
        try WireValidation.nonce(nonce)
        try WireValidation.identifier(issueId)
        guard isValidGDMSentinel(sentinel) else { throw RemoteAuthProtocolError(.claimRejected) }
        try WireValidation.text(username)
        guard pamService == "gdm-password" else { throw RemoteAuthProtocolError(.claimRejected) }
        try WireValidation.text(seat)
        try WireValidation.text(tty)
        try WireValidation.time(greeterGeneration)
        try WireValidation.time(controllerGeneration)
    }
}

extension SudoSignedRequest {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try request.validate()
        try WireValidation.digest(canonicalBodyDigest)
        try WireValidation.identifier(signingKeyId)
        try WireValidation.signature(signature)
        guard request.operation == .sudo else { throw RemoteAuthProtocolError(.targetMismatch) }
        guard case .sudo = request.target else { throw RemoteAuthProtocolError(.targetMismatch) }
        let acceptedBodyDigest = ProtocolCrypto.sha256Hex(try ProtocolTranscript.executionRequest(request))
        guard canonicalBodyDigest == acceptedBodyDigest else {
            throw RemoteAuthProtocolError(.integrityFailure)
        }
    }
}

extension ReviewerResult {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try WireValidation.identifier(reviewId)
        try WireValidation.digest(canonicalRequestDigest)
        try WireValidation.text(reviewerModel)
        try WireValidation.digest(reviewerBuildDigest)
        try WireValidation.digest(promptPolicyDigest)
        try WireValidation.text(reason)
        try WireValidation.text(rationale)
        guard (1...3).contains(attemptCount) else { throw RemoteAuthProtocolError(.reviewBlocked) }
        try WireValidation.time(startedAt)
        try WireValidation.time(completedAt)
        try WireValidation.time(expiresAt)
        guard completedAt >= startedAt, expiresAt > completedAt else {
            throw RemoteAuthProtocolError(.reviewBlocked)
        }

        let consistent: Bool
        switch (status, outcome, reasonCode) {
        case (.completed, .allow, .semanticAllow),
             (.completed, .deny, .semanticDeny),
             (.completed, .escalate, .semanticEscalate):
            consistent = true
        case (.completed, .blocked, .missingEvidence),
             (.completed, .blocked, .promptInjection),
             (.completed, .blocked, .digestMismatch),
             (.completed, .blocked, .truncatedInput),
             (.completed, .blocked, .omittedSecurityField),
             (.completed, .blocked, .canonicalActionUnreconstructable):
            consistent = true
        case (.failed, .blocked, .timeout),
             (.failed, .blocked, .modelFailure),
             (.failed, .blocked, .sessionFailure),
             (.failed, .blocked, .providerFailure),
             (.failed, .blocked, .transportFailure),
             (.failed, .blocked, .parseFailure),
             (.failed, .blocked, .reviewerSetupFailure),
             (.cancelled, .blocked, .cancelled):
            consistent = true
        default:
            consistent = false
        }
        guard consistent else { throw RemoteAuthProtocolError(.reviewBlocked) }
    }
}

extension GDMHPKEInfo: ProtocolValidatable {
    public func validate() throws {
        try WireValidation.protocolVersion(protocolVersion)
        try WireValidation.identifier(recipientKeyId)
    }
}

extension GDMHPKEAADInput: ProtocolValidatable {
    public func validate() throws {
        try challenge.validate()
        try WireValidation.identifier(issueId)
        try WireValidation.digest(sentinelHash)
    }
}

extension GDMEnvelopeSignatureInput: ProtocolValidatable {
    public func validate() throws {
        try HPKEV1.validateEncapsulatedKey(hpkeEnc)
        try HPKEV1.validateCiphertext(ciphertext)
        try WireValidation.identifier(signingKeyId)
    }
}
