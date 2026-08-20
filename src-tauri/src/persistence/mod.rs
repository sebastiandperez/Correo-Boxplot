mod codecs;
mod engine;
mod model;

pub use engine::*;
pub use model::*;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("semantic conflict")]
    Conflict,
    #[error("durable state is corrupt: {0}")]
    CorruptState(String),
    #[error("encrypted storage is unavailable")]
    EncryptionUnavailable,
    #[error("migration failed: {0}")]
    Migration(String),
    #[error("storage unavailable: {0}")]
    Storage(String),
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<rusqlite::Error> for PersistenceError {
    fn from(error: rusqlite::Error) -> Self {
        match &error {
            rusqlite::Error::FromSqlConversionFailure(..)
            | rusqlite::Error::IntegralValueOutOfRange(..)
            | rusqlite::Error::InvalidColumnType(..) => Self::CorruptState(error.to_string()),
            rusqlite::Error::SqliteFailure(inner, _)
                if inner.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                Self::Conflict
            }
            _ => Self::Storage(error.to_string()),
        }
    }
}
