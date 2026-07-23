use std::{
    ffi::CString,
    fs::{self, Metadata},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        unix::{
            ffi::OsStrExt,
            fs::{FileTypeExt, MetadataExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
};

use crate::{
    peer_credentials,
    secure_file::{sync_directory, validate_trusted_directory_tree},
    PeerCredentials, Result, VerifierError,
};

const DEFAULT_LISTEN_BACKLOG: i32 = 16;
const MAX_LISTEN_BACKLOG: i32 = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnixListenerSpec {
    pub path: PathBuf,
    pub owner_uid: u32,
    pub group_gid: u32,
    pub mode: u32,
    pub backlog: i32,
}

impl UnixListenerSpec {
    pub fn root_owned(path: impl Into<PathBuf>, group_gid: u32, mode: u32) -> Self {
        Self {
            path: path.into(),
            owner_uid: 0,
            group_gid,
            mode,
            backlog: DEFAULT_LISTEN_BACKLOG,
        }
    }

    pub const fn with_backlog(mut self, backlog: i32) -> Self {
        self.backlog = backlog;
        self
    }

    fn validate(&self) -> Result<()> {
        if self.owner_uid != 0
            || self.mode > 0o777
            || self.mode & 0o200 == 0
            || !(1..=MAX_LISTEN_BACKLOG).contains(&self.backlog)
            || !self.path.is_absolute()
            || self.path.file_name().is_none()
        {
            return Err(VerifierError::InvalidConfiguration);
        }
        Ok(())
    }
}

pub struct BoundUnixListener {
    listener: UnixListener,
    path: PathBuf,
    device: u64,
    inode: u64,
}

impl BoundUnixListener {
    pub fn listener(&self) -> &UnixListener {
        &self.listener
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn accept(&self) -> Result<(UnixStream, PeerCredentials)> {
        let (stream, _) = self
            .listener
            .accept()
            .map_err(|error| VerifierError::from_io(&error))?;
        let credentials = peer_credentials(&stream)?;
        Ok((stream, credentials))
    }

    pub fn set_nonblocking(&self, nonblocking: bool) -> Result<()> {
        self.listener
            .set_nonblocking(nonblocking)
            .map_err(|error| VerifierError::from_io(&error))
    }
}

impl AsRawFd for BoundUnixListener {
    fn as_raw_fd(&self) -> RawFd {
        self.listener.as_raw_fd()
    }
}

impl Drop for BoundUnixListener {
    fn drop(&mut self) {
        remove_same_socket(&self.path, self.device, self.inode);
    }
}

pub fn bind_unix_listener(spec: &UnixListenerSpec) -> Result<BoundUnixListener> {
    spec.validate()?;
    let parent = spec.path.parent().ok_or(VerifierError::UnsafePath)?;
    validate_trusted_directory_tree(parent)?;
    reject_or_remove_stale_socket(&spec.path)?;

    let descriptor = raw_bind(&spec.path)?;
    let initial = match fs::symlink_metadata(&spec.path) {
        Ok(metadata) if metadata.file_type().is_socket() => metadata,
        _ => {
            remove_any_socket(&spec.path);
            return Err(VerifierError::SocketUnavailable);
        }
    };
    let mut guard = SocketPathGuard {
        path: &spec.path,
        device: initial.dev(),
        inode: initial.ino(),
        armed: true,
    };

    set_socket_owner(&spec.path, spec.owner_uid, spec.group_gid)?;
    fs::set_permissions(&spec.path, fs::Permissions::from_mode(spec.mode))
        .map_err(|error| VerifierError::from_io(&error))?;
    let final_metadata = fs::symlink_metadata(&spec.path)
        .map_err(|error| VerifierError::from_io(&error))?;
    validate_bound_socket(&initial, &final_metadata, spec)?;
    verify_bound_name(&descriptor, &spec.path)?;
    raw_listen(descriptor.as_raw_fd(), spec.backlog)?;
    sync_directory(parent)?;

    let listener = UnixListener::from(descriptor);
    guard.armed = false;
    Ok(BoundUnixListener {
        listener,
        path: spec.path.clone(),
        device: final_metadata.dev(),
        inode: final_metadata.ino(),
    })
}

fn validate_bound_socket(
    initial: &Metadata,
    final_metadata: &Metadata,
    spec: &UnixListenerSpec,
) -> Result<()> {
    if !final_metadata.file_type().is_socket()
        || initial.dev() != final_metadata.dev()
        || initial.ino() != final_metadata.ino()
        || final_metadata.uid() != spec.owner_uid
        || final_metadata.gid() != spec.group_gid
        || final_metadata.mode() & 0o7777 != spec.mode
        || final_metadata.nlink() != 1
    {
        return Err(VerifierError::UnsafePath);
    }
    Ok(())
}

fn reject_or_remove_stale_socket(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(VerifierError::from_io(&error)),
        Ok(metadata)
            if metadata.file_type().is_socket()
                && metadata.uid() == 0
                && metadata.nlink() == 1 =>
        {
            fs::remove_file(path).map_err(|error| VerifierError::from_io(&error))?;
            let parent = path.parent().ok_or(VerifierError::UnsafePath)?;
            sync_directory(parent)
        }
        Ok(_) => Err(VerifierError::UnsafePath),
    }
}

fn verify_bound_name(descriptor: &OwnedFd, expected: &Path) -> Result<()> {
    let listener = UnixListener::from(
        descriptor
            .try_clone()
            .map_err(|error| VerifierError::from_io(&error))?,
    );
    let address = listener
        .local_addr()
        .map_err(|error| VerifierError::from_io(&error))?;
    if address.as_pathname() == Some(expected) {
        Ok(())
    } else {
        Err(VerifierError::UnsafePath)
    }
}

struct SocketPathGuard<'a> {
    path: &'a Path,
    device: u64,
    inode: u64,
    armed: bool,
}

impl Drop for SocketPathGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            remove_same_socket(self.path, self.device, self.inode);
        }
    }
}

