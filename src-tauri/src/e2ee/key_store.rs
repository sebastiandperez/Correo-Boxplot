use std::sync::{Arc, Mutex};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use keyring_core::{CredentialStore, Entry, Error};
use zeroize::Zeroize;

use super::{E2eeError, PrivateKeyMaterial};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreOutcome {
    Stored,
    AlreadyPresent,
}

pub trait E2eeKeyStore: Send + Sync {
    fn load_private_key(
        &self,
        local_identity: &str,
    ) -> Result<Option<PrivateKeyMaterial>, E2eeError>;
    fn store_private_key_if_absent(
        &self,
        local_identity: &str,
        value: &PrivateKeyMaterial,
    ) -> Result<StoreOutcome, E2eeError>;
    fn load_peer_public_key(
        &self,
        local_identity: &str,
        peer_identity: &str,
    ) -> Result<Option<[u8; 32]>, E2eeError>;
    fn store_peer_public_key_if_absent(
        &self,
        local_identity: &str,
        peer_identity: &str,
        value: &[u8; 32],
    ) -> Result<StoreOutcome, E2eeError>;
    #[cfg_attr(not(any(test, feature = "e2ee-dev-tool")), allow(dead_code))]
    fn reset(&self) -> Result<(), E2eeError>;
}

pub struct OsE2eeKeyStore {
    store: Arc<CredentialStore>,
    service: String,
    access: Mutex<()>,
}

impl OsE2eeKeyStore {
    pub fn new(service: impl Into<String>) -> Result<Self, E2eeError> {
        Ok(Self {
            store: platform_store()?,
            service: service.into(),
            access: Mutex::new(()),
        })
    }

    fn entry(&self, slot: &str) -> Result<Entry, E2eeError> {
        #[cfg(target_os = "windows")]
        {
            use std::collections::HashMap;
            let target = format!("{}/{}", self.service, slot);
            let modifiers = HashMap::from([("target", target.as_str()), ("persistence", "local")]);
            return self
                .store
                .build(&self.service, slot, Some(&modifiers))
                .map_err(classify_error);
        }
        #[cfg(not(target_os = "windows"))]
        self.store
            .build(&self.service, slot, None)
            .map_err(classify_error)
    }

    fn load_slot(&self, slot: &str) -> Result<Option<Vec<u8>>, E2eeError> {
        match self.entry(slot)?.get_secret() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(classify_error(error)),
        }
    }

    fn remember_slot(&self, slot: &str) -> Result<(), E2eeError> {
        let mut slots: Vec<String> = match self.load_slot("index-v1")? {
            Some(bytes) => serde_json::from_slice(&bytes).map_err(|_| E2eeError::Unexpected)?,
            None => Vec::new(),
        };
        if !slots.iter().any(|value| value == slot) {
            slots.push(slot.to_owned());
            self.entry("index-v1")?
                .set_secret(&serde_json::to_vec(&slots).map_err(|_| E2eeError::Unexpected)?)
                .map_err(classify_error)?;
        }
        Ok(())
    }

    fn store_if_absent(&self, slot: &str, value: &[u8]) -> Result<StoreOutcome, E2eeError> {
        match self.load_slot(slot)? {
            Some(existing) if existing == value => Ok(StoreOutcome::AlreadyPresent),
            Some(_) => Err(E2eeError::KeyMismatch),
            None => {
                self.entry(slot)?
                    .set_secret(value)
                    .map_err(classify_error)?;
                self.remember_slot(slot)?;
                Ok(StoreOutcome::Stored)
            }
        }
    }
}

impl E2eeKeyStore for OsE2eeKeyStore {
    fn load_private_key(&self, local: &str) -> Result<Option<PrivateKeyMaterial>, E2eeError> {
        let _guard = self.access.lock().map_err(|_| E2eeError::Unavailable)?;
        self.load_slot(&private_slot(local))?
            .map(|mut bytes| {
                let result = <[u8; 32]>::try_from(bytes.as_slice())
                    .map(PrivateKeyMaterial)
                    .map_err(|_| E2eeError::KeyUnavailable);
                bytes.zeroize();
                result
            })
            .transpose()
    }
    fn store_private_key_if_absent(
        &self,
        local: &str,
        value: &PrivateKeyMaterial,
    ) -> Result<StoreOutcome, E2eeError> {
        let _guard = self.access.lock().map_err(|_| E2eeError::Unavailable)?;
        self.store_if_absent(&private_slot(local), &value.0)
    }
    fn load_peer_public_key(&self, local: &str, peer: &str) -> Result<Option<[u8; 32]>, E2eeError> {
        let _guard = self.access.lock().map_err(|_| E2eeError::Unavailable)?;
        self.load_slot(&peer_slot(local, peer))?
            .map(|bytes| bytes.try_into().map_err(|_| E2eeError::InvalidPublicKey))
            .transpose()
    }
    fn store_peer_public_key_if_absent(
        &self,
        local: &str,
        peer: &str,
        value: &[u8; 32],
    ) -> Result<StoreOutcome, E2eeError> {
        let _guard = self.access.lock().map_err(|_| E2eeError::Unavailable)?;
        self.store_if_absent(&peer_slot(local, peer), value)
    }
    fn reset(&self) -> Result<(), E2eeError> {
        let _guard = self.access.lock().map_err(|_| E2eeError::Unavailable)?;
        let slots: Vec<String> = match self.load_slot("index-v1")? {
            Some(bytes) => serde_json::from_slice(&bytes).map_err(|_| E2eeError::Unexpected)?,
            None => Vec::new(),
        };
        for slot in slots
            .into_iter()
            .chain(std::iter::once("index-v1".to_owned()))
        {
            match self.entry(&slot)?.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => {}
                Err(error) => return Err(classify_error(error)),
            }
        }
        Ok(())
    }
}

