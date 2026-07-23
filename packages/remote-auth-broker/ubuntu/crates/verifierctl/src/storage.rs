use std::ffi::CString;
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::fs::MetadataExt;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

use crate::error::{Error, Result};

pub(crate) const CONFIG_ROOT: &str = "/etc/remote-auth-broker";
pub(crate) const MANIFEST_FILE: &str = "key-manifest.json";
pub(crate) const SUDO_PRIVATE_FILE: &str = "sudo-signing-private.key";
pub(crate) const GDM_SIGNING_PRIVATE_FILE: &str = "gdm-signing-private.key";
pub(crate) const GDM_RECIPIENT_PRIVATE_FILE: &str = "gdm-hpke-private.key";
pub(crate) const SUDO_REGISTRY_FILE: &str = "sudo-registry.json";
pub(crate) const GDM_CONFIG_FILE: &str = "gdm.json";
const KEYS_DIRECTORY: &str = "keys";
const MAX_JSON_BYTES: usize = 1_048_576;

pub(crate) struct Storage {
    root: SecureDirectory,
    keys: SecureDirectory,
}

impl Storage {
    pub(crate) fn open(create: bool) -> Result<Self> {
        let root = SecureDirectory::open_absolute(CONFIG_ROOT, create)?;
        let keys = root.open_child(KEYS_DIRECTORY, create)?;
        Ok(Self { root, keys })
    }

    pub(crate) fn complete_state(&self) -> Result<bool> {
        let states = [
            self.root.exists(MANIFEST_FILE)?,
            self.keys.exists(SUDO_PRIVATE_FILE)?,
            self.keys.exists(GDM_SIGNING_PRIVATE_FILE)?,
            self.keys.exists(GDM_RECIPIENT_PRIVATE_FILE)?,
            self.root.exists(SUDO_REGISTRY_FILE)?,
            self.root.exists(GDM_CONFIG_FILE)?,
        ];
        let present = states.iter().filter(|value| **value).count();
        match present {
            0 => Ok(false),
            6 => Ok(true),
            _ => Err(Error::State),
        }
    }

    pub(crate) fn read_manifest(&self) -> Result<Vec<u8>> {
        self.root.read(MANIFEST_FILE, MAX_JSON_BYTES)
    }

    pub(crate) fn read_sudo_registry(&self) -> Result<Vec<u8>> {
        self.root.read(SUDO_REGISTRY_FILE, MAX_JSON_BYTES)
    }

    pub(crate) fn read_gdm_config(&self) -> Result<Vec<u8>> {
        self.root.read(GDM_CONFIG_FILE, MAX_JSON_BYTES)
    }

    pub(crate) fn read_private_keys(&self) -> Result<([u8; 32], [u8; 32], [u8; 32])> {
        Ok((
            self.keys.read_exact_32(SUDO_PRIVATE_FILE)?,
            self.keys.read_exact_32(GDM_SIGNING_PRIVATE_FILE)?,
            self.keys.read_exact_32(GDM_RECIPIENT_PRIVATE_FILE)?,
        ))
    }

    pub(crate) fn write_private_keys(
        &self,
        sudo: &[u8; 32],
        gdm_signing: &[u8; 32],
        gdm_recipient: &[u8; 32],
        replace: bool,
    ) -> Result<()> {
        self.keys.write_atomic(SUDO_PRIVATE_FILE, sudo, replace)?;
        self.keys.write_atomic(GDM_SIGNING_PRIVATE_FILE, gdm_signing, replace)?;
        self.keys.write_atomic(GDM_RECIPIENT_PRIVATE_FILE, gdm_recipient, replace)
    }

    pub(crate) fn write_sudo_registry(&self, bytes: &[u8], replace: bool) -> Result<()> {
        self.root.write_atomic(SUDO_REGISTRY_FILE, bytes, replace)
    }

    pub(crate) fn write_gdm_config(&self, bytes: &[u8], replace: bool) -> Result<()> {
        self.root.write_atomic(GDM_CONFIG_FILE, bytes, replace)
    }

    pub(crate) fn write_manifest(&self, bytes: &[u8], replace: bool) -> Result<()> {
        self.root.write_atomic(MANIFEST_FILE, bytes, replace)
    }
}

struct SecureDirectory {
    file: File,
}

