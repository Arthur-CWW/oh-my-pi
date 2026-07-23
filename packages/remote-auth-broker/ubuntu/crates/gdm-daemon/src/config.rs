use std::{collections::HashSet, path::{Path, PathBuf}, time::Duration};

use remote_auth_broker_protocol::{Ed25519PublicKey, HpkeInfo};
use remote_auth_broker_verifier_core::{load_config_file, BOOT_ID_PATH, CONFIG_ROOT, MACHINE_ID_PATH};
use serde::Deserialize;

use crate::error::{DaemonError, Result};

const ZERO_DIGEST: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const EXPECTED_GREETER_STATE: &str = "/run/remote-auth-broker/gdm/greeter-state.json";
const EXPECTED_CONTROLLER_STATE: &str = "/run/remote-auth-broker/gdm/controller-state.json";
const EXPECTED_CLAIM_CONTEXT: &str = "/run/remote-auth-broker/gdm/claim-context.json";
const EXPECTED_INGEST_SOCKET: &str = "/run/remote-auth-broker/gdm/ingest.sock";
const EXPECTED_CLAIM_SOCKET: &str = "/run/remote-auth-broker/gdm/gdm-claim.sock";

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SigningKeyConfig {
    pub key_id: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AllowedUser {
    pub username: String,
    pub uid: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    pub schema_version: u32,
    pub active: bool,
    pub policy_digest: String,
    pub ssh_host_key_digest: String,
    pub recipient_key_id: String,
    pub recipient_private_key_path: PathBuf,
    pub signing_keys: Vec<SigningKeyConfig>,
    pub allowed_users: Vec<AllowedUser>,
    pub machine_id_path: PathBuf,
    pub boot_id_path: PathBuf,
    pub greeter_state_path: PathBuf,
    pub controller_state_path: PathBuf,
    pub claim_context_path: PathBuf,
    pub ingest_socket_path: PathBuf,
    pub claim_socket_path: PathBuf,
    pub ingest_uid: u32,
    pub ingest_gid: u32,
    pub challenge_lifetime_ms: u64,
    pub pending_lifetime_ms: u64,
    pub read_timeout_ms: u64,
    pub write_timeout_ms: u64,
    pub max_pending_claims: usize,
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let loaded = load_config_file(path).map_err(|_| DaemonError::Configuration)?;
        Self::parse(loaded.as_bytes())
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let config: Self = serde_json::from_slice(bytes).map_err(|_| DaemonError::Configuration)?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1
            || !is_digest(&self.policy_digest)
            || !is_digest(&self.ssh_host_key_digest)
            || HpkeInfo::new(&self.recipient_key_id).is_err()
            || self.machine_id_path != Path::new(MACHINE_ID_PATH)
            || self.boot_id_path != Path::new(BOOT_ID_PATH)
            || self.greeter_state_path != Path::new(EXPECTED_GREETER_STATE)
            || self.controller_state_path != Path::new(EXPECTED_CONTROLLER_STATE)
            || self.claim_context_path != Path::new(EXPECTED_CLAIM_CONTEXT)
            || self.ingest_socket_path != Path::new(EXPECTED_INGEST_SOCKET)
            || self.claim_socket_path != Path::new(EXPECTED_CLAIM_SOCKET)
            || !private_key_path_is_safe(&self.recipient_private_key_path)
            || self.ingest_uid == 0
            || self.ingest_gid == 0
            || !(1..=20_000).contains(&self.challenge_lifetime_ms)
            || !(1_000..=120_000).contains(&self.pending_lifetime_ms)
            || !(10..=10_000).contains(&self.read_timeout_ms)
            || !(10..=10_000).contains(&self.write_timeout_ms)
            || self.max_pending_claims != 1
        {
            return Err(DaemonError::Configuration);
        }

        let mut key_ids = HashSet::with_capacity(self.signing_keys.len());
        if self.signing_keys.len() > 8
            || self.signing_keys.iter().any(|key| {
                !key_ids.insert(key.key_id.as_str())
                    || HpkeInfo::new(&key.key_id).is_err()
                    || Ed25519PublicKey::from_base64url(&key.public_key).is_err()
            })
        {
            return Err(DaemonError::Configuration);
        }

        let mut usernames = HashSet::with_capacity(self.allowed_users.len());
        let mut user_ids = HashSet::with_capacity(self.allowed_users.len());
        if self.allowed_users.len() > 32
            || self.allowed_users.iter().any(|user| {
                !valid_text(&user.username)
                    || user.uid == 0
                    || !usernames.insert(user.username.as_str())
                    || !user_ids.insert(user.uid)
            })
        {
            return Err(DaemonError::Configuration);
        }

        if self.active {
            if self.policy_digest == ZERO_DIGEST
                || self.ssh_host_key_digest == ZERO_DIGEST
                || self.signing_keys.is_empty()
                || self.allowed_users.is_empty()
            {
                return Err(DaemonError::Configuration);
            }
        } else if self.policy_digest != ZERO_DIGEST
            || !self.signing_keys.is_empty()
            || !self.allowed_users.is_empty()
        {
            return Err(DaemonError::Configuration);
        }
        Ok(())
    }

    pub fn io_timeouts(&self) -> (Duration, Duration) {
        (
            Duration::from_millis(self.read_timeout_ms),
            Duration::from_millis(self.write_timeout_ms),
        )
    }

    pub fn signing_public_key(&self, key_id: &str) -> Result<Ed25519PublicKey> {
        let key = self
            .signing_keys
            .iter()
            .find(|key| key.key_id == key_id)
            .ok_or(DaemonError::Integrity)?;
        Ed25519PublicKey::from_base64url(&key.public_key).map_err(|_| DaemonError::Configuration)
    }

    pub fn user_is_allowed(&self, username: &str, uid: u32) -> bool {
        self.allowed_users
            .iter()
            .any(|allowed| allowed.username == username && allowed.uid == uid)
    }
}

