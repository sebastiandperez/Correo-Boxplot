use std::{
    env,
    error::Error,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;

type TestResult = std::result::Result<(), Box<dyn Error>>;

const TEST_KEY: &str =
    r#"PRAGMA key = "x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'";"#;
const WRONG_TEST_KEY: &str =
    r#"PRAGMA key = "x'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'";"#;

struct TemporaryDatabase {
    path: PathBuf,
}

impl TemporaryDatabase {
    fn new() -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after the Unix epoch")
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "correo-boxplot-sqlcipher-{}-{timestamp}.db",
            process::id()
        ));

        remove_database_files(&path);
        Self { path }
    }
}

impl Drop for TemporaryDatabase {
    fn drop(&mut self) {
        remove_database_files(&self.path);
    }
}

fn remove_database_files(path: &Path) {
    for suffix in ["", "-journal", "-wal", "-shm"] {
        let mut related_path = path.as_os_str().to_os_string();
        related_path.push(suffix);
        let _ = fs::remove_file(PathBuf::from(related_path));
    }
}

#[test]
fn sqlcipher_runtime_is_available_and_supported() -> TestResult {
    let connection = Connection::open_in_memory()?;
    let cipher_version: String =
        connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    let sqlite_version: String =
        connection.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;

    println!("SQLCipher: {cipher_version}");
    println!("SQLite: {sqlite_version}");

    assert!(
        !cipher_version.trim().is_empty(),
        "PRAGMA cipher_version returned an empty value"
    );

    let major_version = cipher_version
        .trim()
        .split('.')
        .next()
        .and_then(|component| component.parse::<u8>().ok());
    assert_eq!(
        major_version,
        Some(4),
        "development requires an external SQLCipher 4.x runtime, detected: {cipher_version}"
    );

    assert!(
        !sqlite_version.trim().is_empty(),
        "SELECT sqlite_version() returned an empty value"
    );

    Ok(())
}

#[test]
fn sqlcipher_encrypts_and_rejects_wrong_key() -> TestResult {
    // These raw keys are fixed test vectors. Production DEKs are random and remain in Rust.
    let database = TemporaryDatabase::new();

    {
        let connection = Connection::open(&database.path)?;
        connection.execute_batch(TEST_KEY)?;
        connection.execute_batch(
            "CREATE TABLE proof (value TEXT NOT NULL);\
             INSERT INTO proof (value) VALUES ('encrypted');",
        )?;
    }

    let mut file = fs::File::open(&database.path)?;
    let mut header = [0_u8; 16];
    file.read_exact(&mut header)?;
    assert_ne!(
        &header, b"SQLite format 3\0",
        "the encrypted database must not expose a plaintext SQLite header"
    );

    {
        let connection = Connection::open(&database.path)?;
        connection.execute_batch(TEST_KEY)?;
        let stored_value: String =
            connection.query_row("SELECT value FROM proof", [], |row| row.get(0))?;
        assert_eq!(stored_value, "encrypted");
    }

    {
        let connection = Connection::open(&database.path)?;
        connection.execute_batch(WRONG_TEST_KEY)?;
        let schema_read = connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        });
        assert!(
            schema_read.is_err(),
            "reading the schema with an incorrect SQLCipher key must fail"
        );
    }

    Ok(())
}