impl SecureDirectory {
    fn open_absolute(path: &str, create: bool) -> Result<Self> {
        let path = CString::new(path).map_err(|_| Error::Io)?;
        if create {
            let status = unsafe { libc::mkdir(path.as_ptr(), 0o700) };
            if status != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
                return Err(Error::Io);
            }
        }
        let descriptor = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        Self::from_descriptor(descriptor)
    }

    fn open_child(&self, name: &str, create: bool) -> Result<Self> {
        let name = safe_name(name)?;
        if create {
            let status = unsafe { libc::mkdirat(self.file.as_raw_fd(), name.as_ptr(), 0o700) };
            if status != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
                return Err(Error::Io);
            }
        }
        let descriptor = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        Self::from_descriptor(descriptor)
    }

    fn from_descriptor(descriptor: RawFd) -> Result<Self> {
        if descriptor < 0 {
            return Err(Error::UnsafeFile);
        }
        let file = unsafe { File::from_raw_fd(descriptor) };
        let metadata = file.metadata().map_err(|_| Error::UnsafeFile)?;
        if !metadata.file_type().is_dir()
            || metadata.uid() != 0
            || metadata.gid() != 0
            || metadata.mode() & 0o022 != 0
        {
            return Err(Error::UnsafeFile);
        }
        Ok(Self { file })
    }

    fn exists(&self, name: &str) -> Result<bool> {
        let name = safe_name(name)?;
        let descriptor = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return match std::io::Error::last_os_error().raw_os_error() {
                Some(libc::ENOENT) => Ok(false),
                _ => Err(Error::UnsafeFile),
            };
        }
        let file = unsafe { File::from_raw_fd(descriptor) };
        validate_file(&file)?;
        Ok(true)
    }

    fn read(&self, name: &str, maximum: usize) -> Result<Vec<u8>> {
        let mut file = self.open_file(name)?;
        let length = file.metadata().map_err(|_| Error::Io)?.len();
        if length == 0 || length > maximum as u64 {
            return Err(Error::InvalidData);
        }
        let mut bytes = Vec::with_capacity(length as usize);
        (&mut file)
            .take(maximum as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::Io)?;
        if bytes.len() as u64 != length || bytes.len() > maximum {
            return Err(Error::InvalidData);
        }
        Ok(bytes)
    }

    fn read_exact_32(&self, name: &str) -> Result<[u8; 32]> {
        let mut file = self.open_file(name)?;
        if file.metadata().map_err(|_| Error::Io)?.len() != 32 {
            return Err(Error::InvalidData);
        }
        let mut bytes = [0_u8; 32];
        file.read_exact(&mut bytes).map_err(|_| Error::Io)?;
        let mut extra = [0_u8; 1];
        if file.read(&mut extra).map_err(|_| Error::Io)? != 0 {
            return Err(Error::InvalidData);
        }
        Ok(bytes)
    }

    fn open_file(&self, name: &str) -> Result<File> {
        let name = safe_name(name)?;
        let descriptor = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(Error::State);
        }
        let file = unsafe { File::from_raw_fd(descriptor) };
        validate_file(&file)?;
        Ok(file)
    }

    fn write_atomic(&self, name: &str, bytes: &[u8], replace: bool) -> Result<()> {
        let target = safe_name(name)?;
        if replace {
            if !self.exists(name)? {
                return Err(Error::State);
            }
        } else if self.exists(name)? {
            return Err(Error::State);
        }

        let mut nonce = [0_u8; 18];
        getrandom::getrandom(&mut nonce).map_err(|_| Error::Randomness)?;
        let temporary_name = format!(".verifierctl-{}", URL_SAFE_NO_PAD.encode(nonce));
        let temporary = safe_name(&temporary_name)?;
        let descriptor = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                temporary.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if descriptor < 0 {
            return Err(Error::Io);
        }
        let mut file = unsafe { File::from_raw_fd(descriptor) };
        let prepared = unsafe {
            libc::fchmod(file.as_raw_fd(), 0o600) == 0
                && libc::fchown(file.as_raw_fd(), 0, 0) == 0
        };
        if !prepared
            || file.write_all(bytes).is_err()
            || file.sync_all().is_err()
            || validate_file(&file).is_err()
        {
            drop(file);
            unsafe { libc::unlinkat(self.file.as_raw_fd(), temporary.as_ptr(), 0) };
            return Err(Error::Io);
        }
        drop(file);

        let renamed = rename_entry(self.file.as_raw_fd(), &temporary, &target, replace);
        if !renamed {
            unsafe { libc::unlinkat(self.file.as_raw_fd(), temporary.as_ptr(), 0) };
            return Err(Error::Io);
        }
        if unsafe { libc::fsync(self.file.as_raw_fd()) } != 0 {
            return Err(Error::Io);
        }
        Ok(())
    }
}

fn validate_file(file: &File) -> Result<()> {
    let metadata = file.metadata().map_err(|_| Error::UnsafeFile)?;
    if !metadata.file_type().is_file()
        || metadata.uid() != 0
        || metadata.gid() != 0
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
    {
        return Err(Error::UnsafeFile);
    }
    Ok(())
}

fn safe_name(name: &str) -> Result<CString> {
    if name.is_empty() || name == "." || name == ".." || name.as_bytes().contains(&b'/') {
        return Err(Error::Io);
    }
    CString::new(name).map_err(|_| Error::Io)
}

#[cfg(target_os = "linux")]
fn rename_entry(directory: RawFd, source: &CString, target: &CString, replace: bool) -> bool {
    const RENAME_NOREPLACE: libc::c_uint = 1;
    if replace {
        unsafe { libc::renameat(directory, source.as_ptr(), directory, target.as_ptr()) == 0 }
    } else {
        unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                directory,
                source.as_ptr(),
                directory,
                target.as_ptr(),
                RENAME_NOREPLACE,
            ) == 0
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn rename_entry(directory: RawFd, source: &CString, target: &CString, replace: bool) -> bool {
    if replace {
        unsafe { libc::renameat(directory, source.as_ptr(), directory, target.as_ptr()) == 0 }
    } else {
        let linked = unsafe { libc::linkat(directory, source.as_ptr(), directory, target.as_ptr(), 0) } == 0;
        linked && unsafe { libc::unlinkat(directory, source.as_ptr(), 0) } == 0
    }
}
