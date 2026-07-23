use std::os::fd::AsRawFd;

use crate::{Result, VerifierError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeerCredentials {
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
}

#[cfg(target_os = "linux")]
pub fn peer_credentials(socket: &impl AsRawFd) -> Result<PeerCredentials> {
    use std::mem::{size_of, MaybeUninit};

    let mut credentials = MaybeUninit::<libc::ucred>::zeroed();
    let mut length = size_of::<libc::ucred>() as libc::socklen_t;

    // SAFETY: `credentials` is writable for exactly `length` bytes, `length`
    // points to initialized storage, and `socket` remains borrowed for the call.
    let result = unsafe {
        libc::getsockopt(
            socket.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            credentials.as_mut_ptr().cast(),
            &mut length,
        )
    };
    if result != 0 || length as usize != size_of::<libc::ucred>() {
        return Err(VerifierError::PeerUnavailable);
    }

    // SAFETY: successful `getsockopt(SO_PEERCRED)` initialized the full `ucred`.
    let credentials = unsafe { credentials.assume_init() };
    let pid = u32::try_from(credentials.pid).map_err(|_| VerifierError::PeerUnavailable)?;
    if pid == 0 {
        return Err(VerifierError::PeerUnavailable);
    }
    Ok(PeerCredentials {
        pid,
        uid: credentials.uid,
        gid: credentials.gid,
    })
}

#[cfg(not(target_os = "linux"))]
pub fn peer_credentials(_socket: &impl AsRawFd) -> Result<PeerCredentials> {
    Err(VerifierError::PeerUnavailable)
}
