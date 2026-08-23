use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const ENVELOPE_VERSION: u8 = 1;
pub const ENVELOPE_ALGORITHM: &str = "boxplot-crypto-box-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Error)]
#[serde(rename_all = "camelCase")]
pub enum E2eeError {
    #[error("local E2EE key is unavailable")]
    KeyUnavailable,
    #[error("trusted peer E2EE key is unavailable")]
    PeerKeyUnavailable,
    #[error("trusted peer E2EE key differs")]
    KeyMismatch,
    #[error("public key is invalid")]
    InvalidPublicKey,
    #[error("encrypted envelope is invalid")]
    InvalidEnvelope,
    #[error("encrypted metadata does not match")]
    MetadataMismatch,
    #[error("encrypted payload authentication failed")]
    AuthenticationFailed,
    #[error("native E2EE store is unavailable")]
    Unavailable,
    #[error("unexpected E2EE failure")]
    Unexpected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicIdentity {
    pub local_identity: String,
    pub public_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PeerKeyStatus {
    Missing,
    Trusted { public_key: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct E2eeEnvelope {
    pub version: u8,
    pub algorithm: String,
    pub sender: String,
    pub recipient: String,
    pub sender_public_key: String,
    pub recipient_public_key: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecryptedPayload {
    pub version: u8,
    pub sender: String,
    pub recipient: String,
    pub subject: String,
    pub text: String,
    pub html: Option<String>,
}

#[derive(Clone, PartialEq, Eq, zeroize::Zeroize, zeroize::ZeroizeOnDrop)]
pub struct PrivateKeyMaterial(pub [u8; 32]);