fn remove_same_socket(path: &Path, device: u64, inode: u64) {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_socket()
            && metadata.dev() == device
            && metadata.ino() == inode
        {
            let _ = fs::remove_file(path);
        }
    }
}

fn remove_any_socket(path: &Path) {
    if fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.file_type().is_socket())
    {
        let _ = fs::remove_file(path);
    }
}

#[cfg(target_os = "linux")]
fn raw_bind(path: &Path) -> Result<OwnedFd> {
    let path_bytes = path.as_os_str().as_bytes();
    let mut address = std::mem::MaybeUninit::<libc::sockaddr_un>::zeroed();
    // SAFETY: a zeroed `sockaddr_un` is valid to initialize field-by-field.
    let address = unsafe { address.assume_init_mut() };
    if path_bytes.is_empty()
        || path_bytes.contains(&0)
        || path_bytes.len() >= address.sun_path.len()
    {
        return Err(VerifierError::InvalidConfiguration);
    }
    address.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (destination, source) in address.sun_path.iter_mut().zip(path_bytes) {
        *destination = *source as libc::c_char;
    }
    let address_length = std::mem::offset_of!(libc::sockaddr_un, sun_path)
        .checked_add(path_bytes.len() + 1)
        .and_then(|length| libc::socklen_t::try_from(length).ok())
        .ok_or(VerifierError::InvalidConfiguration)?;

    // SAFETY: `socket` receives constants only and returns a new owned fd.
    let raw = unsafe {
        libc::socket(
            libc::AF_UNIX,
            libc::SOCK_STREAM | libc::SOCK_CLOEXEC,
            0,
        )
    };
    if raw < 0 {
        return Err(VerifierError::SocketUnavailable);
    }
    // SAFETY: successful `socket` returned a fresh descriptor owned here.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    // SAFETY: the initialized address lives through the call, its byte length is
    // exact, and the kernel does not retain the pointer.
    let result = unsafe {
        libc::bind(
            descriptor.as_raw_fd(),
            (address as *const libc::sockaddr_un).cast(),
            address_length,
        )
    };
    if result != 0 {
        return Err(VerifierError::SocketUnavailable);
    }
    Ok(descriptor)
}

#[cfg(not(target_os = "linux"))]
fn raw_bind(_path: &Path) -> Result<OwnedFd> {
    Err(VerifierError::SocketUnavailable)
}

#[cfg(target_os = "linux")]
fn raw_listen(descriptor: RawFd, backlog: i32) -> Result<()> {
    // SAFETY: `descriptor` is a live bound stream socket and no pointer is used.
    if unsafe { libc::listen(descriptor, backlog) } == 0 {
        Ok(())
    } else {
        Err(VerifierError::SocketUnavailable)
    }
}

#[cfg(not(target_os = "linux"))]
fn raw_listen(_descriptor: RawFd, _backlog: i32) -> Result<()> {
    Err(VerifierError::SocketUnavailable)
}

#[cfg(target_os = "linux")]
fn set_socket_owner(path: &Path, uid: u32, gid: u32) -> Result<()> {
    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| VerifierError::InvalidConfiguration)?;
    // SAFETY: the C string is NUL-terminated and lives through the call;
    // AT_SYMLINK_NOFOLLOW prevents replacement with a symlink from being followed.
    if unsafe {
        libc::fchownat(
            libc::AT_FDCWD,
            path.as_ptr(),
            uid,
            gid,
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(VerifierError::SocketUnavailable)
    }
}

#[cfg(not(target_os = "linux"))]
fn set_socket_owner(_path: &Path, _uid: u32, _gid: u32) -> Result<()> {
    Err(VerifierError::SocketUnavailable)
}
