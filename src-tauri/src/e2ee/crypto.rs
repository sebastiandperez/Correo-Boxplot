use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use libsodium_rs::{crypto_box, crypto_scalarmult::curve25519, ensure_init};
use zeroize::Zeroizing;

use super::{
    DecryptedPayload, E2eeEnvelope, E2eeError, ENVELOPE_ALGORITHM, ENVELOPE_VERSION,
    PrivateKeyMaterial,
};

pub fn generate_keypair() -> Result<(PrivateKeyMaterial, [u8; 32]), E2eeError> {
    ensure_init().map_err(|_| E2eeError::Unexpected)?;
    let pair = crypto_box::KeyPair::generate();
    let mut secret = [0_u8; 32];
    secret.copy_from_slice(pair.secret_key.as_bytes());
    let mut public = [0_u8; 32];
    public.copy_from_slice(pair.public_key.as_bytes());
    Ok((PrivateKeyMaterial(secret), public))
}

pub fn public_from_private(private: &PrivateKeyMaterial) -> Result<[u8; 32], E2eeError> {
    ensure_init().map_err(|_| E2eeError::Unexpected)?;
    curve25519::scalarmult_base(&private.0).map_err(|_| E2eeError::KeyUnavailable)
}

pub fn encode_key(value: &[u8; 32]) -> String {
    URL_SAFE_NO_PAD.encode(value)
}

pub fn decode_public_key(value: &str) -> Result<[u8; 32], E2eeError> {
    decode_fixed::<32>(value).map_err(|_| E2eeError::InvalidPublicKey)
}

pub fn encrypt(
    payload: &DecryptedPayload,
    sender_private: &PrivateKeyMaterial,
    sender_public: &[u8; 32],
    recipient_public: &[u8; 32],
) -> Result<E2eeEnvelope, E2eeError> {
    ensure_init().map_err(|_| E2eeError::Unexpected)?;
    let plaintext = Zeroizing::new(serde_json::to_vec(payload).map_err(|_| E2eeError::Unexpected)?);
    let nonce = crypto_box::Nonce::generate();
    let recipient = crypto_box::PublicKey::from_bytes(recipient_public)
        .map_err(|_| E2eeError::InvalidPublicKey)?;
    let sender = crypto_box::SecretKey::from_bytes(&sender_private.0)
        .map_err(|_| E2eeError::KeyUnavailable)?;
    let ciphertext = crypto_box::seal(&plaintext, &nonce, &recipient, &sender)
        .map_err(|_| E2eeError::Unexpected)?;
    Ok(E2eeEnvelope {
        version: ENVELOPE_VERSION,
        algorithm: ENVELOPE_ALGORITHM.to_owned(),
        sender: payload.sender.clone(),
        recipient: payload.recipient.clone(),
        sender_public_key: encode_key(sender_public),
        recipient_public_key: encode_key(recipient_public),
        nonce: URL_SAFE_NO_PAD.encode(nonce.as_bytes()),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    })
}

pub fn decrypt(
    envelope: &E2eeEnvelope,
    recipient_private: &PrivateKeyMaterial,
    trusted_sender_public: &[u8; 32],
) -> Result<DecryptedPayload, E2eeError> {
    ensure_init().map_err(|_| E2eeError::Unexpected)?;
    if envelope.version != ENVELOPE_VERSION || envelope.algorithm != ENVELOPE_ALGORITHM {
        return Err(E2eeError::InvalidEnvelope);
    }
    let nonce = crypto_box::Nonce::from_bytes_exact(decode_fixed::<24>(&envelope.nonce)?);
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&envelope.ciphertext)
        .map_err(|_| E2eeError::InvalidEnvelope)?;
    let sender = crypto_box::PublicKey::from_bytes(trusted_sender_public)
        .map_err(|_| E2eeError::InvalidPublicKey)?;
    let recipient = crypto_box::SecretKey::from_bytes(&recipient_private.0)
        .map_err(|_| E2eeError::KeyUnavailable)?;
    let plaintext = Zeroizing::new(
        crypto_box::open(&ciphertext, &nonce, &sender, &recipient)
            .map_err(|_| E2eeError::AuthenticationFailed)?,
    );
    let value: serde_json::Value =
        serde_json::from_slice(&plaintext).map_err(|_| E2eeError::InvalidEnvelope)?;
    let object = value.as_object().ok_or(E2eeError::InvalidEnvelope)?;
    if object.len() != 6
        || !["version", "sender", "recipient", "subject", "text", "html"]
            .iter()
            .all(|key| object.contains_key(*key))
    {
        return Err(E2eeError::InvalidEnvelope);
    }
    serde_json::from_value(value).map_err(|_| E2eeError::InvalidEnvelope)
}

fn decode_fixed<const N: usize>(value: &str) -> Result<[u8; N], E2eeError> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| E2eeError::InvalidEnvelope)?
        .try_into()
        .map_err(|_| E2eeError::InvalidEnvelope)
}
