use std::sync::Arc;

use super::{DecryptRequest, E2eeError, E2eeService, EncryptRequest, MemoryE2eeKeyStore};

fn service() -> E2eeService {
    E2eeService::new(Arc::new(MemoryE2eeKeyStore::default()))
}

#[test]
fn same_identity_text_in_two_profiles_has_independent_private_keys() {
    let demo1 = service();
    let demo2 = service();
    let first = demo1.ensure_local_identity("alice@boxplot.test").unwrap();
    let second = demo2.ensure_local_identity("alice@boxplot.test").unwrap();
    assert_ne!(first.public_key, second.public_key);
}

#[test]
fn a_wrong_trusted_sender_key_fails_authentication_with_the_correct_recipient_key() {
    let alice = service();
    let bob_store = Arc::new(MemoryE2eeKeyStore::default());
    let bob = E2eeService::new(bob_store.clone());
    let mallory = service();
    let alice_key = alice.ensure_local_identity("alice").unwrap();
    let bob_key = bob.ensure_local_identity("bob").unwrap();
    let mallory_key = mallory.ensure_local_identity("mallory").unwrap();
    alice
        .trust_peer_public_key("alice", "bob", &bob_key.public_key)
        .unwrap();
    bob.trust_peer_public_key("bob", "alice", &mallory_key.public_key)
        .unwrap();
    let envelope = alice
        .encrypt_for(EncryptRequest {
            local_identity: "alice".into(),
            recipient_identity: "bob".into(),
            subject: "subject".into(),
            text: "secret".into(),
            html: Some("<p>secret</p>".into()),
        })
        .unwrap();
    assert_eq!(
        bob.decrypt_from(DecryptRequest {
            local_identity: "bob".into(),
            expected_sender: "alice".into(),
            expected_recipient: "bob".into(),
            expected_subject: "subject".into(),
            envelope,
        }),
        Err(E2eeError::MetadataMismatch)
    );
    assert_ne!(alice_key.public_key, mallory_key.public_key);
}
