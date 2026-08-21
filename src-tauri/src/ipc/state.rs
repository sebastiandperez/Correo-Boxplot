use std::{
    ops::Deref,
    sync::{Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard},
};

use crate::{
    bootstrap::{BootstrapFailure, CacheProcessLock},
    persistence::PersistentLocalEngine,
};

enum LifecycleState {
    Initializing,
    Ready(PersistentLocalEngine),
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "used by the internal authorized reset core")
    )]
    Resetting,
    Unavailable {
        _failure: BootstrapFailure,
    },
}

pub struct ManagedLocalEngine {
    state: RwLock<LifecycleState>,
    process_lock: Mutex<Option<CacheProcessLock>>,
}

impl Default for ManagedLocalEngine {
    fn default() -> Self {
        Self {
            state: RwLock::new(LifecycleState::Initializing),
            process_lock: Mutex::new(None),
        }
    }
}

pub struct EngineLease<'a> {
    state: RwLockReadGuard<'a, LifecycleState>,
}

impl Deref for EngineLease<'_> {
    type Target = PersistentLocalEngine;

    fn deref(&self) -> &Self::Target {
        match &*self.state {
            LifecycleState::Ready(engine) => engine,
            _ => unreachable!("an EngineLease is created only for Ready state"),
        }
    }
}

pub struct ExclusiveEngineState<'a> {
    state: RwLockWriteGuard<'a, LifecycleState>,
}

impl ExclusiveEngineState<'_> {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "used by the internal authorized reset core")
    )]
    pub(crate) fn begin_reset(&mut self) {
        *self.state = LifecycleState::Resetting;
    }

    pub(crate) fn install_ready(&mut self, engine: PersistentLocalEngine) {
        *self.state = LifecycleState::Ready(engine);
    }

    pub(crate) fn install_unavailable(&mut self, failure: BootstrapFailure) {
        *self.state = LifecycleState::Unavailable { _failure: failure };
    }
}

impl ManagedLocalEngine {
    pub fn initialize(&self, engine: PersistentLocalEngine) {
        self.with_exclusive(|state| state.install_ready(engine));
    }

    pub fn mark_unavailable(&self, failure: BootstrapFailure) {
        self.with_exclusive(|state| state.install_unavailable(failure));
    }

    pub fn install_process_lock(
        &self,
        process_lock: CacheProcessLock,
    ) -> Result<(), BootstrapFailure> {
        let mut held = self
            .process_lock
            .lock()
            .map_err(|_| BootstrapFailure::Unexpected)?;
        *held = Some(process_lock);
        Ok(())
    }

    pub(crate) fn lease(&self) -> Option<EngineLease<'_>> {
        let state = self.state.read().ok()?;
        if matches!(&*state, LifecycleState::Ready(_)) {
            Some(EngineLease { state })
        } else {
            None
        }
    }

    pub(crate) fn with_exclusive<T>(
        &self,
        operation: impl FnOnce(&mut ExclusiveEngineState<'_>) -> T,
    ) -> T {
        let state = self
            .state
            .write()
            .expect("Local Engine lifecycle lock poisoned");
        operation(&mut ExclusiveEngineState { state })
    }

    #[cfg(test)]
    pub(crate) fn failure(&self) -> Option<BootstrapFailure> {
        match &*self.state.read().ok()? {
            LifecycleState::Unavailable { _failure } => Some(*_failure),
            _ => None,
        }
    }

    #[cfg(feature = "conformance")]
    pub(crate) fn clear(&self) {
        self.with_exclusive(|state| *state.state = LifecycleState::Initializing);
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::mpsc, thread};

    use super::*;

    #[test]
    fn exclusive_lifecycle_waits_for_active_lease() {
        let temp = tempfile::tempdir().expect("temp directory");
        let managed = std::sync::Arc::new(ManagedLocalEngine::default());
        managed.initialize(
            PersistentLocalEngine::open(temp.path().join("lease.db"), [4; 32])
                .expect("engine opens"),
        );
        let lease = managed.lease().expect("ready lease");
        let (started_tx, started_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = managed.clone();
        let thread = thread::spawn(move || {
            started_tx.send(()).expect("signal start");
            worker.with_exclusive(|state| state.begin_reset());
            done_tx.send(()).expect("signal completion");
        });
        started_rx.recv().expect("worker started");
        assert!(done_rx.try_recv().is_err());
        drop(lease);
        done_rx.recv().expect("exclusive operation completed");
        thread.join().expect("worker joins");
    }

    #[test]
    fn shared_lease_waits_while_exclusive_lifecycle_is_held() {
        let temp = tempfile::tempdir().expect("temp directory");
        let managed = std::sync::Arc::new(ManagedLocalEngine::default());
        managed.initialize(
            PersistentLocalEngine::open(temp.path().join("exclusive.db"), [5; 32])
                .expect("engine opens"),
        );
        let (started_tx, started_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = managed.clone();
        managed.with_exclusive(|_| {
            let thread = thread::spawn(move || {
                started_tx.send(()).expect("signal start");
                let ready = worker.lease().is_some();
                done_tx.send(ready).expect("signal completion");
            });
            started_rx.recv().expect("worker started");
            assert!(done_rx.try_recv().is_err());
            drop(thread);
        });
        assert!(done_rx.recv().expect("shared operation completed"));
    }
}
