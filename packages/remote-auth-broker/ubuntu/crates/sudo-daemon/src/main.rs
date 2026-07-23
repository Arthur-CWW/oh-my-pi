#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(target_os = "linux")]
mod config;
#[cfg(target_os = "linux")]
mod execution;
#[cfg(target_os = "linux")]
mod replay;
#[cfg(target_os = "linux")]
mod reply;
#[cfg(target_os = "linux")]
mod verification;

#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::io::{Read, Write};
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;
#[cfg(target_os = "linux")]
use std::os::linux::fs::MetadataExt;
#[cfg(target_os = "linux")]
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
#[cfg(target_os = "linux")]
use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "linux")]
use std::time::Duration;

#[cfg(target_os = "linux")]
use config::Registry;
#[cfg(target_os = "linux")]
use remote_auth_broker_protocol::{
    decode_sudo_signed_request_frame, PublicError, MAX_FRAME_BYTES,
};
#[cfg(target_os = "linux")]
use verification::LiveBindings;

#[cfg(target_os = "linux")]
const REGISTRY_PATH: &str = "/etc/remote-auth-broker/sudo-registry.json";
#[cfg(target_os = "linux")]
const RUN_DIRECTORY: &str = "/run/remote-auth-broker";
#[cfg(target_os = "linux")]
const SOCKET_PATH: &str = "/run/remote-auth-broker/sudo.sock";
#[cfg(target_os = "linux")]
const CLIENT_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(target_os = "linux")]
fn main() {
    if run().is_err() {
        eprintln!("remote-auth sudo daemon unavailable");
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("remote-auth sudo daemon requires Linux");
    std::process::exit(1);
}

#[cfg(target_os = "linux")]
fn run() -> Result<(), ()> {
    if std::env::args_os().nth(1).is_some() || unsafe { libc::geteuid() } != 0 {
        return Err(());
    }

    let registry = Registry::load(Path::new(REGISTRY_PATH)).map_err(|_| ())?;
    let live = LiveBindings::load(&registry)?;
    replay::prepare_nonce_directory()?;
    let listener = bind_socket(registry.bridge_gid)?;

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = handle_client(&mut stream, &registry, &live);
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(()),
        }
    }
}

#[cfg(target_os = "linux")]
fn handle_client(
    stream: &mut UnixStream,
    registry: &Registry,
    live: &LiveBindings,
) -> Result<(), ()> {
    stream.set_read_timeout(Some(CLIENT_TIMEOUT)).map_err(|_| ())?;
    stream.set_write_timeout(Some(CLIENT_TIMEOUT)).map_err(|_| ())?;

    let peer = peer_credentials(stream)?;
    if peer.uid != registry.bridge_uid || peer.gid != registry.bridge_gid {
        return send_reply(stream, reply::rejected(None, PublicError::PeerMismatch)?);
    }

    let frame = match read_one_frame(stream) {
        Ok(frame) => frame,
        Err(error) => return send_reply(stream, reply::rejected(None, error)?),
    };
    let signed = match decode_sudo_signed_request_frame(&frame) {
        Ok(signed) => signed,
        Err(error) => return send_reply(stream, reply::rejected(None, error.public_error())?),
    };
    let verified = match verification::verify_signed_request(&signed, registry, live) {
        Ok(verified) => verified,
        Err(error) => {
            return send_reply(
                stream,
                reply::rejected(Some(&signed.request.request_id), error)?,
            )
        }
    };
    let prepared = match execution::prepare_registered(verified.action) {
        Ok(prepared) => prepared,
        Err(()) => {
            return send_reply(
                stream,
                reply::rejected(Some(verified.request_id), PublicError::IntegrityFailure)?,
            )
        }
    };

    if let Err(error) = replay::consume_nonce(
        verified.nonce,
        verified.request_id,
        verified.action_id,
        verified.body_digest,
        live.boot_id(),
        verified.expires_at,
    ) {
        return send_reply(stream, reply::rejected(Some(verified.request_id), error)?);
    }

    let result = execution::execute_prepared(prepared);
    send_reply(stream, reply::execution(verified.request_id, result)?)
}

#[cfg(target_os = "linux")]
fn read_one_frame(stream: &mut UnixStream) -> Result<Vec<u8>, PublicError> {
    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).map_err(|_| PublicError::FrameInvalid)?;
    let payload_length = u32::from_be_bytes(header) as usize;
    if payload_length == 0 || payload_length > MAX_FRAME_BYTES {
        return Err(PublicError::FrameInvalid);
    }

    let mut frame = Vec::with_capacity(4 + payload_length);
    frame.extend_from_slice(&header);
    frame.resize(4 + payload_length, 0);
    stream
        .read_exact(&mut frame[4..])
        .map_err(|_| PublicError::FrameInvalid)?;

    let mut trailing = [0_u8; 1];
    match stream.read(&mut trailing) {
        Ok(0) => Ok(frame),
        Ok(_) | Err(_) => Err(PublicError::FrameInvalid),
    }
}

#[cfg(target_os = "linux")]
fn send_reply(stream: &mut UnixStream, frame: Vec<u8>) -> Result<(), ()> {
    stream.write_all(&frame).map_err(|_| ())?;
    stream.flush().map_err(|_| ())?;
    stream.shutdown(std::net::Shutdown::Both).map_err(|_| ())
}

#[cfg(target_os = "linux")]
struct PeerCredentials {
    uid: u32,
    gid: u32,
}

#[cfg(target_os = "linux")]
fn peer_credentials(stream: &UnixStream) -> Result<PeerCredentials, ()> {
    let mut credential = unsafe { std::mem::zeroed::<libc::ucred>() };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credential as *mut libc::ucred).cast(),
            &mut length,
        )
    };
    if result != 0 || length as usize != std::mem::size_of::<libc::ucred>() || credential.pid <= 0 {
        return Err(());
    }
    Ok(PeerCredentials { uid: credential.uid, gid: credential.gid })
}

#[cfg(target_os = "linux")]
fn bind_socket(group: u32) -> Result<UnixListener, ()> {
    ensure_run_directory()?;
    let socket_path = Path::new(SOCKET_PATH);
    match fs::symlink_metadata(socket_path) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() || metadata.st_uid() != 0 {
                return Err(());
            }
            fs::remove_file(socket_path).map_err(|_| ())?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(()),
    }

    let listener = UnixListener::bind(socket_path).map_err(|_| ())?;
    let path = std::ffi::CString::new(SOCKET_PATH).map_err(|_| ())?;
    if unsafe { libc::chown(path.as_ptr(), 0, group) } != 0 {
        let _ = fs::remove_file(socket_path);
        return Err(());
    }
    if fs::set_permissions(socket_path, fs::Permissions::from_mode(0o660)).is_err() {
        let _ = fs::remove_file(socket_path);
        return Err(());
    }
    Ok(listener)
}

#[cfg(target_os = "linux")]
fn ensure_run_directory() -> Result<(), ()> {
    match fs::create_dir(RUN_DIRECTORY) {
        Ok(()) => fs::set_permissions(RUN_DIRECTORY, fs::Permissions::from_mode(0o755)).map_err(|_| ())?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(()),
    }
    let metadata = fs::symlink_metadata(RUN_DIRECTORY).map_err(|_| ())?;
    if !metadata.file_type().is_dir() || metadata.st_uid() != 0 || metadata.st_mode() & 0o022 != 0 {
        return Err(());
    }
    Ok(())
}
