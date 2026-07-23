use std::ffi::{CStr, CString};
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::error::{Error, Result};
use crate::model::{hex_sha256, Identities};

const SSH_HOST_KEY: &str = "/etc/ssh/ssh_host_ed25519_key.pub";
const MAX_HOST_KEY_BYTES: u64 = 16_384;
const RELEASE_STATE: &str = "/var/lib/remote-auth-broker/gdm-release-current";
const SUBJECT_USER: &str = "arthur";
const GDM_INGEST_USER: &str = "remote-auth-gdm-ingest";

pub(crate) fn require_root() -> Result<()> {
    if unsafe { libc::geteuid() } != 0 {
        return Err(Error::Permission);
    }
    Ok(())
}

pub(crate) fn identities() -> Result<Identities> {
    let subject = user(SUBJECT_USER)?;
    let gdm = user(GDM_INGEST_USER)?;
    if subject.uid == 0
        || gdm.uid == 0
        || gdm.gid == 0
        || subject.uid == gdm.uid
    {
        return Err(Error::Identity);
    }
    Ok(Identities {
        subject_username: SUBJECT_USER.to_owned(),
        subject_uid: subject.uid,
        bridge_uid: gdm.uid,
        bridge_gid: gdm.gid,
        gdm_ingest_uid: gdm.uid,
        gdm_ingest_gid: gdm.gid,
    })
}

pub(crate) fn release_digest() -> Result<String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(Path::new(RELEASE_STATE))
        .map_err(|_| Error::Identity)?;
    let metadata = file.metadata().map_err(|_| Error::Identity)?;
    if !metadata.file_type().is_file()
        || metadata.uid() != 0
        || metadata.gid() != 0
        || metadata.mode() & 0o7777 != 0o600
        || metadata.nlink() != 1
        || metadata.len() == 0
        || metadata.len() > 4096
    {
        return Err(Error::Identity);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Identity)?;
    if bytes.len() as u64 != metadata.len() || bytes.iter().any(|byte| *byte == 0) {
        return Err(Error::Identity);
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| Error::Identity)?;
    let mut release = None;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("release=") {
            if release.replace(value).is_some() {
                return Err(Error::Identity);
            }
        }
    }
    let release = release.ok_or(Error::Identity)?;
    if release.len() != 64
        || !release
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(Error::Identity);
    }
    Ok(release.to_owned())
}

pub(crate) fn ssh_host_key_digest() -> Result<String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(Path::new(SSH_HOST_KEY))
        .map_err(|_| Error::HostKey)?;
    validate_host_key_file(&file)?;
    let length = file.metadata().map_err(|_| Error::HostKey)?.len();
    if length == 0 || length > MAX_HOST_KEY_BYTES {
        return Err(Error::HostKey);
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(MAX_HOST_KEY_BYTES + 1).read_to_end(&mut bytes).map_err(|_| Error::HostKey)?;
    if bytes.len() as u64 != length || bytes.len() as u64 > MAX_HOST_KEY_BYTES {
        return Err(Error::HostKey);
    }
    digest_openssh_ed25519(&bytes)
}

fn validate_host_key_file(file: &File) -> Result<()> {
    let metadata = file.metadata().map_err(|_| Error::HostKey)?;
    if !metadata.file_type().is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || metadata.nlink() != 1
    {
        return Err(Error::HostKey);
    }
    Ok(())
}

fn digest_openssh_ed25519(input: &[u8]) -> Result<String> {
    let text = std::str::from_utf8(input).map_err(|_| Error::HostKey)?;
    if text.as_bytes().contains(&0) || text.lines().count() != 1 {
        return Err(Error::HostKey);
    }
    let mut fields = text.split_ascii_whitespace();
    if fields.next() != Some("ssh-ed25519") {
        return Err(Error::HostKey);
    }
    let encoded = fields.next().ok_or(Error::HostKey)?;
    if encoded.is_empty() || fields.count() > 1 {
        return Err(Error::HostKey);
    }
    let blob = STANDARD.decode(encoded).map_err(|_| Error::HostKey)?;
    if STANDARD.encode(&blob).trim_end_matches('=') != encoded.trim_end_matches('=') {
        return Err(Error::HostKey);
    }
    validate_openssh_blob(&blob)?;
    Ok(hex_sha256(&blob))
}

fn validate_openssh_blob(blob: &[u8]) -> Result<()> {
    let mut offset = 0_usize;
    let algorithm = read_ssh_field(blob, &mut offset)?;
    let public_key = read_ssh_field(blob, &mut offset)?;
    if algorithm != b"ssh-ed25519" || public_key.len() != 32 || offset != blob.len() {
        return Err(Error::HostKey);
    }
    Ok(())
}

fn read_ssh_field<'a>(blob: &'a [u8], offset: &mut usize) -> Result<&'a [u8]> {
    let length_bytes: [u8; 4] = blob
        .get(*offset..offset.checked_add(4).ok_or(Error::HostKey)?)
        .ok_or(Error::HostKey)?
        .try_into()
        .map_err(|_| Error::HostKey)?;
    *offset += 4;
    let length = u32::from_be_bytes(length_bytes) as usize;
    let end = offset.checked_add(length).ok_or(Error::HostKey)?;
    let field = blob.get(*offset..end).ok_or(Error::HostKey)?;
    *offset = end;
    Ok(field)
}

struct User {
    uid: u32,
    gid: u32,
}

fn user(name: &str) -> Result<User> {
    let name = CString::new(name).map_err(|_| Error::Identity)?;
    let suggested = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let size = if suggested > 0 { suggested as usize } else { 16_384 };
    let mut buffer = vec![0_u8; size.clamp(1_024, 1_048_576)];
    let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
    let mut result = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwnam_r(
            name.as_ptr(),
            &mut entry,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() || entry.pw_name.is_null() {
        return Err(Error::Identity);
    }
    let resolved = unsafe { CStr::from_ptr(entry.pw_name) };
    if resolved.to_bytes() != name.as_bytes() {
        return Err(Error::Identity);
    }
    Ok(User { uid: entry.pw_uid, gid: entry.pw_gid })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openssh_digest_hashes_the_canonical_public_blob() {
        let mut blob = Vec::new();
        blob.extend_from_slice(&(11_u32.to_be_bytes()));
        blob.extend_from_slice(b"ssh-ed25519");
        blob.extend_from_slice(&(32_u32.to_be_bytes()));
        blob.extend_from_slice(&[9_u8; 32]);
        let line = format!("ssh-ed25519 {} host\n", STANDARD.encode(&blob));
        assert_eq!(digest_openssh_ed25519(line.as_bytes()).unwrap(), hex_sha256(&blob));
    }

    #[test]
    fn openssh_decode_rejects_wrong_algorithm_and_shape() {
        assert!(digest_openssh_ed25519(b"ssh-rsa AAAA\n").is_err());
        assert!(digest_openssh_ed25519(b"ssh-ed25519 AAAA\nsecond\n").is_err());
        assert!(digest_openssh_ed25519(b"ssh-ed25519 !!!\n").is_err());
    }
}
