mod cache_lock;
mod markers;
mod reset;
#[path = "bootstrap.rs"]
mod startup;

pub(crate) use cache_lock::CacheProcessLock;
pub(crate) use reset::{NoopResetHook, resume_reset};
#[cfg(test)]
use reset::{ResetHook, ResetPhase, authorized_reset};
pub(crate) use startup::{
    BootstrapFailure, CachePaths, DekGenerator, OsDekGenerator, bootstrap_local_cache,
};

#[cfg(test)]
mod e2ee_reset_test;
#[cfg(test)]
mod profile_tests;
#[cfg(test)]
mod tests;

pub fn initialize_tauri(app: &tauri::App) {
    use tauri::Manager;

    let lifecycle = app.state::<crate::ipc::ManagedLocalEngine>();
    let result = (|| {
        let identifier = app.config().identifier.as_str();
        let mode = crate::security::RuntimeMode {
            is_tauri_dev: tauri::is_dev(),
            has_debug_assertions: cfg!(debug_assertions),
        };
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|_| BootstrapFailure::LocalDataUnavailable)?;
        let identity = crate::security::CacheIdentity::resolve(identifier, root, mode)?;
        identity.paths.prepare_root()?;
        let process_lock = CacheProcessLock::acquire(&identity.paths.lock)?;
        lifecycle.install_process_lock(process_lock)?;
        let store =
            crate::security::OsDekStore::new(identity.credential.clone()).map_err(|error| {
                match error {
                    crate::security::DekStoreError::Unavailable => {
                        BootstrapFailure::SecureStoreUnavailable
                    }
                    crate::security::DekStoreError::Corrupt => BootstrapFailure::SecureStoreCorrupt,
                    crate::security::DekStoreError::InvalidStoredDek => {
                        BootstrapFailure::InvalidStoredDek
                    }
                    crate::security::DekStoreError::Configuration => {
                        BootstrapFailure::SecureStoreConfiguration
                    }
                }
            })?;
        bootstrap_local_cache(&identity.paths, &store, &OsDekGenerator)
    })();
    match result {
        Ok(engine) => lifecycle.initialize(engine),
        Err(failure) => lifecycle.mark_unavailable(failure),
    }
}

#[cfg(feature = "conformance")]
const _: fn(&tauri::App) = initialize_tauri;
