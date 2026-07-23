use remote_auth_broker_protocol::{
    gdm_envelope_signature_transcript, gdm_hpke_aad_transcript, open_hpke_base,
    validate_sentinel, verify_ed25519, Ed25519Signature, GdmEnvelope, HpkeCiphertext,
    HpkeEncapsulatedKey, HpkeInfo, HpkePrivateKey, PublicError, Validate,
};
use remote_auth_broker_verifier_core::{load_key_file, LockedSecret};

use crate::{
    config::Config,
    error::{DaemonError, Result},
    live::LiveSnapshot,
    state::{pending_from_target, PreparedEnvelope},
};

const GDM_PLAINTEXT_MAGIC: &[u8; 8] = b"RABGDM1\0";
const MAX_PASSWORD_BYTES: usize = 4096;

#[derive(Debug)]
pub struct CryptoMaterial {
    recipient_private_key: LockedSecret,
}

impl CryptoMaterial {
    pub fn load(config: &Config) -> Result<Self> {
        if !config.active {
            return Err(DaemonError::Inactive);
        }
        let recipient_private_key = load_key_file(&config.recipient_private_key_path, 32)
            .map_err(|_| DaemonError::Configuration)?;
        Ok(Self { recipient_private_key })
    }

    pub fn verify_and_open(
        &self,
        config: &Config,
        live: &LiveSnapshot,
        envelope: GdmEnvelope,
        envelope_digest: [u8; 32],
        now_boottime_ms: u64,
    ) -> Result<PreparedEnvelope> {
        envelope.validate().map_err(DaemonError::Protocol)?;
        live.validate_request(&envelope.request)?;
        if envelope.challenge.boot_id != live.boot_id
            || envelope.challenge.policy_digest != config.policy_digest
            || now_boottime_ms < envelope.challenge.issued_boottime_ms
            || now_boottime_ms >= envelope.challenge.expires_boottime_ms
        {
            return Err(DaemonError::ChallengeInvalid);
        }

        let encapsulated = HpkeEncapsulatedKey::from_base64url(&envelope.hpke_enc)
            .map_err(|_| DaemonError::Protocol(PublicError::NoncanonicalValue))?;
        let ciphertext = HpkeCiphertext::from_base64url(&envelope.ciphertext)
            .map_err(|_| DaemonError::Protocol(PublicError::NoncanonicalValue))?;
        let signature = Ed25519Signature::from_base64url(&envelope.signature)
            .map_err(|_| DaemonError::Protocol(PublicError::NoncanonicalValue))?;
        let aad = gdm_hpke_aad_transcript(
            &envelope.request,
            &envelope.challenge,
            &envelope.issue_id,
            &envelope.sentinel_hash,
        )
        .map_err(|_| DaemonError::Integrity)?;
        let signature_transcript = gdm_envelope_signature_transcript(
            &aad,
            &encapsulated,
            &ciphertext,
            &envelope.signing_key_id,
        )
        .map_err(|_| DaemonError::Integrity)?;
        let signing_key = config.signing_public_key(&envelope.signing_key_id)?;
        verify_ed25519(&signing_key, &signature_transcript, &signature)
            .map_err(|_| DaemonError::Protocol(PublicError::SignatureInvalid))?;

        let private_key_bytes: [u8; 32] = self
            .recipient_private_key
            .as_bytes()
            .try_into()
            .map_err(|_| DaemonError::Configuration)?;
        let private_key = HpkePrivateKey::from_bytes(private_key_bytes);
        let info = HpkeInfo::new(&config.recipient_key_id).map_err(|_| DaemonError::Configuration)?;
        let plaintext = open_hpke_base(&private_key, &encapsulated, &info, &aad, &ciphertext)
            .map_err(|_| DaemonError::Protocol(PublicError::CiphertextInvalid))?;
        let (password, sentinel) = parse_plaintext(&plaintext)?;
        if !validate_sentinel(sentinel)
            || remote_auth_broker_protocol::sha256_hex(sentinel.as_bytes()) != envelope.sentinel_hash
        {
            return Err(DaemonError::Integrity);
        }
        let password = LockedSecret::from_bytes(password).map_err(|_| DaemonError::Unavailable)?;
        let request_lifetime_ms = envelope
            .request
            .expires_at
            .checked_sub(envelope.request.created_at)
            .ok_or(DaemonError::Expired)?;
        let pending_lifetime_ms = request_lifetime_ms.min(config.pending_lifetime_ms);
        let expires_boottime_ms = now_boottime_ms
            .checked_add(pending_lifetime_ms)
            .ok_or(DaemonError::Configuration)?;
        let pending = pending_from_target(
            envelope.request.request_id.clone(),
            envelope.request.nonce.clone(),
            envelope.issue_id.clone(),
            envelope.sentinel_hash.clone(),
            &envelope.request.target,
            live.context_digest,
            expires_boottime_ms,
            password,
        )?;
        Ok(PreparedEnvelope {
            challenge: envelope.challenge,
            body_digest: envelope_digest,
            pending,
        })
    }
}

