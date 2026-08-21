use super::CredentialIdentity;

#[cfg_attr(
    not(any(test, target_os = "windows")),
    expect(dead_code, reason = "used by the Windows credential backend")
)]
pub const LOCAL_PERSISTENCE_MODIFIER: &str = "local";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsCredentialSpec {
    pub target: String,
    pub persistence: &'static str,
}

impl WindowsCredentialSpec {
    #[cfg_attr(
        not(any(test, target_os = "windows")),
        expect(dead_code, reason = "used by the Windows credential backend")
    )]
    pub fn for_identity(identity: &CredentialIdentity) -> Self {
        Self {
            target: identity.windows_target(),
            persistence: LOCAL_PERSISTENCE_MODIFIER,
        }
    }
}
