use std::sync::{Arc, Mutex};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use keyring_core::{CredentialStore, Entry, Error};
use zeroize::Zeroizing;

use crate::net::errors::NativeMailErrorDto;

const SERVICE: &str = "correo-boxplot-google-oauth";

pub struct GoogleRefreshTokenStore {
    store: Arc<CredentialStore>,
    access: Mutex<()>,
}

impl GoogleRefreshTokenStore {
    pub fn new() -> Result<Self, NativeMailErrorDto> {
        Ok(Self {
            store: platform_store()?,
            access: Mutex::new(()),
        })
    }

    pub fn load(
        &self,
        credential_ref: &str,
    ) -> Result<Option<Zeroizing<String>>, NativeMailErrorDto> {
        let _guard = self
            .access
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))?;
        match self.entry(credential_ref)?.get_secret() {
            Ok(mut value) => {
                let text = String::from_utf8(std::mem::take(&mut value))
                    .map_err(|_| NativeMailErrorDto::protocol("oauth_store_malformed"))?;
                Ok(Some(Zeroizing::new(text)))
            }
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err(NativeMailErrorDto::unavailable("oauth_store_unavailable")),
        }
    }

    pub fn replace(&self, credential_ref: &str, value: &str) -> Result<(), NativeMailErrorDto> {
        let _guard = self
            .access
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))?;
        self.entry(credential_ref)?
            .set_secret(value.as_bytes())
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))
    }

    pub fn forget(&self, credential_ref: &str) -> Result<(), NativeMailErrorDto> {
        let _guard = self
            .access
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))?;
        match self.entry(credential_ref)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err(NativeMailErrorDto::unavailable("oauth_store_unavailable")),
        }
    }

    fn entry(&self, credential_ref: &str) -> Result<Entry, NativeMailErrorDto> {
        let slot = format!("refresh-v1/{}", URL_SAFE_NO_PAD.encode(credential_ref));
        #[cfg(target_os = "windows")]
        {
            use std::collections::HashMap;
            let target = format!("{SERVICE}/{slot}");
            let modifiers = HashMap::from([("target", target.as_str()), ("persistence", "local")]);
            return self
                .store
                .build(SERVICE, &slot, Some(&modifiers))
                .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"));
        }
        #[cfg(not(target_os = "windows"))]
        self.store
            .build(SERVICE, &slot, None)
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))
    }
}

#[cfg(target_os = "linux")]
fn platform_store() -> Result<Arc<CredentialStore>, NativeMailErrorDto> {
    zbus_secret_service_keyring_store::Store::new()
        .map(|value| value as Arc<CredentialStore>)
        .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))
}
#[cfg(target_os = "windows")]
fn platform_store() -> Result<Arc<CredentialStore>, NativeMailErrorDto> {
    windows_native_keyring_store::Store::new()
        .map(|value| value as Arc<CredentialStore>)
        .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))
}
#[cfg(target_os = "macos")]
fn platform_store() -> Result<Arc<CredentialStore>, NativeMailErrorDto> {
    apple_native_keyring_store::keychain::Store::new()
        .map(|value| value as Arc<CredentialStore>)
        .map_err(|_| NativeMailErrorDto::unavailable("oauth_store_unavailable"))
}
#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn platform_store() -> Result<Arc<CredentialStore>, NativeMailErrorDto> {
    Err(NativeMailErrorDto::unavailable("oauth_store_unavailable"))
}
