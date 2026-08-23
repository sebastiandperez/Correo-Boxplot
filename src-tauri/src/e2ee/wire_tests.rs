use super::{E2eeEnvelope, E2eeError, PeerKeyStatus, PublicIdentity};

#[test]
fn ipc_values_are_camel_case_and_never_contain_private_key_material() {
    let identity = serde_json::to_value(PublicIdentity {
        local_identity: "alice".into(),
        public_key: "public".into(),
    })
    .unwrap();
    assert_eq!(
        identity,
        serde_json::json!({ "localIdentity": "alice", "publicKey": "public" })
    );
    assert!(identity.get("privateKey").is_none());
    assert_eq!(
        serde_json::to_value(PeerKeyStatus::Trusted {
            public_key: "peer".into()
        })
        .unwrap(),
        serde_json::json!({ "kind": "trusted", "publicKey": "peer" })
    );
    assert_eq!(
        serde_json::to_value(E2eeError::KeyMismatch).unwrap(),
        serde_json::json!("keyMismatch")
    );
}

#[test]
fn envelope_wire_shape_is_exact() {
    let value = serde_json::to_value(E2eeEnvelope {
        version: 1,
        algorithm: "boxplot-crypto-box-v1".into(),
        sender: "alice".into(),
        recipient: "bob".into(),
        sender_public_key: "a".into(),
        recipient_public_key: "b".into(),
        nonce: "n".into(),
        ciphertext: "c".into(),
    })
    .unwrap();
    assert_eq!(
        value
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>(),
        [
            "algorithm",
            "ciphertext",
            "nonce",
            "recipient",
            "recipientPublicKey",
            "sender",
            "senderPublicKey",
            "version"
        ]
        .map(str::to_owned)
        .into_iter()
        .collect()
    );
}
