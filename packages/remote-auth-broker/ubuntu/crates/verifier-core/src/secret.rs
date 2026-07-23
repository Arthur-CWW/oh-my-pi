use std::{fmt, slice};

use zeroize::Zeroize;

use crate::{Result, VerifierError};

pub struct LockedSecret {
    address: usize,
    len: usize,
    mapped_len: usize,
}

impl LockedSecret {
    pub(crate) fn allocate(len: usize) -> Result<Self> {
        if len == 0 {
            return Err(VerifierError::InvalidConfiguration);
        }
        let page_size = page_size()?;
        let mapped_len = len
            .checked_add(page_size - 1)
            .map(|value| value / page_size * page_size)
            .ok_or(VerifierError::SecretMemoryUnavailable)?;
        let address = map_anonymous(mapped_len)?;
        if lock_memory(address, mapped_len).is_err() {
            unmap_memory(address, mapped_len);
            return Err(VerifierError::SecretMemoryUnavailable);
        }
        if exclude_from_dumps(address, mapped_len).is_err() {
            unlock_memory(address, mapped_len);
            unmap_memory(address, mapped_len);
            return Err(VerifierError::SecretMemoryUnavailable);
        }
        Ok(Self {
            address,
            len,
            mapped_len,
        })
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let mut secret = Self::allocate(bytes.len())?;
        secret.as_mut_bytes().copy_from_slice(bytes);
        Ok(secret)
    }

    pub const fn len(&self) -> usize {
        self.len
    }

    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn as_bytes(&self) -> &[u8] {
        // SAFETY: the constructor owns a live mapping of at least `len` bytes;
        // shared access cannot outlive `self`, and mutation requires `&mut self`.
        unsafe { slice::from_raw_parts(self.address as *const u8, self.len) }
    }

    pub fn sha256(&self) -> [u8; 32] {
        crate::sha256_bytes(self.as_bytes())
    }

    pub(crate) fn as_mut_bytes(&mut self) -> &mut [u8] {
        // SAFETY: `&mut self` provides exclusive access to the live mapping.
        unsafe { slice::from_raw_parts_mut(self.address as *mut u8, self.len) }
    }
}

impl fmt::Debug for LockedSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("LockedSecret([REDACTED])")
    }
}

impl Drop for LockedSecret {
    fn drop(&mut self) {
        self.as_mut_bytes().zeroize();
        restore_dump_behavior(self.address, self.mapped_len);
        unlock_memory(self.address, self.mapped_len);
        unmap_memory(self.address, self.mapped_len);
    }
}

#[cfg(target_os = "linux")]
fn page_size() -> Result<usize> {
    // SAFETY: `sysconf` receives a constant selector and retains no pointers.
    let value = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    usize::try_from(value)
        .ok()
        .filter(|size| size.is_power_of_two())
        .ok_or(VerifierError::SecretMemoryUnavailable)
}

#[cfg(not(target_os = "linux"))]
fn page_size() -> Result<usize> {
    Err(VerifierError::SecretMemoryUnavailable)
}

#[cfg(target_os = "linux")]
fn map_anonymous(len: usize) -> Result<usize> {
    // SAFETY: this requests a new anonymous mapping with no borrowed backing;
    // the returned address is checked and owned until the matching `munmap`.
    let address = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            len,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
            -1,
            0,
        )
    };
    if address == libc::MAP_FAILED {
        Err(VerifierError::SecretMemoryUnavailable)
    } else {
        Ok(address as usize)
    }
}

#[cfg(not(target_os = "linux"))]
fn map_anonymous(_len: usize) -> Result<usize> {
    Err(VerifierError::SecretMemoryUnavailable)
}

#[cfg(target_os = "linux")]
fn lock_memory(address: usize, len: usize) -> Result<()> {
    // SAFETY: `address..address + len` is the live mapping created above.
    if unsafe { libc::mlock(address as *const libc::c_void, len) } == 0 {
        Ok(())
    } else {
        Err(VerifierError::SecretMemoryUnavailable)
    }
}

#[cfg(not(target_os = "linux"))]
fn lock_memory(_address: usize, _len: usize) -> Result<()> {
    Err(VerifierError::SecretMemoryUnavailable)
}

#[cfg(target_os = "linux")]
fn unlock_memory(address: usize, len: usize) {
    // SAFETY: the range is still mapped and was passed to `mlock`.
    let _ = unsafe { libc::munlock(address as *const libc::c_void, len) };
}

#[cfg(not(target_os = "linux"))]
fn unlock_memory(_address: usize, _len: usize) {}

#[cfg(target_os = "linux")]
fn exclude_from_dumps(address: usize, len: usize) -> Result<()> {
    // SAFETY: the range is page-aligned, mapped, and valid for the entire call.
    if unsafe {
        libc::madvise(
            address as *mut libc::c_void,
            len,
            libc::MADV_DONTDUMP,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(VerifierError::SecretMemoryUnavailable)
    }
}

#[cfg(not(target_os = "linux"))]
fn exclude_from_dumps(_address: usize, _len: usize) -> Result<()> {
    Err(VerifierError::SecretMemoryUnavailable)
}

#[cfg(target_os = "linux")]
fn restore_dump_behavior(address: usize, len: usize) {
    // SAFETY: the range remains page-aligned and mapped until this call returns.
    let _ = unsafe {
        libc::madvise(address as *mut libc::c_void, len, libc::MADV_DODUMP)
    };
}

#[cfg(not(target_os = "linux"))]
fn restore_dump_behavior(_address: usize, _len: usize) {}

#[cfg(target_os = "linux")]
fn unmap_memory(address: usize, len: usize) {
    // SAFETY: the range is the complete live mapping and is never used again.
    let _ = unsafe { libc::munmap(address as *mut libc::c_void, len) };
}

#[cfg(not(target_os = "linux"))]
fn unmap_memory(_address: usize, _len: usize) {}
