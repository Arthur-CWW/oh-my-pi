use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Component, Path, PathBuf},
};

use crate::{sha256_bytes, LockedSecret, Result, VerifierError};

pub const MACHINE_ID_PATH: &str = "/etc/machine-id";
pub const BOOT_ID_PATH: &str = "/proc/sys/kernel/random/boot_id";
pub const RUNTIME_ROOT: &str = "/run/remote-auth-broker";
pub const CONFIG_ROOT: &str = "/etc/remote-auth-broker";
pub const STATE_ROOT: &str = "/var/lib/remote-auth-broker";

pub const MAX_POLICY_BYTES: usize = 1024 * 1024;
pub const MAX_CONFIG_BYTES: usize = 256 * 1024;
pub const MAX_LIVE_STATE_BYTES: usize = 256 * 1024;
pub const MAX_DOMAIN_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileMode {
    Exact(u32),
    NotGroupOrWorldWritable,
}

pub struct LoadedFile {
    bytes: Vec<u8>,
    digest: [u8; 32],
}

impl LoadedFile {
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub const fn digest(&self) -> &[u8; 32] {
        &self.digest
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    device: u64,
    inode: u64,
    size: u64,
    uid: u32,
    gid: u32,
    mode: u32,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

impl FileStamp {
    fn from_metadata(metadata: &Metadata) -> Self {
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            size: metadata.size(),
            uid: metadata.uid(),
            gid: metadata.gid(),
            mode: metadata.mode(),
            modified_seconds: metadata.mtime(),
            modified_nanoseconds: metadata.mtime_nsec(),
            changed_seconds: metadata.ctime(),
            changed_nanoseconds: metadata.ctime_nsec(),
        }
    }
}

pub fn load_root_owned_file(path: &Path, max_bytes: usize, mode: FileMode) -> Result<LoadedFile> {
    if max_bytes == 0 {
        return Err(VerifierError::InvalidConfiguration);
    }
    let (mut file, initial) = open_root_owned_regular(path, mode)?;
    if initial.size > max_bytes as u64 {
        return Err(VerifierError::InvalidFile);
    }

    let capacity = usize::try_from(initial.size).map_err(|_| VerifierError::InvalidFile)?;
    let mut bytes = Vec::with_capacity(capacity);
    Read::by_ref(&mut file)
        .take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| VerifierError::from_io(&error))?;
    if bytes.len() > max_bytes {
        return Err(VerifierError::InvalidFile);
    }
    ensure_unchanged(&file, initial)?;

    let digest = sha256_bytes(&bytes);
    Ok(LoadedFile { bytes, digest })
}

pub fn load_policy_file(path: &Path) -> Result<LoadedFile> {
    load_root_owned_file(path, MAX_POLICY_BYTES, FileMode::NotGroupOrWorldWritable)
}

pub fn load_config_file(path: &Path) -> Result<LoadedFile> {
    load_root_owned_file(path, MAX_CONFIG_BYTES, FileMode::NotGroupOrWorldWritable)
}

pub fn load_controller_live_state(path: &Path) -> Result<LoadedFile> {
    load_root_owned_file(
        path,
        MAX_LIVE_STATE_BYTES,
        FileMode::NotGroupOrWorldWritable,
    )
}

pub fn load_greeter_live_state(path: &Path) -> Result<LoadedFile> {
    load_root_owned_file(
        path,
        MAX_LIVE_STATE_BYTES,
        FileMode::NotGroupOrWorldWritable,
    )
}

pub fn load_domain_file(path: &Path) -> Result<LoadedFile> {
    load_root_owned_file(path, MAX_DOMAIN_BYTES, FileMode::NotGroupOrWorldWritable)
}

pub fn load_key_file(path: &Path, expected_bytes: usize) -> Result<LockedSecret> {
    if expected_bytes == 0 {
        return Err(VerifierError::InvalidConfiguration);
    }
    let (mut file, initial) = open_root_owned_regular(path, FileMode::Exact(0o600))?;
    if initial.size != expected_bytes as u64 {
        return Err(VerifierError::InvalidFile);
    }

    let mut secret = LockedSecret::allocate(expected_bytes)?;
    file.read_exact(secret.as_mut_bytes())
        .map_err(|error| VerifierError::from_io(&error))?;
    let mut extra = [0_u8; 1];
    if file
        .read(&mut extra)
        .map_err(|error| VerifierError::from_io(&error))?
        != 0
    {
        return Err(VerifierError::InvalidFile);
    }
    ensure_unchanged(&file, initial)?;
    Ok(secret)
}

