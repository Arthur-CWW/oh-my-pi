use std::fmt;

use serde::{de::DeserializeOwned, Serialize};

use crate::{
    ControlRequest, ExecutionRequest, GdmChallenge, GdmClaim, GdmEnvelope, Grant, PublicError,
    PublicStatus, Receipt, ReviewerResult, SudoSignedRequest, Validate,
};

pub const MAX_FRAME_BYTES: usize = 262_144;
const FRAME_HEADER_BYTES: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameError {
    Truncated,
    Oversize,
    Trailing,
    InvalidUtf8,
    InvalidJson,
}

impl fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Truncated => "truncated frame",
            Self::Oversize => "oversize frame",
            Self::Trailing => "trailing frame bytes",
            Self::InvalidUtf8 => "invalid frame UTF-8",
            Self::InvalidJson => "invalid frame JSON",
        })
    }
}

impl std::error::Error for FrameError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireError {
    Frame(FrameError),
    Protocol(PublicError),
}

impl WireError {
    pub const fn public_error(self) -> PublicError {
        match self {
            Self::Frame(_) => PublicError::FrameInvalid,
            Self::Protocol(error) => error,
        }
    }
}

impl fmt::Display for WireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Frame(_) => "wire frame rejected",
            Self::Protocol(_) => "wire value rejected",
        })
    }
}

impl std::error::Error for WireError {}

impl From<FrameError> for WireError {
    fn from(error: FrameError) -> Self {
        Self::Frame(error)
    }
}

pub fn encode_frame_payload(payload: &[u8]) -> Result<Vec<u8>, FrameError> {
    let length = u32::try_from(payload.len()).map_err(|_| FrameError::Oversize)?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(FrameError::Oversize);
    }
    let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + payload.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn decode_frame_payload(frame: &[u8]) -> Result<&[u8], FrameError> {
    let header: [u8; FRAME_HEADER_BYTES] = frame
        .get(..FRAME_HEADER_BYTES)
        .ok_or(FrameError::Truncated)?
        .try_into()
        .expect("frame header length was checked");
    let payload_length = u32::from_be_bytes(header) as usize;
    if payload_length > MAX_FRAME_BYTES {
        return Err(FrameError::Oversize);
    }
    let frame_length = FRAME_HEADER_BYTES + payload_length;
    if frame.len() < frame_length {
        return Err(FrameError::Truncated);
    }
    if frame.len() > frame_length {
        return Err(FrameError::Trailing);
    }
    Ok(&frame[FRAME_HEADER_BYTES..])
}

fn classify_json_error(error: serde_json::Error) -> WireError {
    use serde_json::error::Category;

    if matches!(error.classify(), Category::Syntax | Category::Eof) {
        return WireError::Frame(FrameError::InvalidJson);
    }
    if error.to_string().starts_with("unknown field `") {
        WireError::Protocol(PublicError::ExcessField)
    } else {
        WireError::Protocol(PublicError::NoncanonicalValue)
    }
}

fn decode_wire<T>(frame: &[u8]) -> Result<T, WireError>
where
    T: DeserializeOwned + Validate,
{
    let payload = decode_frame_payload(frame)?;
    std::str::from_utf8(payload).map_err(|_| FrameError::InvalidUtf8)?;
    let value: T = serde_json::from_slice(payload).map_err(classify_json_error)?;
    value.validate().map_err(WireError::Protocol)?;
    Ok(value)
}

fn encode_wire<T>(value: &T) -> Result<Vec<u8>, WireError>
where
    T: Serialize + Validate,
{
    value.validate().map_err(WireError::Protocol)?;
    let payload = serde_json::to_vec(value).map_err(|_| FrameError::InvalidJson)?;
    encode_frame_payload(&payload).map_err(WireError::Frame)
}

macro_rules! wire_codec {
    ($encode:ident, $decode:ident, $message:ty) => {
        pub fn $encode(value: &$message) -> Result<Vec<u8>, WireError> {
            encode_wire(value)
        }

        pub fn $decode(frame: &[u8]) -> Result<$message, WireError> {
            decode_wire(frame)
        }
    };
}

wire_codec!(encode_execution_request_frame, decode_execution_request_frame, ExecutionRequest);
wire_codec!(encode_grant_frame, decode_grant_frame, Grant);
wire_codec!(encode_receipt_frame, decode_receipt_frame, Receipt);
wire_codec!(encode_public_status_frame, decode_public_status_frame, PublicStatus);
wire_codec!(encode_control_frame, decode_control_frame, ControlRequest);
wire_codec!(encode_gdm_challenge_frame, decode_gdm_challenge_frame, GdmChallenge);
wire_codec!(encode_gdm_envelope_frame, decode_gdm_envelope_frame, GdmEnvelope);
wire_codec!(encode_gdm_claim_frame, decode_gdm_claim_frame, GdmClaim);
wire_codec!(encode_sudo_signed_request_frame, decode_sudo_signed_request_frame, SudoSignedRequest);
wire_codec!(encode_reviewer_result_frame, decode_reviewer_result_frame, ReviewerResult);

#[derive(Debug, Default)]
pub struct FrameDecoder {
    header: [u8; FRAME_HEADER_BYTES],
    header_bytes: usize,
    payload: Vec<u8>,
    payload_length: Option<usize>,
    failed: bool,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>, FrameError> {
        if self.failed {
            return Err(FrameError::Truncated);
        }
        let mut complete = Vec::new();
        let mut offset = 0;
        while offset < chunk.len() {
            if self.payload_length.is_none() {
                let copied = (FRAME_HEADER_BYTES - self.header_bytes).min(chunk.len() - offset);
                self.header[self.header_bytes..self.header_bytes + copied]
                    .copy_from_slice(&chunk[offset..offset + copied]);
                self.header_bytes += copied;
                offset += copied;
                if self.header_bytes != FRAME_HEADER_BYTES {
                    continue;
                }
                let payload_length = u32::from_be_bytes(self.header) as usize;
                if payload_length > MAX_FRAME_BYTES {
                    self.failed = true;
                    return Err(FrameError::Oversize);
                }
                self.payload = Vec::with_capacity(payload_length);
                self.payload_length = Some(payload_length);
                if payload_length == 0 {
                    complete.push(Vec::new());
                    self.reset_frame();
                }
                continue;
            }

            let payload_length = self.payload_length.expect("payload length is present");
            let copied = (payload_length - self.payload.len()).min(chunk.len() - offset);
            self.payload.extend_from_slice(&chunk[offset..offset + copied]);
            offset += copied;
            if self.payload.len() == payload_length {
                complete.push(std::mem::take(&mut self.payload));
                self.reset_frame();
            }
        }
        Ok(complete)
    }

    pub fn finish(&mut self) -> Result<(), FrameError> {
        if self.failed || self.header_bytes != 0 || self.payload_length.is_some() {
            self.failed = true;
            Err(FrameError::Truncated)
        } else {
            Ok(())
        }
    }

    fn reset_frame(&mut self) {
        self.header_bytes = 0;
        self.payload_length = None;
    }
}
