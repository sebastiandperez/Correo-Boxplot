use std::sync::{Arc, Mutex};

use keyring_core::{CredentialStore, Entry, Error};
use zeroize::Zeroize;

#[cfg(target_os = "windows")]
use super::WindowsCredentialSpec;
use super::{CredentialIdentity, Dek, DekLookup, DekStore, DekStoreError};

pub struct OsDekStore {
    store: Arc<CredentialStore>,
    identity: CredentialIdentity,
    access: Mutex<()>,
}

impl OsDekStore {
    pub fn new(identity: CredentialIdentity) -> Result<Self, DekStoreError> {
        Ok(Self {
            store: platform_store()?,
            identity,
            access: Mutex::new(()),
        })
    }

    fn entry(&self) -> Result<Entry, DekStoreError> {
        platform_entry(&self.store, &self.identity)
    }

    #[cfg(target_os = "windows")]
    fn legacy_windows_entry(&self) -> Result<Entry, DekStoreError> {
        self.store
            .build(&self.identity.service, &self.identity.user, None)
            .map_err(classify_operation_error)
    }
}

impl DekStore for OsDekStore {
    fn load(&self) -> Result<DekLookup, DekStoreError> {
        let _access = self.access.lock().map_err(|_| DekStoreError::Unavailable)?;
        platform_load(self)
    }

    fn store(&self, dek: &Dek) -> Result<(), DekStoreError> {
        let _access = self.access.lock().map_err(|_| DekStoreError::Unavailable)?;
        platform_store_dek(self, dek)
    }

    fn delete(&self) -> Result<(), DekStoreError> {
        let _access = self.access.lock().map_err(|_| DekStoreError::Unavailable)?;
        platform_delete(self)
    }
}

#[cfg(target_os = "linux")]
fn platform_entry(
    store: &Arc<CredentialStore>,
    identity: &CredentialIdentity,
) -> Result<Entry, DekStoreError> {
    store
        .build(&identity.service, &identity.user, None)
        .map_err(classify_operation_error)
}

#[cfg(target_os = "macos")]
fn platform_entry(
    store: &Arc<CredentialStore>,
    identity: &CredentialIdentity,
) -> Result<Entry, DekStoreError> {
    store
        .build(&identity.service, &identity.user, None)
        .map_err(classify_operation_error)
}

#[cfg(target_os = "windows")]
fn platform_entry(
    store: &Arc<CredentialStore>,
    identity: &CredentialIdentity,
) -> Result<Entry, DekStoreError> {
    use std::collections::HashMap;

    let spec = WindowsCredentialSpec::for_identity(identity);
    let modifiers = HashMap::from([
        ("target", spec.target.as_str()),
        ("persistence", spec.persistence),
    ]);
    store
        .build(&identity.service, &identity.user, Some(&modifiers))
        .map_err(classify_operation_error)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn platform_entry(
    _store: &Arc<CredentialStore>,
    _identity: &CredentialIdentity,
) -> Result<Entry, DekStoreError> {
    Err(DekStoreError::Configuration)
}

#[cfg(target_os = "linux")]
fn platform_load(store: &OsDekStore) -> Result<DekLookup, DekStoreError> {
    match store.entry()?.get_secret() {
        Ok(secret) => super::linux_dek_codec::decode(secret).map(DekLookup::Present),
        Err(Error::NoEntry) => Ok(DekLookup::Absent),
        Err(error) => Err(classify_operation_error(error)),
    }
}

#[cfg(any(
    target_os = "macos",
    not(any(target_os = "linux", target_os = "windows", target_os = "macos"))
))]
fn platform_load(store: &OsDekStore) -> Result<DekLookup, DekStoreError> {
    match store.entry()?.get_secret() {
        Ok(secret) => Dek::from_secret(secret)
            .map(DekLookup::Present)
            .map_err(|_| DekStoreError::InvalidStoredDek),
        Err(Error::NoEntry) => Ok(DekLookup::Absent),
        Err(error) => Err(classify_operation_error(error)),
    }
}