pub fn load_machine_id() -> Result<String> {
    load_machine_id_from(Path::new(MACHINE_ID_PATH))
}

pub fn load_machine_id_from(path: &Path) -> Result<String> {
    let loaded = load_root_owned_file(path, 64, FileMode::NotGroupOrWorldWritable)?;
    let bytes = one_line(loaded.into_bytes())?;
    if bytes.len() != 32
        || bytes.iter().any(|byte| !matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        || bytes.iter().all(|byte| *byte == b'0')
    {
        return Err(VerifierError::InvalidFile);
    }
    String::from_utf8(bytes).map_err(|_| VerifierError::InvalidFile)
}

pub fn load_boot_id() -> Result<String> {
    load_boot_id_from(Path::new(BOOT_ID_PATH))
}

pub fn load_boot_id_from(path: &Path) -> Result<String> {
    let loaded = load_root_owned_file(path, 64, FileMode::NotGroupOrWorldWritable)?;
    let bytes = one_line(loaded.into_bytes())?;
    if bytes.len() != 36
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| match index {
                8 | 13 | 18 | 23 => *byte != b'-',
                _ => !matches!(byte, b'0'..=b'9' | b'a'..=b'f'),
            })
        || bytes
            .iter()
            .filter(|byte| **byte != b'-')
            .all(|byte| *byte == b'0')
    {
        return Err(VerifierError::InvalidFile);
    }
    String::from_utf8(bytes).map_err(|_| VerifierError::InvalidFile)
}

fn one_line(mut bytes: Vec<u8>) -> Result<Vec<u8>> {
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    if bytes.is_empty() || bytes.iter().any(|byte| matches!(byte, b'\n' | b'\r')) {
        return Err(VerifierError::InvalidFile);
    }
    Ok(bytes)
}

fn open_root_owned_regular(path: &Path, mode: FileMode) -> Result<(File, FileStamp)> {
    let before = fs::symlink_metadata(path).map_err(|error| VerifierError::from_io(&error))?;
    validate_root_regular(&before, mode)?;

    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| VerifierError::from_io(&error))?;
    let after = file
        .metadata()
        .map_err(|error| VerifierError::from_io(&error))?;
    validate_root_regular(&after, mode)?;
    let before_stamp = FileStamp::from_metadata(&before);
    let after_stamp = FileStamp::from_metadata(&after);
    if before_stamp != after_stamp {
        return Err(VerifierError::UnsafeFile);
    }
    Ok((file, after_stamp))
}

fn ensure_unchanged(file: &File, initial: FileStamp) -> Result<()> {
    let final_metadata = file
        .metadata()
        .map_err(|error| VerifierError::from_io(&error))?;
    if FileStamp::from_metadata(&final_metadata) != initial {
        return Err(VerifierError::UnsafeFile);
    }
    Ok(())
}

fn validate_root_regular(metadata: &Metadata, mode: FileMode) -> Result<()> {
    if !metadata.file_type().is_file() || metadata.uid() != 0 {
        return Err(VerifierError::UnsafeFile);
    }
    validate_mode(metadata.mode(), mode)
}

fn validate_mode(raw_mode: u32, requirement: FileMode) -> Result<()> {
    let permissions = raw_mode & 0o7777;
    match requirement {
        FileMode::Exact(expected) if expected <= 0o777 && permissions == expected => Ok(()),
        FileMode::NotGroupOrWorldWritable
            if permissions & 0o7022 == 0 =>
        {
            Ok(())
        }
        _ => Err(VerifierError::UnsafeFile),
    }
}

pub(crate) fn validate_trusted_directory_tree(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(VerifierError::UnsafePath);
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir => current.push(Path::new("/")),
            Component::Normal(name) => current.push(name),
            _ => return Err(VerifierError::UnsafePath),
        }
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| VerifierError::from_io(&error))?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o7022 != 0 {
            return Err(VerifierError::UnsafePath);
        }
    }
    Ok(())
}

pub(crate) fn sync_directory(path: &Path) -> Result<()> {
    validate_trusted_directory_tree(path)?;
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_DIRECTORY)
        .open(path)
        .map_err(|error| VerifierError::from_io(&error))?;
    directory
        .sync_all()
        .map_err(|error| VerifierError::from_io(&error))
}

