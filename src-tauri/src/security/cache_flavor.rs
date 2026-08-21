use crate::bootstrap::BootstrapFailure;

pub const PRODUCTION_IDENTIFIER: &str = "com.editorialhuellas.correoboxplot";
pub const DEVELOPMENT_IDENTIFIER: &str = "com.editorialhuellas.correoboxplot.dev";
pub const CREDENTIAL_USER: &str = "sqlcipher-dek-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheFlavor {
    Production,
    Development,
}

#[derive(Debug, Clone, Copy)]
pub struct RuntimeMode {
    pub is_tauri_dev: bool,
    pub has_debug_assertions: bool,
}

impl CacheFlavor {
    pub fn resolve(identifier: &str, mode: RuntimeMode) -> Result<Self, BootstrapFailure> {
        let flavor = match identifier {
            PRODUCTION_IDENTIFIER => Self::Production,
            DEVELOPMENT_IDENTIFIER => Self::Development,
            _ => return Err(BootstrapFailure::InvalidCacheFlavorConfiguration),
        };
        if flavor == Self::Production && mode.is_tauri_dev {
            return Err(BootstrapFailure::UnsafeProductionIdentityInDevelopment);
        }
        if flavor == Self::Production && mode.has_debug_assertions {
            return Err(BootstrapFailure::UnsafeProductionIdentityInDebugBuild);
        }
        Ok(flavor)
    }

    pub fn credential_service(self) -> &'static str {
        match self {
            Self::Production => "com.editorialhuellas.correoboxplot.local-cache",
            Self::Development => "com.editorialhuellas.correoboxplot.dev.local-cache",
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
