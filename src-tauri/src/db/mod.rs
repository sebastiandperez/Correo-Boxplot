mod migrations;

use std::{
    fmt::Write,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags};
use zeroize::Zeroizing;

use crate::{persistence::PersistenceError, security::Dek};

pub(crate) const EXPECTED_SQLCIPHER_VERSION: &str = "4.17.0 community";
pub(crate) const EXPECTED_SQLITE_VERSION: &str = "3.53.3";
#[cfg(feature = "local-env-doctor")]
pub(crate) const EXPECTED_CIPHER_PROVIDER: &str = "openssl";
#[cfg(feature = "local-env-doctor")]
pub(crate) const EXPECTED_CIPHER_PROVIDER_VERSION: &str = "OpenSSL 3.6.3 9 Jun 2026";

#[cfg(feature = "local-env-doctor")]
pub(crate) fn native_database_diagnostics()
-> Result<(String, String, String, String), PersistenceError> {
    let key = Dek::generate().map_err(|_| PersistenceError::EncryptionUnavailable)?;
    let connection = open_keyed_connection(Path::new(":memory:"), key.expose())?;
    let (sqlcipher, sqlite) = query_native_database_runtime(&connection)?;
    let provider = connection.query_row("PRAGMA cipher_provider", [], |row| row.get(0))?;
    let provider_version =
        connection.query_row("PRAGMA cipher_provider_version", [], |row| row.get(0))?;
    Ok((sqlcipher, sqlite, provider, provider_version))
}

fn query_native_database_runtime(
    connection: &Connection,
) -> Result<(String, String), PersistenceError> {
    let sqlcipher = connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    let sqlite = connection.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;
    Ok((sqlcipher, sqlite))
}

fn assert_expected_native_runtime(connection: &Connection) -> Result<(), PersistenceError> {
    let (sqlcipher, sqlite) = query_native_database_runtime(connection)?;
    if native_runtime_matches(&sqlcipher, &sqlite) {
        Ok(())
    } else {
        Err(PersistenceError::EncryptionUnavailable)
    }
}

fn native_runtime_matches(sqlcipher: &str, sqlite: &str) -> bool {
    sqlcipher == EXPECTED_SQLCIPHER_VERSION && sqlite == EXPECTED_SQLITE_VERSION
}

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
        query_native_database_runtime(&connection)
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

    assert_expected_native_runtime(&connection)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_runtime_identity_is_exact_and_future_versions_do_not_auto_upgrade() {
        assert!(native_runtime_matches("4.17.0 community", "3.53.3"));
        assert!(!native_runtime_matches("4.17.1 community", "3.53.3"));
        assert!(!native_runtime_matches("4.18.0 community", "3.53.3"));
        assert!(!native_runtime_matches("4.17.0 community", "3.53.4"));
        assert!(!native_runtime_matches("", "3.53.3"));
    }
}
