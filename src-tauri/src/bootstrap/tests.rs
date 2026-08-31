use std::{collections::VecDeque, fs, sync::Mutex};

use crate::{
    ipc::ManagedLocalEngine,
    persistence::{
        Account, Address, MutationLifecycle, MutationPayload, OwnedOptional, PendingMutation,
        SendBody, SendIntent, SendSecurityMode,
    },
    security::{Dek, DekLookup, DekStore, DekStoreError},
};

use super::*;

#[derive(Clone, Copy)]
enum LoadFailure {
    Unavailable,
    Corrupt,
}

struct FakeStoreState {
    secret: Option<Vec<u8>>,
    load_failure: Option<LoadFailure>,
    store_failure: Option<DekStoreError>,
    delete_failure: Option<DekStoreError>,
    stores: usize,
}

struct FakeStore(Mutex<FakeStoreState>);

impl FakeStore {
    fn absent() -> Self {
        Self(Mutex::new(FakeStoreState {
            secret: None,
            load_failure: None,
            store_failure: None,
            delete_failure: None,
            stores: 0,
        }))
    }

    fn present(value: [u8; 32]) -> Self {
        let store = Self::absent();
        store.0.lock().expect("fake store lock").secret = Some(value.to_vec());
        store
    }

    fn secret(&self) -> Option<Vec<u8>> {
        self.0.lock().expect("fake store lock").secret.clone()
    }
}

impl DekStore for FakeStore {
    fn load(&self) -> Result<DekLookup, DekStoreError> {
        let state = self.0.lock().expect("fake store lock");
        match state.load_failure {
            Some(LoadFailure::Unavailable) => Err(DekStoreError::Unavailable),
            Some(LoadFailure::Corrupt) => Err(DekStoreError::Corrupt),
            None => match &state.secret {
                None => Ok(DekLookup::Absent),
                Some(secret) => Dek::from_secret(secret.clone())
                    .map(DekLookup::Present)
                    .map_err(|_| DekStoreError::InvalidStoredDek),
            },
        }
    }

    fn store(&self, dek: &Dek) -> Result<(), DekStoreError> {
        let mut state = self.0.lock().expect("fake store lock");
        if let Some(error) = state.store_failure {
            return Err(error);
        }
        state.secret = Some(dek.expose().to_vec());
        state.stores += 1;
        Ok(())
    }

    fn delete(&self) -> Result<(), DekStoreError> {
        let mut state = self.0.lock().expect("fake store lock");
        if let Some(error) = state.delete_failure {
            return Err(error);
        }
        state.secret = None;
        Ok(())
    }
}

struct SequenceGenerator(Mutex<VecDeque<[u8; 32]>>);

impl SequenceGenerator {
    fn new(values: impl IntoIterator<Item = [u8; 32]>) -> Self {
        Self(Mutex::new(values.into_iter().collect()))
    }
}

impl DekGenerator for SequenceGenerator {
    fn generate(&self) -> Result<Dek, BootstrapFailure> {
        self.0
            .lock()
            .expect("generator lock")
            .pop_front()
            .map(Dek::from)
            .ok_or(BootstrapFailure::Unexpected)
    }
}

struct FailAt(Mutex<Option<ResetPhase>>);

impl ResetHook for FailAt {
    fn reached(&self, phase: ResetPhase) -> Result<(), BootstrapFailure> {
        let mut target = self.0.lock().expect("hook lock");
        if *target == Some(phase) {
            *target = None;
            Err(BootstrapFailure::Unexpected)
        } else {
            Ok(())
        }
    }
}

fn cache_paths() -> (tempfile::TempDir, CachePaths) {
    let temp = tempfile::tempdir().expect("temp directory");
    let paths = CachePaths::prepare(temp.path().to_path_buf()).expect("cache paths");
    (temp, paths)
}

fn account() -> Account {
    Account {
        key: "account-a".into(),
        service_key: "service-a".into(),
        jmap_account_id: "remote-a".into(),
    }
}

fn pending_send() -> PendingMutation {
    PendingMutation {
        account_key: "account-a".into(),
        mutation_id: "mutation-a".into(),
        created_at: "2026-08-20T12:00:00Z".into(),
        payload: MutationPayload::Send(SendIntent {
            security_mode: SendSecurityMode::Plain,
            identity_jmap_id: "identity-a".into(),
            from: Address {
                name: None,
                email: "sender@example.test".into(),
            },
            reply_to: vec![],
            to: vec![Address {
                name: None,
                email: "recipient@example.test".into(),
            }],
            cc: vec![],
            bcc: vec![],
            subject: String::new(),
            body: SendBody {
                text: String::new(),
                html: None,
            },
        }),
        lifecycle: MutationLifecycle::Pending { attempt_count: 0 },
    }
}

