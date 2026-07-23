use remote_auth_broker_protocol::{encode_frame_payload, PublicError};
use serde::Serialize;

use crate::execution::ExecutionResult;

const MAX_REPLY_PAYLOAD_BYTES: usize = 4_096;

#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
enum Outcome {
    Succeeded,
    Failed,
    Rejected,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataReply<'a> {
    protocol_version: u8,
    request_id: Option<&'a str>,
    outcome: Outcome,
    error: Option<PublicError>,
    exit_code: Option<i32>,
    signal: Option<i32>,
}

pub(crate) fn rejected(request_id: Option<&str>, error: PublicError) -> Result<Vec<u8>, ()> {
    encode(&MetadataReply {
        protocol_version: 1,
        request_id,
        outcome: Outcome::Rejected,
        error: Some(error),
        exit_code: None,
        signal: None,
    })
}

pub(crate) fn execution(request_id: &str, result: ExecutionResult) -> Result<Vec<u8>, ()> {
    let reply = match result {
        ExecutionResult::Exited(0) => MetadataReply {
            protocol_version: 1,
            request_id: Some(request_id),
            outcome: Outcome::Succeeded,
            error: None,
            exit_code: Some(0),
            signal: None,
        },
        ExecutionResult::Exited(code) => MetadataReply {
            protocol_version: 1,
            request_id: Some(request_id),
            outcome: Outcome::Failed,
            error: Some(PublicError::ExecutionFailed),
            exit_code: Some(code),
            signal: None,
        },
        ExecutionResult::Signaled(signal) => MetadataReply {
            protocol_version: 1,
            request_id: Some(request_id),
            outcome: Outcome::Failed,
            error: Some(PublicError::ExecutionFailed),
            exit_code: None,
            signal: Some(signal),
        },
        ExecutionResult::Failed => MetadataReply {
            protocol_version: 1,
            request_id: Some(request_id),
            outcome: Outcome::Failed,
            error: Some(PublicError::ExecutionFailed),
            exit_code: None,
            signal: None,
        },
    };
    encode(&reply)
}

fn encode(reply: &MetadataReply<'_>) -> Result<Vec<u8>, ()> {
    let payload = serde_json::to_vec(reply).map_err(|_| ())?;
    if payload.len() > MAX_REPLY_PAYLOAD_BYTES {
        return Err(());
    }
    encode_frame_payload(&payload).map_err(|_| ())
}
