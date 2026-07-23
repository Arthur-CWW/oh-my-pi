use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::process;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use remote_auth_broker_protocol::MAX_FRAME_BYTES;
use remote_auth_broker_verifier_core::{peer_credentials, FrameIo, FrameTimeouts};

const SOCKET_PATH: &str = "/run/remote-auth-broker/gdm/ingest.sock";
const TRUSTED_SOCKET_DIRECTORIES: [&str; 3] = [
    "/run",
    "/run/remote-auth-broker",
    "/run/remote-auth-broker/gdm",
];
const INPUT_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const SOCKET_IO_TIMEOUT: Duration = Duration::from_secs(5);
const REJECTION_MESSAGE: &[u8] = b"remote-auth-gdm-ingest: rejected\n";
const REJECTION_EXIT_STATUS: i32 = 1;
const FRAME_HEADER_BYTES: usize = 4;
const MAX_METADATA_REPLY_BYTES: usize = 4096;

fn main() {
    if invocation_is_invalid() || relay_one_exchange().is_err() {
        let _ = io::stderr().write_all(REJECTION_MESSAGE);
        process::exit(REJECTION_EXIT_STATUS);
    }
}

fn invocation_is_invalid() -> bool {
    invocation_values_are_invalid(
        env::args_os().nth(1).is_some(),
        env::var_os("SSH_ORIGINAL_COMMAND").is_some(),
    )
}

fn invocation_values_are_invalid(has_argument: bool, has_original_command: bool) -> bool {
    has_argument || has_original_command
}

fn relay_one_exchange() -> Result<(), ()> {
    let request = read_stdin_frame_with_deadline()?;
    verify_socket_path()?;

    let daemon = connect_with_deadline()?;
    let mut framed = FrameIo::new(
        daemon,
        FrameTimeouts::new(SOCKET_IO_TIMEOUT, SOCKET_IO_TIMEOUT),
    )
    .map_err(|_| ())?;
    framed.write_frame(&request).map_err(|_| ())?;
    framed
        .stream()
        .shutdown(std::net::Shutdown::Write)
        .map_err(|_| ())?;

    let daemon = framed.into_stream();
    let reply = read_exact_frame(daemon, MAX_METADATA_REPLY_BYTES)?;

    let mut stdout = io::stdout().lock();
    write_frame(&mut stdout, &reply)?;
    stdout.flush().map_err(|_| ())
}

fn read_stdin_frame_with_deadline() -> Result<Vec<u8>, ()> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::Builder::new()
        .spawn(move || {
            let result = read_exact_frame(io::stdin(), MAX_FRAME_BYTES);
            let _ = sender.send(result);
        })
        .map_err(|_| ())?;

    receiver.recv_timeout(INPUT_TIMEOUT).map_err(|_| ())?
}

fn read_exact_frame(mut source: impl Read, maximum: usize) -> Result<Vec<u8>, ()> {
    let mut header = [0_u8; FRAME_HEADER_BYTES];
    source.read_exact(&mut header).map_err(|_| ())?;

    let payload_length = usize::try_from(u32::from_be_bytes(header)).map_err(|_| ())?;
    if payload_length == 0 || payload_length > maximum {
        return Err(());
    }
    let mut payload = Vec::new();
    payload.try_reserve_exact(payload_length).map_err(|_| ())?;
    payload.resize(payload_length, 0);
    source.read_exact(&mut payload).map_err(|_| ())?;

    let mut trailing = [0_u8; 1];
    match read_uninterrupted(&mut source, &mut trailing) {
        Ok(0) => Ok(payload),
        Ok(_) | Err(_) => Err(()),
    }
}

fn write_frame(destination: &mut impl Write, payload: &[u8]) -> Result<(), ()> {
    if payload.is_empty() || payload.len() > MAX_METADATA_REPLY_BYTES {
        return Err(());
    }
    let length = u32::try_from(payload.len()).map_err(|_| ())?;
    destination
        .write_all(&length.to_be_bytes())
        .and_then(|()| destination.write_all(payload))
        .map_err(|_| ())
}

fn read_uninterrupted(source: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    loop {
        match source.read(buffer) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => return result,
        }
    }
}

fn verify_socket_path() -> Result<(), ()> {
    for directory in TRUSTED_SOCKET_DIRECTORIES {
        let metadata = fs::symlink_metadata(directory).map_err(|_| ())?;
        if !metadata.file_type().is_dir()
            || metadata.uid() != 0
            || metadata.mode() & 0o022 != 0
        {
            return Err(());
        }
    }

    let metadata = fs::symlink_metadata(SOCKET_PATH).map_err(|_| ())?;
    if !metadata.file_type().is_socket() || metadata.uid() != 0 || metadata.mode() & 0o002 != 0 {
        return Err(());
    }
    Ok(())
}

fn connect_with_deadline() -> Result<UnixStream, ()> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::Builder::new()
        .spawn(move || {
            let result = UnixStream::connect(SOCKET_PATH);
            let _ = sender.send(result);
        })
        .map_err(|_| ())?;

    let stream = receiver
        .recv_timeout(CONNECT_TIMEOUT)
        .map_err(|_| ())?
        .map_err(|_| ())?;
    if peer_credentials(&stream).map_err(|_| ())?.uid != 0 {
        return Err(());
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn frame(payload: &[u8]) -> Vec<u8> {
        let mut encoded = Vec::with_capacity(FRAME_HEADER_BYTES + payload.len());
        encoded.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        encoded.extend_from_slice(payload);
        encoded
    }

    #[test]
    fn invocation_rejects_arguments_and_original_command_even_when_empty() {
        assert!(!invocation_values_are_invalid(false, false));
        assert!(invocation_values_are_invalid(true, false));
        assert!(invocation_values_are_invalid(false, true));
        assert!(invocation_values_are_invalid(true, true));
    }

    #[test]
    fn frame_parser_returns_one_opaque_payload() {
        let payload = br#"{"opaque":true}"#;
        assert_eq!(
            read_exact_frame(Cursor::new(frame(payload)), MAX_FRAME_BYTES),
            Ok(payload.to_vec())
        );
    }

    #[test]
    fn frame_parser_rejects_empty_oversize_truncated_and_trailing_frames() {
        assert_eq!(
            read_exact_frame(Cursor::new(frame(b"")), MAX_FRAME_BYTES),
            Err(())
        );

        let oversize = ((MAX_FRAME_BYTES + 1) as u32).to_be_bytes();
        assert_eq!(
            read_exact_frame(Cursor::new(oversize), MAX_FRAME_BYTES),
            Err(())
        );

        let mut truncated = frame(b"abc");
        truncated.pop();
        assert_eq!(
            read_exact_frame(Cursor::new(truncated), MAX_FRAME_BYTES),
            Err(())
        );

        let mut trailing = frame(b"abc");
        trailing.push(0);
        assert_eq!(
            read_exact_frame(Cursor::new(trailing), MAX_FRAME_BYTES),
            Err(())
        );
    }

    #[test]
    fn metadata_writer_emits_exact_single_frame_and_enforces_bound() {
        let mut encoded = Vec::new();
        write_frame(&mut encoded, b"metadata").expect("bounded metadata");
        assert_eq!(encoded, frame(b"metadata"));

        assert_eq!(write_frame(&mut Vec::new(), b""), Err(()));
        assert_eq!(
            write_frame(&mut Vec::new(), &vec![0; MAX_METADATA_REPLY_BYTES + 1]),
            Err(())
        );
    }
}
