#![forbid(unsafe_code)]

mod crypto;
mod frame;
mod transcript;
mod types;
mod validation;

pub use crypto::{
    open_hpke_base, sha256, sha256_hex, verify_ed25519, CryptoError, Ed25519PublicKey,
    Ed25519Signature, HpkeCiphertext, HpkeEncapsulatedKey, HpkeInfo, HpkePrivateKey,
    HpkePublicKey,
};
pub use frame::{
    decode_control_frame, decode_execution_request_frame, decode_frame_payload,
    decode_gdm_challenge_frame, decode_gdm_claim_frame, decode_gdm_envelope_frame,
    decode_grant_frame, decode_public_status_frame, decode_receipt_frame,
    decode_reviewer_result_frame, decode_sudo_signed_request_frame, encode_control_frame,
    encode_execution_request_frame, encode_frame_payload, encode_gdm_challenge_frame,
    encode_gdm_claim_frame, encode_gdm_envelope_frame, encode_grant_frame,
    encode_public_status_frame, encode_receipt_frame, encode_reviewer_result_frame,
    encode_sudo_signed_request_frame, FrameDecoder, FrameError, WireError, MAX_FRAME_BYTES,
};
pub use transcript::{
    execution_request_transcript, gdm_envelope_signature_transcript, gdm_hpke_aad_transcript,
    gdm_hpke_info_transcript, TranscriptError,
};
pub use types::*;
pub use validation::{validate_sentinel, Validate};
