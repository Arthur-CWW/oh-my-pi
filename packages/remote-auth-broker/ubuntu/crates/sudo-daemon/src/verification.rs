use std::ffi::CStr;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use remote_auth_broker_protocol::{
    execution_request_transcript, verify_ed25519, AuthorizationMode, Ed25519PublicKey,
    Ed25519Signature, PublicError, Risk, SudoSignedRequest, Target,
};

use crate::config::{RegisteredAction, Registry};

const MACHINE_ID_PATH: &str = "/etc/machine-id";
const BOOT_ID_PATH: &str = "/proc/sys/kernel/random/boot_id";
const MAX_BINDING_BYTES: u64 = 4_096;

pub(crate) struct LiveBindings {
    machine_id: String,
    boot_id: String,
    username: String,
    uid: u32,
}

pub(crate) struct VerifiedAction<'a> {
    pub(crate) request_id: &'a str,
    pub(crate) nonce: &'a str,
    pub(crate) action_id: &'a str,
    pub(crate) body_digest: &'a str,
    pub(crate) expires_at: u64,
    pub(crate) action: &'a RegisteredAction,
}

impl LiveBindings {
    pub(crate) fn load(registry: &Registry) -> Result<Self, ()> {
        let machine_id = read_binding(Path::new(MACHINE_ID_PATH))?;
        let boot_id = read_binding(Path::new(BOOT_ID_PATH))?;
        let username = username_for_uid(registry.subject_uid)?;
        if username != registry.subject_username {
            return Err(());
        }
        Ok(Self { machine_id, boot_id, username, uid: registry.subject_uid })
    }

    pub(crate) fn boot_id(&self) -> &str {
        &self.boot_id
    }
}

pub(crate) fn verify_signed_request<'a>(
    signed: &'a SudoSignedRequest,
    registry: &'a Registry,
    live: &LiveBindings,
) -> Result<VerifiedAction<'a>, PublicError> {
    if signed.signing_key_id != registry.sudo_signing_key_id {
        return Err(PublicError::SignatureInvalid);
    }
    let transcript = execution_request_transcript(&signed.request)
        .map_err(|_| PublicError::IntegrityFailure)?;
    let public_key = Ed25519PublicKey::from_base64url(&registry.sudo_signing_public_key)
        .map_err(|_| PublicError::IntegrityFailure)?;
    let signature = Ed25519Signature::from_base64url(&signed.signature)
        .map_err(|_| PublicError::SignatureInvalid)?;
    verify_ed25519(&public_key, &transcript, &signature)
        .map_err(|_| PublicError::SignatureInvalid)?;

    validate_wall_time(
        signed.request.created_at,
        signed.request.expires_at,
        wall_time_millis()?,
    )?;
    let (action_id, action) = validate_target_bindings(
        &signed.request.target,
        signed.request.principal.uid,
        registry,
        live,
    )?;

    if matches!(signed.request.authorization_mode_requested, AuthorizationMode::Delegated)
        && (action.requires_biometric() || matches!(action.risk, Risk::Critical))
    {
        return Err(PublicError::GrantForbidden);
    }
    if action.requires_biometric()
        && !matches!(
            signed.request.authorization_mode_requested,
            AuthorizationMode::BiometricOneShot
        )
    {
        return Err(PublicError::GrantForbidden);
    }
    if !registry.active {
        return Err(PublicError::Inactive);
    }

    Ok(VerifiedAction {
        request_id: &signed.request.request_id,
        nonce: &signed.request.nonce,
        action_id,
        body_digest: &signed.canonical_body_digest,
        expires_at: signed.request.expires_at,
        action,
    })
}

fn validate_wall_time(created_at: u64, expires_at: u64, now: u64) -> Result<(), PublicError> {
    if created_at > now || expires_at <= now {
        Err(PublicError::RequestExpired)
    } else {
        Ok(())
    }
}

fn validate_target_bindings<'a>(
    target: &'a Target,
    principal_uid: u32,
    registry: &'a Registry,
    live: &LiveBindings,
) -> Result<(&'a str, &'a RegisteredAction), PublicError> {
    let Target::Sudo {
        ssh_host_key_digest,
        machine_id,
        boot_id,
        username,
        uid,
        sudo_policy_digest,
        action_id,
        executable,
        argv_digest,
    } = target
    else {
        return Err(PublicError::TargetMismatch);
    };

    if principal_uid != live.uid
        || *uid != live.uid
        || username != &live.username
        || machine_id != &live.machine_id
        || boot_id != &live.boot_id
        || ssh_host_key_digest != &registry.ssh_host_key_digest
    {
        return Err(PublicError::TargetMismatch);
    }
    if sudo_policy_digest != &registry.policy_digest {
        return Err(PublicError::PolicyMismatch);
    }
    let action = registry.actions.get(action_id).ok_or(PublicError::TargetMismatch)?;
    if executable != &action.executable || argv_digest != &action.argv_digest {
        return Err(PublicError::TargetMismatch);
    }
    Ok((action_id, action))
}

