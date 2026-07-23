use std::fmt;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use hpke::{
    aead::ChaCha20Poly1305,
    kdf::HkdfSha256,
    kem::X25519HkdfSha256,
    single_shot_open, Deserializable, Kem as KemTrait, OpModeR,
};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    InvalidEncoding,
    InvalidLength,
    SignatureInvalid,
    CiphertextInvalid,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidEncoding => "invalid cryptographic encoding",
            Self::InvalidLength => "invalid cryptographic value length",
            Self::SignatureInvalid => "signature verification failed",
            Self::CiphertextInvalid => "ciphertext authentication failed",
        })
    }
}

impl std::error::Error for CryptoError {}

fn decode_fixed<const N: usize>(encoded: &str) -> Result<[u8; N], CryptoError> {
    if encoded.bytes().any(|byte| !(byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')) {
        return Err(CryptoError::InvalidEncoding);
    }
    let mut bytes = [0_u8; N];
    match URL_SAFE_NO_PAD.decode_slice(encoded, &mut bytes) {
        Ok(length) if length == N => Ok(bytes),
        Ok(_) => Err(CryptoError::InvalidLength),
        Err(_) => Err(CryptoError::InvalidEncoding),
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct HpkePrivateKey([u8; 32]);

impl HpkePrivateKey {
    pub fn from_base64url(encoded: &str) -> Result<Self, CryptoError> {
        Ok(Self(decode_fixed(encoded)?))
    }

    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for HpkePrivateKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("HpkePrivateKey([REDACTED])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ed25519PublicKey([u8; 32]);

impl Ed25519PublicKey {
    pub fn from_base64url(encoded: &str) -> Result<Self, CryptoError> {
        Ok(Self(decode_fixed(encoded)?))
    }

    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ed25519Signature([u8; 64]);

impl Ed25519Signature {
    pub fn from_base64url(encoded: &str) -> Result<Self, CryptoError> {
        Ok(Self(decode_fixed(encoded)?))
    }

    pub const fn from_bytes(bytes: [u8; 64]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 64] {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HpkePublicKey([u8; 32]);

impl HpkePublicKey {
    pub fn from_base64url(encoded: &str) -> Result<Self, CryptoError> {
        Ok(Self(decode_fixed(encoded)?))
    }

    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HpkeEncapsulatedKey([u8; 32]);

impl HpkeEncapsulatedKey {
    pub fn from_base64url(encoded: &str) -> Result<Self, CryptoError> {
        Ok(Self(decode_fixed(encoded)?))
    }

    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HpkeCiphertext(Vec<u8>);

impl HpkeCiphertext {
    pub fn from_base64url(encoded: &str) -> Result<Self, CryptoError> {
        if encoded.is_empty()
            || encoded.len() > 524_288
            || encoded.bytes().any(|byte| !(byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
        {
            return Err(CryptoError::InvalidEncoding);
        }
        let bytes = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| CryptoError::InvalidEncoding)?;
        if !(16..=393_216).contains(&bytes.len()) {
            return Err(CryptoError::InvalidLength);
        }
        Ok(Self(bytes))
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, CryptoError> {
        if bytes.len() < 16 || bytes.len() > 393_216 {
            Err(CryptoError::InvalidLength)
        } else {
            Ok(Self(bytes))
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HpkeInfo {
    recipient_key_id: String,
    transcript: Vec<u8>,
}

impl HpkeInfo {
    pub fn new(recipient_key_id: &str) -> Result<Self, crate::TranscriptError> {
        let transcript = crate::gdm_hpke_info_transcript(recipient_key_id)?;
        Ok(Self { recipient_key_id: recipient_key_id.to_owned(), transcript })
    }

    pub fn recipient_key_id(&self) -> &str {
        &self.recipient_key_id
    }

    pub fn transcript(&self) -> &[u8] {
        &self.transcript
    }
}

pub fn open_hpke_base(
    recipient_private_key: &HpkePrivateKey,
    encapsulated_key: &HpkeEncapsulatedKey,
    info: &HpkeInfo,
    aad: &[u8],
    ciphertext: &HpkeCiphertext,
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    type Kem = X25519HkdfSha256;

    let recipient_private_key =
        <Kem as KemTrait>::PrivateKey::from_bytes(recipient_private_key.as_bytes())
            .map_err(|_| CryptoError::InvalidEncoding)?;
    let encapsulated_key =
        <Kem as KemTrait>::EncappedKey::from_bytes(encapsulated_key.as_bytes())
            .map_err(|_| CryptoError::InvalidEncoding)?;
    single_shot_open::<ChaCha20Poly1305, HkdfSha256, Kem>(
        &OpModeR::Base,
        &recipient_private_key,
        &encapsulated_key,
        info.transcript(),
        ciphertext.as_bytes(),
        aad,
    )
    .map(Zeroizing::new)
    .map_err(|_| CryptoError::CiphertextInvalid)
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = sha256(bytes);
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

pub fn verify_ed25519(public_key: &Ed25519PublicKey, message: &[u8], signature: &Ed25519Signature) -> Result<(), CryptoError> {
    let verifying_key = VerifyingKey::from_bytes(public_key.as_bytes()).map_err(|_| CryptoError::InvalidEncoding)?;
    let signature = Signature::from_bytes(signature.as_bytes());
    verifying_key.verify_strict(message, &signature).map_err(|_| CryptoError::SignatureInvalid)
}
