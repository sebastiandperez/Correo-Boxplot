mod cache_flavor;
mod cache_identity;
mod dek;
mod dek_store;
#[cfg(target_os = "linux")]
mod linux_dek_codec;
mod os_dek_store;
#[cfg(test)]
mod profile_config_tests;
#[cfg(test)]
mod profile_tests;
mod windows_credential;

#[cfg(any(test, feature = "e2ee-dev-tool", feature = "local-env-doctor"))]
pub(crate) use cache_flavor::DEVELOPMENT_IDENTIFIER;
#[cfg(test)]
pub(crate) use cache_flavor::PRODUCTION_IDENTIFIER;
pub(crate) use cache_flavor::{CREDENTIAL_USER, CacheFlavor, InstanceProfile, RuntimeMode};
#[cfg(any(test, feature = "e2ee-dev-tool"))]
pub(crate) use cache_flavor::{DEMO1_IDENTIFIER, DEMO2_IDENTIFIER};
pub(crate) use cache_identity::{CacheIdentity, CredentialIdentity};
pub(crate) use dek::{Dek, DekGenerationError};
pub(crate) use dek_store::{DekLookup, DekStore, DekStoreError};
pub(crate) use os_dek_store::OsDekStore;
#[cfg(any(test, target_os = "windows"))]
pub(crate) use windows_credential::WindowsCredentialSpec;
