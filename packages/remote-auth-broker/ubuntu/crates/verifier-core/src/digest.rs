use std::{
    fs::{File, OpenOptions},
    io::Read,
    os::unix::fs::OpenOptionsExt,
    path::Path,
};

use sha2::{Digest, Sha256};

use crate::{Result, VerifierError};

const DIGEST_BUFFER_BYTES: usize = 16 * 1024;

pub fn sha256_bytes(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn sha256_file(path: &Path, max_bytes: u64) -> Result<[u8; 32]> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| VerifierError::from_io(&error))?;
    if !file
        .metadata()
        .map_err(|error| VerifierError::from_io(&error))?
        .is_file()
    {
        return Err(VerifierError::UnsafeFile);
    }
    sha256_reader(&mut file, max_bytes)
}

pub(crate) fn sha256_reader(reader: &mut File, max_bytes: u64) -> Result<[u8; 32]> {
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; DIGEST_BUFFER_BYTES];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| VerifierError::from_io(&error))?;
        if read == 0 {
            return Ok(digest.finalize().into());
        }
        total = total
            .checked_add(read as u64)
            .ok_or(VerifierError::InvalidFile)?;
        if total > max_bytes {
            return Err(VerifierError::InvalidFile);
        }
        digest.update(&buffer[..read]);
    }
}
