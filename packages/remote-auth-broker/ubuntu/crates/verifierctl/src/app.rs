use std::ffi::OsString;

use zeroize::Zeroize;

use crate::error::{Error, Result};
use crate::model::{
    decode_strict, ActivationStatus, GdmActivationBundle, GdmConfig, Identities, KeyBundle,
    PublicExport, SudoRegistry,
};
use crate::platform;
use crate::storage::Storage;

pub(crate) const HELP: &str = "remote-auth-verifierctl\n\nRoot-owned GDM verifier lifecycle for Remote Auth Broker.\n\nUSAGE:\n    remote-auth-verifierctl <COMMAND>\n\nCOMMANDS:\n    init-inactive   Create or verify complete inactive local state\n    rotate-keys     Replace verifier keys while remaining inactive\n    export-public   Print metadata-only verifier public JSON\n    activate-gdm    Validate the fixed owner-only bundle and activate GDM\n    deactivate-gdm  Return GDM to exact locally-derived inactive state\n    status          Print installed/prepared/active/drift metadata\n    validate        Validate schemas, bindings, identities, and file metadata\n\nOPTIONS:\n    -h, --help      Print help\n";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Command {
    Help,
    InitInactive,
    RotateKeys,
    ExportPublic,
    ActivateGdm,
    DeactivateGdm,
    Status,
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
        Some("activate-gdm") => Ok(Command::ActivateGdm),
        Some("deactivate-gdm") => Ok(Command::DeactivateGdm),
        Some("status") => Ok(Command::Status),
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
        Command::ExportPublic => Ok(Some(encode_json(&export_public()?)?)),
        Command::ActivateGdm => {
            activate_gdm()?;
            Ok(None)
        }
        Command::DeactivateGdm => {
            deactivate_gdm()?;
            Ok(None)
        }
        Command::Status => Ok(Some(encode_json(&status()?)?)),
        Command::Validate => {
            validate()?;
            Ok(None)
        }
    }
}

fn live_context() -> Result<(Identities, String, String)> {
    platform::require_root()?;
    Ok((
        platform::identities()?,
        platform::ssh_host_key_digest()?,
        platform::release_digest()?,
    ))
}

fn init_inactive() -> Result<()> {
    let (identities, host_digest, release_digest) = live_context()?;
    let storage = Storage::open(true)?;
    if storage.complete_state()? {
        let state = load_state(&storage, &identities, &host_digest, &release_digest)?;
        state.gdm.validate_inactive()?;
        return Ok(());
    }
    let keys = KeyBundle::generate()?;
    let sudo = SudoRegistry::inactive(&host_digest, &keys, &identities)?;
    let gdm = GdmConfig::inactive(&host_digest, &keys, &identities)?;
    persist_generation(
        &storage,
        &keys,
        &sudo,
        &gdm,
        &identities,
        &host_digest,
        &release_digest,
        false,
    )
}

fn rotate_keys() -> Result<()> {
    let (identities, host_digest, release_digest) = live_context()?;
    let storage = Storage::open(false)?;
    let state = load_state(&storage, &identities, &host_digest, &release_digest)?;
    state.gdm.validate_inactive()?;
    let keys = KeyBundle::generate()?;
    let sudo = SudoRegistry::inactive(&host_digest, &keys, &identities)?;
    let gdm = GdmConfig::inactive(&host_digest, &keys, &identities)?;
    persist_generation(
        &storage,
        &keys,
        &sudo,
        &gdm,
        &identities,
        &host_digest,
        &release_digest,
        true,
    )
}

fn export_public() -> Result<PublicExport> {
    let (identities, host_digest, release_digest) = live_context()?;
    let storage = Storage::open(false)?;
    let state = load_state(&storage, &identities, &host_digest, &release_digest)?;
    Ok(state.public)
}

fn activate_gdm() -> Result<()> {
    let (identities, host_digest, release_digest) = live_context()?;
    let storage = Storage::open(false)?;
    let state = load_state(&storage, &identities, &host_digest, &release_digest)?;
    let bytes = storage
        .read_activation_bundle(identities.subject_uid)?
        .ok_or(Error::State)?;
    let bundle: GdmActivationBundle = decode_strict(&bytes)?;
    bundle.validate(&state.public)?;
    if state.gdm.active {
        state.gdm.validate_active(&bundle)?;
        return Ok(());
    }
    let active = GdmConfig::active_from(&state.gdm, &bundle)?;
    storage.write_gdm_config(&encode_json(&active)?, true)
}

