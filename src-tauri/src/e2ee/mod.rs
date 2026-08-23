#[cfg(test)]
mod acceptance_tests;
mod crypto;
#[cfg(feature = "e2ee-dev-tool")]
mod dev_tool;
pub(crate) mod ipc;
mod key_store;
#[cfg(test)]
mod os_store_tests;
mod service;
mod types;
#[cfg(test)]
mod wire_tests;

use std::sync::Arc;

#[cfg(feature = "e2ee-dev-tool")]
pub use dev_tool::run as run_development_tool;
pub use ipc::ManagedE2eeService;
#[cfg(test)]
pub use key_store::MemoryE2eeKeyStore;
pub use key_store::{E2eeKeyStore, OsE2eeKeyStore};
pub use service::{DecryptRequest, E2eeService, EncryptRequest};
pub use types::{
    DecryptedPayload, E2eeEnvelope, E2eeError, ENVELOPE_ALGORITHM, ENVELOPE_VERSION, PeerKeyStatus,
    PrivateKeyMaterial, PublicIdentity,
};

#[cfg_attr(feature = "conformance", allow(dead_code))]
pub fn initialize_tauri(app: &tauri::App) {
    use tauri::Manager;
    let state = app.state::<ManagedE2eeService>();
    let mode = crate::security::RuntimeMode {
        is_tauri_dev: tauri::is_dev(),
        has_debug_assertions: cfg!(debug_assertions),
    };
    let result = crate::security::InstanceProfile::resolve(&app.config().identifier, mode)
        .map_err(|_| E2eeError::Unavailable)
        .and_then(|profile| OsE2eeKeyStore::new(profile.e2ee_credential_service()))
        .map(|store| E2eeService::new(Arc::new(store)))
        .and_then(|service| state.initialize(service));
    if result.is_err() {
        // Commands remain fail-closed through the uninitialized managed state.
    }
}

#[cfg(feature = "e2ee-dev-tool")]
pub fn development_service(identifier: &str) -> Result<E2eeService, E2eeError> {
    let profile = crate::security::InstanceProfile::resolve(
        identifier,
        crate::security::RuntimeMode {
            is_tauri_dev: true,
            has_debug_assertions: true,
        },
    )
    .map_err(|_| E2eeError::Unavailable)?;
    Ok(E2eeService::new(Arc::new(OsE2eeKeyStore::new(
        profile.e2ee_credential_service(),
    )?)))
}
