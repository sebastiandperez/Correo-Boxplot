use std::sync::{Arc, RwLock};

use crate::persistence::PersistentLocalEngine;

#[derive(Default)]
pub struct ManagedLocalEngine {
    engine: RwLock<Option<Arc<PersistentLocalEngine>>>,
}

impl ManagedLocalEngine {
    pub fn initialize(&self, engine: PersistentLocalEngine) {
        *self
            .engine
            .write()
            .expect("Local Engine state lock poisoned") = Some(Arc::new(engine));
    }

    pub(crate) fn get(&self) -> Option<Arc<PersistentLocalEngine>> {
        self.engine.read().ok()?.clone()
    }

    #[cfg(feature = "conformance")]
    pub(crate) fn clear(&self) {
        *self
            .engine
            .write()
            .expect("Local Engine state lock poisoned") = None;
    }
}
