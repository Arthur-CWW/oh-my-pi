use std::fmt;

use crate::{
    validation::{valid_digest, valid_id},
    Domain, ExecutionRequest, GdmChallenge, HpkeCiphertext, HpkeEncapsulatedKey, PublicError,
    Target, Validate,
};

const MAGIC: &[u8; 4] = b"RAB1";
const DESKTOP_REQUEST_DOMAIN: &str = "remote-auth-broker/v1/desktop-browser/execution-request";
const SUDO_REQUEST_DOMAIN: &str = "remote-auth-broker/v1/sudo/execution-request";
const GDM_HPKE_INFO_DOMAIN: &str = "remote-auth-broker/v1/desktop-browser/gdm-hpke-info";
const GDM_HPKE_AAD_DOMAIN: &str = "remote-auth-broker/v1/desktop-browser/gdm-hpke-aad";
const GDM_SIGNATURE_DOMAIN: &str = "remote-auth-broker/v1/desktop-browser/gdm-envelope-signature";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptError {
    Invalid(PublicError),
    FieldTooLong,
}

impl fmt::Display for TranscriptError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Invalid(_) => "invalid transcript input",
            Self::FieldTooLong => "transcript field is too long",
        })
    }
}

impl std::error::Error for TranscriptError {}

struct Builder {
    bytes: Vec<u8>,
}

impl Builder {
    fn new(domain: &str) -> Result<Self, TranscriptError> {
        let domain_len = u16::try_from(domain.len()).map_err(|_| TranscriptError::FieldTooLong)?;
        let mut bytes = Vec::with_capacity(512);
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&domain_len.to_be_bytes());
        bytes.extend_from_slice(domain.as_bytes());
        Ok(Self { bytes })
    }

    fn field(&mut self, name: &str, value: &[u8]) -> Result<(), TranscriptError> {
        let name_len = u16::try_from(name.len()).map_err(|_| TranscriptError::FieldTooLong)?;
        let value_len = u32::try_from(value.len()).map_err(|_| TranscriptError::FieldTooLong)?;
        self.bytes.extend_from_slice(&name_len.to_be_bytes());
        self.bytes.extend_from_slice(name.as_bytes());
        self.bytes.extend_from_slice(&value_len.to_be_bytes());
        self.bytes.extend_from_slice(value);
        Ok(())
    }

    fn string(&mut self, name: &str, value: &str) -> Result<(), TranscriptError> {
        self.field(name, value.as_bytes())
    }

    fn u32(&mut self, name: &str, value: u32) -> Result<(), TranscriptError> {
        self.field(name, &value.to_be_bytes())
    }

    fn u64(&mut self, name: &str, value: u64) -> Result<(), TranscriptError> {
        self.field(name, &value.to_be_bytes())
    }

    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

fn nested_field(bytes: &mut Vec<u8>, name: &str, value: &[u8]) -> Result<(), TranscriptError> {
    let name_len = u16::try_from(name.len()).map_err(|_| TranscriptError::FieldTooLong)?;
    let value_len = u32::try_from(value.len()).map_err(|_| TranscriptError::FieldTooLong)?;
    bytes.extend_from_slice(&name_len.to_be_bytes());
    bytes.extend_from_slice(name.as_bytes());
    bytes.extend_from_slice(&value_len.to_be_bytes());
    bytes.extend_from_slice(value);
    Ok(())
}

fn nested_string(bytes: &mut Vec<u8>, name: &str, value: &str) -> Result<(), TranscriptError> {
    nested_field(bytes, name, value.as_bytes())
}

fn nested_u32(bytes: &mut Vec<u8>, name: &str, value: u32) -> Result<(), TranscriptError> {
    nested_field(bytes, name, &value.to_be_bytes())
}

fn nested_u64(bytes: &mut Vec<u8>, name: &str, value: u64) -> Result<(), TranscriptError> {
    nested_field(bytes, name, &value.to_be_bytes())
}

