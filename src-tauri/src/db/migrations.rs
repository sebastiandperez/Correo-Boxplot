use rusqlite::Connection;

use crate::persistence::PersistenceError;

const INITIAL: &str = include_str!("migrations/0001_initial.sql");
const PERSIST_01: &str = include_str!("migrations/0002_persist_01.sql");
const FTS5_03: &str = include_str!("migrations/0003_fts5.sql");
const LATEST_VERSION: i64 = 3;

pub(super) fn migrate(connection: &mut Connection) -> Result<(), PersistenceError> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > LATEST_VERSION {
        return Err(PersistenceError::Migration(format!(
            "unsupported future schema version {version}"
        )));
    }
    if version == 0 {
        connection
            .execute_batch(INITIAL)
            .map_err(|error| PersistenceError::Migration(error.to_string()))?;
    }
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version == 1 {
        let legacy_mutations: i64 =
            connection.query_row("SELECT count(*) FROM pending_mutations", [], |row| {
                row.get(0)
            })?;
        if legacy_mutations != 0 {
            return Err(PersistenceError::Migration(
                "legacy PendingMutation rows require joint recovery; migration will not discard them"
                    .into(),
            ));
        }
        let transaction = connection.transaction()?;
        transaction
            .execute_batch(PERSIST_01)
            .map_err(|error| PersistenceError::Migration(error.to_string()))?;
        transaction.commit()?;
    }
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version == 2 {
        connection
            .execute_batch(FTS5_03)
            .map_err(|error| PersistenceError::Migration(error.to_string()))?;
    }
    Ok(())
}
