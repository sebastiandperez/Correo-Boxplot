use tauri::{AppHandle, Emitter};

use super::dto::IpcLocalChangeBatch;

pub const LOCAL_STATE_CHANGED_EVENT: &str = "local-state-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventDeliveryError;

pub trait LocalChangeEmitter {
    fn emit_local_change(&self, batch: &IpcLocalChangeBatch) -> Result<(), EventDeliveryError>;
}

impl LocalChangeEmitter for AppHandle {
    fn emit_local_change(&self, batch: &IpcLocalChangeBatch) -> Result<(), EventDeliveryError> {
        self.emit(LOCAL_STATE_CHANGED_EVENT, batch)
            .map_err(|_| EventDeliveryError)
    }
}
