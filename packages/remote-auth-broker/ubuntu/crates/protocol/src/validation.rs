use std::collections::HashSet;

use crate::{
    crypto::sha256,
    transcript::{execution_request_transcript, TranscriptError},
    types::*,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_REQUEST_LIFETIME_MS: u64 = 120_000;
const MAX_CHALLENGE_LIFETIME_MS: u64 = 20_000;

pub trait Validate {
    fn validate(&self) -> Result<(), PublicError>;
}

fn valid_time(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}

fn contains_control(value: &str) -> bool {
    value.chars().any(char::is_control)
}

fn valid_text(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 256 && !contains_control(value)
}

pub(crate) fn valid_b64url(value: &str, min: usize, max: usize) -> bool {
    if !(min..=max).contains(&value.len()) {
        return false;
    }
    let Some(last) = value.bytes().try_fold(0_u8, |_, byte| {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'-' => Some(62),
            b'_' => Some(63),
            _ => None,
        }
    }) else {
        return false;
    };
    match value.len() % 4 {
        0 => true,
        2 => last & 0x0f == 0,
        3 => last & 0x03 == 0,
        _ => false,
    }
}

fn valid_owner_epoch(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            14 => (b'1'..=b'8').contains(byte),
            19 => matches!(*byte, b'8' | b'9' | b'a' | b'b'),
            _ => byte.is_ascii_digit() || (b'a'..=b'f').contains(byte),
        })
}

fn valid_gdm_ciphertext(value: &str) -> bool {
    valid_b64url(value, 1, 524_288)
        && (16..=393_216).contains(&(value.len() * 3 / 4))
}

pub(crate) fn valid_id(value: &str) -> bool {
    valid_b64url(value, 22, 86)
}

fn valid_request_id(value: &str) -> bool {
    valid_b64url(value, 22, 64)
}

fn valid_nonce(value: &str) -> bool {
    valid_b64url(value, 43, 43)
}

fn valid_grant_id(value: &str) -> bool {
    value.strip_prefix("grant-v1:").is_some_and(|suffix| valid_b64url(suffix, 22, 64))
}

pub(crate) fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_executable(value: &str) -> bool {
    value.chars().count() <= 512
        && value.starts_with('/')
        && !value.ends_with('/')
        && !contains_control(value)
        && value.split('/').skip(1).all(|part| !part.is_empty())
}

fn valid_ownership_socket_path(value: &str) -> bool {
    if value.len() > 103 || contains_control(value) || !value.starts_with('/') || value.ends_with('/') {
        return false;
    }
    let Some(prefix) = value.strip_suffix("/claim/owner.sock") else {
        return false;
    };
    let Some((root, digest)) = prefix.rsplit_once("/owners-v1/") else {
        return false;
    };
    root.len() > 1
        && root.split('/').skip(1).all(|component| !component.is_empty() && component != "." && component != "..")
        && valid_digest(digest)
}

fn valid_origin(value: &str) -> bool {
    if value.len() > 253
        || !value.starts_with("https://")
        || value.chars().any(char::is_control)
        || value.bytes().any(|byte| byte.is_ascii_uppercase())
    {
        return false;
    }
    let authority = &value[8..];
    if authority.is_empty() || authority.contains(['/', '@', '?', '#']) {
        return false;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port))
            if !host.is_empty()
                && !port.is_empty()
                && port.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            (host, Some(port))
        }
        Some(_) => return false,
        None => (authority, None),
    };
    if host.split('.').any(|label| {
        !(1..=63).contains(&label.len())
            || label.starts_with('-')
            || label.ends_with('-')
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    }) {
        return false;
    }
    match port {
        None => true,
        Some(port) => {
            !port.starts_with('0')
                && port
                    .parse::<u16>()
                    .is_ok_and(|number| number != 0 && number != 443)
        }
    }
}

fn valid_target_pair(domain: Domain, operation: Operation, target: &Target) -> Result<(), PublicError> {
    let target_operation = match target {
        Target::Gdm { .. } => (Domain::DesktopBrowser, Operation::GdmLogin),
        Target::Bitwarden { .. } => (Domain::DesktopBrowser, Operation::BitwardenUnlock),
        Target::Website { .. } => (Domain::DesktopBrowser, Operation::WebsiteAutofill),
        Target::Sudo { .. } => (Domain::Sudo, Operation::Sudo),
    };
    if domain != target_operation.0 {
        Err(PublicError::DomainMismatch)
    } else if operation != target_operation.1 {
        Err(PublicError::TargetMismatch)
    } else {
        Ok(())
    }
}

