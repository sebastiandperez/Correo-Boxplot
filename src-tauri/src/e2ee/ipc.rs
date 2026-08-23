use std::sync::{Arc, RwLock};

use serde::Deserialize;
use tauri::State;

use super::{
    DecryptRequest, DecryptedPayload, E2eeEnvelope, E2eeError, E2eeService, PeerKeyStatus,
    PublicIdentity,
};

#[derive(Default)]
pub struct ManagedE2eeService {
    service: RwLock<Option<Arc<E2eeService>>>,
}

impl ManagedE2eeService {
    pub fn initialize(&self, service: E2eeService) -> Result<(), E2eeError> {
        let mut current = self.service.write().map_err(|_| E2eeError::Unavailable)?;
        *current = Some(Arc::new(service));
        Ok(())
    }
    fn service(&self) -> Result<Arc<E2eeService>, E2eeError> {
        self.service
            .read()
            .map_err(|_| E2eeError::Unavailable)?
            .clone()
            .ok_or(E2eeError::Unavailable)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnsureRequest {
    local_identity: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustRequest {
    local_identity: String,
    peer_identity: String,
    public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PeerStatusRequest {
    local_identity: String,
    peer_identity: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EncryptIpcRequest {
    local_identity: String,
    recipient_identity: String,
    subject: String,
    text: String,
    html: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecryptIpcRequest {
    local_identity: String,
    expected_sender: String,
    expected_recipient: String,
    expected_subject: String,
    envelope: E2eeEnvelope,
}

#[tauri::command]
pub fn e2ee_ensure_local_identity(
    state: State<'_, ManagedE2eeService>,
    request: EnsureRequest,
) -> Result<PublicIdentity, E2eeError> {
    state
        .service()?
        .ensure_local_identity(&request.local_identity)
}

#[tauri::command]
pub fn e2ee_trust_peer_public_key(
    state: State<'_, ManagedE2eeService>,
    request: TrustRequest,
) -> Result<(), E2eeError> {
    state.service()?.trust_peer_public_key(
        &request.local_identity,
        &request.peer_identity,
        &request.public_key,
    )
}

#[tauri::command]
pub fn e2ee_peer_key_status(
    state: State<'_, ManagedE2eeService>,
    request: PeerStatusRequest,
) -> Result<PeerKeyStatus, E2eeError> {
    state
        .service()?
        .peer_key_status(&request.local_identity, &request.peer_identity)
}

#[tauri::command]
pub fn e2ee_encrypt(
    state: State<'_, ManagedE2eeService>,
    request: EncryptIpcRequest,
) -> Result<E2eeEnvelope, E2eeError> {
    state.service()?.encrypt_for(super::EncryptRequest {
        local_identity: request.local_identity,
        recipient_identity: request.recipient_identity,
        subject: request.subject,
        text: request.text,
        html: request.html,
    })
}

#[tauri::command]
pub fn e2ee_decrypt(
    state: State<'_, ManagedE2eeService>,
    request: DecryptIpcRequest,
) -> Result<DecryptedPayload, E2eeError> {
    state.service()?.decrypt_from(DecryptRequest {
        local_identity: request.local_identity,
        expected_sender: request.expected_sender,
        expected_recipient: request.expected_recipient,
        expected_subject: request.expected_subject,
        envelope: request.envelope,
    })
}
