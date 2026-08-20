use serde::{Serialize, de::DeserializeOwned};

use super::PersistenceError;

pub(crate) fn encode<T: Serialize>(value: &T) -> Result<String, PersistenceError> {
    Ok(serde_json::to_string(value)?)
}

pub(crate) fn decode<T: DeserializeOwned>(value: &str, field: &str) -> Result<T, PersistenceError> {
    serde_json::from_str(value)
        .map_err(|error| PersistenceError::CorruptState(format!("invalid {field}: {error}")))
}