fn deactivate_gdm() -> Result<()> {
    let (identities, host_digest, release_digest) = live_context()?;
    let storage = Storage::open(false)?;
    let state = load_state(&storage, &identities, &host_digest, &release_digest)?;
    let inactive = GdmConfig::inactive(&host_digest, &state.keys, &identities)?;
    storage.write_gdm_config(&encode_json(&inactive)?, true)
}

fn status() -> Result<ActivationStatus> {
    let (identities, host_digest, release_digest) = live_context()?;
    let storage = Storage::open(false)?;
    let drift = || ActivationStatus {
        schema_version: 1,
        state: "drift".to_owned(),
        ubuntu_release_digest: release_digest.clone(),
        policy_digest: None,
        bundle_digest: None,
        mac_release_digest: None,
        gdm_signing_key_id: None,
    };
    let state = match load_state(&storage, &identities, &host_digest, &release_digest) {
        Ok(state) => state,
        Err(_) => return Ok(drift()),
    };
    let bundle = match storage.read_activation_bundle(identities.subject_uid) {
        Ok(Some(bytes)) => match decode_strict::<GdmActivationBundle>(&bytes) {
            Ok(bundle) if bundle.validate(&state.public).is_ok() => Some(bundle),
            _ => return Ok(drift()),
        },
        Ok(None) => None,
        Err(_) => return Ok(drift()),
    };
    let state_name = match (&bundle, state.gdm.active) {
        (None, false) if state.gdm.validate_inactive().is_ok() => "installed",
        (Some(_), false) if state.gdm.validate_inactive().is_ok() => "prepared",
        (Some(bundle), true) if state.gdm.validate_active(bundle).is_ok() => "active",
        _ => return Ok(drift()),
    };
    Ok(ActivationStatus {
        schema_version: 1,
        state: state_name.to_owned(),
        ubuntu_release_digest: release_digest,
        policy_digest: bundle.as_ref().map(|value| value.policy_digest.clone()),
        bundle_digest: bundle.as_ref().map(|value| value.bundle_digest.clone()),
        mac_release_digest: bundle.as_ref().map(|value| value.mac_release_digest.clone()),
        gdm_signing_key_id: bundle
            .as_ref()
            .map(|value| value.gdm_signing_key_id.clone()),
    })
}

fn validate() -> Result<()> {
    let (identities, host_digest, release_digest) = live_context()?;
    let storage = Storage::open(false)?;
    let state = load_state(&storage, &identities, &host_digest, &release_digest)?;
    if state.gdm.active {
        let bytes = storage
            .read_activation_bundle(identities.subject_uid)?
            .ok_or(Error::State)?;
        let bundle: GdmActivationBundle = decode_strict(&bytes)?;
        bundle.validate(&state.public)?;
        state.gdm.validate_active(&bundle)
    } else {
        state.gdm.validate_inactive()
    }
}

struct State {
    keys: KeyBundle,
    public: PublicExport,
    gdm: GdmConfig,
}

fn load_state(
    storage: &Storage,
    identities: &Identities,
    host_digest: &str,
    release_digest: &str,
) -> Result<State> {
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
    let current_public = keys.public_export(identities, host_digest, release_digest);
    if current_public != manifest {
        return Err(Error::State);
    }
    let sudo: SudoRegistry = decode_strict(&storage.read_sudo_registry()?)?;
    let gdm: GdmConfig = decode_strict(&storage.read_gdm_config()?)?;
    sudo.validate_inactive()?;
    if !sudo.matches(&keys, identities, host_digest)
        || !gdm.matches(&keys, identities, host_digest)
    {
        return Err(Error::State);
    }
    Ok(State {
        keys,
        public: current_public,
        gdm,
    })
}

#[allow(clippy::too_many_arguments)]
fn persist_generation(
    storage: &Storage,
    keys: &KeyBundle,
    sudo: &SudoRegistry,
    gdm: &GdmConfig,
    identities: &Identities,
    host_digest: &str,
    release_digest: &str,
    replace: bool,
) -> Result<()> {
    keys.validate()?;
    sudo.validate_inactive()?;
    gdm.validate_inactive()?;
    let public = keys.public_export(identities, host_digest, release_digest);
    public.validate()?;
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
    storage.write_manifest(&encode_json(&public)?, replace)
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
