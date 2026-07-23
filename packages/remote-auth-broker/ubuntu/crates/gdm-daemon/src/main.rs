mod config;
mod crypto;
mod error;
mod live;
mod state;

use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use config::Config;
use crypto::CryptoMaterial;
use error::{DaemonError, Result};
use live::LiveSnapshot;
use remote_auth_broker_protocol::{GdmClaim, GdmEnvelope, ProtocolVersion, PublicError, Validate};
use remote_auth_broker_verifier_core::{
    bind_unix_listener, boottime_millis, inspect_process, peer_credentials, sha256_bytes,
    BoundUnixListener, FrameIo, FrameTimeouts, ProcessExpectation, UnixListenerSpec,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use state::{LifecycleStatus, ServerState};

const DEFAULT_CONFIG: &str = "/etc/remote-auth-broker/gdm.json";
const GDM_SESSION_WORKER: &str = "/usr/libexec/gdm-session-worker";
const GDM_DAEMON: &str = "/usr/sbin/gdm3";
const GDM_SERVICE_CGROUP: &[u8] = b"/system.slice/gdm.service";
const GDM_GREETER_UID: u32 = 128;

fn gdm_process_expectation(target_uid: Option<u32>) -> ProcessExpectation {
    let expectation = ProcessExpectation::none()
        .with_executable(GDM_SESSION_WORKER)
        .with_direct_parent_executable(GDM_DAEMON)
        .requiring_uniform_credentials();
    match target_uid {
        Some(target_uid) => expectation.with_cgroup_or_user_session_scopes(
            GDM_SERVICE_CGROUP,
            GDM_GREETER_UID,
            Some(target_uid),
        ),
        None => expectation.with_cgroup_or_any_user_session_scope(GDM_SERVICE_CGROUP),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ChallengeRequest {
    protocol_version: ProtocolVersion,
    action: ChallengeAction,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ChallengeAction {
    IssueChallenge,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataReply<'a> {
    protocol_version: u8,
    request_id: Option<&'a str>,
    accepted: bool,
    error: Option<PublicError>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StatusQuery {
    protocol_version: ProtocolVersion,
    action: StatusAction,
    request_id: String,
    issue_id: String,
    nonce: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum StatusAction {
    RequestStatus,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SuccessAcknowledgement {
    protocol_version: ProtocolVersion,
    action: SuccessAction,
    request_id: String,
    issue_id: String,
    nonce: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum SuccessAction {
    AuthenticationSucceeded,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleReply<'a> {
    protocol_version: u8,
    request_id: &'a str,
    issue_id: &'a str,
    state: LifecycleStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimContext<'a> {
    schema_version: u8,
    request_id: &'a str,
    nonce: &'a str,
    issue_id: &'a str,
    sentinel_hash: &'a str,
    uid: u32,
    seat: &'a str,
    greeter_generation: u64,
    controller_generation: u64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("remote-auth-gdmd: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let config_path = parse_config_path()?;
    let config = Arc::new(Config::load(&config_path)?);
    let crypto = if config.active {
        Some(Arc::new(CryptoMaterial::load(&config)?))
    } else {
        None
    };
    let ingest = bind_unix_listener(
        &UnixListenerSpec::root_owned(&config.ingest_socket_path, config.ingest_gid, 0o660)
            .with_backlog(16),
    )?;
    let claims = bind_unix_listener(
        &UnixListenerSpec::root_owned(&config.claim_socket_path, 0, 0o600).with_backlog(8),
    )?;
    ingest.set_nonblocking(true)?;
    claims.set_nonblocking(true)?;

    let state = Arc::new(Mutex::new(ServerState::default()));
    loop {
        let mut handled = false;
        if let Some(stream) = accept(&claims)? {
            handled = true;
            let config = Arc::clone(&config);
            let state = Arc::clone(&state);
            thread::Builder::new()
                .name("gdm-claim".to_owned())
                .spawn(move || handle_claim(stream, &config, &state))
                .map_err(|_| DaemonError::Unavailable)?;
        }
        if let Some(stream) = accept(&ingest)? {
            handled = true;
            let config = Arc::clone(&config);
            let crypto = crypto.as_ref().map(Arc::clone);
            let state = Arc::clone(&state);
            thread::Builder::new()
                .name("gdm-ingest".to_owned())
                .spawn(move || handle_ingest(stream, &config, crypto.as_deref(), &state))
                .map_err(|_| DaemonError::Unavailable)?;
        }
        if !handled {
            thread::sleep(Duration::from_millis(10));
        }
    }
}

fn parse_config_path() -> Result<PathBuf> {
    let mut args = env::args_os().skip(1);
    match (args.next(), args.next(), args.next()) {
        (None, None, None) => Ok(PathBuf::from(DEFAULT_CONFIG)),
        (Some(flag), Some(path), None) if flag == "--config" && Path::new(&path).is_absolute() => {
            Ok(PathBuf::from(path))
        }
        _ => Err(DaemonError::Configuration),
    }
}

fn accept(listener: &BoundUnixListener) -> Result<Option<UnixStream>> {
    match listener.listener().accept() {
        Ok((stream, _)) => Ok(Some(stream)),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn handle_ingest(
    stream: UnixStream,
    config: &Config,
    crypto: Option<&CryptoMaterial>,
    state: &Mutex<ServerState>,
) {
    let Ok(credentials) = peer_credentials(&stream) else { return; };
    if credentials.uid != config.ingest_uid || credentials.gid != config.ingest_gid {
        return;
    }
    let (read, write) = config.io_timeouts();
    let Ok(mut framed) = FrameIo::new(stream, FrameTimeouts::new(read, write)) else { return; };
    let Ok(payload) = framed.read_frame() else { return; };

    let response = state
        .lock()
        .map_err(|_| DaemonError::Unavailable)
        .and_then(|mut state| process_ingest(&payload, config, crypto, &mut state))
        .unwrap_or_else(|error| metadata(None, false, Some(error.public_error())));
    if let Ok(response) = response {
        let _ = framed.write_frame(&response);
    }
}

fn process_ingest(
    payload: &[u8],
    config: &Config,
    crypto: Option<&CryptoMaterial>,
    state: &mut ServerState,
) -> Result<std::result::Result<Vec<u8>, serde_json::Error>> {
    if let Ok(query) = decode_strict::<StatusQuery>(payload) {
        if !config.active || !valid_lifecycle_key(&query.request_id, &query.issue_id, &query.nonce) {
            return Err(DaemonError::Protocol(PublicError::NoncanonicalValue));
        }
        let now = boottime_millis()?;
        let status = state.status(&query.request_id, &query.issue_id, &query.nonce, now)?;
        return Ok(serde_json::to_vec(&LifecycleReply {
            protocol_version: 1,
            request_id: &query.request_id,
            issue_id: &query.issue_id,
            state: status,
        }));
    }

    if decode_strict::<ChallengeRequest>(payload).is_ok() {
        if !config.active {
            return Err(DaemonError::Inactive);
        }
        let live = LiveSnapshot::load(config)?;
        let now = boottime_millis()?;
        let challenge = state.issue_challenge(
            random_id()?,
            random_nonce()?,
            &live,
            &config.policy_digest,
            now,
            config.challenge_lifetime_ms,
            config.max_pending_claims,
        )?;
        return Ok(serde_json::to_vec(&challenge));
    }

    let envelope: GdmEnvelope = decode_strict(payload)
        .map_err(|_| DaemonError::Protocol(PublicError::NoncanonicalValue))?;
    if !config.active {
        return Err(DaemonError::Inactive);
    }
    let request_id = envelope.request.request_id.clone();
    let live = LiveSnapshot::load(config)?;
    let now = boottime_millis()?;
    let prepared = crypto
        .ok_or(DaemonError::Inactive)?
        .verify_and_open(config, &live, envelope, sha256_bytes(payload), now)?;
    let context = ClaimContext {
        schema_version: 1,
        request_id: &prepared.pending.request_id,
        nonce: &prepared.pending.nonce,
        issue_id: &prepared.pending.issue_id,
        sentinel_hash: &prepared.pending.sentinel_hash,
        uid: prepared.pending.uid,
        seat: &prepared.pending.seat,
        greeter_generation: prepared.pending.greeter_generation,
        controller_generation: prepared.pending.controller_generation,
    };
    let encoded_context = serde_json::to_vec(&context).map_err(|_| DaemonError::Integrity)?;
    state.install_verified(prepared, now, config.max_pending_claims)?;
    write_context(&config.claim_context_path, &encoded_context)?;
    Ok(metadata(Some(&request_id), true, None))
}

fn handle_claim(stream: UnixStream, config: &Config, state: &Mutex<ServerState>) {
    let Ok(credentials) = peer_credentials(&stream) else { return; };
    let expectation = gdm_process_expectation(None);
    if credentials.uid != 0
        || credentials.gid != 0
        || !config.active
        || inspect_process(credentials, &expectation).is_err()
    {
        return;
    }
    let (read, write) = config.io_timeouts();
    let Ok(mut framed) = FrameIo::new(stream, FrameTimeouts::new(read, write)) else { return; };
    let Ok(payload) = framed.read_frame() else { return; };
    if inspect_process(credentials, &expectation).is_err() {
        return;
    }

    if let Ok(acknowledgement) = decode_strict::<SuccessAcknowledgement>(&payload) {
        if !valid_lifecycle_key(
            &acknowledgement.request_id,
            &acknowledgement.issue_id,
            &acknowledgement.nonce,
        ) {
            return;
        }
        let Ok(now) = boottime_millis() else { return; };
        let Ok(status) = state
            .lock()
            .map_err(|_| DaemonError::Unavailable)
            .and_then(|mut state| {
                state.acknowledge_success(
                    &acknowledgement.request_id,
                    &acknowledgement.issue_id,
                    &acknowledgement.nonce,
                    now,
                )
            })
        else {
            return;
        };
        let Ok(reply) = serde_json::to_vec(&LifecycleReply {
            protocol_version: 1,
            request_id: &acknowledgement.request_id,
            issue_id: &acknowledgement.issue_id,
            state: status,
        }) else {
            return;
        };
        let _ = framed.write_frame(&reply);
        return;
    }

    let Ok(claim) = decode_strict::<GdmClaim>(&payload) else { return; };
    if claim.validate().is_err() {
        return;
    }
    let claim_expectation = gdm_process_expectation(Some(claim.uid));
    let Ok(live) = LiveSnapshot::load(config) else { return; };
    let Ok(now) = boottime_millis() else { return; };
    let Ok(password) = state
        .lock()
        .map_err(|_| DaemonError::Unavailable)
        .and_then(|mut state| state.claim(&claim, sha256_bytes(&payload), &live, now))
    else {
        return;
    };
    if inspect_process(credentials, &claim_expectation).is_err() {
        mark_claim_failed(state, &claim, now);
        return;
    }
    let _ = fs::remove_file(&config.claim_context_path);
    if framed.write_frame(password.as_bytes()).is_err() {
        mark_claim_failed(state, &claim, now);
    }
}

fn mark_claim_failed(state: &Mutex<ServerState>, claim: &GdmClaim, now_boottime_ms: u64) {
    if let Ok(mut state) = state.lock() {
        let _ = state.mark_claim_failed(
            &claim.request_id,
            &claim.issue_id,
            &claim.nonce,
            now_boottime_ms,
        );
    }
}

fn decode_strict<T: DeserializeOwned>(bytes: &[u8]) -> std::result::Result<T, serde_json::Error> {
    let mut decoder = serde_json::Deserializer::from_slice(bytes);
    let value = T::deserialize(&mut decoder)?;
    decoder.end()?;
    Ok(value)
}

fn valid_lifecycle_key(request_id: &str, issue_id: &str, nonce: &str) -> bool {
    valid_b64url(request_id, 22, 64)
        && valid_b64url(issue_id, 22, 86)
        && valid_b64url(nonce, 43, 43)
}

fn valid_b64url(value: &str, minimum: usize, maximum: usize) -> bool {
    if !(minimum..=maximum).contains(&value.len()) {
        return false;
    }
    let Some(last) = value.bytes().try_fold(0_u8, |_, byte| match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'-' => Some(62),
        b'_' => Some(63),
        _ => None,
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

fn random_id() -> Result<String> {
    let mut bytes = [0_u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| DaemonError::Unavailable)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn random_nonce() -> Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| DaemonError::Unavailable)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn metadata(
    request_id: Option<&str>,
    accepted: bool,
    error: Option<PublicError>,
) -> std::result::Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&MetadataReply { protocol_version: 1, request_id, accepted, error })
}

fn write_context(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or(DaemonError::Configuration)?;
    let temporary = parent.join(format!(".claim-context.{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(&temporary)?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
        fs::rename(&temporary, path)?;
        OpenOptions::new().read(true).open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