fn private_slot(local: &str) -> String {
    format!("private-v1/{}", URL_SAFE_NO_PAD.encode(local))
}
fn peer_slot(local: &str, peer: &str) -> String {
    format!(
        "peer-v1/{}/{}",
        URL_SAFE_NO_PAD.encode(local),
        URL_SAFE_NO_PAD.encode(peer)
    )
}

fn classify_error(error: Error) -> E2eeError {
    match error {
        Error::BadEncoding(mut bytes) | Error::BadDataFormat(mut bytes, _) => {
            bytes.zeroize();
            E2eeError::Unexpected
        }
        _ => E2eeError::Unavailable,
    }
}

#[cfg(target_os = "linux")]
fn platform_store() -> Result<Arc<CredentialStore>, E2eeError> {
    zbus_secret_service_keyring_store::Store::new()
        .map(|v| v as Arc<CredentialStore>)
        .map_err(classify_error)
}
#[cfg(target_os = "windows")]
fn platform_store() -> Result<Arc<CredentialStore>, E2eeError> {
    windows_native_keyring_store::Store::new()
        .map(|v| v as Arc<CredentialStore>)
        .map_err(classify_error)
}
#[cfg(target_os = "macos")]
fn platform_store() -> Result<Arc<CredentialStore>, E2eeError> {
    apple_native_keyring_store::keychain::Store::new()
        .map(|v| v as Arc<CredentialStore>)
        .map_err(classify_error)
}
#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn platform_store() -> Result<Arc<CredentialStore>, E2eeError> {
    Err(E2eeError::Unavailable)
}

#[cfg(test)]
pub use memory::MemoryE2eeKeyStore;

#[cfg(test)]
mod memory {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};

    #[derive(Default)]
    pub struct MemoryE2eeKeyStore {
        values: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl MemoryE2eeKeyStore {
        pub fn insert_malformed_private(&self, identity: &str) {
            self.values
                .lock()
                .unwrap()
                .insert(private_slot(identity), vec![1]);
        }
    }

    impl E2eeKeyStore for MemoryE2eeKeyStore {
        fn load_private_key(&self, local: &str) -> Result<Option<PrivateKeyMaterial>, E2eeError> {
            self.values
                .lock()
                .unwrap()
                .get(&private_slot(local))
                .map(|v| {
                    <[u8; 32]>::try_from(v.as_slice())
                        .map(PrivateKeyMaterial)
                        .map_err(|_| E2eeError::KeyUnavailable)
                })
                .transpose()
        }
        fn store_private_key_if_absent(
            &self,
            local: &str,
            value: &PrivateKeyMaterial,
        ) -> Result<StoreOutcome, E2eeError> {
            memory_store(&self.values, private_slot(local), &value.0)
        }
        fn load_peer_public_key(
            &self,
            local: &str,
            peer: &str,
        ) -> Result<Option<[u8; 32]>, E2eeError> {
            self.values
                .lock()
                .unwrap()
                .get(&peer_slot(local, peer))
                .map(|v| {
                    v.as_slice()
                        .try_into()
                        .map_err(|_| E2eeError::InvalidPublicKey)
                })
                .transpose()
        }
        fn store_peer_public_key_if_absent(
            &self,
            local: &str,
            peer: &str,
            value: &[u8; 32],
        ) -> Result<StoreOutcome, E2eeError> {
            memory_store(&self.values, peer_slot(local, peer), value)
        }
        fn reset(&self) -> Result<(), E2eeError> {
            self.values.lock().unwrap().clear();
            Ok(())
        }
    }

    fn memory_store(
        values: &Mutex<HashMap<String, Vec<u8>>>,
        slot: String,
        value: &[u8],
    ) -> Result<StoreOutcome, E2eeError> {
        use std::collections::hash_map::Entry;
        match values.lock().unwrap().entry(slot) {
            Entry::Vacant(entry) => {
                entry.insert(value.to_vec());
                Ok(StoreOutcome::Stored)
            }
            Entry::Occupied(entry) if entry.get() == value => Ok(StoreOutcome::AlreadyPresent),
            Entry::Occupied(_) => Err(E2eeError::KeyMismatch),
        }
    }
}