impl Validate for Principal {
    fn validate(&self) -> Result<(), PublicError> {
        if !valid_text(&self.session_id)
            || !valid_owner_epoch(&self.owner_epoch)
            || !valid_text(&self.code_identity)
            || !valid_digest(&self.build_digest)
            || !valid_text(&self.runner_instance_identity)
            || !valid_ownership_socket_path(&self.ownership_socket_path)
        {
            return Err(PublicError::PrincipalInvalid);
        }
        Ok(())
    }
}

impl Validate for Target {
    fn validate(&self) -> Result<(), PublicError> {
        let valid = match self {
            Target::Gdm {
                ssh_host_key_digest,
                machine_id,
                boot_id,
                username,
                greeter_generation,
                jetkvm_device_id,
                controller_generation,
                seat,
                tty,
                ..
            } => {
                valid_digest(ssh_host_key_digest)
                    && [machine_id, boot_id, username, jetkvm_device_id, seat, tty].into_iter().all(|value| valid_text(value))
                    && valid_time(*greeter_generation)
                    && valid_time(*controller_generation)
            }
            Target::Bitwarden {
                host_identity,
                graphical_session_id,
                chrome_service,
                chrome_executable_digest,
                profile_identity,
                browser_target_id,
                window_id,
                extension_id,
                extension_version,
                manifest_digest,
                ui_target,
                ..
            } => {
                [host_identity, graphical_session_id, chrome_service, profile_identity, browser_target_id, window_id, extension_id, extension_version, ui_target]
                    .into_iter()
                    .all(|value| valid_text(value))
                    && valid_digest(chrome_executable_digest)
                    && valid_digest(manifest_digest)
            }
            Target::Website {
                host_identity,
                graphical_session_id,
                chrome_service,
                chrome_executable_digest,
                profile_identity,
                browser_target_id,
                window_id,
                extension_id,
                extension_version,
                manifest_digest,
                ui_target,
                origin_set,
                active_tab_id,
                frame_id,
                form_action_origin,
                foreground_window_id,
                credential_pairing_id,
                ..
            } => {
                let text_fields_valid = [host_identity, graphical_session_id, chrome_service, profile_identity, browser_target_id, window_id, extension_id, extension_version, ui_target, active_tab_id, frame_id, foreground_window_id, credential_pairing_id]
                    .into_iter()
                    .all(|value| valid_text(value));
                let origins_valid = (1..=16).contains(&origin_set.len())
                    && origin_set.iter().all(|origin| valid_origin(origin))
                    && origin_set.windows(2).all(|pair| pair[0] < pair[1])
                    && valid_origin(form_action_origin)
                    && origin_set.binary_search(form_action_origin).is_ok();
                text_fields_valid && valid_digest(chrome_executable_digest) && valid_digest(manifest_digest) && origins_valid
            }
            Target::Sudo {
                ssh_host_key_digest,
                machine_id,
                boot_id,
                username,
                sudo_policy_digest,
                action_id,
                executable,
                argv_digest,
                ..
            } => {
                valid_digest(ssh_host_key_digest)
                    && [machine_id, boot_id, username, action_id].into_iter().all(|value| valid_text(value))
                    && valid_digest(sudo_policy_digest)
                    && valid_executable(executable)
                    && valid_digest(argv_digest)
            }
        };
        if valid { Ok(()) } else { Err(PublicError::NoncanonicalValue) }
    }
}

impl Validate for ExecutionRequest {
    fn validate(&self) -> Result<(), PublicError> {
        if !valid_request_id(&self.request_id) || !valid_nonce(&self.nonce) || !valid_time(self.created_at) || !valid_time(self.expires_at) || !valid_text(&self.purpose) {
            return Err(PublicError::NoncanonicalValue);
        }
        self.principal.validate()?;
        self.target.validate()?;
        valid_target_pair(self.domain, self.operation, &self.target)?;
        if self.expires_at <= self.created_at {
            return Err(PublicError::RequestExpired);
        }
        if self.expires_at - self.created_at > MAX_REQUEST_LIFETIME_MS {
            return Err(PublicError::NoncanonicalValue);
        }
        match (self.authorization_mode_requested, &self.grant_id) {
            (AuthorizationMode::Delegated, None) => Err(PublicError::GrantRequired),
            (AuthorizationMode::Delegated, Some(grant_id)) if !valid_grant_id(grant_id) => Err(PublicError::GrantInvalid),
            (AuthorizationMode::BiometricOneShot, Some(_)) => Err(PublicError::GrantForbidden),
            (AuthorizationMode::BiometricOneShot, None) | (AuthorizationMode::Delegated, Some(_)) => Ok(()),
        }
    }
}