#[cfg(target_os = "windows")]
fn platform_load(store: &OsDekStore) -> Result<DekLookup, DekStoreError> {
    let entry = store.entry()?;
    match entry.get_secret() {
        Ok(secret) => {
            let dek = Dek::from_secret(secret).map_err(|_| DekStoreError::InvalidStoredDek)?;
            ensure_windows_local(&entry, &dek)?;
            Ok(DekLookup::Present(dek))
        }
        Err(Error::NoEntry) => migrate_legacy_windows_entry(store, &entry),
        Err(error) => Err(classify_operation_error(error)),
    }
}

#[cfg(target_os = "linux")]
fn platform_store_dek(store: &OsDekStore, dek: &Dek) -> Result<(), DekStoreError> {
    let encoded = super::linux_dek_codec::encode(dek);
    store
        .entry()?
        .set_password(encoded.as_str())
        .map_err(classify_operation_error)
}

#[cfg(any(
    target_os = "macos",
    not(any(target_os = "linux", target_os = "windows", target_os = "macos"))
))]
fn platform_store_dek(store: &OsDekStore, dek: &Dek) -> Result<(), DekStoreError> {
    store
        .entry()?
        .set_secret(dek.expose())
        .map_err(classify_operation_error)
}

#[cfg(target_os = "windows")]
fn platform_store_dek(store: &OsDekStore, dek: &Dek) -> Result<(), DekStoreError> {
    let entry = store.entry()?;
    entry
        .set_secret(dek.expose())
        .map_err(classify_operation_error)?;
    ensure_windows_local(&entry, dek)
}