fn principal_bytes(request: &ExecutionRequest) -> Result<Vec<u8>, TranscriptError> {
    let principal = &request.principal;
    let mut bytes = Vec::with_capacity(256);
    nested_string(&mut bytes, "sessionId", &principal.session_id)?;
    nested_string(&mut bytes, "ownerEpoch", &principal.owner_epoch)?;
    nested_u32(&mut bytes, "pid", principal.pid)?;
    nested_u32(&mut bytes, "uid", principal.uid)?;
    nested_string(&mut bytes, "codeIdentity", &principal.code_identity)?;
    nested_string(&mut bytes, "buildDigest", &principal.build_digest)?;
    nested_string(&mut bytes, "runnerInstanceIdentity", &principal.runner_instance_identity)?;
    nested_string(&mut bytes, "ownershipSocketPath", &principal.ownership_socket_path)?;
    Ok(bytes)
}

fn browser_binding(
    bytes: &mut Vec<u8>,
    host_identity: &str,
    graphical_session_id: &str,
    chrome_service: &str,
    chrome_executable_digest: &str,
    chrome_pid: u32,
    profile_identity: &str,
    browser_target_id: &str,
    window_id: &str,
    extension_id: &str,
    extension_version: &str,
    manifest_digest: &str,
    ui_target: &str,
) -> Result<(), TranscriptError> {
    nested_string(bytes, "hostIdentity", host_identity)?;
    nested_string(bytes, "graphicalSessionId", graphical_session_id)?;
    nested_string(bytes, "chromeService", chrome_service)?;
    nested_string(bytes, "chromeExecutableDigest", chrome_executable_digest)?;
    nested_u32(bytes, "chromePid", chrome_pid)?;
    nested_string(bytes, "profileIdentity", profile_identity)?;
    nested_string(bytes, "browserTargetId", browser_target_id)?;
    nested_string(bytes, "windowId", window_id)?;
    nested_string(bytes, "extensionId", extension_id)?;
    nested_string(bytes, "extensionVersion", extension_version)?;
    nested_string(bytes, "extensionSource", "official-chrome-web-store")?;
    nested_string(bytes, "manifestDigest", manifest_digest)?;
    nested_string(bytes, "uiTarget", ui_target)
}

