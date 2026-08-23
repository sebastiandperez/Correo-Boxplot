use std::path::PathBuf;

use correo_boxplot_lib::persistence::{Account, LocalEntity, PersistentLocalEngine};

const SQLCIPHER_4_14_TEST_KEY: [u8; 32] = [0x2a; 32];

#[test]
fn sqlcipher_4_14_database_opens_writes_and_reopens_without_rekey() {
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sqlcipher-4.14.0.db");
    let temporary = tempfile::tempdir().expect("temporary compatibility directory");
    let database = temporary.path().join("compatibility.db");
    std::fs::copy(&fixture, &database).expect("copy immutable 4.14 fixture");

    {
        let engine = PersistentLocalEngine::open(&database, SQLCIPHER_4_14_TEST_KEY)
            .expect("SQLCipher 4.17 opens the 4.14 fixture");
        assert!(matches!(
            engine.read_account("compat-account"),
            Ok(LocalEntity::Present(_))
        ));
        engine
            .register_account(&Account {
                key: "written-by-4.17".into(),
                service_key: "compat-service-4.17".into(),
                jmap_account_id: "compat-remote-4.17".into(),
            })
            .expect("write through canonical persistence semantics");
    }

    let reopened = PersistentLocalEngine::open(&database, SQLCIPHER_4_14_TEST_KEY)
        .expect("reopen with the same DEK and no rekey");
    assert!(matches!(
        reopened.read_account("compat-account"),
        Ok(LocalEntity::Present(_))
    ));
    assert!(matches!(
        reopened.read_account("written-by-4.17"),
        Ok(LocalEntity::Present(_))
    ));
}
