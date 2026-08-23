use crate::bootstrap::BootstrapFailure;

pub const PRODUCTION_IDENTIFIER: &str = "com.editorialhuellas.correoboxplot";
pub const DEVELOPMENT_IDENTIFIER: &str = "com.editorialhuellas.correoboxplot.dev";
pub const DEMO1_IDENTIFIER: &str = "com.editorialhuellas.correoboxplot.dev.demo1";
pub const DEMO2_IDENTIFIER: &str = "com.editorialhuellas.correoboxplot.dev.demo2";
pub const CREDENTIAL_USER: &str = "sqlcipher-dek-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheFlavor {
    Production,
    Development,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceProfile {
    Production,
    Development,
    Demo1,
    Demo2,
}

#[derive(Debug, Clone, Copy)]
pub struct RuntimeMode {
    pub is_tauri_dev: bool,
    pub has_debug_assertions: bool,
}

impl CacheFlavor {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "compatibility selector used by safety tests")
    )]
    pub fn resolve(identifier: &str, mode: RuntimeMode) -> Result<Self, BootstrapFailure> {
        InstanceProfile::resolve(identifier, mode).map(Self::from_profile)
    }

    pub fn from_profile(profile: InstanceProfile) -> Self {
        match profile {
            InstanceProfile::Production => Self::Production,
            InstanceProfile::Development | InstanceProfile::Demo1 | InstanceProfile::Demo2 => {
                Self::Development
            }
        }
    }
}

impl InstanceProfile {
    pub fn resolve(identifier: &str, mode: RuntimeMode) -> Result<Self, BootstrapFailure> {
        let profile = match identifier {
            PRODUCTION_IDENTIFIER => Self::Production,
            DEVELOPMENT_IDENTIFIER => Self::Development,
            DEMO1_IDENTIFIER => Self::Demo1,
            DEMO2_IDENTIFIER => Self::Demo2,
            _ => return Err(BootstrapFailure::InvalidCacheFlavorConfiguration),
        };
        let flavor = CacheFlavor::from_profile(profile);
        if flavor == CacheFlavor::Production && mode.is_tauri_dev {
            return Err(BootstrapFailure::UnsafeProductionIdentityInDevelopment);
        }
        if flavor == CacheFlavor::Production && mode.has_debug_assertions {
            return Err(BootstrapFailure::UnsafeProductionIdentityInDebugBuild);
        }
        Ok(profile)
    }

    pub fn cache_credential_service(self) -> &'static str {
        match self {
            Self::Production => "com.editorialhuellas.correoboxplot.local-cache",
            Self::Development => "com.editorialhuellas.correoboxplot.dev.local-cache",
            Self::Demo1 => "com.editorialhuellas.correoboxplot.dev.demo1.local-cache",
            Self::Demo2 => "com.editorialhuellas.correoboxplot.dev.demo2.local-cache",
        }
    }

    pub fn e2ee_credential_service(self) -> &'static str {
        match self {
            Self::Production => "com.editorialhuellas.correoboxplot.e2ee",
            Self::Development => "com.editorialhuellas.correoboxplot.dev.e2ee",
            Self::Demo1 => "com.editorialhuellas.correoboxplot.dev.demo1.e2ee",
            Self::Demo2 => "com.editorialhuellas.correoboxplot.dev.demo2.e2ee",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_is_the_only_flavor_selector_and_guards_fail_closed() {
        let release = RuntimeMode {
            is_tauri_dev: false,
            has_debug_assertions: false,
        };
        assert_eq!(
            CacheFlavor::resolve(PRODUCTION_IDENTIFIER, release),
            Ok(CacheFlavor::Production)
        );
        assert_eq!(
            CacheFlavor::resolve(DEVELOPMENT_IDENTIFIER, release),
            Ok(CacheFlavor::Development)
        );
        assert_eq!(
            CacheFlavor::resolve(DEMO1_IDENTIFIER, release),
            Ok(CacheFlavor::Development)
        );
        assert_eq!(
            CacheFlavor::resolve(DEMO2_IDENTIFIER, release),
            Ok(CacheFlavor::Development)
        );
        assert_eq!(
            CacheFlavor::resolve(
                DEVELOPMENT_IDENTIFIER,
                RuntimeMode {
                    is_tauri_dev: true,
                    has_debug_assertions: true,
                },
            ),
            Ok(CacheFlavor::Development)
        );
        assert_eq!(
            CacheFlavor::resolve(
                PRODUCTION_IDENTIFIER,
                RuntimeMode {
                    is_tauri_dev: true,
                    has_debug_assertions: false,
                },
            ),
            Err(BootstrapFailure::UnsafeProductionIdentityInDevelopment)
        );
        assert_eq!(
            CacheFlavor::resolve(
                PRODUCTION_IDENTIFIER,
                RuntimeMode {
                    is_tauri_dev: false,
                    has_debug_assertions: true,
                },
            ),
            Err(BootstrapFailure::UnsafeProductionIdentityInDebugBuild)
        );
        assert_eq!(
            CacheFlavor::resolve("com.example.unknown", release),
            Err(BootstrapFailure::InvalidCacheFlavorConfiguration)
        );
    }
}
