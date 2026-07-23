use remote_auth_broker_protocol::{
    encode_public_status_frame, CanonicalStatus, EndpointStatus, ProtocolVersion, PublicError,
    PublicStatus, SocketPosture,
};

use crate::{Result, VerifierError};

pub const MAX_PUBLIC_REPLY_FRAME_BYTES: usize = 32 * 1024;

pub fn inactive_status(error: PublicError) -> PublicStatus {
    let endpoint = EndpointStatus {
        ready: false,
        error_code: Some(error),
    };
    PublicStatus {
        protocol_version: ProtocolVersion,
        canonical_status: CanonicalStatus::DesignInactive,
        policy_digest: None,
        installed_build_digest: None,
        running_build_digest: None,
        code_identity: None,
        pid: None,
        socket_posture: SocketPosture::Absent,
        jetkvm_controller_generation: None,
        gdm: endpoint.clone(),
        browser: endpoint.clone(),
        sudo: endpoint,
        errors: vec![error],
    }
}

pub fn encode_inactive_status(status: &PublicStatus) -> Result<Vec<u8>> {
    if status.canonical_status != CanonicalStatus::DesignInactive {
        return Err(VerifierError::PublicReplyInvalid);
    }
    let frame = encode_public_status_frame(status)
        .map_err(|_| VerifierError::PublicReplyInvalid)?;
    if frame.len() > MAX_PUBLIC_REPLY_FRAME_BYTES {
        return Err(VerifierError::PublicReplyInvalid);
    }
    Ok(frame)
}