#[test]
fn bootstrap_matrix_first_run_reuse_reopen_and_key_loss() {
    let (_temp, paths) = cache_paths();
    let store = FakeStore::absent();
    let generator = SequenceGenerator::new([[1; 32]]);
    let engine = bootstrap_local_cache(&paths, &store, &generator).expect("first run ready");
    assert!(paths.database.exists());
    assert!(!paths.create_marker.exists());
    assert_eq!(store.secret(), Some(vec![1; 32]));
    drop(engine);

    let reopened = bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([]))
        .expect("existing database reopens");
    reopened.runtime_versions().expect("database validates");
    drop(reopened);

    store.0.lock().expect("fake store lock").secret = None;
    let original = fs::read(&paths.database).expect("encrypted database exists");
    assert_eq!(
        bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([[2; 32]])).err(),
        Some(BootstrapFailure::KeyLost)
    );
    assert_eq!(
        fs::read(&paths.database).expect("database preserved"),
        original
    );
}

#[test]
fn database_absent_with_existing_dek_reuses_it() {
    let (_temp, paths) = cache_paths();
    let store = FakeStore::present([7; 32]);
    bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([[8; 32]]))
        .expect("database created with existing key");
    assert_eq!(store.secret(), Some(vec![7; 32]));
    assert_eq!(store.0.lock().expect("fake store lock").stores, 0);
}

#[test]
fn store_failures_invalid_secret_wrong_key_and_orphans_fail_closed() {
    let (_temp, paths) = cache_paths();
    let unavailable = FakeStore::absent();
    unavailable.0.lock().expect("fake store lock").load_failure = Some(LoadFailure::Unavailable);
    assert_eq!(
        bootstrap_local_cache(&paths, &unavailable, &SequenceGenerator::new([[1; 32]])).err(),
        Some(BootstrapFailure::SecureStoreUnavailable)
    );
    assert!(!paths.any_database_artifact());

    let corrupt = FakeStore::absent();
    corrupt.0.lock().expect("fake store lock").load_failure = Some(LoadFailure::Corrupt);
    assert_eq!(
        bootstrap_local_cache(&paths, &corrupt, &SequenceGenerator::new([[1; 32]])).err(),
        Some(BootstrapFailure::SecureStoreCorrupt)
    );

    let invalid = FakeStore::absent();
    invalid.0.lock().expect("fake store lock").secret = Some(vec![9; 31]);
    assert_eq!(
        bootstrap_local_cache(&paths, &invalid, &SequenceGenerator::new([[1; 32]])).err(),
        Some(BootstrapFailure::InvalidStoredDek)
    );

    let failed_write = FakeStore::absent();
    failed_write
        .0
        .lock()
        .expect("fake store lock")
        .store_failure = Some(DekStoreError::Unavailable);
    assert_eq!(
        bootstrap_local_cache(&paths, &failed_write, &SequenceGenerator::new([[1; 32]])).err(),
        Some(BootstrapFailure::SecureStoreUnavailable)
    );
    assert!(!paths.any_database_artifact());

    let correct = FakeStore::present([3; 32]);
    bootstrap_local_cache(&paths, &correct, &SequenceGenerator::new([])).expect("database created");
    let wrong = FakeStore::present([4; 32]);
    let original = fs::read(&paths.database).expect("database bytes");
    assert_eq!(
        bootstrap_local_cache(&paths, &wrong, &SequenceGenerator::new([])).err(),
        Some(BootstrapFailure::DatabaseUnreadable)
    );
    assert_eq!(
        fs::read(&paths.database).expect("database preserved"),
        original
    );

    fs::remove_file(&paths.database).expect("remove main database");
    fs::write(format!("{}-wal", paths.database.display()), b"orphan").expect("write orphan");
    assert_eq!(
        bootstrap_local_cache(&paths, &correct, &SequenceGenerator::new([])).err(),
        Some(BootstrapFailure::DatabaseUnreadable)
    );
}

