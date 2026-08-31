use std::path::Path;

use correo_boxplot_lib::ipc::dto::IpcSendSecurityMode;
use correo_boxplot_lib::persistence::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;

const KEY: [u8; 32] = [0x53; 32];

fn account() -> Account {
    Account {
        key: "account-a".into(),
        service_key: "service-a".into(),
        jmap_account_id: "remote-a".into(),
    }
}

fn send_intent(security_mode: SendSecurityMode) -> SendIntent {
    SendIntent {
        security_mode,
        identity_jmap_id: "identity-a".into(),
        from: Address {
            name: Some("Sender".into()),
            email: "sender@example.test".into(),
        },
        reply_to: vec![],
        to: vec![Address {
            name: None,
            email: "recipient@example.test".into(),
        }],
        cc: vec![],
        bcc: vec![],
        subject: "Subject".into(),
        body: SendBody {
            text: "Text".into(),
            html: Some("<p>HTML</p>".into()),
        },
    }
}

fn mutation(id: &str, security_mode: SendSecurityMode) -> PendingMutation {
    PendingMutation {
        account_key: "account-a".into(),
        mutation_id: id.into(),
        created_at: "2026-08-30T12:00:00Z".into(),
        payload: MutationPayload::Send(send_intent(security_mode)),
        lifecycle: MutationLifecycle::Pending { attempt_count: 0 },
    }
}

fn engine(path: &Path) -> PersistentLocalEngine {
    PersistentLocalEngine::open(path, KEY).expect("open encrypted engine")
}

fn raw(path: &Path) -> Connection {
    let connection = Connection::open(path).expect("open raw SQLCipher connection");
    let hex = KEY
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    connection
        .execute_batch(&format!("PRAGMA key=\"x'{hex}'\";PRAGMA foreign_keys=ON;"))
        .expect("unlock raw SQLCipher connection");
    connection
}

#[test]
fn ipc_security_mode_wire_values_are_exact_and_closed() {
    assert_eq!(
        serde_json::to_string(&IpcSendSecurityMode::Plain).expect("encode plain mode"),
        "\"plain\""
    );
    assert_eq!(
        serde_json::to_string(&IpcSendSecurityMode::BoxplotE2eeV1).expect("encode encrypted mode"),
        "\"boxplotE2eeV1\""
    );
    assert!(serde_json::from_str::<IpcSendSecurityMode>("\"quantumMagic\"").is_err());
}

#[test]
fn security_mode_survives_encrypted_restart_and_new_writes_are_explicit() {
    let directory = TempDir::new().expect("temporary directory");
    let path = directory.path().join("security-mode.db");
    let local = engine(&path);
    local
        .register_account(&account())
        .expect("register account");
    local
        .stage_send_mutation(&mutation("e2ee", SendSecurityMode::BoxplotE2eeV1))
        .expect("stage encrypted send");
    drop(local);

    let reopened = engine(&path);
    assert!(matches!(
        reopened
            .read_pending_mutation("account-a", "e2ee")
            .expect("read staged mutation"),
        OwnedOptional::Present(PendingMutation {
            payload: MutationPayload::Send(SendIntent {
                security_mode: SendSecurityMode::BoxplotE2eeV1,
                ..
            }),
            ..
        })
    ));
    drop(reopened);

    let encoded: String = raw(&path)
        .query_row(
            "SELECT send_intent_json FROM pending_mutations WHERE account_key='account-a' AND mutation_id='e2ee'",
            [],
            |row| row.get(0),
        )
        .expect("read encoded send intent");
    let value: serde_json::Value = serde_json::from_str(&encoded).expect("valid JSON");
    assert_eq!(value["securityMode"], "boxplotE2eeV1");
}

#[test]
fn historical_missing_mode_decodes_as_plain_but_unknown_mode_is_corrupt() {
    let directory = TempDir::new().expect("temporary directory");
    let path = directory.path().join("legacy-security-mode.db");
    let local = engine(&path);
    local
        .register_account(&account())
        .expect("register account");
    drop(local);

    let mut legacy =
        serde_json::to_value(send_intent(SendSecurityMode::Plain)).expect("encode legacy fixture");
    legacy
        .as_object_mut()
        .expect("send intent object")
        .remove("securityMode");
    let lifecycle = serde_json::to_string(&MutationLifecycle::Pending { attempt_count: 0 })
        .expect("encode lifecycle");
    let connection = raw(&path);
    connection
        .execute(
            "INSERT INTO pending_mutations(account_key,mutation_id,kind,created_at,target_email_jmap_id,send_intent_json,keyword_change_json,membership_change_json,lifecycle_json) VALUES(?1,?2,'send',?3,NULL,?4,NULL,NULL,?5)",
            params![
                "account-a",
                "legacy",
                "2026-08-30T12:00:00Z",
                serde_json::to_string(&legacy).expect("encode legacy JSON"),
                lifecycle,
            ],
        )
        .expect("insert legacy mutation");
    drop(connection);

    let local = engine(&path);
    assert!(matches!(
        local
            .read_pending_mutation("account-a", "legacy")
            .expect("decode historical mutation"),
        OwnedOptional::Present(PendingMutation {
            payload: MutationPayload::Send(SendIntent {
                security_mode: SendSecurityMode::Plain,
                ..
            }),
            ..
        })
    ));
    drop(local);

    let connection = raw(&path);
    let mut unknown = legacy;
    unknown
        .as_object_mut()
        .expect("send intent object")
        .insert("securityMode".into(), "quantumMagic".into());
    connection
        .execute(
            "UPDATE pending_mutations SET send_intent_json=?1 WHERE account_key='account-a' AND mutation_id='legacy'",
            [serde_json::to_string(&unknown).expect("encode unknown mode")],
        )
        .expect("write unknown mode");
    drop(connection);

    assert!(matches!(
        engine(&path).read_pending_mutation("account-a", "legacy"),
        Err(PersistenceError::CorruptState(_))
    ));
}

#[test]
fn persistent_cas_rejects_security_mode_changes() {
    let directory = TempDir::new().expect("temporary directory");
    let path = directory.path().join("cas-security-mode.db");
    let local = engine(&path);
    local
        .register_account(&account())
        .expect("register account");
    let expected = mutation("cas", SendSecurityMode::Plain);
    local
        .stage_send_mutation(&expected)
        .expect("stage plain send");
    let mut next = expected.clone();
    next.payload = MutationPayload::Send(send_intent(SendSecurityMode::BoxplotE2eeV1));
    next.lifecycle = MutationLifecycle::InFlight { attempt_count: 1 };

    assert!(matches!(
        local.replace_pending_mutation_if_current(&expected, &next),
        Err(PersistenceError::Conflict)
    ));
}