fn parse_plaintext(plaintext: &[u8]) -> Result<(&[u8], &str)> {
    if plaintext.len() < GDM_PLAINTEXT_MAGIC.len() + 4 + 2
        || plaintext.get(..GDM_PLAINTEXT_MAGIC.len()) != Some(GDM_PLAINTEXT_MAGIC)
    {
        return Err(DaemonError::Integrity);
    }
    let password_length = u32::from_be_bytes(
        plaintext[8..12].try_into().map_err(|_| DaemonError::Integrity)?,
    ) as usize;
    if !(1..=MAX_PASSWORD_BYTES).contains(&password_length) {
        return Err(DaemonError::Integrity);
    }
    let password_end = 12_usize.checked_add(password_length).ok_or(DaemonError::Integrity)?;
    let sentinel_length_end = password_end.checked_add(2).ok_or(DaemonError::Integrity)?;
    if sentinel_length_end > plaintext.len() {
        return Err(DaemonError::Integrity);
    }
    let sentinel_length = u16::from_be_bytes(
        plaintext[password_end..sentinel_length_end]
            .try_into()
            .map_err(|_| DaemonError::Integrity)?,
    ) as usize;
    let end = sentinel_length_end.checked_add(sentinel_length).ok_or(DaemonError::Integrity)?;
    if end != plaintext.len() {
        return Err(DaemonError::Integrity);
    }
    let password = &plaintext[12..password_end];
    if password.contains(&0) {
        return Err(DaemonError::Integrity);
    }
    let sentinel = std::str::from_utf8(&plaintext[sentinel_length_end..end])
        .map_err(|_| DaemonError::Integrity)?;
    Ok((password, sentinel))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plaintext(password: &[u8], sentinel: &str) -> Vec<u8> {
        let mut bytes = GDM_PLAINTEXT_MAGIC.to_vec();
        bytes.extend_from_slice(&(password.len() as u32).to_be_bytes());
        bytes.extend_from_slice(password);
        bytes.extend_from_slice(&(sentinel.len() as u16).to_be_bytes());
        bytes.extend_from_slice(sentinel.as_bytes());
        bytes
    }

    #[test]
    fn parses_exact_credential_plaintext() {
        let sentinel = "gdm-broker-v1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
        let bytes = plaintext(b"secret", sentinel);
        assert_eq!(parse_plaintext(&bytes), Ok((&b"secret"[..], sentinel)));
    }

    #[test]
    fn rejects_nul_password_and_trailing_data() {
        let sentinel = "gdm-broker-v1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
        assert_eq!(parse_plaintext(&plaintext(b"bad\0password", sentinel)), Err(DaemonError::Integrity));
        let mut trailing = plaintext(b"secret", sentinel);
        trailing.push(0);
        assert_eq!(parse_plaintext(&trailing), Err(DaemonError::Integrity));
    }
}
