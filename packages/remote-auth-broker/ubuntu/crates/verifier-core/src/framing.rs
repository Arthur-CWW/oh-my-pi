use std::{
    io::{self, Read, Write},
    os::unix::net::UnixStream,
    time::Duration,
};

use remote_auth_broker_protocol::MAX_FRAME_BYTES;

use crate::{Result, VerifierError};

const FRAME_HEADER_BYTES: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameTimeouts {
    pub read: Duration,
    pub write: Duration,
}

impl FrameTimeouts {
    pub const fn new(read: Duration, write: Duration) -> Self {
        Self { read, write }
    }

    fn validate(self) -> Result<Self> {
        if self.read.is_zero() || self.write.is_zero() {
            Err(VerifierError::InvalidConfiguration)
        } else {
            Ok(self)
        }
    }
}

pub struct FrameIo {
    stream: UnixStream,
    timeouts: FrameTimeouts,
    failed: bool,
}

impl FrameIo {
    pub fn new(stream: UnixStream, timeouts: FrameTimeouts) -> Result<Self> {
        let timeouts = timeouts.validate()?;
        stream
            .set_read_timeout(Some(timeouts.read))
            .map_err(|error| VerifierError::from_io(&error))?;
        stream
            .set_write_timeout(Some(timeouts.write))
            .map_err(|error| VerifierError::from_io(&error))?;
        Ok(Self {
            stream,
            timeouts,
            failed: false,
        })
    }

    pub const fn timeouts(&self) -> FrameTimeouts {
        self.timeouts
    }

    pub fn stream(&self) -> &UnixStream {
        &self.stream
    }

    pub fn into_stream(self) -> UnixStream {
        self.stream
    }

    pub fn read_frame(&mut self) -> Result<Vec<u8>> {
        if self.failed {
            return Err(VerifierError::FrameTruncated);
        }

        let mut header = [0_u8; FRAME_HEADER_BYTES];
        if let Err(error) = self.stream.read_exact(&mut header) {
            self.failed = true;
            return Err(classify_read_error(&error));
        }
        let payload_length = u32::from_be_bytes(header) as usize;
        if payload_length > MAX_FRAME_BYTES {
            self.failed = true;
            return Err(VerifierError::FrameTooLarge);
        }

        let mut payload = vec![0_u8; payload_length];
        if let Err(error) = self.stream.read_exact(&mut payload) {
            self.failed = true;
            return Err(classify_read_error(&error));
        }
        Ok(payload)
    }

    pub fn write_frame(&mut self, payload: &[u8]) -> Result<()> {
        if self.failed {
            return Err(VerifierError::FrameTruncated);
        }
        if payload.len() > MAX_FRAME_BYTES {
            return Err(VerifierError::FrameTooLarge);
        }
        let length = u32::try_from(payload.len()).map_err(|_| VerifierError::FrameTooLarge)?;
        let header = length.to_be_bytes();
        if let Err(error) = self
            .stream
            .write_all(&header)
            .and_then(|()| self.stream.write_all(payload))
        {
            self.failed = true;
            return Err(VerifierError::from_io(&error));
        }
        Ok(())
    }
}

fn classify_read_error(error: &io::Error) -> VerifierError {
    if error.kind() == io::ErrorKind::UnexpectedEof {
        VerifierError::FrameTruncated
    } else {
        VerifierError::from_io(error)
    }
}
