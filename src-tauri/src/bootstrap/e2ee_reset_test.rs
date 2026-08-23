use std::sync::{Arc, Mutex};

use crate::{
    e2ee::{E2eeService, MemoryE2eeKeyStore},
    ipc::ManagedLocalEngine,
    security::{Dek, DekLookup, DekStore, DekStoreError},
};

use super::{
    BootstrapFailure, CachePaths, DekGenerator, NoopResetHook, authorized_reset,
    bootstrap_local_cache,
};

#[derive(Default)]
struct TestDekStore(Mutex<Option<Vec<u8>>>);

impl DekStore for TestDekStore {
    fn load(&self) -> Result<DekLookup, DekStoreError> {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .map(|value| {
                Dek::from_secret(value.clone())
                    .map(DekLookup::Present)
                    .map_err(|_| DekStoreError::InvalidStoredDek)
            })
            .unwrap_or(Ok(DekLookup::Absent))
    }
    fn store(&self, value: &Dek) -> Result<(), DekStoreError> {
        *self.0.lock().unwrap() = Some(value.expose().to_vec());
        Ok(())
    }
    fn delete(&self) -> Result<(), DekStoreError> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

struct TestGenerator;
impl DekGenerator for TestGenerator {
    fn generate(&self) -> Result<Dek, BootstrapFailure> {
        Dek::generate().map_err(|_| BootstrapFailure::Unexpected)
    }
}

#[test]
fn authorized_sqlcipher_cache_reset_does_not_touch_e2ee_identity() {
    let e2ee_store = Arc::new(MemoryE2eeKeyStore::default());
    let e2ee = E2eeService::new(e2ee_store);
    let before = e2ee.ensure_local_identity("alice@boxplot.test").unwrap();
    let peer = E2eeService::new(Arc::new(MemoryE2eeKeyStore::default()));
    let peer_public = peer.ensure_local_identity("bob@boxplot.test").unwrap();
    e2ee.trust_peer_public_key(
        "alice@boxplot.test",
        "bob@boxplot.test",
        &peer_public.public_key,
    )
    .unwrap();
    let temp = tempfile::tempdir().unwrap();
    let paths = CachePaths::prepare(temp.path().to_owned()).unwrap();
    let dek_store = TestDekStore::default();
    let engine = bootstrap_local_cache(&paths, &dek_store, &TestGenerator).unwrap();
    let lifecycle = ManagedLocalEngine::default();
    lifecycle.initialize(engine);
    authorized_reset(
        &lifecycle,
        &paths,
        &dek_store,
        &TestGenerator,
        &NoopResetHook,
    )
    .unwrap();
    let after = e2ee.ensure_local_identity("alice@boxplot.test").unwrap();
    assert_eq!(before, after);
    assert!(matches!(
        e2ee.peer_key_status("alice@boxplot.test", "bob@boxplot.test")
            .unwrap(),
        crate::e2ee::PeerKeyStatus::Trusted { .. }
    ));
}