#[test]
fn create_marker_recovers_every_frozen_shape() {
    for (name, partial, key_present) in [
        ("no-db-key", false, true),
        ("partial-db-key", true, true),
        ("partial-db-no-key", true, false),
    ] {
        let (_temp, paths) = cache_paths();
        markers::create_durable(&paths.create_marker).expect("create marker");
        if partial {
            fs::write(&paths.database, b"incomplete").expect("partial database");
        }
        let store = if key_present {
            FakeStore::present([6; 32])
        } else {
            FakeStore::absent()
        };
        let engine = bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([[7; 32]]))
            .unwrap_or_else(|error| panic!("{name} must recover: {error:?}"));
        engine.runtime_versions().expect("recovered DB validates");
        assert!(!paths.create_marker.exists());
    }

    let (_temp, paths) = cache_paths();
    let store = FakeStore::present([8; 32]);
    let engine = bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([]))
        .expect("complete database");
    drop(engine);
    markers::create_durable(&paths.create_marker).expect("create marker");
    bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([]))
        .expect("complete but never-ready database is recreated");

    let (_temp, paths) = cache_paths();
    markers::create_durable(&paths.create_marker).expect("create marker");
    fs::write(&paths.database, b"incomplete").expect("partial database");
    let unavailable = FakeStore::absent();
    unavailable.0.lock().expect("fake store lock").load_failure = Some(LoadFailure::Unavailable);
    assert_eq!(
        bootstrap_local_cache(&paths, &unavailable, &SequenceGenerator::new([[1; 32]])).err(),
        Some(BootstrapFailure::SecureStoreUnavailable)
    );
    assert!(paths.create_marker.exists());
    assert!(!paths.any_database_artifact());
}

#[test]
fn reset_destroys_old_state_and_uses_a_fresh_dek() {
    let (_temp, paths) = cache_paths();
    let store = FakeStore::present([10; 32]);
    let engine = bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([]))
        .expect("old cache opens");
    engine
        .register_account(&account())
        .expect("account written");
    engine
        .stage_send_mutation(&pending_send())
        .expect("pending mutation written");
    let managed = ManagedLocalEngine::default();
    managed.initialize(engine);
    authorized_reset(
        &managed,
        &paths,
        &store,
        &SequenceGenerator::new([[11; 32]]),
        &NoopResetHook,
    )
    .expect("authorized reset succeeds");
    assert_eq!(store.secret(), Some(vec![11; 32]));
    assert!(!paths.reset_marker.exists());
    let lease = managed.lease().expect("new engine ready");
    assert!(lease.list_accounts().expect("read new cache").is_empty());
    assert!(matches!(
        lease
            .read_pending_mutation("account-a", "mutation-a")
            .expect("read mutation"),
        OwnedOptional::OwnerAbsent
    ));
}

#[test]
fn reset_recovers_after_every_interruption_phase() {
    let phases = [
        ResetPhase::MarkerWritten,
        ResetPhase::EngineDrained,
        ResetPhase::DatabaseDeleted,
        ResetPhase::CredentialDeleted,
        ResetPhase::DekGenerated,
        ResetPhase::DekStored,
        ResetPhase::DatabaseCreated,
        ResetPhase::DatabaseVerified,
        ResetPhase::MarkerRemoved,
    ];
    for phase in phases {
        let (_temp, paths) = cache_paths();
        let store = FakeStore::present([20; 32]);
        let engine = bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([]))
            .expect("old cache opens");
        engine
            .register_account(&account())
            .expect("old state written");
        let managed = ManagedLocalEngine::default();
        managed.initialize(engine);
        let result = authorized_reset(
            &managed,
            &paths,
            &store,
            &SequenceGenerator::new([[21; 32]]),
            &FailAt(Mutex::new(Some(phase))),
        );
        assert_eq!(result.err(), Some(BootstrapFailure::Unexpected));
        drop(managed);
        let recovered = bootstrap_local_cache(
            &paths,
            &store,
            &SequenceGenerator::new([[22; 32], [23; 32]]),
        )
        .unwrap_or_else(|error| panic!("phase {phase:?} must recover: {error:?}"));
        assert!(
            recovered
                .list_accounts()
                .expect("new cache read")
                .is_empty()
        );
        assert!(!paths.reset_marker.exists());
    }
}

#[test]
fn reset_store_delete_failure_keeps_marker_and_unavailable_state() {
    let (_temp, paths) = cache_paths();
    let store = FakeStore::present([30; 32]);
    let engine = bootstrap_local_cache(&paths, &store, &SequenceGenerator::new([]))
        .expect("old cache opens");
    let managed = ManagedLocalEngine::default();
    managed.initialize(engine);
    store.0.lock().expect("fake store lock").delete_failure = Some(DekStoreError::Unavailable);
    assert_eq!(
        authorized_reset(
            &managed,
            &paths,
            &store,
            &SequenceGenerator::new([[31; 32]]),
            &NoopResetHook,
        )
        .err(),
        Some(BootstrapFailure::SecureStoreUnavailable)
    );
    assert!(paths.reset_marker.exists());
    assert_eq!(
        managed.failure(),
        Some(BootstrapFailure::SecureStoreUnavailable)
    );
    assert!(managed.lease().is_none());
}
