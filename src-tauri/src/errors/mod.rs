use thiserror::Error;

#[derive(Debug, Error)]
pub enum NativeError {
    #[error("local storage is unavailable")]
    StorageUnavailable,
    #[error("local encryption is locked")]
    EncryptionLocked,
    #[error("a database migration failed")]
    MigrationFailed,
}
