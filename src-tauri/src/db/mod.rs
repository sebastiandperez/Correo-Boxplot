mod migrations;

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::persistence::PersistenceError;

#[derive(Clone)]
pub struct EncryptedDatabase {
    path: PathBuf,
    key: [u8; 32],
}

impl EncryptedDatabase {
    pub fn open(path: impl AsRef<Path>, key: [u8; 32]) -> Result<Self, PersistenceError> {
        let database = Self {
            path: path.as_ref().to_path_buf(),
            key,
        };
        let mut connection = database.connect()?;
        migrations::migrate(&mut connection)?;
        Ok(database)
    }

    pub(crate) fn connect(&self) -> Result<Connection, PersistenceError> {
        open_keyed_connection(&self.path, &self.key)
    }

    pub fn runtime_versions(&self) -> Result<(String, String), PersistenceError> {
        let connection = self.connect()?;
        let cipher = connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
        let sqlite = connection.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;
        Ok((cipher, sqlite))
    }
}

fn open_keyed_connection(path: &Path, key: &[u8; 32]) -> Result<Connection, PersistenceError> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    let key_hex = key
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    connection.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))?;

    let cipher: Option<String> = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .optional()?;
    if cipher.as_deref().is_none_or(str::is_empty) {
        return Err(PersistenceError::EncryptionUnavailable);
    }

    // Force key verification before any migration or schema access.
    connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })?;
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(connection)
}

use rusqlite::OptionalExtension;
