use std::ffi::OsString;

use zeroize::Zeroize;

use crate::error::{Error, Result};
use crate::model::{decode_strict, GdmConfig, Identities, KeyBundle, PublicExport, SudoRegistry};
use crate::platform;
use crate::storage::Storage;

pub(crate) const HELP: &str = "remote-auth-verifierctl\n\nSafe inactive configuration and key lifecycle for Remote Auth Broker.\n\nUSAGE:\n    remote-auth-verifierctl <COMMAND>\n\nCOMMANDS:\n    init-inactive  Create or verify a complete inactive configuration\n    rotate-keys    Replace all verifier keys while remaining inactive\n    export-public  Print public key identifiers and public keys as JSON\n    validate       Validate inactive schemas, key bindings, identities, and file metadata\n\nOPTIONS:\n    -h, --help     Print help\n";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Command {
    Help,
    InitInactive,
    RotateKeys,
    ExportPublic,
    Validate,
}

pub(crate) fn parse_args<I>(arguments: I) -> Result<Command>
where
    I: IntoIterator<Item = OsString>,
{
    let mut arguments = arguments.into_iter();
    let _program = arguments.next().ok_or(Error::Usage)?;
    let command = arguments.next().ok_or(Error::Usage)?;
    if arguments.next().is_some() {
        return Err(Error::Usage);
    }
    match command.to_str() {
        Some("-h" | "--help") => Ok(Command::Help),
        Some("init-inactive") => Ok(Command::InitInactive),
        Some("rotate-keys") => Ok(Command::RotateKeys),
        Some("export-public") => Ok(Command::ExportPublic),
        Some("validate") => Ok(Command::Validate),
        _ => Err(Error::Usage),
    }
}

pub(crate) fn execute(command: Command) -> Result<Option<Vec<u8>>> {
    match command {
        Command::Help => Ok(Some(HELP.as_bytes().to_vec())),
        Command::InitInactive => {
            init_inactive()?;
            Ok(None)
        }
        Command::RotateKeys => {
            rotate_keys()?;
            Ok(None)
        }
        Command::ExportPublic => {
            let public = export_public()?;
            Ok(Some(encode_json(&public)?))
        }
        Command::Validate => {
            validate()?;
            Ok(None)
        }
    }
}

fn init_inactive() -> Result<()> {
    platform::require_root()?;
    let identities = platform::identities()?;
    let host_digest = platform::ssh_host_key_digest()?;
    let storage = Storage::open(true)?;
    if storage.complete_state()? {
        load_state(&storage, &identities, &host_digest)?;
        return Ok(());
    }

    let keys = KeyBundle::generate()?;
    let sudo = SudoRegistry::inactive(&host_digest, &keys, &identities)?;
    let gdm = GdmConfig::inactive(&host_digest, &keys, &identities)?;
    sudo.validate_inactive()?;
    gdm.validate_inactive()?;
    persist_generation(&storage, &keys, &sudo, &gdm, false)
}

fn rotate_keys() -> Result<()> {
    platform::require_root()?;
    let identities = platform::identities()?;
    let host_digest = platform::ssh_host_key_digest()?;
    let storage = Storage::open(false)?;
    load_state(&storage, &identities, &host_digest)?;

    let keys = KeyBundle::generate()?;
    let sudo = SudoRegistry::inactive(&host_digest, &keys, &identities)?;
    let gdm = GdmConfig::inactive(&host_digest, &keys, &identities)?;
    persist_generation(&storage, &keys, &sudo, &gdm, true)
}

fn export_public() -> Result<PublicExport> {
    platform::require_root()?;
    let identities = platform::identities()?;
    let host_digest = platform::ssh_host_key_digest()?;
    let storage = Storage::open(false)?;
    let keys = load_state(&storage, &identities, &host_digest)?;
    Ok(keys.public_export())
}

fn validate() -> Result<()> {
    platform::require_root()?;
    let identities = platform::identities()?;
    let host_digest = platform::ssh_host_key_digest()?;
    let storage = Storage::open(false)?;
    load_state(&storage, &identities, &host_digest)?;
    Ok(())
}

fn load_state(storage: &Storage, identities: &Identities, host_digest: &str) -> Result<KeyBundle> {
    if !storage.complete_state()? {
        return Err(Error::State);
    }
    let manifest: PublicExport = decode_strict(&storage.read_manifest()?)?;
    manifest.validate()?;
    let (mut sudo_private, mut gdm_private, mut recipient_private) = storage.read_private_keys()?;
    let keys = KeyBundle::from_private_bytes(
        manifest.generation_id.clone(),
        &sudo_private,
        &gdm_private,
        &recipient_private,
    );
    sudo_private.zeroize();
    gdm_private.zeroize();
    recipient_private.zeroize();
    keys.validate()?;
    if keys.public_export() != manifest {
        return Err(Error::State);
    }

    let sudo: SudoRegistry = decode_strict(&storage.read_sudo_registry()?)?;
    let gdm: GdmConfig = decode_strict(&storage.read_gdm_config()?)?;
    sudo.validate_inactive()?;
    gdm.validate_inactive()?;
    if !sudo.matches(&keys, identities, host_digest) || !gdm.matches(&keys, identities, host_digest) {
        return Err(Error::State);
    }
    Ok(keys)
}

fn persist_generation(
    storage: &Storage,
    keys: &KeyBundle,
    sudo: &SudoRegistry,
    gdm: &GdmConfig,
    replace: bool,
) -> Result<()> {
    keys.validate()?;
    sudo.validate_inactive()?;
    gdm.validate_inactive()?;
    let (mut sudo_private, mut gdm_private, mut recipient_private) = keys.private_bytes()?;
    let write_result = storage.write_private_keys(
        &sudo_private,
        &gdm_private,
        &recipient_private,
        replace,
    );
    sudo_private.zeroize();
    gdm_private.zeroize();
    recipient_private.zeroize();
    write_result?;

    storage.write_gdm_config(&encode_json(gdm)?, replace)?;
    storage.write_sudo_registry(&encode_json(sudo)?, replace)?;
    storage.write_manifest(&encode_json(&keys.public_export())?, replace)
}

fn encode_json<T: serde::Serialize>(value: &T) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|_| Error::InvalidData)?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn cli_is_closed_and_has_explicit_help() {
        assert_eq!(parse_args(args(&["remote-auth-verifierctl", "--help"])).unwrap(), Command::Help);
        assert_eq!(parse_args(args(&["remote-auth-verifierctl", "validate"])).unwrap(), Command::Validate);
        assert!(parse_args(args(&["remote-auth-verifierctl"])).is_err());
        assert!(parse_args(args(&["remote-auth-verifierctl", "validate", "extra"])).is_err());
        assert!(parse_args(args(&["remote-auth-verifierctl", "--path", "/tmp"])).is_err());
        assert!(parse_args(args(&["remote-auth-verifierctl", "init"])).is_err());
    }
}
