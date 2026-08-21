use std::{fs, path::PathBuf};

use crate::{
    persistence::PersistentLocalEngine,
    security::{Dek, DekGenerationError, DekLookup, DekStore, DekStoreError},
};

use super::{NoopResetHook, markers, resume_reset};

pub const DATABASE_FILE: &str = "mail-cache.sqlite3";
pub const CACHE_LOCK_FILE: &str = "local-cache-v1.lock";
pub const CREATE_MARKER_FILE: &str = "bootstrap-create-v1.marker";
pub const RESET_MARKER_FILE: &str = "cache-reset-v1.marker";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootstrapFailure {
    LocalDataUnavailable,
    LocalCacheAlreadyInUse,
    SecureStoreUnavailable,
    SecureStoreCorrupt,
    SecureStoreConfiguration,
    KeyLost,
    InvalidStoredDek,
    DatabaseUnreadable,
    Unexpected,
    UnsafeProductionIdentityInDevelopment,
    UnsafeProductionIdentityInDebugBuild,
    InvalidCacheFlavorConfiguration,
}

#[derive(Clone)]
pub struct CachePaths {
    pub database: PathBuf,
    pub lock: PathBuf,
    pub create_marker: PathBuf,
    pub reset_marker: PathBuf,
}

impl CachePaths {
    pub fn from_root(root: PathBuf) -> Self {
        Self {
            database: root.join(DATABASE_FILE),
            lock: root.join(CACHE_LOCK_FILE),
            create_marker: root.join(CREATE_MARKER_FILE),
            reset_marker: root.join(RESET_MARKER_FILE),
        }
    }

    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "test helper for isolated bootstrap roots")
    )]
    pub fn prepare(root: PathBuf) -> Result<Self, BootstrapFailure> {
        let paths = Self::from_root(root);
        paths.prepare_root()?;
        Ok(paths)
    }

    pub fn prepare_root(&self) -> Result<(), BootstrapFailure> {
        let root = self
            .database
            .parent()
            .ok_or(BootstrapFailure::LocalDataUnavailable)?;
        fs::create_dir_all(root).map_err(|_| BootstrapFailure::LocalDataUnavailable)
    }

    pub(crate) fn artifacts(&self) -> [PathBuf; 4] {
        [
            self.database.clone(),
            PathBuf::from(format!("{}-wal", self.database.display())),
            PathBuf::from(format!("{}-shm", self.database.display())),
            PathBuf::from(format!("{}-journal", self.database.display())),
        ]
    }

    pub(crate) fn any_database_artifact(&self) -> bool {
        self.artifacts().iter().any(|path| path.exists())
    }

    pub(crate) fn has_orphan_sidecar(&self) -> bool {
        !self.database.exists() && self.artifacts()[1..].iter().any(|path| path.exists())
    }

    pub(crate) fn delete_database_artifacts(&self) -> Result<(), BootstrapFailure> {
        for path in self.artifacts() {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(BootstrapFailure::LocalDataUnavailable),
            }
        }
        Ok(())
    }
}

pub trait DekGenerator: Send + Sync {
    fn generate(&self) -> Result<Dek, BootstrapFailure>;
}

#[derive(Default)]
pub struct OsDekGenerator;

impl DekGenerator for OsDekGenerator {
    fn generate(&self) -> Result<Dek, BootstrapFailure> {
        Dek::generate().map_err(|DekGenerationError| BootstrapFailure::Unexpected)
    }
}

pub fn bootstrap_local_cache(
    paths: &CachePaths,
    store: &dyn DekStore,
    generator: &dyn DekGenerator,
) -> Result<PersistentLocalEngine, BootstrapFailure> {
    if paths.reset_marker.exists() {
        return resume_reset(paths, store, generator, &NoopResetHook);
    }
    if paths.create_marker.exists() {
        return recover_incomplete_creation(paths, store, generator);
    }
    if paths.has_orphan_sidecar() {
        return Err(BootstrapFailure::DatabaseUnreadable);
    }

    let database_exists = paths.any_database_artifact();
    match load_dek(store)? {
        DekLookup::Absent if database_exists => Err(BootstrapFailure::KeyLost),
        DekLookup::Absent => {
            let dek = generator.generate()?;
            store.store(&dek).map_err(map_store_error)?;
            create_new_database(paths, dek)
        }
        DekLookup::Present(dek) if database_exists => open_database(paths, dek),
        DekLookup::Present(dek) => create_new_database(paths, dek),
    }
}

fn recover_incomplete_creation(
    paths: &CachePaths,
    store: &dyn DekStore,
    generator: &dyn DekGenerator,
) -> Result<PersistentLocalEngine, BootstrapFailure> {
    paths.delete_database_artifacts()?;
    let dek = match load_dek(store)? {
        DekLookup::Absent => {
            let value = generator.generate()?;
            store.store(&value).map_err(map_store_error)?;
            value
        }
        DekLookup::Present(value) => value,
    };
    let engine = open_database(paths, dek)?;
    markers::remove_durable(&paths.create_marker)?;
    Ok(engine)
}

fn create_new_database(
    paths: &CachePaths,
    dek: Dek,
) -> Result<PersistentLocalEngine, BootstrapFailure> {
    markers::create_durable(&paths.create_marker)?;
    let engine = open_database(paths, dek)?;
    markers::remove_durable(&paths.create_marker)?;
    Ok(engine)
}

pub(crate) fn open_database(
    paths: &CachePaths,
    dek: Dek,
) -> Result<PersistentLocalEngine, BootstrapFailure> {
    PersistentLocalEngine::open_with_dek(&paths.database, dek)
        .map_err(|_| BootstrapFailure::DatabaseUnreadable)
}

pub(crate) fn load_dek(store: &dyn DekStore) -> Result<DekLookup, BootstrapFailure> {
    store.load().map_err(map_store_error)
}

pub(crate) fn map_store_error(error: DekStoreError) -> BootstrapFailure {
    match error {
        DekStoreError::Unavailable => BootstrapFailure::SecureStoreUnavailable,
        DekStoreError::Corrupt => BootstrapFailure::SecureStoreCorrupt,
        DekStoreError::InvalidStoredDek => BootstrapFailure::InvalidStoredDek,
        DekStoreError::Configuration => BootstrapFailure::SecureStoreConfiguration,
    }
}
