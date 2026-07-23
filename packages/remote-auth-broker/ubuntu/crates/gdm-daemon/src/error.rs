use std::{fmt, io};

use remote_auth_broker_protocol::PublicError;
use remote_auth_broker_verifier_core::VerifierError;

pub type Result<T, E = DaemonError> = std::result::Result<T, E>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonError {
    Configuration,
    Inactive,
    Protocol(PublicError),
    Integrity,
    PolicyMismatch,
    TargetMismatch,
    ChallengeInvalid,
    Expired,
    Replay,
    BodyConflict,
    Capacity,
    Unavailable,
    Io,
}

impl DaemonError {
    pub const fn public_error(self) -> PublicError {
        match self {
            Self::Configuration | Self::Integrity => PublicError::IntegrityFailure,
            Self::Inactive => PublicError::Inactive,
            Self::Protocol(error) => error,
            Self::PolicyMismatch => PublicError::PolicyMismatch,
            Self::TargetMismatch => PublicError::TargetMismatch,
            Self::ChallengeInvalid => PublicError::ChallengeInvalid,
            Self::Expired => PublicError::RequestExpired,
            Self::Replay => PublicError::RequestReplayed,
            Self::BodyConflict => PublicError::BodyConflict,
            Self::Capacity | Self::Unavailable | Self::Io => PublicError::Unavailable,
        }
    }
}

impl From<VerifierError> for DaemonError {
    fn from(error: VerifierError) -> Self {
        match error {
            VerifierError::Replay => Self::Replay,
            VerifierError::BodyConflict => Self::BodyConflict,
            VerifierError::ContextChanged => Self::PolicyMismatch,
            VerifierError::Timeout => Self::Unavailable,
            VerifierError::Io => Self::Io,
            _ => Self::Integrity,
        }
    }
}

impl From<io::Error> for DaemonError {
    fn from(_: io::Error) -> Self {
        Self::Io
    }
}

impl fmt::Display for DaemonError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Configuration => "invalid daemon configuration",
            Self::Inactive => "daemon policy is inactive",
            Self::Protocol(_) => "protocol input rejected",
            Self::Integrity => "integrity verification failed",
            Self::PolicyMismatch => "trusted policy context changed",
            Self::TargetMismatch => "request target did not match live state",
            Self::ChallengeInvalid => "challenge was invalid",
            Self::Expired => "request expired",
            Self::Replay => "request was replayed",
            Self::BodyConflict => "request identifier conflicted with prior content",
            Self::Capacity => "pending request capacity reached",
            Self::Unavailable => "daemon service unavailable",
            Self::Io => "daemon I/O failed",
        })
    }
}

impl std::error::Error for DaemonError {}
