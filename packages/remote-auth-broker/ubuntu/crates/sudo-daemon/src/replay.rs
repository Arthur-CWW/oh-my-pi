use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::linux::fs::MetadataExt;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use remote_auth_broker_protocol::PublicError;
use serde::{Deserialize, Serialize};

const STATE_PARENT: &str = "/var/lib/remote-auth-broker";
pub(crate) const NONCE_DIRECTORY: &str = "/var/lib/remote-auth-broker/sudo-nonces";
const LOCK_FILE: &str = ".lock";
const MAX_RECORD_BYTES: u64 = 4_096;
const MAX_RECORDS: usize = 4_096;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NonceRecord {
    protocol_version: u8,
    nonce: String,
    request_id: String,
    action_id: String,
    body_digest: String,
    boot_id: String,
    expires_at: u64,
    consumed_at: u64,
}

struct ReplayAttempt<'a> {
    nonce: &'a str,
    request_id: &'a str,
    body_digest: &'a str,
    boot_id: &'a str,
    now: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReplayDecision {
    Allow,
    Replayed,
    BodyConflict,
}

pub(crate) fn prepare_nonce_directory() -> Result<(), ()> {
    ensure_directory(Path::new(STATE_PARENT), 0o700)?;
    ensure_directory(Path::new(NONCE_DIRECTORY), 0o700)?;
    validate_directory(Path::new(NONCE_DIRECTORY), true)?;
    let lock = open_lock().map_err(|_| ())?;
    validate_state_file(&lock).map_err(|_| ())
}

pub(crate) fn consume_nonce(
    nonce: &str,
    request_id: &str,
    action_id: &str,
    body_digest: &str,
    boot_id: &str,
    expires_at: u64,
) -> Result<(), PublicError> {
    let now = wall_time_millis()?;
    let attempt = ReplayAttempt { nonce, request_id, body_digest, boot_id, now };
    let lock = open_lock()?;
    lock_exclusive(&lock)?;

    let mut records = Vec::new();
    let mut expired = Vec::new();
    let entries = fs::read_dir(NONCE_DIRECTORY).map_err(|_| PublicError::Internal)?;
    for (index, entry) in entries.enumerate() {
        if index >= MAX_RECORDS + 1 {
            return Err(PublicError::Internal);
        }
        let entry = entry.map_err(|_| PublicError::Internal)?;
        let name = entry.file_name();
        if name.as_bytes() == LOCK_FILE.as_bytes() {
            continue;
        }
        let path = entry.path();
        if name.as_bytes().starts_with(b".pending-") {
            validate_path_for_removal(&path)?;
            expired.push(path);
            continue;
        }
        let record = read_record(&path)?;
        if record.nonce.as_bytes() != name.as_bytes() {
            return Err(PublicError::Internal);
        }
        if record.expires_at <= now || record.boot_id != boot_id {
            expired.push(path);
        } else {
            records.push(record);
        }
    }
    for path in expired {
        fs::remove_file(path).map_err(|_| PublicError::Internal)?;
    }

    match classify(&records, &attempt) {
        ReplayDecision::Allow => {}
        ReplayDecision::Replayed => return Err(PublicError::RequestReplayed),
        ReplayDecision::BodyConflict => return Err(PublicError::BodyConflict),
    }
    if records.len() >= MAX_RECORDS {
        return Err(PublicError::Internal);
    }

    let record = NonceRecord {
        protocol_version: 1,
        nonce: nonce.to_owned(),
        request_id: request_id.to_owned(),
        action_id: action_id.to_owned(),
        body_digest: body_digest.to_owned(),
        boot_id: boot_id.to_owned(),
        expires_at,
        consumed_at: now,
    };
    validate_record(&record)?;
    let bytes = serde_json::to_vec(&record).map_err(|_| PublicError::Internal)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(PublicError::Internal);
    }

    let pending_path = Path::new(NONCE_DIRECTORY).join(format!(".pending-{request_id}"));
    let final_path = nonce_path(nonce)?;
    let mut pending = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(&pending_path)
        .map_err(|_| PublicError::Internal)?;
    if pending.write_all(&bytes).is_err() || pending.sync_all().is_err() {
        drop(pending);
        let _ = fs::remove_file(&pending_path);
        return Err(PublicError::Internal);
    }
    drop(pending);

    let pending_c = std::ffi::CString::new(pending_path.as_os_str().as_bytes())
        .map_err(|_| PublicError::Internal)?;
    let final_c = std::ffi::CString::new(final_path.as_os_str().as_bytes())
        .map_err(|_| PublicError::Internal)?;
    let renamed = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            pending_c.as_ptr(),
            libc::AT_FDCWD,
            final_c.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if renamed != 0 {
        let error = std::io::Error::last_os_error();
        let _ = fs::remove_file(&pending_path);
        return if error.kind() == std::io::ErrorKind::AlreadyExists {
            Err(PublicError::RequestReplayed)
        } else {
            Err(PublicError::Internal)
        };
    }

    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(NONCE_DIRECTORY)
        .map_err(|_| PublicError::Internal)?;
    directory.sync_all().map_err(|_| PublicError::Internal)
}

fn classify(records: &[NonceRecord], attempt: &ReplayAttempt<'_>) -> ReplayDecision {
    for record in records {
        if record.expires_at <= attempt.now || record.boot_id != attempt.boot_id {
            continue;
        }
        if record.request_id == attempt.request_id {
            return if record.body_digest == attempt.body_digest {
                ReplayDecision::Replayed
            } else {
                ReplayDecision::BodyConflict
            };
        }
        if record.nonce == attempt.nonce {
            return ReplayDecision::Replayed;
        }
    }
    ReplayDecision::Allow
}