fn private_key_path_is_safe(path: &Path) -> bool {
    path.is_absolute()
        && path.starts_with(Path::new(CONFIG_ROOT).join("keys"))
        && path.file_name().is_some()
        && !path.components().any(|component| matches!(component, std::path::Component::ParentDir))
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_text(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 256 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inactive_json(extra: &str) -> Vec<u8> {
        format!(r#"{{
          "schemaVersion":1,
          "active":false,
          "policyDigest":"{ZERO_DIGEST}",
          "sshHostKeyDigest":"{ZERO_DIGEST}",
          "recipientKeyId":"AAECAwQFBgcICQoLDA0ODw",
          "recipientPrivateKeyPath":"/etc/remote-auth-broker/keys/gdm-hpke-private.key",
          "signingKeys":[],
          "allowedUsers":[],
          "machineIdPath":"{MACHINE_ID_PATH}",
          "bootIdPath":"{BOOT_ID_PATH}",
          "greeterStatePath":"{EXPECTED_GREETER_STATE}",
          "controllerStatePath":"{EXPECTED_CONTROLLER_STATE}",
          "claimContextPath":"{EXPECTED_CLAIM_CONTEXT}",
          "ingestSocketPath":"{EXPECTED_INGEST_SOCKET}",
          "claimSocketPath":"{EXPECTED_CLAIM_SOCKET}",
          "ingestUid":997,
          "ingestGid":997,
          "challengeLifetimeMs":10000,
          "pendingLifetimeMs":60000,
          "readTimeoutMs":1000,
          "writeTimeoutMs":1000,
          "maxPendingClaims":1{extra}
        }}"#).into_bytes()
    }

    #[test]
    fn inactive_config_is_complete_and_valid() {
        let config = Config::parse(&inactive_json("")).unwrap();
        assert!(!config.active);
    }

    #[test]
    fn unknown_fields_and_effectful_inactive_config_are_rejected() {
        assert_eq!(Config::parse(&inactive_json(",\"unexpected\":true")).unwrap_err(), DaemonError::Configuration);
        let bytes = String::from_utf8(inactive_json("")).unwrap().replace("\"signingKeys\":[]", "\"signingKeys\":[{\"keyId\":\"AAECAwQFBgcICQoLDA0ODw\",\"publicKey\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}]");
        assert_eq!(Config::parse(bytes.as_bytes()).unwrap_err(), DaemonError::Configuration);
    }

    #[test]
    fn redirected_security_paths_are_rejected() {
        let bytes = String::from_utf8(inactive_json("")).unwrap().replace(EXPECTED_CLAIM_SOCKET, "/tmp/claim.sock");
        assert_eq!(Config::parse(bytes.as_bytes()).unwrap_err(), DaemonError::Configuration);
    }
}
