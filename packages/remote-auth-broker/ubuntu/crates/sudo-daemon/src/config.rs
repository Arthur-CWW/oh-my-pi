use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::linux::fs::MetadataExt;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Component, Path};

use remote_auth_broker_protocol::{Ed25519PublicKey, Risk};
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use sha2::{Digest, Sha256};

const MAX_REGISTRY_BYTES: u64 = 1_048_576;
const MAX_ACTIONS: usize = 128;
const MAX_ARGV: usize = 64;
const MAX_ENV: usize = 64;
const MAX_VALUE_BYTES: usize = 4_096;
const MAX_ARGV_BYTES: usize = 65_536;
const ARGV_DIGEST_DOMAIN: &[u8] = b"remote-auth-broker/v1/sudo/registered-argv";

#[derive(Debug)]
pub(crate) enum ConfigError {
    Open,
    Ownership,
    Size,
    Decode,
    Invalid,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Open => "registry unavailable",
            Self::Ownership => "registry ownership invalid",
            Self::Size => "registry size invalid",
            Self::Decode => "registry syntax invalid",
            Self::Invalid => "registry content invalid",
        })
    }
}

impl std::error::Error for ConfigError {}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Registry {
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
    #[serde(deserialize_with = "deserialize_actions")]
    pub(crate) actions: BTreeMap<String, RegisteredAction>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RegisteredAction {
    pub(crate) executable: String,
    pub(crate) argv: Vec<String>,
    pub(crate) argv_digest: String,
    pub(crate) risk: Risk,
    pub(crate) destructive: bool,
    pub(crate) irreversible: bool,
    pub(crate) fixed_env: Vec<FixedEnvironment>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct FixedEnvironment {
    pub(crate) name: String,
    pub(crate) value: String,
}

fn deserialize_actions<'de, D>(deserializer: D) -> Result<BTreeMap<String, RegisteredAction>, D::Error>
where
    D: Deserializer<'de>,
{
    struct ActionMapVisitor;

    impl<'de> Visitor<'de> for ActionMapVisitor {
        type Value = BTreeMap<String, RegisteredAction>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an action-id map without duplicate keys")
        }

        fn visit_map<M>(self, mut access: M) -> Result<Self::Value, M::Error>
        where
            M: MapAccess<'de>,
        {
            let mut actions = BTreeMap::new();
            while let Some((action_id, action)) = access.next_entry::<String, RegisteredAction>()? {
                if actions.insert(action_id, action).is_some() {
                    return Err(de::Error::custom("duplicate action id"));
                }
            }
            Ok(actions)
        }
    }

    deserializer.deserialize_map(ActionMapVisitor)
}

impl Registry {
    pub(crate) fn load(path: &Path) -> Result<Self, ConfigError> {
        validate_root_ancestors(path)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(path)
            .map_err(|_| ConfigError::Open)?;
        validate_root_file(&file)?;

        let length = file.metadata().map_err(|_| ConfigError::Open)?.len();
        if length == 0 || length > MAX_REGISTRY_BYTES {
            return Err(ConfigError::Size);
        }
        let mut bytes = Vec::with_capacity(length as usize);
        let mut bounded = file.take(MAX_REGISTRY_BYTES + 1);
        bounded.read_to_end(&mut bytes).map_err(|_| ConfigError::Open)?;
        if bytes.len() as u64 != length || bytes.len() as u64 > MAX_REGISTRY_BYTES {
            return Err(ConfigError::Size);
        }

        let registry: Self = serde_json::from_slice(&bytes).map_err(|_| ConfigError::Decode)?;
        registry.validate()?;
        Ok(registry)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.version != 1
            || !is_digest(&self.policy_digest)
            || !is_digest(&self.ssh_host_key_digest)
            || !is_identifier(&self.sudo_signing_key_id)
            || !is_text(&self.subject_username)
            || self.subject_uid == 0
            || self.bridge_uid == 0
            || self.bridge_gid == 0
            || self.actions.len() > MAX_ACTIONS
            || (self.active && self.actions.is_empty())
            || Ed25519PublicKey::from_base64url(&self.sudo_signing_public_key).is_err()
        {
            return Err(ConfigError::Invalid);
        }

        for (action_id, action) in &self.actions {
            if !is_identifier(action_id) {
                return Err(ConfigError::Invalid);
            }
            action.validate()?;
        }
        Ok(())
    }
}

impl RegisteredAction {
    fn validate(&self) -> Result<(), ConfigError> {
        if !is_normal_absolute_executable(&self.executable)
            || is_forbidden_executable(&self.executable)
            || self.argv.is_empty()
            || self.argv.len() > MAX_ARGV
            || self.argv[0] != self.executable
            || !is_digest(&self.argv_digest)
            || self.fixed_env.len() > MAX_ENV
        {
            return Err(ConfigError::Invalid);
        }

        let mut argv_bytes = 0_usize;
        for argument in &self.argv {
            if argument.as_bytes().contains(&0)
                || argument.len() > MAX_VALUE_BYTES
                || contains_wildcard(argument)
                || forbidden_credential_argument(argument)
            {
                return Err(ConfigError::Invalid);
            }
            argv_bytes = argv_bytes.checked_add(argument.len()).ok_or(ConfigError::Invalid)?;
        }
        if argv_bytes > MAX_ARGV_BYTES || !argv_digest_matches(&self.argv, &self.argv_digest) {
            return Err(ConfigError::Invalid);
        }

        let mut names = BTreeSet::new();
        for entry in &self.fixed_env {
            if !is_environment_name(&entry.name)
                || !is_allowed_environment(&entry.name)
                || entry.value.as_bytes().contains(&0)
                || entry.value.len() > MAX_VALUE_BYTES
                || is_credential_environment(&entry.name)
                || !names.insert(entry.name.as_str())
            {
                return Err(ConfigError::Invalid);
            }
        }
        Ok(())
    }

