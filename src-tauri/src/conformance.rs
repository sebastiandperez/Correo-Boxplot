use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::{ipc::ManagedLocalEngine, persistence::PersistentLocalEngine};

static NEXT_RUNTIME_ID: AtomicU64 = AtomicU64::new(1);
pub const SETTLED_EVENT: &str = "conformance-settled";

struct RuntimeResources {
    id: String,
    path: PathBuf,
    key: [u8; 32],
}

#[derive(Default)]
pub struct ConformanceRuntimeState {
    current: Mutex<Option<RuntimeResources>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequest {
    runtime_id: String,
}

#[derive(Deserialize)]
pub struct SettleRequest {
    token: String,
}

#[derive(Serialize, Clone)]
pub struct SettleEvent {
    token: String,
}

fn remove_database_artifacts(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let artifact = PathBuf::from(format!("{}{suffix}", path.display()));
        let _ = fs::remove_file(artifact);
    }
}

fn fresh_path(id: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "correo-boxplot-prod-conformance-{}-{id}.db",
        std::process::id()
    ))
}

fn current<'a>(
    state: &'a State<'_, ConformanceRuntimeState>,
    request: &RuntimeRequest,
) -> Result<std::sync::MutexGuard<'a, Option<RuntimeResources>>, String> {
    let guard = state
        .current
        .lock()
        .map_err(|_| "conformance state lock poisoned".to_owned())?;
    if guard
        .as_ref()
        .is_none_or(|value| value.id != request.runtime_id)
    {
        return Err("conformance runtime is not active".to_owned());
    }
    Ok(guard)
}

#[tauri::command]
pub fn conformance_create_runtime(
    engine_state: State<'_, ManagedLocalEngine>,
    runtime_state: State<'_, ConformanceRuntimeState>,
) -> Result<String, String> {
    engine_state.clear();
    let mut current = runtime_state
        .current
        .lock()
        .map_err(|_| "conformance state lock poisoned".to_owned())?;
    if let Some(previous) = current.take() {
        remove_database_artifacts(&previous.path);
    }

    let id = NEXT_RUNTIME_ID.fetch_add(1, Ordering::Relaxed).to_string();
    let path = fresh_path(&id);
    remove_database_artifacts(&path);
    let mut key = [0_u8; 32];
    getrandom::fill(&mut key).map_err(|error| error.to_string())?;
    let engine = PersistentLocalEngine::open(&path, key).map_err(|error| error.to_string())?;
    engine_state.initialize(engine);
    *current = Some(RuntimeResources {
        id: id.clone(),
        path,
        key,
    });
    Ok(id)
}

#[tauri::command]
pub fn conformance_dispose_runtime(
    request: RuntimeRequest,
    engine_state: State<'_, ManagedLocalEngine>,
    runtime_state: State<'_, ConformanceRuntimeState>,
) -> Result<(), String> {
    let mut current = current(&runtime_state, &request)?;
    engine_state.clear();
    if let Some(resources) = current.take() {
        remove_database_artifacts(&resources.path);
    }
    Ok(())
}

#[tauri::command]
pub fn conformance_settle(request: SettleRequest, app: AppHandle) -> Result<(), String> {
    app.emit(
        SETTLED_EVENT,
        SettleEvent {
            token: request.token,
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn conformance_restart_runtime(
    request: RuntimeRequest,
    engine_state: State<'_, ManagedLocalEngine>,
    runtime_state: State<'_, ConformanceRuntimeState>,
) -> Result<(), String> {
    let current = current(&runtime_state, &request)?;
    let resources = current
        .as_ref()
        .ok_or_else(|| "conformance runtime is not active".to_owned())?;
    engine_state.clear();
    let engine = PersistentLocalEngine::open(&resources.path, resources.key)
        .map_err(|error| error.to_string())?;
    engine_state.initialize(engine);
    Ok(())
}

#[tauri::command]
pub fn conformance_wrong_key_rejected(
    request: RuntimeRequest,
    runtime_state: State<'_, ConformanceRuntimeState>,
) -> Result<bool, String> {
    let current = current(&runtime_state, &request)?;
    let resources = current
        .as_ref()
        .ok_or_else(|| "conformance runtime is not active".to_owned())?;
    let mut wrong_key = resources.key;
    wrong_key[0] ^= 0xff;
    Ok(PersistentLocalEngine::open(&resources.path, wrong_key).is_err())
}
