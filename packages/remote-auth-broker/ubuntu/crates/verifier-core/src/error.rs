use std::{fmt, io};

use remote_auth_broker_protocol::PublicError;

pub type Result<T, E = VerifierError> = std::result::Result<T, E>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifierError {
    Io,
    Timeout,
    FrameTruncated,
    FrameTooLarge,
    PeerUnavailable,
    PeerMismatch,
    ProcessUnavailable,
    ProcessMismatch,
    ClockUnavailable,
    UnsafePath,
    UnsafeFile,
    InvalidFile,
    InvalidConfiguration,
    SecretMemoryUnavailable,
    Replay,
    BodyConflict,
    ContextChanged,
    StateCorrupt,
    SocketUnavailable,
    PublicReplyInvalid,
}

impl VerifierError {
    pub const fn public_error(self) -> PublicError {
        match self {
            Self::Timeout => PublicError::Timeout,
            Self::FrameTruncated | Self::FrameTooLarge => PublicError::FrameInvalid,
            Self::PeerUnavailable | Self::PeerMismatch | Self::ProcessMismatch => {
                PublicError::PeerMismatch
            }
            Self::ProcessUnavailable | Self::SocketUnavailable | Self::ClockUnavailable => {
                PublicError::Unavailable
            }
            Self::Replay => PublicError::RequestReplayed,
            Self::BodyConflict => PublicError::BodyConflict,
            Self::ContextChanged => PublicError::PolicyMismatch,
            Self::UnsafePath
            | Self::UnsafeFile
            | Self::InvalidFile
            | Self::InvalidConfiguration
            | Self::SecretMemoryUnavailable
            | Self::StateCorrupt => PublicError::IntegrityFailure,
            Self::PublicReplyInvalid => PublicError::ProtocolInvalid,
            Self::Io => PublicError::Internal,
        }
    }

    pub(crate) fn from_io(error: &io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => Self::Timeout,
            _ => Self::Io,
        }
    }
}

impl fmt::Display for VerifierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Io => "verifier I/O failed",
            Self::Timeout => "verifier I/O timed out",
            Self::FrameTruncated => "framed message was truncated",
            Self::FrameTooLarge => "framed message exceeded its bound",
            Self::PeerUnavailable => "peer credentials unavailable",
            Self::PeerMismatch => "peer credentials did not match",
            Self::ProcessUnavailable => "process identity unavailable",
            Self::ProcessMismatch => "process identity did not match",
            Self::ClockUnavailable => "boot clock unavailable",
            Self::UnsafePath => "path failed security validation",
            Self::UnsafeFile => "file failed security validation",
            Self::InvalidFile => "file content was invalid",
            Self::InvalidConfiguration => "verifier configuration was invalid",
            Self::SecretMemoryUnavailable => "secure memory unavailable",
            Self::Replay => "request was already consumed",
            Self::BodyConflict => "request identifier conflicts with prior content",
            Self::ContextChanged => "verification context changed",
            Self::StateCorrupt => "durable verifier state was invalid",
            Self::SocketUnavailable => "Unix socket unavailable",
            Self::PublicReplyInvalid => "public reply was invalid",
        })
    }
}

impl std::error::Error for VerifierError {}
