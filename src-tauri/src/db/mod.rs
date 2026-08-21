mod migrations;

use std::{
    fmt::Write,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags};
use zeroize::Zeroizing;

use crate::{persistence::PersistenceError, security::Dek};

pub(crate) struct EncryptedDatabase {
    path: PathBuf,
    key: Dek,
}

impl EncryptedDatabase {
    pub(crate) fn open(path: impl AsRef<Path>, key: Dek) -> Result<Self, PersistenceError> {
        let database = Self {
            path: path.as_ref().to_path_buf(),
            key,
        };
        let mut connection = database.connect()?;
        migrations::migrate(&mut connection)?;
        Ok(database)
    }

    pub(crate) fn connect(&self) -> Result<Connection, PersistenceError> {
        open_keyed_connection(&self.path, self.key.expose())
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
    let mut key_pragma = Zeroizing::new(String::with_capacity(82));
    key_pragma.push_str("PRAGMA key = \"x'");
    for byte in key {
        write!(key_pragma, "{byte:02x}").map_err(|error| {
            PersistenceError::Storage(format!("could not prepare SQLCipher key: {error}"))
        })?;
    }
    key_pragma.push_str("'\";");
    connection.execute_batch(key_pragma.as_str())?;

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