fn delete_entry(entry: Entry) -> Result<(), DekStoreError> {
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(classify_operation_error(error)),
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_delete(store: &OsDekStore) -> Result<(), DekStoreError> {
    delete_entry(store.entry()?)
}

#[cfg(target_os = "windows")]
fn platform_delete(store: &OsDekStore) -> Result<(), DekStoreError> {
    delete_entry(store.entry()?)?;
    delete_entry(store.legacy_windows_entry()?)
}

#[cfg(target_os = "windows")]
fn ensure_windows_local(entry: &Entry, dek: &Dek) -> Result<(), DekStoreError> {
    let attributes = entry.get_attributes().map_err(classify_operation_error)?;
    if attributes.get("persistence").map(String::as_str) != Some("Local") {
        entry
            .set_secret(dek.expose())
            .map_err(classify_operation_error)?;
    }
    let verified = entry.get_attributes().map_err(classify_operation_error)?;
    if verified.get("persistence").map(String::as_str) == Some("Local") {
        Ok(())
    } else {
        Err(DekStoreError::Configuration)
    }
}

#[cfg(target_os = "windows")]
fn migrate_legacy_windows_entry(
    store: &OsDekStore,
    local_entry: &Entry,
) -> Result<DekLookup, DekStoreError> {
    let legacy = store.legacy_windows_entry()?;
    let secret = match legacy.get_secret() {
        Ok(secret) => secret,
        Err(Error::NoEntry) => return Ok(DekLookup::Absent),
        Err(error) => return Err(classify_operation_error(error)),
    };
    let dek = Dek::from_secret(secret).map_err(|_| DekStoreError::InvalidStoredDek)?;
    local_entry
        .set_secret(dek.expose())
        .map_err(classify_operation_error)?;
    ensure_windows_local(local_entry, &dek)?;
    delete_entry(legacy)?;
    Ok(DekLookup::Present(dek))
}

fn classify_operation_error(error: Error) -> DekStoreError {
    match error {
        Error::NoStorageAccess(_) | Error::PlatformFailure(_) | Error::NoDefaultStore => {
            DekStoreError::Unavailable
        }
        Error::BadEncoding(mut bytes) => {
            bytes.zeroize();
            DekStoreError::Corrupt
        }
        Error::BadDataFormat(mut bytes, _) => {
            bytes.zeroize();
            DekStoreError::Corrupt
        }
        Error::BadStoreFormat(_) | Error::Ambiguous(_) => DekStoreError::Corrupt,
        Error::TooLong(_, _) | Error::Invalid(_, _) | Error::NotSupportedByStore(_) => {
            DekStoreError::Configuration
        }
        Error::NoEntry => DekStoreError::Unavailable,
        _ => DekStoreError::Unavailable,
    }
}

#[cfg(target_os = "linux")]
fn platform_store() -> Result<Arc<CredentialStore>, DekStoreError> {
    zbus_secret_service_keyring_store::Store::new()
        .map(|store| store as Arc<CredentialStore>)
        .map_err(classify_operation_error)
}

#[cfg(target_os = "windows")]
fn platform_store() -> Result<Arc<CredentialStore>, DekStoreError> {
    windows_native_keyring_store::Store::new()
        .map(|store| store as Arc<CredentialStore>)
        .map_err(classify_operation_error)
}

#[cfg(target_os = "macos")]
fn platform_store() -> Result<Arc<CredentialStore>, DekStoreError> {
    apple_native_keyring_store::keychain::Store::new()
        .map(|store| store as Arc<CredentialStore>)
        .map_err(classify_operation_error)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn platform_store() -> Result<Arc<CredentialStore>, DekStoreError> {
    Err(DekStoreError::Configuration)
}

#[cfg(test)]
mod tests {
    use std::{
        io,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    #[test]
    fn keyring_errors_are_classified_fail_closed() {
        assert_eq!(
            classify_operation_error(Error::NoStorageAccess(Box::new(io::Error::other("locked")))),
            DekStoreError::Unavailable
        );
        assert_eq!(
            classify_operation_error(Error::PlatformFailure(Box::new(io::Error::other("failed")))),
            DekStoreError::Unavailable
        );
        assert_eq!(
            classify_operation_error(Error::BadEncoding(vec![0xff])),
            DekStoreError::Corrupt
        );
        assert_eq!(
            classify_operation_error(Error::BadStoreFormat("invalid".into())),
            DekStoreError::Corrupt
        );
        assert_eq!(
            classify_operation_error(Error::Ambiguous(vec![])),
            DekStoreError::Corrupt
        );
        assert_eq!(
            classify_operation_error(Error::NotSupportedByStore("unsupported".into())),
            DekStoreError::Configuration
        );
        assert_eq!(
            classify_operation_error(Error::NoDefaultStore),
            DekStoreError::Unavailable
        );
        assert_eq!(
            classify_operation_error(Error::NoEntry),
            DekStoreError::Unavailable
        );
    }

    #[test]
    #[ignore = "requires the host OS credential service"]
    fn host_os_dek_store_smoke() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after epoch")
            .as_nanos();
        let identity =
            CredentialIdentity::isolated_test(&nonce.to_string(), "sqlcipher-dek-smoke-v1");
        let store = match OsDekStore::new(identity) {
            Ok(store) => store,
            Err(DekStoreError::Unavailable) => {
                eprintln!("HOST_OS_STORE_ENVIRONMENT_BLOCKED");
                return;
            }
            Err(error) => panic!("host store initialization defect: {error:?}"),
        };
        let dek = Dek::generate().expect("OS random source is available");
        let result = (|| {
            store.store(&dek)?;
            let loaded = store.load()?;
            match loaded {
                DekLookup::Present(value) if value.expose() == dek.expose() => {}
                _ => return Err(DekStoreError::Corrupt),
            }
            store.delete()?;
            if matches!(store.load()?, DekLookup::Absent) {
                Ok(())
            } else {
                Err(DekStoreError::Corrupt)
            }
        })();
        let _ = store.delete();
        match result {
            Ok(()) => eprintln!("HOST_OS_STORE_PASS"),
            Err(DekStoreError::Unavailable) => {
                eprintln!("HOST_OS_STORE_ENVIRONMENT_BLOCKED")
            }
            Err(error) => panic!("host store smoke defect: {error:?}"),
        }
    }
}