fn read_record(path: &Path) -> Result<NonceRecord, PublicError> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| PublicError::Internal)?;
    validate_state_file(&file)?;
    let length = file.metadata().map_err(|_| PublicError::Internal)?.len();
    if length == 0 || length > MAX_RECORD_BYTES {
        return Err(PublicError::Internal);
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(MAX_RECORD_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PublicError::Internal)?;
    if bytes.len() as u64 != length {
        return Err(PublicError::Internal);
    }
    let record = serde_json::from_slice(&bytes).map_err(|_| PublicError::Internal)?;
    validate_record(&record)?;
    Ok(record)
}

fn validate_record(record: &NonceRecord) -> Result<(), PublicError> {
    if record.protocol_version != 1
        || nonce_path(&record.nonce).is_err()
        || !valid_identifier(&record.request_id, 22, 64)
        || !valid_identifier(&record.action_id, 1, 128)
        || !valid_digest(&record.body_digest)
        || record.boot_id.is_empty()
        || record.boot_id.len() > 256
        || record.boot_id.bytes().any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        || record.expires_at == 0
        || record.consumed_at == 0
    {
        return Err(PublicError::Internal);
    }
    Ok(())
}

fn validate_path_for_removal(path: &Path) -> Result<(), PublicError> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| PublicError::Internal)?;
    validate_state_file(&file)
}

fn open_lock() -> Result<File, PublicError> {
    let path = Path::new(NONCE_DIRECTORY).join(LOCK_FILE);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| PublicError::Internal)?;
    validate_state_file(&file)?;
    Ok(file)
}

fn lock_exclusive(file: &File) -> Result<(), PublicError> {
    loop {
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
            return Ok(());
        }
        if std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR) {
            return Err(PublicError::Internal);
        }
    }
}

fn validate_state_file(file: &File) -> Result<(), PublicError> {
    let metadata = file.metadata().map_err(|_| PublicError::Internal)?;
    if !metadata.file_type().is_file()
        || metadata.st_uid() != 0
        || metadata.st_mode() & 0o077 != 0
        || metadata.st_nlink() != 1
    {
        return Err(PublicError::Internal);
    }
    Ok(())
}

fn nonce_path(nonce: &str) -> Result<PathBuf, PublicError> {
    if !valid_identifier(nonce, 43, 43) {
        return Err(PublicError::NoncanonicalValue);
    }
    Ok(Path::new(NONCE_DIRECTORY).join(nonce))
}

fn valid_identifier(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn ensure_directory(path: &Path, create_mode: u32) -> Result<(), ()> {
    match fs::create_dir(path) {
        Ok(()) => fs::set_permissions(path, fs::Permissions::from_mode(create_mode)).map_err(|_| ())?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(()),
    }
    validate_directory(path, false)
}

fn validate_directory(path: &Path, private: bool) -> Result<(), ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.file_type().is_dir()
        || metadata.st_uid() != 0
        || metadata.st_mode() & 0o022 != 0
        || (private && metadata.st_mode() & 0o077 != 0)
    {
        return Err(());
    }
    Ok(())
}

fn wall_time_millis() -> Result<u64, PublicError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| PublicError::Internal)?
        .as_millis();
    u64::try_from(millis).map_err(|_| PublicError::Internal)
}

use std::os::fd::AsRawFd;

#[cfg(test)]
mod tests {
    use super::*;

    fn record(nonce: &str, request_id: &str, body_digest: &str) -> NonceRecord {
        NonceRecord {
            protocol_version: 1,
            nonce: nonce.to_owned(),
            request_id: request_id.to_owned(),
            action_id: "gdm.restart".to_owned(),
            body_digest: body_digest.to_owned(),
            boot_id: "boot-a".to_owned(),
            expires_at: 2_000,
            consumed_at: 900,
        }
    }

    #[test]
    fn replay_and_request_body_conflict_are_distinct() {
        let nonce = "A".repeat(43);
        let other_nonce = "B".repeat(43);
        let request_id = "C".repeat(22);
        let body = "1".repeat(64);
        let records = vec![record(&nonce, &request_id, &body)];

        let same = ReplayAttempt { nonce: &nonce, request_id: &request_id, body_digest: &body, boot_id: "boot-a", now: 1_000 };
        assert_eq!(classify(&records, &same), ReplayDecision::Replayed);

        let conflicting_body = "2".repeat(64);
        let conflict = ReplayAttempt { nonce: &other_nonce, request_id: &request_id, body_digest: &conflicting_body, boot_id: "boot-a", now: 1_000 };
        assert_eq!(classify(&records, &conflict), ReplayDecision::BodyConflict);

        let other_request = "D".repeat(22);
        let reused_nonce = ReplayAttempt { nonce: &nonce, request_id: &other_request, body_digest: &conflicting_body, boot_id: "boot-a", now: 1_000 };
        assert_eq!(classify(&records, &reused_nonce), ReplayDecision::Replayed);
    }

    #[test]
    fn expired_or_prior_boot_records_do_not_block() {
        let nonce = "A".repeat(43);
        let request_id = "C".repeat(22);
        let body = "1".repeat(64);
        let records = vec![record(&nonce, &request_id, &body)];
        let expired = ReplayAttempt { nonce: &nonce, request_id: &request_id, body_digest: &body, boot_id: "boot-a", now: 2_000 };
        assert_eq!(classify(&records, &expired), ReplayDecision::Allow);
        let new_boot = ReplayAttempt { nonce: &nonce, request_id: &request_id, body_digest: &body, boot_id: "boot-b", now: 1_000 };
        assert_eq!(classify(&records, &new_boot), ReplayDecision::Allow);
    }
}
