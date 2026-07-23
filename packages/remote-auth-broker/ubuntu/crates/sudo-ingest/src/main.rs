use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use remote_auth_broker_protocol::{decode_frame_payload, ProtocolVersion, PublicError, MAX_FRAME_BYTES};
use serde::{Deserialize, Deserializer};

const SOCKET_PATH: &str = "/run/remote-auth-broker/sudo.sock";
const MAX_REPLY_PAYLOAD_BYTES: usize = 4_096;
const SOCKET_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Outcome {
    Succeeded,
    Failed,
    Rejected,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MetadataReply {
    protocol_version: ProtocolVersion,
    #[serde(deserialize_with = "required_option")]
    request_id: Option<String>,
    outcome: Outcome,
    #[serde(deserialize_with = "required_option")]
    error: Option<PublicError>,
    #[serde(deserialize_with = "required_option")]
    exit_code: Option<i32>,
    #[serde(deserialize_with = "required_option")]
    signal: Option<i32>,
}

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn main() {
    if run().is_err() {
        eprintln!("remote-auth sudo request rejected");
        std::process::exit(1);
    }
}

fn run() -> Result<(), ()> {
    if std::env::args_os().nth(1).is_some() || std::env::var_os("SSH_ORIGINAL_COMMAND").is_some() {
        return Err(());
    }

    let request = read_exact_frame(io::stdin().lock(), MAX_FRAME_BYTES)?;
    validate_root_socket(Path::new(SOCKET_PATH))?;
    let mut stream = UnixStream::connect(SOCKET_PATH).map_err(|_| ())?;
    stream.set_read_timeout(Some(SOCKET_TIMEOUT)).map_err(|_| ())?;
    stream.set_write_timeout(Some(SOCKET_TIMEOUT)).map_err(|_| ())?;
    stream.write_all(&request).map_err(|_| ())?;
    stream.flush().map_err(|_| ())?;
    stream.shutdown(std::net::Shutdown::Write).map_err(|_| ())?;

    let reply = read_exact_frame(&mut stream, MAX_REPLY_PAYLOAD_BYTES)?;
    validate_metadata_reply(&reply)?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(&reply).map_err(|_| ())?;
    stdout.flush().map_err(|_| ())
}

fn read_exact_frame<R: Read>(mut reader: R, maximum_payload: usize) -> Result<Vec<u8>, ()> {
    let mut header = [0_u8; 4];
    reader.read_exact(&mut header).map_err(|_| ())?;
    let payload_length = u32::from_be_bytes(header) as usize;
    if payload_length > maximum_payload {
        return Err(());
    }

    let mut frame = Vec::with_capacity(4 + payload_length);
    frame.extend_from_slice(&header);
    frame.resize(4 + payload_length, 0);
    reader.read_exact(&mut frame[4..]).map_err(|_| ())?;

    let mut trailing = [0_u8; 1];
    match reader.read(&mut trailing) {
        Ok(0) => Ok(frame),
        Ok(_) | Err(_) => Err(()),
    }
}

fn validate_root_socket(path: &Path) -> Result<(), ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.file_type().is_socket() || metadata.uid() != 0 || metadata.mode() & 0o002 != 0 {
        return Err(());
    }
    Ok(())
}

fn validate_metadata_reply(frame: &[u8]) -> Result<(), ()> {
    let payload = decode_frame_payload(frame).map_err(|_| ())?;
    if payload.len() > MAX_REPLY_PAYLOAD_BYTES {
        return Err(());
    }
    let reply: MetadataReply = serde_json::from_slice(payload).map_err(|_| ())?;
    let _version = reply.protocol_version;
    match reply.outcome {
        Outcome::Succeeded => {
            if reply.request_id.is_none()
                || reply.error.is_some()
                || reply.exit_code != Some(0)
                || reply.signal.is_some()
            {
                return Err(());
            }
        }
        Outcome::Failed => {
            if reply.request_id.is_none()
                || reply.error != Some(PublicError::ExecutionFailed)
                || reply.exit_code == Some(0)
                || (reply.exit_code.is_some() && reply.signal.is_some())
            {
                return Err(());
            }
        }
        Outcome::Rejected => {
            if reply.error.is_none() || reply.exit_code.is_some() || reply.signal.is_some() {
                return Err(());
            }
        }
    }
    Ok(())
}
