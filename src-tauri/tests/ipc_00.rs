use std::collections::BTreeSet;

use correo_boxplot_lib::ipc::{
    commands::{READ_COMMAND_NAMES, WRITE_COMMAND_NAMES},
    dto::*,
    events::LOCAL_STATE_CHANGED_EVENT,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

fn canonical() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/ipc-v1.json"))
        .expect("canonical IPC fixture must be valid JSON")
}

fn assert_canonical<T>(value: Value)
where
    T: DeserializeOwned + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).expect("fixture must decode");
    assert_eq!(
        serde_json::to_value(decoded).expect("DTO must encode"),
        value
    );
}

fn assert_round_trip<T>(value: Value)
where
    T: DeserializeOwned + Serialize,
{
    assert_canonical::<T>(value);
}

#[test]
fn ipc_fixture_matches_rust_dtos_exactly() {
    let fixture = canonical();
    assert_eq!(fixture["protocolVersion"], IPC_PROTOCOL_VERSION);
    assert_canonical::<IpcAccount>(fixture["account"].clone());
    assert_canonical::<IpcEmail>(fixture["email"].clone());
    assert_canonical::<IpcEmailBody>(fixture["emailBody"].clone());
    assert_canonical::<IpcMailboxView>(fixture["mailboxView"].clone());
    assert_canonical::<IpcCollectionSyncCursor>(fixture["cursor"].clone());
    assert_canonical::<IpcPendingMutation>(fixture["sendMutation"].clone());
    assert_canonical::<IpcPendingMutation>(fixture["keywordMutation"].clone());
    assert_canonical::<IpcPendingMutation>(fixture["membershipMutation"].clone());
    assert_canonical::<IpcReadResult<()>>(fixture["readError"].clone());
    assert_canonical::<IpcWriteResult>(fixture["writeConflict"].clone());
    assert_canonical::<IpcLocalChangeBatch>(fixture["changeBatch"].clone());
}

#[test]
fn serde_preserves_null_empty_and_camel_case_wire_fields() {
    assert_round_trip::<IpcEmailAddressList>(json!(null));
    assert_round_trip::<IpcEmailAddressList>(json!([]));
    assert_round_trip::<IpcEmailBody>(json!({
        "emailId": {"accountKey": "a", "jmapEmailId": "e"},
        "text": null,
        "html": ""
    }));
    assert_round_trip::<IpcAttachmentRef>(json!({
        "emailId": {"accountKey": "a", "jmapEmailId": "e"},
        "partId": "",
        "blobId": {"accountKey": "a", "jmapBlobId": "b"},
        "name": null,
        "mediaType": "application/octet-stream",
        "size": 0,
        "disposition": "",
        "cid": null
    }));
    assert_round_trip::<IpcCollectionSyncCursor>(json!({
        "accountKey": "a", "dataType": "email", "state": ""
    }));
}

#[test]
fn every_mutation_lifecycle_variant_round_trips() {
    for lifecycle in [
        json!({"status":"pending","attemptCount":0}),
        json!({"status":"inFlight","attemptCount":1}),
        json!({"status":"retrying","attemptCount":2,"nextAttemptAt":"later"}),
        json!({"status":"failedTerminal","attemptCount":3}),
    ] {
        assert_round_trip::<IpcSendMutationLifecycle>(lifecycle.clone());
        assert_round_trip::<IpcEmailUpdateLifecycle>(lifecycle);
    }
    assert_round_trip::<IpcSendMutationLifecycle>(json!({
        "status":"confirmed",
        "attemptCount":1,
        "confirmation":{"emailId":{"accountKey":"a","jmapEmailId":"e"}}
    }));
    assert_round_trip::<IpcEmailUpdateLifecycle>(json!({"status":"confirmed","attemptCount":1}));
}

#[test]
fn all_six_collection_commit_variants_round_trip() {
    let cursor = json!({"accountKey":"a","dataType":"email","state":"s2"});
    let matching = json!({
        "kind":"matches",
        "cursor":{"accountKey":"a","dataType":"email","state":"s1"}
    });
    let absent = json!({"kind":"absent"});
    for (kind, data_type) in [
        ("email", "email"),
        ("mailbox", "mailbox"),
        ("identity", "identity"),
    ] {
        let mut next = cursor.clone();
        next["dataType"] = json!(data_type);
        let mut expected = matching.clone();
        expected["cursor"]["dataType"] = json!(data_type);
        assert_round_trip::<IpcCollectionSyncCommit>(json!({
            "kind":kind,
            "mode":"delta",
            "expectedCursor":expected,
            "nextCursor":next,
            "changed":[],
            "destroyed":[]
        }));
        let mut next = cursor.clone();
        next["dataType"] = json!(data_type);
        assert_round_trip::<IpcCollectionSyncCommit>(json!({
            "kind":kind,
            "mode":"replace",
            "expectedCursor":absent,
            "nextCursor":next,
            "snapshot":[]
        }));
    }
}

#[test]
fn result_envelopes_event_and_inventory_are_frozen() {
    assert_round_trip::<IpcReadResult<IpcOwnedCache<Vec<IpcAttachmentRef>>>>(
        json!({"ok":true,"value":{"kind":"notCached"}}),
    );
    assert_round_trip::<IpcReadResult<()>>(json!({
        "ok":false,"error":{"kind":"corruptState"}
    }));
    assert_round_trip::<IpcWriteResult>(json!({"ok":true,"value":null}));
    assert_round_trip::<IpcWriteResult>(json!({
        "ok":false,"error":{"kind":"conflict"}
    }));
    assert_eq!(LOCAL_STATE_CHANGED_EVENT, "local-state-changed");
    assert_eq!(READ_COMMAND_NAMES.len(), 15);
    assert_eq!(WRITE_COMMAND_NAMES.len(), 10);
    assert_eq!(
        READ_COMMAND_NAMES
            .into_iter()
            .chain(WRITE_COMMAND_NAMES)
            .collect::<BTreeSet<_>>()
            .len(),
        25
    );
}