impl Validate for PrincipalSelector {
    fn validate(&self) -> Result<(), PublicError> {
        if valid_text(&self.session_id) && valid_owner_epoch(&self.owner_epoch) && valid_text(&self.code_identity) && valid_digest(&self.build_digest) {
            Ok(())
        } else {
            Err(PublicError::GrantInvalid)
        }
    }
}

impl Validate for Grant {
    fn validate(&self) -> Result<(), PublicError> {
        if !valid_grant_id(&self.grant_id)
            || !valid_time(self.issued_at)
            || !valid_time(self.expires_at)
            || self.expires_at <= self.issued_at
            || !self.revoked_at.is_none_or(|time| valid_time(time) && (self.issued_at..=self.expires_at).contains(&time))
            || !self.consumed_at.is_none_or(|time| valid_time(time) && (self.issued_at..=self.expires_at).contains(&time))
            || !valid_digest(&self.policy_digest)
            || !valid_digest(&self.broker_build_digest)
            || !valid_text(&self.broker_code_identity)
            || !valid_id(&self.biometric_evidence_id)
            || !valid_time(self.biometric_issued_at)
            || self.biometric_issued_at > self.issued_at
        {
            return Err(PublicError::GrantInvalid);
        }
        self.principal_selector.validate()?;
        self.target_predicate.validate().map_err(|_| PublicError::GrantInvalid)?;
        valid_target_pair(self.domain, self.operation, &self.target_predicate).map_err(|_| PublicError::GrantInvalid)?;
        let lifecycle_valid = match self.lifecycle_state {
            GrantLifecycleState::Active => self.revoked_at.is_none() && self.consumed_at.is_none(),
            GrantLifecycleState::Consumed => self.consumed_at.is_some() && self.revoked_at.is_none(),
            GrantLifecycleState::Revoked => self.revoked_at.is_some() && self.consumed_at.is_none(),
            GrantLifecycleState::Expired | GrantLifecycleState::Invalidated => self.consumed_at.is_none(),
        };
        if lifecycle_valid { Ok(()) } else { Err(PublicError::GrantInvalid) }
    }
}

