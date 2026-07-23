use crate::{Result, VerifierError};

#[cfg(target_os = "linux")]
pub fn boottime_millis() -> Result<u64> {
    let mut value = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `value` is valid writable storage for one `timespec`; the kernel
    // does not retain the pointer. CLOCK_BOOTTIME includes suspended time.
    if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut value) } != 0 {
        return Err(VerifierError::ClockUnavailable);
    }
    let seconds = u64::try_from(value.tv_sec).map_err(|_| VerifierError::ClockUnavailable)?;
    let nanoseconds = u64::try_from(value.tv_nsec).map_err(|_| VerifierError::ClockUnavailable)?;
    if nanoseconds >= 1_000_000_000 {
        return Err(VerifierError::ClockUnavailable);
    }
    seconds
        .checked_mul(1_000)
        .and_then(|millis| millis.checked_add(nanoseconds / 1_000_000))
        .ok_or(VerifierError::ClockUnavailable)
}

#[cfg(not(target_os = "linux"))]
pub fn boottime_millis() -> Result<u64> {
    Err(VerifierError::ClockUnavailable)
}
