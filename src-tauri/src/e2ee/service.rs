use std::sync::Arc;

use super::{
    DecryptedPayload, E2eeEnvelope, E2eeError, E2eeKeyStore, PeerKeyStatus, PublicIdentity, crypto,
};

pub struct EncryptRequest {
    pub local_identity: String,
    pub recipient_identity: String,
    pub subject: String,
    pub text: String,
    pub html: Option<String>,
}

pub struct DecryptRequest {
    pub local_identity: String,
    pub expected_sender: String,
    pub expected_recipient: String,
    pub expected_subject: String,
    pub envelope: E2eeEnvelope,
}

pub struct E2eeService {
    store: Arc<dyn E2eeKeyStore>,
}

impl E2eeService {
    pub fn new(store: Arc<dyn E2eeKeyStore>) -> Self {
        Self { store }
    }

    pub fn ensure_local_identity(&self, local_identity: &str) -> Result<PublicIdentity, E2eeError> {
        let private = match self.store.load_private_key(local_identity)? {
            Some(value) => value,
            None => {
                let (generated, _) = crypto::generate_keypair()?;
                self.store
                    .store_private_key_if_absent(local_identity, &generated)?;
                self.store
                    .load_private_key(local_identity)?
                    .ok_or(E2eeError::KeyUnavailable)?
            }
        };
        let public = crypto::public_from_private(&private)?;
        Ok(PublicIdentity {
            local_identity: local_identity.to_owned(),
            public_key: crypto::encode_key(&public),
        })
    }

    pub fn trust_peer_public_key(
        &self,
        local: &str,
        peer: &str,
        public_key: &str,
    ) -> Result<(), E2eeError> {
        let public = crypto::decode_public_key(public_key)?;
        self.store
            .store_peer_public_key_if_absent(local, peer, &public)?;
        Ok(())
    }

    pub fn peer_key_status(&self, local: &str, peer: &str) -> Result<PeerKeyStatus, E2eeError> {
        Ok(match self.store.load_peer_public_key(local, peer)? {
            None => PeerKeyStatus::Missing,
            Some(value) => PeerKeyStatus::Trusted {
                public_key: crypto::encode_key(&value),
            },
        })
    }

    pub fn encrypt_for(&self, request: EncryptRequest) -> Result<E2eeEnvelope, E2eeError> {
        let private = self
            .store
            .load_private_key(&request.local_identity)?
            .ok_or(E2eeError::KeyUnavailable)?;
        let sender_public = crypto::public_from_private(&private)?;
        let recipient_public = self
            .store
            .load_peer_public_key(&request.local_identity, &request.recipient_identity)?
            .ok_or(E2eeError::PeerKeyUnavailable)?;
        let payload = DecryptedPayload {
            version: 1,
            sender: request.local_identity,
            recipient: request.recipient_identity,
            subject: request.subject,
            text: request.text,
            html: request.html,
        };
        crypto::encrypt(&payload, &private, &sender_public, &recipient_public)
    }

    pub fn decrypt_from(&self, request: DecryptRequest) -> Result<DecryptedPayload, E2eeError> {
        if request.envelope.sender != request.expected_sender
            || request.envelope.recipient != request.expected_recipient
        {
            return Err(E2eeError::MetadataMismatch);
        }
        let private = self
            .store
            .load_private_key(&request.local_identity)?
            .ok_or(E2eeError::KeyUnavailable)?;
        let recipient_public = crypto::public_from_private(&private)?;
        let trusted_sender = self
            .store
            .load_peer_public_key(&request.local_identity, &request.expected_sender)?
            .ok_or(E2eeError::PeerKeyUnavailable)?;
        if crypto::decode_public_key(&request.envelope.sender_public_key)? != trusted_sender
            || crypto::decode_public_key(&request.envelope.recipient_public_key)?
                != recipient_public
            || request.local_identity != request.expected_recipient
        {
            return Err(E2eeError::MetadataMismatch);
        }
        let payload = crypto::decrypt(&request.envelope, &private, &trusted_sender)?;
        if payload.version != 1
            || payload.sender != request.expected_sender
            || payload.recipient != request.expected_recipient
            || payload.subject != request.expected_subject
        {
            return Err(E2eeError::MetadataMismatch);
        }
        Ok(payload)
    }