impl Validate for Receipt {
    fn validate(&self) -> Result<(), PublicError> {
        if !valid_id(&self.receipt_id)
            || !valid_request_id(&self.request_id)
            || !self.grant_id.as_deref().is_none_or(valid_grant_id)
            || !valid_digest(&self.target_fingerprint)
            || !valid_digest(&self.policy_digest)
            || !valid_digest(&self.broker_build_digest)
            || !valid_digest(&self.broker_code_digest)
            || !valid_time(self.events.requested_at)
            || !self.events.authorized_at.is_none_or(valid_time)
            || !self.events.executing_at.is_none_or(valid_time)
            || !self.events.terminal_at.is_none_or(valid_time)
            || !self.browser_target_generation.is_none_or(valid_time)
        {
            return Err(PublicError::NoncanonicalValue);
        }
        let expected_domain = if self.operation == Operation::Sudo {
            Domain::Sudo
        } else {
            Domain::DesktopBrowser
        };
        if self.domain != expected_domain {
            return Err(PublicError::DomainMismatch);
        }
        match (self.authorization_mode_used, &self.grant_id) {
            (AuthorizationMode::Delegated, None) => return Err(PublicError::GrantRequired),
            (AuthorizationMode::BiometricOneShot, Some(_)) => return Err(PublicError::GrantForbidden),
            _ => {}
        }
        let authorized_valid = self
            .events
            .authorized_at
            .is_none_or(|time| time >= self.events.requested_at);
        let executing_valid = self.events.executing_at.is_none_or(|time| {
            self.events
                .authorized_at
                .is_some_and(|authorized_at| time >= authorized_at)
        });
        let terminal_valid = self.events.terminal_at.is_none_or(|time| {
            time >= self
                .events
                .executing_at
                .or(self.events.authorized_at)
                .unwrap_or(self.events.requested_at)
        });
        let state_valid = match self.state {
            ReceiptState::Requested => {
                self.events.authorized_at.is_none()
                    && self.events.executing_at.is_none()
                    && self.events.terminal_at.is_none()
            }
            ReceiptState::Authorized => {
                self.events.authorized_at.is_some()
                    && self.events.executing_at.is_none()
                    && self.events.terminal_at.is_none()
            }
            ReceiptState::Executing => {
                self.events.authorized_at.is_some()
                    && self.events.executing_at.is_some()
                    && self.events.terminal_at.is_none()
            }
            ReceiptState::Succeeded
            | ReceiptState::Failed
            | ReceiptState::Cancelled
            | ReceiptState::Expired
            | ReceiptState::Revoked
            | ReceiptState::Disabled => self.events.terminal_at.is_some(),
        };
        let error_valid = match self.state {
            ReceiptState::Requested
            | ReceiptState::Authorized
            | ReceiptState::Executing
            | ReceiptState::Succeeded => self.error_code.is_none(),
            ReceiptState::Failed
            | ReceiptState::Cancelled
            | ReceiptState::Expired
            | ReceiptState::Revoked
            | ReceiptState::Disabled => self.error_code.is_some(),
        };
        let release_valid = match self.operation {
            Operation::BitwardenUnlock | Operation::WebsiteAutofill => {
                self.target_release_disposition != TargetReleaseDisposition::NotApplicable
                    && self.browser_target_generation.is_some()
            }
            Operation::GdmLogin | Operation::Sudo => {
                self.target_release_disposition == TargetReleaseDisposition::NotApplicable
                    && self.browser_target_generation.is_none()
            }
        };
        if authorized_valid && executing_valid && terminal_valid && state_valid && error_valid && release_valid {
            Ok(())
        } else {
            Err(PublicError::NoncanonicalValue)
        }
    }
}

impl Validate for EndpointStatus {
    fn validate(&self) -> Result<(), PublicError> {
        if self.ready == self.error_code.is_none() {
            Ok(())
        } else {
            Err(PublicError::NoncanonicalValue)
        }
    }
}

impl Validate for PublicStatus {
    fn validate(&self) -> Result<(), PublicError> {
        if !self.policy_digest.as_deref().is_none_or(valid_digest)
            || !self.installed_build_digest.as_deref().is_none_or(valid_digest)
            || !self.running_build_digest.as_deref().is_none_or(valid_digest)
            || !self.code_identity.as_deref().is_none_or(valid_text)
            || !self.jetkvm_controller_generation.is_none_or(valid_time)
            || self.errors.len() > 8
            || self.errors.iter().collect::<HashSet<_>>().len() != self.errors.len()
        {
            return Err(PublicError::NoncanonicalValue);
        }
        self.gdm.validate()?;
        self.browser.validate()?;
        self.sudo.validate()
    }
}

impl Validate for ControlRequest {
    fn validate(&self) -> Result<(), PublicError> {
        let valid = match self {
            Self::RequestState { request_id } | Self::Cancel { request_id } => valid_request_id(request_id),
            Self::GrantList {} | Self::ReEnable {} | Self::Status {} => true,
            Self::GrantRevoke { grant_id } | Self::GrantExpire { grant_id } => valid_grant_id(grant_id),
            Self::CredentialForget { credential_id } => valid_id(credential_id),
            Self::EmergencyDisable { reason } => valid_text(reason),
        };
        if valid { Ok(()) } else { Err(PublicError::NoncanonicalValue) }
    }
}

impl Validate for GdmChallenge {
    fn validate(&self) -> Result<(), PublicError> {
        if !valid_id(&self.challenge_id)
            || !valid_nonce(&self.challenge)
            || !valid_text(&self.boot_id)
            || !valid_time(self.issued_boottime_ms)
            || !valid_time(self.expires_boottime_ms)
            || self.expires_boottime_ms <= self.issued_boottime_ms
            || self.expires_boottime_ms - self.issued_boottime_ms > MAX_CHALLENGE_LIFETIME_MS
            || !valid_digest(&self.policy_digest)
        {
            Err(PublicError::ChallengeInvalid)
        } else {
            Ok(())
        }
    }
}

