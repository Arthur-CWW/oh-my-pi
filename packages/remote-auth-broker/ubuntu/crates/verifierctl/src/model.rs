use std::collections::BTreeMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{Error, Result};

pub(crate) const VERSION: u32 = 1;
const EMPTY_POLICY: &[u8] = b"{}";

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct KeyBundle {
    #[zeroize(skip)]
    pub(crate) version: u32,
    pub(crate) generation_id: String,
    pub(crate) sudo_signing: PrivateKeyRecord,
    pub(crate) gdm_signing: PrivateKeyRecord,
    pub(crate) gdm_recipient: PrivateKeyRecord,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct PrivateKeyRecord {
    pub(crate) key_id: String,
    pub(crate) private_key: String,
    pub(crate) public_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SudoRegistry {
    pub(crate) version: u32,
    pub(crate) active: bool,
    pub(crate) policy_digest: String,
    pub(crate) ssh_host_key_digest: String,
    pub(crate) sudo_signing_key_id: String,
    pub(crate) sudo_signing_public_key: String,
    pub(crate) subject_username: String,
    pub(crate) subject_uid: u32,
    pub(crate) bridge_uid: u32,
    pub(crate) bridge_gid: u32,
    pub(crate) actions: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct GdmConfig {
    pub(crate) schema_version: u32,
    pub(crate) active: bool,
    pub(crate) policy_digest: String,
    pub(crate) ssh_host_key_digest: String,
    pub(crate) recipient_key_id: String,
    pub(crate) recipient_private_key_path: String,
    pub(crate) signing_keys: Vec<GdmSigningKey>,
    pub(crate) allowed_users: Vec<GdmAllowedUser>,
    pub(crate) machine_id_path: String,
    pub(crate) boot_id_path: String,
    pub(crate) greeter_state_path: String,
    pub(crate) controller_state_path: String,
    pub(crate) claim_context_path: String,
    pub(crate) ingest_socket_path: String,
    pub(crate) claim_socket_path: String,
    pub(crate) ingest_uid: u32,
    pub(crate) ingest_gid: u32,
    pub(crate) challenge_lifetime_ms: u64,
    pub(crate) pending_lifetime_ms: u64,
    pub(crate) read_timeout_ms: u64,
    pub(crate) write_timeout_ms: u64,
    pub(crate) max_pending_claims: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct GdmSigningKey {
    pub(crate) key_id: String,
    pub(crate) public_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct GdmAllowedUser {
    pub(crate) username: String,
    pub(crate) uid: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct PublicExport {
    pub(crate) schema_version: u32,
    pub(crate) generation_id: String,
    pub(crate) ubuntu_release_digest: String,
    pub(crate) ssh_host_key_digest: String,
    pub(crate) recipient_key_id: String,
    pub(crate) recipient_public_key: String,
    pub(crate) subject_username: String,
    pub(crate) subject_uid: u32,
    pub(crate) gdm_ingest_uid: u32,
    pub(crate) gdm_ingest_gid: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct GdmActivationBundle {
    pub(crate) schema_version: u32,
    pub(crate) bundle_digest: String,
    pub(crate) policy_digest: String,
    pub(crate) ubuntu_release_digest: String,
    pub(crate) ubuntu_generation_id: String,
    pub(crate) ssh_host_key_digest: String,
    pub(crate) recipient_key_id: String,
    pub(crate) recipient_public_key: String,
    pub(crate) mac_release_digest: String,
    pub(crate) gdm_signing_key_id: String,
    pub(crate) gdm_signing_public_key: String,
    pub(crate) subject_username: String,
    pub(crate) subject_uid: u32,
    pub(crate) gdm_ingest_uid: u32,
    pub(crate) gdm_ingest_gid: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivationStatus {
    pub(crate) schema_version: u32,
    pub(crate) state: String,
    pub(crate) ubuntu_release_digest: String,
    pub(crate) policy_digest: Option<String>,
    pub(crate) bundle_digest: Option<String>,
    pub(crate) mac_release_digest: Option<String>,
    pub(crate) gdm_signing_key_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Identities {
    pub(crate) subject_username: String,
    pub(crate) subject_uid: u32,
    pub(crate) bridge_uid: u32,
    pub(crate) bridge_gid: u32,
    pub(crate) gdm_ingest_uid: u32,
    pub(crate) gdm_ingest_gid: u32,
}

impl KeyBundle {
    pub(crate) fn generate() -> Result<Self> {
        let mut generation = [0_u8; 16];
        getrandom::getrandom(&mut generation).map_err(|_| Error::Randomness)?;
        Ok(Self {
            version: VERSION,
            generation_id: format!("generation-{}", URL_SAFE_NO_PAD.encode(generation)),
            sudo_signing: generate_ed25519("sudo-ed25519")?,
            gdm_signing: generate_ed25519("gdm-ed25519")?,
            gdm_recipient: generate_x25519("gdm-x25519")?,
        })
    }

    pub(crate) fn from_private_bytes(
        generation_id: String,
        sudo_private: &[u8; 32],
        gdm_private: &[u8; 32],
        recipient_private: &[u8; 32],
    ) -> Self {
        let sudo_public = SigningKey::from_bytes(sudo_private).verifying_key().to_bytes();
        let gdm_public = SigningKey::from_bytes(gdm_private).verifying_key().to_bytes();
        let recipient_secret = StaticSecret::from(*recipient_private);
        let recipient_public = X25519PublicKey::from(&recipient_secret).to_bytes();
        Self {
            version: VERSION,
            generation_id,
            sudo_signing: key_record("sudo-ed25519", sudo_private, &sudo_public),
            gdm_signing: key_record("gdm-ed25519", gdm_private, &gdm_public),
            gdm_recipient: key_record("gdm-x25519", recipient_secret.as_bytes(), &recipient_public),
        }
    }

    pub(crate) fn private_bytes(&self) -> Result<([u8; 32], [u8; 32], [u8; 32])> {
        Ok((
            decode_32(&self.sudo_signing.private_key)?,
            decode_32(&self.gdm_signing.private_key)?,
            decode_32(&self.gdm_recipient.private_key)?,
        ))
    }

    pub(crate) fn validate(&self) -> Result<()> {
        if self.version != VERSION || !is_identifier(&self.generation_id) {
            return Err(Error::InvalidData);
        }
        validate_ed25519(&self.sudo_signing, "sudo-ed25519")?;
        validate_ed25519(&self.gdm_signing, "gdm-ed25519")?;
        validate_x25519(&self.gdm_recipient, "gdm-x25519")
    }

    pub(crate) fn public_export(
        &self,
        identities: &Identities,
        host_digest: &str,
        release_digest: &str,
    ) -> PublicExport {
        PublicExport {
            schema_version: VERSION,
            generation_id: self.generation_id.clone(),
            ubuntu_release_digest: release_digest.to_owned(),
            ssh_host_key_digest: host_digest.to_owned(),
            recipient_key_id: self.gdm_recipient.key_id.clone(),
            recipient_public_key: self.gdm_recipient.public_key.clone(),
            subject_username: identities.subject_username.clone(),
            subject_uid: identities.subject_uid,
            gdm_ingest_uid: identities.gdm_ingest_uid,
            gdm_ingest_gid: identities.gdm_ingest_gid,
        }
    }
}

impl PublicExport {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.schema_version != VERSION
            || !is_identifier(&self.generation_id)
            || !is_digest(&self.ubuntu_release_digest)
            || !is_digest(&self.ssh_host_key_digest)
            || !is_base64url_id(&self.recipient_key_id)
            || decode_32(&self.recipient_public_key).is_err()
            || self.subject_username != "arthur"
            || self.subject_uid == 0
            || self.gdm_ingest_uid == 0
            || self.gdm_ingest_gid == 0
        {
            return Err(Error::InvalidData);
        }
        Ok(())
    }
}

impl GdmActivationBundle {
    pub(crate) fn computed_digest(&self) -> String {
        let material = format!(
            "remote-auth-gdm-activation-v1\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
            self.policy_digest,
            self.ubuntu_release_digest,
            self.ubuntu_generation_id,
            self.ssh_host_key_digest,
            self.recipient_key_id,
            self.recipient_public_key,
            self.mac_release_digest,
            self.gdm_signing_key_id,
            self.gdm_signing_public_key,
            self.subject_username,
            self.subject_uid,
            self.gdm_ingest_uid,
            self.gdm_ingest_gid,
            self.schema_version,
        );
        hex_sha256(material.as_bytes())
    }

    pub(crate) fn validate(
        &self,
        public: &PublicExport,
    ) -> Result<()> {
        if self.schema_version != VERSION
            || !is_digest(&self.bundle_digest)
            || !is_digest(&self.policy_digest)
            || self.policy_digest == "0".repeat(64)
            || !is_digest(&self.mac_release_digest)
            || !is_base64url_id(&self.gdm_signing_key_id)
            || decode_32(&self.gdm_signing_public_key).is_err()
            || self.bundle_digest != self.computed_digest()
            || self.ubuntu_release_digest != public.ubuntu_release_digest
            || self.ubuntu_generation_id != public.generation_id
            || self.ssh_host_key_digest != public.ssh_host_key_digest
            || self.recipient_key_id != public.recipient_key_id
            || self.recipient_public_key != public.recipient_public_key
            || self.subject_username != public.subject_username
            || self.subject_uid != public.subject_uid
            || self.gdm_ingest_uid != public.gdm_ingest_uid
            || self.gdm_ingest_gid != public.gdm_ingest_gid
        {
            return Err(Error::InvalidData);
        }
        Ok(())
    }
}

impl SudoRegistry {
    pub(crate) fn inactive(host_digest: &str, keys: &KeyBundle, identities: &Identities) -> Result<Self> {
        if !is_digest(host_digest) {
            return Err(Error::InvalidData);
        }
        let policy_digest = hex_sha256(EMPTY_POLICY);
        Ok(Self {
            version: VERSION,
            active: false,
            policy_digest,
            ssh_host_key_digest: host_digest.to_owned(),
            sudo_signing_key_id: keys.sudo_signing.key_id.clone(),
            sudo_signing_public_key: keys.sudo_signing.public_key.clone(),
            subject_username: identities.subject_username.clone(),
            subject_uid: identities.subject_uid,
            bridge_uid: identities.bridge_uid,
            bridge_gid: identities.bridge_gid,
            actions: BTreeMap::new(),
        })
    }

    pub(crate) fn validate_inactive(&self) -> Result<()> {
        if self.version != VERSION
            || self.active
            || !is_digest(&self.policy_digest)
            || !is_digest(&self.ssh_host_key_digest)
            || !is_identifier(&self.sudo_signing_key_id)
            || decode_32(&self.sudo_signing_public_key).is_err()
            || !is_text(&self.subject_username)
            || self.subject_uid == 0
            || self.bridge_uid == 0
            || self.bridge_gid == 0
            || !self.actions.is_empty()
        {
            return Err(Error::InvalidData);
        }
        Ok(())
    }

    pub(crate) fn matches(&self, keys: &KeyBundle, identities: &Identities, host_digest: &str) -> bool {
        self.sudo_signing_key_id == keys.sudo_signing.key_id
            && self.sudo_signing_public_key == keys.sudo_signing.public_key
            && self.subject_username == identities.subject_username
            && self.subject_uid == identities.subject_uid
            && self.bridge_uid == identities.bridge_uid
            && self.bridge_gid == identities.bridge_gid
            && self.ssh_host_key_digest == host_digest
    }
}

impl GdmConfig {
    pub(crate) fn inactive(host_digest: &str, keys: &KeyBundle, identities: &Identities) -> Result<Self> {
        if !is_digest(host_digest) {
            return Err(Error::InvalidData);
        }
        Ok(Self {
            schema_version: VERSION,
            active: false,
            policy_digest: "0".repeat(64),
            ssh_host_key_digest: host_digest.to_owned(),
            recipient_key_id: keys.gdm_recipient.key_id.clone(),
            recipient_private_key_path: "/etc/remote-auth-broker/keys/gdm-hpke-private.key".to_owned(),
            signing_keys: Vec::new(),
            allowed_users: Vec::new(),
            machine_id_path: "/etc/machine-id".to_owned(),
            boot_id_path: "/proc/sys/kernel/random/boot_id".to_owned(),
            greeter_state_path: "/run/remote-auth-broker/gdm/greeter-state.json".to_owned(),
            controller_state_path: "/run/remote-auth-broker/gdm/controller-state.json".to_owned(),
            claim_context_path: "/run/remote-auth-broker/gdm/claim-context.json".to_owned(),
            ingest_socket_path: "/run/remote-auth-broker/gdm/ingest.sock".to_owned(),
            claim_socket_path: "/run/remote-auth-broker/gdm/gdm-claim.sock".to_owned(),
            ingest_uid: identities.gdm_ingest_uid,
            ingest_gid: identities.gdm_ingest_gid,
            challenge_lifetime_ms: 10_000,
            pending_lifetime_ms: 60_000,
            read_timeout_ms: 1_000,
            write_timeout_ms: 1_000,
            max_pending_claims: 1,
        })
    }

    pub(crate) fn validate_inactive(&self) -> Result<()> {
        if self.schema_version != VERSION
            || self.active
            || self.policy_digest != "0".repeat(64)
            || !is_digest(&self.ssh_host_key_digest)
            || !is_base64url_id(&self.recipient_key_id)
            || self.recipient_private_key_path != "/etc/remote-auth-broker/keys/gdm-hpke-private.key"
            || !self.signing_keys.is_empty()
            || !self.allowed_users.is_empty()
            || self.machine_id_path != "/etc/machine-id"
            || self.boot_id_path != "/proc/sys/kernel/random/boot_id"
            || self.greeter_state_path != "/run/remote-auth-broker/gdm/greeter-state.json"
            || self.controller_state_path != "/run/remote-auth-broker/gdm/controller-state.json"
            || self.claim_context_path != "/run/remote-auth-broker/gdm/claim-context.json"
            || self.ingest_socket_path != "/run/remote-auth-broker/gdm/ingest.sock"
            || self.claim_socket_path != "/run/remote-auth-broker/gdm/gdm-claim.sock"
            || self.ingest_uid == 0
            || self.ingest_gid == 0
            || !(1..=20_000).contains(&self.challenge_lifetime_ms)
            || !(1_000..=120_000).contains(&self.pending_lifetime_ms)
            || !(10..=10_000).contains(&self.read_timeout_ms)
            || !(10..=10_000).contains(&self.write_timeout_ms)
            || self.max_pending_claims != 1
        {
            return Err(Error::InvalidData);
        }
        Ok(())
    }

    pub(crate) fn matches(&self, keys: &KeyBundle, identities: &Identities, host_digest: &str) -> bool {
        self.recipient_key_id == keys.gdm_recipient.key_id
            && self.ingest_uid == identities.gdm_ingest_uid
            && self.ingest_gid == identities.gdm_ingest_gid
            && self.ssh_host_key_digest == host_digest
    }

    pub(crate) fn active_from(
        inactive: &Self,
        bundle: &GdmActivationBundle,
    ) -> Result<Self> {
        inactive.validate_inactive()?;
        let mut active = inactive.clone();
        active.active = true;
        active.policy_digest = bundle.policy_digest.clone();
        active.signing_keys = vec![GdmSigningKey {
            key_id: bundle.gdm_signing_key_id.clone(),
            public_key: bundle.gdm_signing_public_key.clone(),
        }];
        active.allowed_users = vec![GdmAllowedUser {
            username: bundle.subject_username.clone(),
            uid: bundle.subject_uid,
        }];
        active.validate_active(bundle)?;
        Ok(active)
    }

    pub(crate) fn validate_active(&self, bundle: &GdmActivationBundle) -> Result<()> {
        if !self.active
            || self.schema_version != VERSION
            || self.policy_digest != bundle.policy_digest
            || self.ssh_host_key_digest != bundle.ssh_host_key_digest
            || self.recipient_key_id != bundle.recipient_key_id
            || self.ingest_uid != bundle.gdm_ingest_uid
            || self.ingest_gid != bundle.gdm_ingest_gid
            || self.signing_keys
                != vec![GdmSigningKey {
                    key_id: bundle.gdm_signing_key_id.clone(),
                    public_key: bundle.gdm_signing_public_key.clone(),
                }]
            || self.allowed_users
                != vec![GdmAllowedUser {
                    username: bundle.subject_username.clone(),
                    uid: bundle.subject_uid,
                }]
        {
            return Err(Error::InvalidData);
        }
        let mut inactive = self.clone();
        inactive.active = false;
        inactive.policy_digest = "0".repeat(64);
        inactive.signing_keys.clear();
        inactive.allowed_users.clear();
        inactive.validate_inactive()
    }
}

pub(crate) fn decode_strict<T>(bytes: &[u8]) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = T::deserialize(&mut deserializer).map_err(|_| Error::InvalidData)?;
    deserializer.end().map_err(|_| Error::InvalidData)?;
    Ok(value)
}

fn generate_ed25519(domain: &str) -> Result<PrivateKeyRecord> {
    let mut private = [0_u8; 32];
    getrandom::getrandom(&mut private).map_err(|_| Error::Randomness)?;
    let signing = SigningKey::from_bytes(&private);
    let public = signing.verifying_key().to_bytes();
    let record = key_record(domain, &private, &public);
    private.zeroize();
    Ok(record)
}

fn generate_x25519(domain: &str) -> Result<PrivateKeyRecord> {
    let mut private = [0_u8; 32];
    getrandom::getrandom(&mut private).map_err(|_| Error::Randomness)?;
    let secret = StaticSecret::from(private);
    let public = X25519PublicKey::from(&secret).to_bytes();
    let record = key_record(domain, secret.as_bytes(), &public);
    private.zeroize();
    Ok(record)
}

fn key_record(domain: &str, private: &[u8; 32], public: &[u8; 32]) -> PrivateKeyRecord {
    let mut hasher = Sha256::new();
    hasher.update(b"remote-auth-broker/v1/key-id/");
    hasher.update(domain.as_bytes());
    hasher.update(public);
    let digest = hasher.finalize();
    PrivateKeyRecord {
        key_id: URL_SAFE_NO_PAD.encode(&digest[..16]),
        private_key: URL_SAFE_NO_PAD.encode(private),
        public_key: URL_SAFE_NO_PAD.encode(public),
    }
}

fn validate_ed25519(record: &PrivateKeyRecord, domain: &str) -> Result<()> {
    let mut private = decode_32(&record.private_key)?;
    let signing = SigningKey::from_bytes(&private);
    let public = signing.verifying_key().to_bytes();
    let expected = key_record(domain, &private, &public);
    private.zeroize();
    if record.key_id != expected.key_id || record.public_key != expected.public_key {
        return Err(Error::InvalidData);
    }
    Ok(())
}

fn validate_x25519(record: &PrivateKeyRecord, domain: &str) -> Result<()> {
    let mut private = decode_32(&record.private_key)?;
    let secret = StaticSecret::from(private);
    let public = X25519PublicKey::from(&secret).to_bytes();
    let expected = key_record(domain, secret.as_bytes(), &public);
    private.zeroize();
    if record.key_id != expected.key_id || record.public_key != expected.public_key {
        return Err(Error::InvalidData);
    }
    Ok(())
}

pub(crate) fn decode_32(value: &str) -> Result<[u8; 32]> {
    if value.len() != 43 || value.bytes().any(|byte| byte == b'=') {
        return Err(Error::InvalidData);
    }
    let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|_| Error::InvalidData)?;
    if decoded.len() != 32 || URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err(Error::InvalidData);
    }
    let mut output = [0_u8; 32];
    output.copy_from_slice(&decoded);
    Ok(output)
}

pub(crate) fn hex_sha256(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn is_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_base64url_id(value: &str) -> bool {
    (22..=86).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn is_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.bytes().any(|byte| byte == 0 || byte.is_ascii_control())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_bundle() -> KeyBundle {
        let sudo_private = [7_u8; 32];
        let gdm_private = [11_u8; 32];
        let hpke_private = [13_u8; 32];
        let sudo_public = SigningKey::from_bytes(&sudo_private).verifying_key().to_bytes();
        let gdm_public = SigningKey::from_bytes(&gdm_private).verifying_key().to_bytes();
        let hpke_secret = StaticSecret::from(hpke_private);
        let hpke_public = X25519PublicKey::from(&hpke_secret).to_bytes();
        KeyBundle {
            version: VERSION,
            generation_id: "generation-test".to_owned(),
            sudo_signing: key_record("sudo-ed25519", &sudo_private, &sudo_public),
            gdm_signing: key_record("gdm-ed25519", &gdm_private, &gdm_public),
            gdm_recipient: key_record("gdm-x25519", hpke_secret.as_bytes(), &hpke_public),
        }
    }

    fn identities() -> Identities {
        Identities {
            subject_username: "arthur".to_owned(),
            subject_uid: 1000,
            bridge_uid: 992,
            bridge_gid: 992,
            gdm_ingest_uid: 992,
            gdm_ingest_gid: 992,
        }
    }

    #[test]
    fn initial_configs_are_strictly_inactive() {
        let keys = fixed_bundle();
        let host_digest = "1".repeat(64);
        let sudo = SudoRegistry::inactive(&host_digest, &keys, &identities()).unwrap();
        let gdm = GdmConfig::inactive(&host_digest, &keys, &identities()).unwrap();
        assert!(!sudo.active);
        assert!(sudo.actions.is_empty());
        assert!(!gdm.active);
        sudo.validate_inactive().unwrap();
        gdm.validate_inactive().unwrap();
    }

    #[test]
    fn strict_json_rejects_unknown_duplicate_and_trailing_data() {
        let export = fixed_bundle().public_export(
            &identities(),
            &"1".repeat(64),
            &"2".repeat(64),
        );
        let mut value = serde_json::to_value(&export).unwrap();
        value.as_object_mut().unwrap().insert("extra".to_owned(), 0.into());
        assert!(decode_strict::<PublicExport>(&serde_json::to_vec(&value).unwrap()).is_err());
        let valid = serde_json::to_vec(&export).unwrap();
        let duplicate = String::from_utf8(valid.clone())
            .unwrap()
            .replacen("{", r#"{"schemaVersion":1,"#, 1);
        assert!(decode_strict::<PublicExport>(duplicate.as_bytes()).is_err());
        let mut trailing = valid;
        trailing.extend_from_slice(b" true");
        assert!(decode_strict::<PublicExport>(&trailing).is_err());
        assert!(decode_32("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").is_err());
        assert!(decode_32("+++++++++++++++++++++++++++++++++++++++++++").is_err());
    }

    #[test]
    fn public_export_contains_only_required_public_material() {
        let keys = fixed_bundle();
        keys.validate().unwrap();
        let exported = keys.public_export(&identities(), &"1".repeat(64), &"2".repeat(64));
        exported.validate().unwrap();
        let value = serde_json::to_value(exported).unwrap();
        let object = value.as_object().unwrap();
        assert_eq!(object.len(), 10);
        assert!(object.keys().all(|name| !name.to_ascii_lowercase().contains("private")));
        assert_eq!(object["recipientPublicKey"], keys.gdm_recipient.public_key);
        assert_ne!(keys.gdm_recipient.private_key, keys.gdm_recipient.public_key);
        assert!(object.get("sudoSigningPublicKey").is_none());
        assert!(object.get("gdmSigningPublicKey").is_none());
    }
}
