use crate::{
    ipc::ManagedLocalEngine,
    persistence::PersistentLocalEngine,
    security::{DekStore, DekStoreError},
};

use super::{
    BootstrapFailure, CachePaths, DekGenerator, markers,
    startup::{map_store_error, open_database},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResetPhase {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "used by the future native authorization caller")
    )]
    MarkerWritten,
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "used by the future native authorization caller")
    )]
    EngineDrained,
    DatabaseDeleted,
    CredentialDeleted,
    DekGenerated,
    DekStored,
    DatabaseCreated,
    DatabaseVerified,
    MarkerRemoved,
}

pub trait ResetHook {
    fn reached(&self, phase: ResetPhase) -> Result<(), BootstrapFailure>;
}

pub struct NoopResetHook;

impl ResetHook for NoopResetHook {
    fn reached(&self, _phase: ResetPhase) -> Result<(), BootstrapFailure> {
        Ok(())
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "native reset core awaits a separately authorized caller"
    )
)]
pub(crate) fn authorized_reset(
    lifecycle: &ManagedLocalEngine,
    paths: &CachePaths,
    store: &dyn DekStore,
    generator: &dyn DekGenerator,
    hook: &dyn ResetHook,
) -> Result<(), BootstrapFailure> {
    lifecycle.with_exclusive(|state| {
        markers::create_durable(&paths.reset_marker)?;
        state.begin_reset();
        let result = hook
            .reached(ResetPhase::MarkerWritten)
            .and_then(|()| hook.reached(ResetPhase::EngineDrained))
            .and_then(|()| resume_reset(paths, store, generator, hook));
        match result {
            Ok(engine) => {
                state.install_ready(engine);
                Ok(())
            }
            Err(error) => {
                state.install_unavailable(error);
                Err(error)
            }
        }
    })
}

pub fn resume_reset(
    paths: &CachePaths,
    store: &dyn DekStore,
    generator: &dyn DekGenerator,
    hook: &dyn ResetHook,
) -> Result<PersistentLocalEngine, BootstrapFailure> {
    paths.delete_database_artifacts()?;
    hook.reached(ResetPhase::DatabaseDeleted)?;
    match store.delete() {
        Ok(()) => {}
        Err(DekStoreError::Unavailable) => return Err(BootstrapFailure::SecureStoreUnavailable),
        Err(error) => return Err(map_store_error(error)),
    }
    hook.reached(ResetPhase::CredentialDeleted)?;
    let dek = generator.generate()?;
    hook.reached(ResetPhase::DekGenerated)?;
    store.store(&dek).map_err(map_store_error)?;
    hook.reached(ResetPhase::DekStored)?;
    let engine = open_database(paths, dek)?;
    hook.reached(ResetPhase::DatabaseCreated)?;
    engine
        .runtime_versions()
        .map_err(|_| BootstrapFailure::DatabaseUnreadable)?;
    hook.reached(ResetPhase::DatabaseVerified)?;
    markers::remove_durable(&paths.reset_marker)?;
    hook.reached(ResetPhase::MarkerRemoved)?;
    Ok(engine)
}