impl Validate for GdmEnvelope {
    fn validate(&self) -> Result<(), PublicError> {
        self.request.validate()?;
        self.challenge.validate()?;
        if !matches!(self.request.target, Target::Gdm { .. }) {
            return Err(PublicError::TargetMismatch);
        }
        let request_boot_id = match &self.request.target {
            Target::Gdm { boot_id, .. } => boot_id,
            _ => unreachable!(),
        };
        if request_boot_id != &self.challenge.boot_id {
            return Err(PublicError::ChallengeInvalid);
        }
        if !valid_id(&self.issue_id)
            || !valid_digest(&self.sentinel_hash)
            || !valid_b64url(&self.hpke_enc, 43, 43)
            || !valid_gdm_ciphertext(&self.ciphertext)
            || !valid_id(&self.signing_key_id)
            || !valid_b64url(&self.signature, 86, 86)
        {
            Err(PublicError::NoncanonicalValue)
        } else {
            Ok(())
        }
    }
}

pub fn validate_sentinel(value: &str) -> bool {
    let Some(encoded) = value.strip_prefix("gdm-broker-v1:") else { return false; };
    valid_nonce(encoded)
}

impl Validate for GdmClaim {
    fn validate(&self) -> Result<(), PublicError> {
        if valid_request_id(&self.request_id)
            && valid_nonce(&self.nonce)
            && valid_id(&self.issue_id)
            && validate_sentinel(&self.sentinel)
            && valid_text(&self.username)
            && valid_text(&self.seat)
            && valid_text(&self.tty)
            && valid_time(self.greeter_generation)
            && valid_time(self.controller_generation)
        {
            Ok(())
        } else {
            Err(PublicError::ClaimRejected)
        }
    }
}

impl Validate for SudoSignedRequest {
    fn validate(&self) -> Result<(), PublicError> {
        self.request.validate()?;
        if !matches!(self.request.target, Target::Sudo { .. }) {
            return Err(PublicError::TargetMismatch);
        }
        if !valid_digest(&self.canonical_body_digest)
            || !valid_id(&self.signing_key_id)
            || !valid_b64url(&self.signature, 86, 86)
        {
            return Err(PublicError::NoncanonicalValue);
        }
        let transcript = execution_request_transcript(&self.request).map_err(|error| match error {
            TranscriptError::Invalid(error) => error,
            TranscriptError::FieldTooLong => PublicError::NoncanonicalValue,
        })?;
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let digest = sha256(&transcript);
        let matches = self
            .canonical_body_digest
            .as_bytes()
            .chunks_exact(2)
            .zip(digest)
            .all(|(encoded, byte)| {
                encoded[0] == HEX[(byte >> 4) as usize]
                    && encoded[1] == HEX[(byte & 0x0f) as usize]
            });
        if matches {
            Ok(())
        } else {
            Err(PublicError::IntegrityFailure)
        }
    }
}

impl Validate for ReviewerResult {
    fn validate(&self) -> Result<(), PublicError> {
        if !valid_id(&self.review_id)
            || !valid_digest(&self.canonical_request_digest)
            || !valid_text(&self.reviewer_model)
            || !valid_digest(&self.reviewer_build_digest)
            || !valid_digest(&self.prompt_policy_digest)
            || !valid_text(&self.reason)
            || !valid_text(&self.rationale)
            || !(1..=3).contains(&self.attempt_count)
            || !valid_time(self.started_at)
            || !valid_time(self.completed_at)
            || !valid_time(self.expires_at)
            || self.completed_at < self.started_at
            || self.expires_at <= self.completed_at
        {
            return Err(PublicError::ReviewBlocked);
        }
        use ReviewerOutcome::{Allow, Blocked, Deny, Escalate};
        use ReviewerReason::*;
        use ReviewerStatus::{Cancelled as CancelledStatus, Completed, Failed};
        let consistent = match (self.status, self.outcome, self.reason_code) {
            (Completed, Allow, SemanticAllow) | (Completed, Deny, SemanticDeny) | (Completed, Escalate, SemanticEscalate) => true,
            (Completed, Blocked, MissingEvidence | PromptInjection | DigestMismatch | TruncatedInput | OmittedSecurityField | CanonicalActionUnreconstructable) => true,
            (Failed, Blocked, Timeout | ModelFailure | SessionFailure | ProviderFailure | TransportFailure | ParseFailure | ReviewerSetupFailure) => true,
            (CancelledStatus, Blocked, Cancelled) => true,
            _ => false,
        };
        if consistent { Ok(()) } else { Err(PublicError::ReviewBlocked) }
    }
}