fn target_bytes(target: &Target) -> Result<Vec<u8>, TranscriptError> {
    let mut bytes = Vec::with_capacity(512);
    match target {
        Target::Gdm {
            ssh_host_key_digest,
            machine_id,
            boot_id,
            username,
            uid,
            seat,
            tty,
            rhost,
            greeter_generation,
            jetkvm_device_id,
            controller_generation,
            ..
        } => {
            nested_string(&mut bytes, "kind", "gdm")?;
            nested_string(&mut bytes, "sshHostKeyDigest", ssh_host_key_digest)?;
            nested_string(&mut bytes, "machineId", machine_id)?;
            nested_string(&mut bytes, "bootId", boot_id)?;
            nested_string(&mut bytes, "username", username)?;
            nested_u32(&mut bytes, "uid", *uid)?;
            nested_string(&mut bytes, "pamService", "gdm-password")?;
            nested_string(&mut bytes, "seat", seat)?;
            nested_string(&mut bytes, "tty", tty)?;
            nested_string(&mut bytes, "rhost", match rhost { crate::RemoteHost::Empty => "empty", crate::RemoteHost::Local => "local" })?;
            nested_u64(&mut bytes, "greeterGeneration", *greeter_generation)?;
            nested_string(&mut bytes, "jetkvmDeviceId", jetkvm_device_id)?;
            nested_u64(&mut bytes, "controllerGeneration", *controller_generation)?;
        }
        Target::Bitwarden {
            host_identity,
            graphical_session_id,
            chrome_service,
            chrome_executable_digest,
            chrome_pid,
            profile_identity,
            browser_target_id,
            window_id,
            extension_id,
            extension_version,
            manifest_digest,
            ui_target,
            ..
        } => {
            nested_string(&mut bytes, "kind", "bitwarden")?;
            browser_binding(&mut bytes, host_identity, graphical_session_id, chrome_service, chrome_executable_digest, *chrome_pid, profile_identity, browser_target_id, window_id, extension_id, extension_version, manifest_digest, ui_target)?;
        }
        Target::Website {
            host_identity,
            graphical_session_id,
            chrome_service,
            chrome_executable_digest,
            chrome_pid,
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
            nested_string(&mut bytes, "kind", "website")?;
            browser_binding(&mut bytes, host_identity, graphical_session_id, chrome_service, chrome_executable_digest, *chrome_pid, profile_identity, browser_target_id, window_id, extension_id, extension_version, manifest_digest, ui_target)?;
            let mut origins = Vec::new();
            origins.extend_from_slice(&u32::try_from(origin_set.len()).map_err(|_| TranscriptError::FieldTooLong)?.to_be_bytes());
            for origin in origin_set {
                origins.extend_from_slice(&u32::try_from(origin.len()).map_err(|_| TranscriptError::FieldTooLong)?.to_be_bytes());
                origins.extend_from_slice(origin.as_bytes());
            }
            nested_field(&mut bytes, "originSet", &origins)?;
            nested_string(&mut bytes, "activeTabId", active_tab_id)?;
            nested_string(&mut bytes, "frameId", frame_id)?;
            nested_string(&mut bytes, "formActionOrigin", form_action_origin)?;
            nested_string(&mut bytes, "foregroundWindowId", foreground_window_id)?;
            nested_string(&mut bytes, "credentialPairingId", credential_pairing_id)?;
        }
        Target::Sudo {
            ssh_host_key_digest,
            machine_id,
            boot_id,
            username,
            uid,
            sudo_policy_digest,
            action_id,
            executable,
            argv_digest,
        } => {
            nested_string(&mut bytes, "kind", "sudo")?;
            nested_string(&mut bytes, "sshHostKeyDigest", ssh_host_key_digest)?;
            nested_string(&mut bytes, "machineId", machine_id)?;
            nested_string(&mut bytes, "bootId", boot_id)?;
            nested_string(&mut bytes, "username", username)?;
            nested_u32(&mut bytes, "uid", *uid)?;
            nested_string(&mut bytes, "sudoPolicyDigest", sudo_policy_digest)?;
            nested_string(&mut bytes, "actionId", action_id)?;
            nested_string(&mut bytes, "executable", executable)?;
            nested_string(&mut bytes, "argvDigest", argv_digest)?;
        }
    }
    Ok(bytes)
}

pub fn execution_request_transcript(request: &ExecutionRequest) -> Result<Vec<u8>, TranscriptError> {
    request.validate().map_err(TranscriptError::Invalid)?;
    let domain_tag = match request.domain {
        Domain::DesktopBrowser => DESKTOP_REQUEST_DOMAIN,
        Domain::Sudo => SUDO_REQUEST_DOMAIN,
    };
    let mut builder = Builder::new(domain_tag)?;
    builder.u32("protocolVersion", 1)?;
    builder.string("requestId", &request.request_id)?;
    builder.string("nonce", &request.nonce)?;
    builder.u64("createdAt", request.created_at)?;
    builder.u64("expiresAt", request.expires_at)?;
    builder.field("principal", &principal_bytes(request)?)?;
    builder.string("authorizationModeRequested", match request.authorization_mode_requested { crate::AuthorizationMode::Delegated => "delegated", crate::AuthorizationMode::BiometricOneShot => "biometric-one-shot" })?;
    builder.string("domain", match request.domain { Domain::DesktopBrowser => "desktop-browser", Domain::Sudo => "sudo" })?;
    builder.string("operation", match request.operation { crate::Operation::GdmLogin => "gdm-login", crate::Operation::BitwardenUnlock => "bitwarden-unlock", crate::Operation::WebsiteAutofill => "website-autofill", crate::Operation::Sudo => "sudo" })?;
    builder.field("target", &target_bytes(&request.target)?)?;
    builder.string("purpose", &request.purpose)?;
    let mut grant_id = Vec::with_capacity(request.grant_id.as_ref().map_or(1, |value| value.len() + 1));
    match &request.grant_id {
        None => grant_id.push(0),
        Some(value) => { grant_id.push(1); grant_id.extend_from_slice(value.as_bytes()); }
    }
    builder.field("grantId", &grant_id)?;
    Ok(builder.finish())
}