fn wall_time_millis() -> Result<u64, PublicError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| PublicError::Internal)?;
    u64::try_from(duration.as_millis()).map_err(|_| PublicError::Internal)
}

fn read_binding(path: &Path) -> Result<String, ()> {
    let metadata = fs::metadata(path).map_err(|_| ())?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_BINDING_BYTES {
        return Err(());
    }
    let value = fs::read_to_string(path).map_err(|_| ())?;
    let trimmed = value.trim_end_matches(['\r', '\n']);
    if trimmed.is_empty()
        || trimmed.len() > 256
        || trimmed
            .bytes()
            .any(|byte| byte == 0 || byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(());
    }
    Ok(trimmed.to_owned())
}

fn username_for_uid(uid: u32) -> Result<String, ()> {
    let suggested = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let capacity = if suggested < 1 {
        16_384
    } else {
        usize::try_from(suggested)
            .map_err(|_| ())?
            .clamp(1_024, 1_048_576)
    };
    let mut buffer = vec![0_u8; capacity];
    let mut passwd = unsafe { std::mem::zeroed::<libc::passwd>() };
    let mut result = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwuid_r(
            uid,
            &mut passwd,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() || passwd.pw_name.is_null() {
        return Err(());
    }
    let username = unsafe { CStr::from_ptr(passwd.pw_name) }
        .to_str()
        .map_err(|_| ())?;
    if username.is_empty() || username.len() > 256 {
        return Err(());
    }
    Ok(username.to_owned())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::config::RegisteredAction;

    fn registry() -> Registry {
        let action = RegisteredAction {
            executable: "/usr/bin/systemctl".to_owned(),
            argv: vec!["/usr/bin/systemctl".to_owned(), "restart".to_owned(), "gdm.service".to_owned()],
            argv_digest: "3".repeat(64),
            risk: Risk::High,
            destructive: true,
            irreversible: false,
            fixed_env: Vec::new(),
        };
        Registry {
            version: 1,
            active: true,
            policy_digest: "1".repeat(64),
            ssh_host_key_digest: "2".repeat(64),
            sudo_signing_key_id: "signing-key".to_owned(),
            sudo_signing_public_key: "unused".to_owned(),
            subject_username: "arthur".to_owned(),
            subject_uid: 1000,
            bridge_uid: 993,
            bridge_gid: 993,
            actions: BTreeMap::from([("gdm.restart".to_owned(), action)]),
        }
    }

    fn target() -> Target {
        Target::Sudo {
            ssh_host_key_digest: "2".repeat(64),
            machine_id: "machine-a".to_owned(),
            boot_id: "boot-a".to_owned(),
            username: "arthur".to_owned(),
            uid: 1000,
            sudo_policy_digest: "1".repeat(64),
            action_id: "gdm.restart".to_owned(),
            executable: "/usr/bin/systemctl".to_owned(),
            argv_digest: "3".repeat(64),
        }
    }

    fn live() -> LiveBindings {
        LiveBindings {
            machine_id: "machine-a".to_owned(),
            boot_id: "boot-a".to_owned(),
            username: "arthur".to_owned(),
            uid: 1000,
        }
    }

    #[test]
    fn wall_time_rejects_future_and_expired_requests() {
        assert_eq!(validate_wall_time(1_001, 1_100, 1_000), Err(PublicError::RequestExpired));
        assert_eq!(validate_wall_time(900, 1_000, 1_000), Err(PublicError::RequestExpired));
        assert!(validate_wall_time(900, 1_001, 1_000).is_ok());
    }

    #[test]
    fn every_live_and_registered_target_binding_is_required() {
        let registry = registry();
        let live = live();
        assert!(validate_target_bindings(&target(), 1000, &registry, &live).is_ok());

        let mut wrong_boot = target();
        if let Target::Sudo { boot_id, .. } = &mut wrong_boot {
            *boot_id = "boot-b".to_owned();
        }
        assert!(matches!(
            validate_target_bindings(&wrong_boot, 1000, &registry, &live),
            Err(PublicError::TargetMismatch)
        ));

        let mut wrong_policy = target();
        if let Target::Sudo { sudo_policy_digest, .. } = &mut wrong_policy {
            *sudo_policy_digest = "9".repeat(64);
        }
        assert!(matches!(
            validate_target_bindings(&wrong_policy, 1000, &registry, &live),
            Err(PublicError::PolicyMismatch)
        ));

        let mut wrong_argv = target();
        if let Target::Sudo { argv_digest, .. } = &mut wrong_argv {
            *argv_digest = "8".repeat(64);
        }
        assert!(matches!(
            validate_target_bindings(&wrong_argv, 1000, &registry, &live),
            Err(PublicError::TargetMismatch)
        ));
        assert!(matches!(
            validate_target_bindings(&target(), 1001, &registry, &live),
            Err(PublicError::TargetMismatch)
        ));
    }
}
