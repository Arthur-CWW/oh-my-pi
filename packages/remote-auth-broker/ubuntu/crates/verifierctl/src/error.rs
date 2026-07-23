use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Error {
    Usage,
    Permission,
    Identity,
    HostKey,
    State,
    UnsafeFile,
    InvalidData,
    Randomness,
    Io,
}

impl Error {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Usage => "invalid command; run remote-auth-verifierctl --help",
            Self::Permission => "operation requires root",
            Self::Identity => "required local identity is unavailable or unsafe",
            Self::HostKey => "SSH Ed25519 host public key is unavailable or invalid",
            Self::State => "configuration state is incomplete or inconsistent",
            Self::UnsafeFile => "configuration storage metadata is unsafe",
            Self::InvalidData => "configuration data is invalid",
            Self::Randomness => "operating-system randomness is unavailable",
            Self::Io => "configuration operation failed",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message())
    }
}

impl std::error::Error for Error {}

pub(crate) type Result<T> = std::result::Result<T, Error>;