fn challenge_bytes(challenge: &GdmChallenge) -> Result<Vec<u8>, TranscriptError> {
    let mut bytes = Vec::with_capacity(320);
    nested_u32(&mut bytes, "protocolVersion", 1)?;
    nested_string(&mut bytes, "challengeId", &challenge.challenge_id)?;
    nested_string(&mut bytes, "challenge", &challenge.challenge)?;
    nested_string(&mut bytes, "bootId", &challenge.boot_id)?;
    nested_u64(&mut bytes, "issuedBoottimeMs", challenge.issued_boottime_ms)?;
    nested_u64(&mut bytes, "expiresBoottimeMs", challenge.expires_boottime_ms)?;
    nested_string(&mut bytes, "policyDigest", &challenge.policy_digest)?;
    Ok(bytes)
}

pub fn gdm_hpke_info_transcript(recipient_key_id: &str) -> Result<Vec<u8>, TranscriptError> {
    if !valid_id(recipient_key_id) {
        return Err(TranscriptError::Invalid(PublicError::NoncanonicalValue));
    }
    let mut builder = Builder::new(GDM_HPKE_INFO_DOMAIN)?;
    builder.u32("protocolVersion", 1)?;
    builder.string("recipientKeyId", recipient_key_id)?;
    Ok(builder.finish())
}

pub fn gdm_hpke_aad_transcript(request: &ExecutionRequest, challenge: &GdmChallenge, issue_id: &str, sentinel_hash: &str) -> Result<Vec<u8>, TranscriptError> {
    request.validate().map_err(TranscriptError::Invalid)?;
    challenge.validate().map_err(TranscriptError::Invalid)?;
    if !matches!(request.target, Target::Gdm { .. }) {
        return Err(TranscriptError::Invalid(PublicError::TargetMismatch));
    }
    if !valid_id(issue_id) || !valid_digest(sentinel_hash) {
        return Err(TranscriptError::Invalid(PublicError::NoncanonicalValue));
    }
    let mut builder = Builder::new(GDM_HPKE_AAD_DOMAIN)?;
    builder.field("requestTranscript", &execution_request_transcript(request)?)?;
    builder.field("challenge", &challenge_bytes(challenge)?)?;
    builder.string("issueId", issue_id)?;
    builder.string("sentinelHash", sentinel_hash)?;
    Ok(builder.finish())
}

pub fn gdm_envelope_signature_transcript(hpke_aad_transcript: &[u8], hpke_enc: &HpkeEncapsulatedKey, ciphertext: &HpkeCiphertext, signing_key_id: &str) -> Result<Vec<u8>, TranscriptError> {
    if !valid_id(signing_key_id) || hpke_aad_transcript.len() < MAGIC.len() || &hpke_aad_transcript[..MAGIC.len()] != MAGIC {
        return Err(TranscriptError::Invalid(PublicError::NoncanonicalValue));
    }
    let mut builder = Builder::new(GDM_SIGNATURE_DOMAIN)?;
    builder.field("hpkeAadTranscript", hpke_aad_transcript)?;
    builder.field("hpkeEnc", hpke_enc.as_bytes())?;
    builder.field("ciphertext", ciphertext.as_bytes())?;
    builder.string("signingKeyId", signing_key_id)?;
    Ok(builder.finish())
}