    pub(crate) fn requires_biometric(&self) -> bool {
        self.destructive || self.irreversible
    }
}

fn validate_root_file(file: &File) -> Result<(), ConfigError> {
    let metadata = file.metadata().map_err(|_| ConfigError::Open)?;
    if !metadata.file_type().is_file() || metadata.st_uid() != 0 || metadata.st_mode() & 0o022 != 0 {
        return Err(ConfigError::Ownership);
    }
    Ok(())
}

fn validate_root_ancestors(path: &Path) -> Result<(), ConfigError> {
    let mut ancestor = path.parent().ok_or(ConfigError::Ownership)?;
    loop {
        let metadata = ancestor.symlink_metadata().map_err(|_| ConfigError::Open)?;
        if !metadata.file_type().is_dir()
            || metadata.st_uid() != 0
            || metadata.st_mode() & 0o022 != 0
        {
            return Err(ConfigError::Ownership);
        }
        match ancestor.parent() {
            Some(parent) => ancestor = parent,
            None => return Ok(()),
        }
    }
}

fn is_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.bytes().any(|byte| byte == 0 || byte.is_ascii_control())
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn is_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_normal_absolute_executable(value: &str) -> bool {
    if value.len() > MAX_VALUE_BYTES || value.as_bytes().contains(&0) {
        return false;
    }
    let path = Path::new(value);
    if !path.is_absolute() {
        return false;
    }
    let mut components = path.components();
    if !matches!(components.next(), Some(Component::RootDir)) {
        return false;
    }
    components.all(|component| matches!(component, Component::Normal(_)))
}

fn is_forbidden_executable(value: &str) -> bool {
    let Some(name) = Path::new(value).file_name().map(|name| name.as_bytes()) else {
        return true;
    };
    [
        b"sh".as_slice(),
        b"bash".as_slice(),
        b"dash".as_slice(),
        b"ksh".as_slice(),
        b"zsh".as_slice(),
        b"fish".as_slice(),
        b"csh".as_slice(),
        b"tcsh".as_slice(),
        b"env".as_slice(),
        b"busybox".as_slice(),
        b"sudo".as_slice(),
        b"doas".as_slice(),
        b"pkexec".as_slice(),
    ]
    .contains(&name)
}

fn contains_wildcard(argument: &str) -> bool {
    argument.bytes().any(|byte| matches!(byte, b'*' | b'?' | b'[' | b']' | b'{' | b'}' | b'~'))
}

fn forbidden_credential_argument(argument: &str) -> bool {
    let name = argument
        .split_once('=')
        .map_or(argument, |(name, _)| name)
        .trim_start_matches('-');
    let normalized: String = name
        .chars()
        .filter(|character| *character != '-' && *character != '_')
        .flat_map(char::to_lowercase)
        .collect();
    [
        "password",
        "passwd",
        "passphrase",
        "token",
        "secret",
        "credential",
        "apikey",
        "privatekey",
    ]
    .iter()
    .any(|forbidden| normalized.contains(forbidden))
}

fn is_environment_name(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z') | Some(b'_'))
        && bytes.all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

fn is_allowed_environment(name: &str) -> bool {
    matches!(name, "LANG" | "LC_ALL" | "TZ")
}

fn is_credential_environment(name: &str) -> bool {
    ["PASSWORD", "PASSWD", "TOKEN", "SECRET", "CREDENTIAL", "PRIVATE_KEY"]
        .iter()
        .any(|marker| name.contains(marker))
}

fn argv_digest_matches(argv: &[String], encoded: &str) -> bool {
    let Ok(expected) = decode_digest(encoded) else {
        return false;
    };
    let Ok(count) = u32::try_from(argv.len()) else {
        return false;
    };
    let Ok(domain_length) = u16::try_from(ARGV_DIGEST_DOMAIN.len()) else {
        return false;
    };

    let mut digest = Sha256::new();
    digest.update(b"RAB1");
    digest.update(domain_length.to_be_bytes());
    digest.update(ARGV_DIGEST_DOMAIN);
    digest.update(count.to_be_bytes());
    for argument in argv {
        let Ok(length) = u32::try_from(argument.len()) else {
            return false;
        };
        digest.update(length.to_be_bytes());
        digest.update(argument.as_bytes());
    }
    let actual: [u8; 32] = digest.finalize().into();
    actual == expected
}

fn decode_digest(encoded: &str) -> Result<[u8; 32], ()> {
    if !is_digest(encoded) {
        return Err(());
    }
    let mut digest = [0_u8; 32];
    for (index, pair) in encoded.as_bytes().chunks_exact(2).enumerate() {
        digest[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Ok(digest)
}

fn hex_nibble(byte: u8) -> Result<u8, ()> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        _ => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(argv: Vec<String>, fixed_env: Vec<FixedEnvironment>) -> RegisteredAction {
        let mut digest = Sha256::new();
        digest.update(b"RAB1");
        digest.update((ARGV_DIGEST_DOMAIN.len() as u16).to_be_bytes());
        digest.update(ARGV_DIGEST_DOMAIN);
        digest.update((argv.len() as u32).to_be_bytes());
        for argument in &argv {
            digest.update((argument.len() as u32).to_be_bytes());
            digest.update(argument.as_bytes());
        }
        let argv_digest = digest
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        RegisteredAction {
            executable: argv[0].clone(),
            argv,
            argv_digest,
            risk: Risk::Low,
            destructive: false,
            irreversible: false,
            fixed_env,
        }
    }

    #[test]
    fn strict_registry_action_rejects_wildcards_credentials_and_ambient_controls() {
        let valid = action(
            vec!["/usr/bin/systemctl".to_owned(), "status".to_owned(), "gdm.service".to_owned()],
            vec![FixedEnvironment { name: "LANG".to_owned(), value: "C.UTF-8".to_owned() }],
        );
        assert!(valid.validate().is_ok());

        let wildcard = action(
            vec!["/usr/bin/systemctl".to_owned(), "status".to_owned(), "*.service".to_owned()],
            Vec::new(),
        );
        assert!(wildcard.validate().is_err());

        let credential = action(
            vec!["/usr/bin/systemctl".to_owned(), "--api_key=value".to_owned()],
            Vec::new(),
        );
        assert!(credential.validate().is_err());

        let loader_injection = action(
            vec!["/usr/bin/systemctl".to_owned(), "status".to_owned()],
            vec![FixedEnvironment { name: "LD_PRELOAD".to_owned(), value: "/tmp/hook.so".to_owned() }],
        );
        assert!(loader_injection.validate().is_err());
    }
}