    #[cfg(feature = "e2ee-dev-tool")]
    pub fn reset_development(&self) -> Result<(), E2eeError> {
        self.store.reset()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::e2ee::{ENVELOPE_ALGORITHM, MemoryE2eeKeyStore};

    fn pair() -> (Arc<MemoryE2eeKeyStore>, E2eeService) {
        let store = Arc::new(MemoryE2eeKeyStore::default());
        (store.clone(), E2eeService::new(store))
    }

    fn connected() -> (E2eeService, E2eeService) {
        let (_, alice) = pair();
        let (_, bob) = pair();
        let alice_public = alice.ensure_local_identity("alice@boxplot.test").unwrap();
        let bob_public = bob.ensure_local_identity("bob@boxplot.test").unwrap();
        alice
            .trust_peer_public_key(
                "alice@boxplot.test",
                "bob@boxplot.test",
                &bob_public.public_key,
            )
            .unwrap();
        bob.trust_peer_public_key(
            "bob@boxplot.test",
            "alice@boxplot.test",
            &alice_public.public_key,
        )
        .unwrap();
        (alice, bob)
    }

    fn encrypt(
        service: &E2eeService,
        sender: &str,
        recipient: &str,
        subject: &str,
        text: &str,
    ) -> E2eeEnvelope {
        service
            .encrypt_for(EncryptRequest {
                local_identity: sender.into(),
                recipient_identity: recipient.into(),
                subject: subject.into(),
                text: text.into(),
                html: None,
            })
            .unwrap()
    }

    fn decrypt(
        service: &E2eeService,
        recipient: &str,
        sender: &str,
        subject: &str,
        envelope: E2eeEnvelope,
    ) -> Result<DecryptedPayload, E2eeError> {
        service.decrypt_from(DecryptRequest {
            local_identity: recipient.into(),
            expected_sender: sender.into(),
            expected_recipient: recipient.into(),
            expected_subject: subject.into(),
            envelope,
        })
    }

    #[test]
    fn identities_persist_and_peer_trust_is_manual_and_fail_closed() {
        let (store, first) = pair();
        let alice = first.ensure_local_identity("alice@boxplot.test").unwrap();
        assert_eq!(
            first.ensure_local_identity("alice@boxplot.test").unwrap(),
            alice
        );
        let recreated = E2eeService::new(store.clone());
        assert_eq!(
            recreated
                .ensure_local_identity("alice@boxplot.test")
                .unwrap(),
            alice
        );
        assert_eq!(
            first
                .peer_key_status("alice@boxplot.test", "bob@boxplot.test")
                .unwrap(),
            PeerKeyStatus::Missing
        );
        let (_, bob) = pair();
        let bob_public = bob
            .ensure_local_identity("bob@boxplot.test")
            .unwrap()
            .public_key;
        first
            .trust_peer_public_key("alice@boxplot.test", "bob@boxplot.test", &bob_public)
            .unwrap();
        first
            .trust_peer_public_key("alice@boxplot.test", "bob@boxplot.test", &bob_public)
            .unwrap();
        let (_, mallory) = pair();
        let different = mallory
            .ensure_local_identity("mallory@boxplot.test")
            .unwrap()
            .public_key;
        assert_eq!(
            first.trust_peer_public_key("alice@boxplot.test", "bob@boxplot.test", &different),
            Err(E2eeError::KeyMismatch)
        );
    }

    #[test]
    fn alice_and_bob_roundtrip_both_directions_and_randomize_nonce() {
        let (alice, bob) = connected();
        let first = encrypt(
            &alice,
            "alice@boxplot.test",
            "bob@boxplot.test",
            "Hola Bob",
            "Mensaje secreto desde Alice",
        );
        let second = encrypt(
            &alice,
            "alice@boxplot.test",
            "bob@boxplot.test",
            "Hola Bob",
            "Mensaje secreto desde Alice",
        );
        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
        assert_eq!(
            decrypt(
                &bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "Hola Bob",
                first
            )
            .unwrap()
            .text,
            "Mensaje secreto desde Alice"
        );
        let reply = encrypt(
            &bob,
            "bob@boxplot.test",
            "alice@boxplot.test",
            "Re: Hola Bob",
            "Recibido",
        );
        assert_eq!(
            decrypt(
                &alice,
                "alice@boxplot.test",
                "bob@boxplot.test",
                "Re: Hola Bob",
                reply
            )
            .unwrap()
            .text,
            "Recibido"
        );
    }

    #[test]
    fn missing_keys_malformed_keys_and_bad_public_input_fail_closed() {
        let (store, service) = pair();
        assert_eq!(
            service.encrypt_for(EncryptRequest {
                local_identity: "alice".into(),
                recipient_identity: "bob".into(),
                subject: "s".into(),
                text: "t".into(),
                html: None
            }),
            Err(E2eeError::KeyUnavailable)
        );
        service.ensure_local_identity("alice").unwrap();
        assert_eq!(
            service.encrypt_for(EncryptRequest {
                local_identity: "alice".into(),
                recipient_identity: "bob".into(),
                subject: "s".into(),
                text: "t".into(),
                html: None
            }),
            Err(E2eeError::PeerKeyUnavailable)
        );
        assert_eq!(
            service.trust_peer_public_key("alice", "bob", "***"),
            Err(E2eeError::InvalidPublicKey)
        );
        store.insert_malformed_private("broken");
        assert_eq!(
            service.ensure_local_identity("broken"),
            Err(E2eeError::KeyUnavailable)
        );
    }

    #[test]
    fn tampering_wrong_metadata_and_unsupported_envelopes_fail_closed() {
        let (alice, bob) = connected();
        let original = encrypt(
            &alice,
            "alice@boxplot.test",
            "bob@boxplot.test",
            "Subject",
            "secret",
        );
        let mut ciphertext = original.clone();
        ciphertext.ciphertext.replace_range(
            ..1,
            if ciphertext.ciphertext.starts_with('A') {
                "B"
            } else {
                "A"
            },
        );
        assert!(
            decrypt(
                &bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "Subject",
                ciphertext
            )
            .is_err()
        );
        let mut nonce = original.clone();
        nonce.nonce.replace_range(
            ..1,
            if nonce.nonce.starts_with('A') {
                "B"
            } else {
                "A"
            },
        );
        assert!(
            decrypt(
                &bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "Subject",
                nonce
            )
            .is_err()
        );
        assert_eq!(
            decrypt(
                &bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "Wrong",
                original.clone()
            ),
            Err(E2eeError::MetadataMismatch)
        );
        assert_eq!(
            decrypt(
                &bob,
                "wrong",
                "alice@boxplot.test",
                "Subject",
                original.clone()
            ),
            Err(E2eeError::MetadataMismatch)
        );
        let mut version = original.clone();
        version.version = 2;
        assert_eq!(
            decrypt(
                &bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "Subject",
                version
            ),
            Err(E2eeError::InvalidEnvelope)
        );
        let mut algorithm = original.clone();
        algorithm.algorithm = format!("{ENVELOPE_ALGORITHM}-other");
        assert_eq!(
            decrypt(
                &bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "Subject",
                algorithm
            ),
            Err(E2eeError::InvalidEnvelope)
        );
        let mut malformed = original;
        malformed.nonce = "%%%".into();
        assert_eq!(
            decrypt(
                &bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "Subject",
                malformed
            ),
            Err(E2eeError::InvalidEnvelope)
        );
    }

    #[test]
    fn wrong_trusted_sender_and_plaintext_marker_never_appear_in_envelope() {
        let (alice, bob) = connected();
        let marker = "SUPER-SECRET-BOXPLOT-ALICE-12345";
        let envelope = encrypt(
            &alice,
            "alice@boxplot.test",
            "bob@boxplot.test",
            "s",
            marker,
        );
        assert!(!serde_json::to_string(&envelope).unwrap().contains(marker));
        let (_, mallory) = pair();
        let key = mallory.ensure_local_identity("mallory").unwrap().public_key;
        let (_, wrong_bob) = pair();
        wrong_bob.ensure_local_identity("bob@boxplot.test").unwrap();
        wrong_bob
            .trust_peer_public_key("bob@boxplot.test", "alice@boxplot.test", &key)
            .unwrap();
        assert!(
            decrypt(
                &wrong_bob,
                "bob@boxplot.test",
                "alice@boxplot.test",
                "s",
                envelope
            )
            .is_err()
        );
        let _ = bob;
    }
}
