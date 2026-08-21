use std::path::PathBuf;

use crate::bootstrap::{BootstrapFailure, CachePaths};

use super::{CREDENTIAL_USER, CacheFlavor, RuntimeMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialIdentity {
    pub service: String,
    pub user: String,
}

impl CredentialIdentity {
    #[cfg_attr(
        not(any(test, target_os = "windows")),
        expect(dead_code, reason = "used by the Windows credential backend")
    )]
    pub fn windows_target(&self) -> String {
        format!("{}/{}", self.service, self.user)
    }

    #[cfg(any(test, feature = "local-env-doctor"))]
    pub fn isolated_test(run_id: &str, user: &str) -> Self {
        Self {
            service: format!("com.editorialhuellas.correoboxplot.test.{run_id}.local-cache"),
            user: user.to_owned(),
        }
    }
}

#[derive(Clone)]
pub struct CacheIdentity {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "retained as canonical cache identity metadata")
    )]
    pub flavor: CacheFlavor,
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "retained as canonical cache identity metadata")
    )]
    pub tauri_identifier: String,
    pub credential: CredentialIdentity,
    pub paths: CachePaths,
}

impl CacheIdentity {
    pub fn resolve(
        tauri_identifier: &str,
        local_data_root: PathBuf,
        mode: RuntimeMode,
    ) -> Result<Self, BootstrapFailure> {
        let flavor = CacheFlavor::resolve(tauri_identifier, mode)?;
        Ok(Self {
            flavor,
            tauri_identifier: tauri_identifier.to_owned(),
            credential: CredentialIdentity {
                service: flavor.credential_service().to_owned(),
                user: CREDENTIAL_USER.to_owned(),
            },
            paths: CachePaths::from_root(local_data_root),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::cache_flavor::{DEVELOPMENT_IDENTIFIER, PRODUCTION_IDENTIFIER};

    #[test]
    fn production_development_and_test_identities_are_disjoint() {
        let mode = RuntimeMode {
            is_tauri_dev: false,
            has_debug_assertions: false,
        };
        let production = CacheIdentity::resolve(
            PRODUCTION_IDENTIFIER,
            PathBuf::from("production-root"),
            mode,
        )
        .expect("production identity");
        let development = CacheIdentity::resolve(
            DEVELOPMENT_IDENTIFIER,
            PathBuf::from("development-root"),
            mode,
        )
        .expect("development identity");
        let test = CredentialIdentity::isolated_test("run-123", "sqlcipher-dek-smoke-v1");

        assert_ne!(production.credential, development.credential);
        assert_eq!(production.flavor, CacheFlavor::Production);
        assert_eq!(development.flavor, CacheFlavor::Development);
        assert_eq!(production.tauri_identifier, PRODUCTION_IDENTIFIER);
        assert_eq!(development.tauri_identifier, DEVELOPMENT_IDENTIFIER);
        assert_ne!(production.paths.database, development.paths.database);
        assert_ne!(production.paths.lock, development.paths.lock);
        assert_ne!(
            production.paths.create_marker,
            development.paths.create_marker
        );
        assert_ne!(
            production.paths.reset_marker,
            development.paths.reset_marker
        );
        assert_ne!(test, production.credential);
        assert_ne!(test, development.credential);
        assert!(test.service.contains(".test.run-123.local-cache"));
    }

    #[test]
    fn windows_logical_targets_are_explicit_local_and_distinct() {
        let production = CredentialIdentity {
            service: CacheFlavor::Production.credential_service().to_owned(),
            user: CREDENTIAL_USER.to_owned(),
        };
        let development = CredentialIdentity {
            service: CacheFlavor::Development.credential_service().to_owned(),
            user: CREDENTIAL_USER.to_owned(),
        };
        let test = CredentialIdentity::isolated_test("unique", "sqlcipher-dek-smoke-v1");
        let production = crate::security::WindowsCredentialSpec::for_identity(&production);
        let development = crate::security::WindowsCredentialSpec::for_identity(&development);
        let test = crate::security::WindowsCredentialSpec::for_identity(&test);
        assert_eq!(
            production.target,
            "com.editorialhuellas.correoboxplot.local-cache/sqlcipher-dek-v1"
        );
        assert_eq!(
            development.target,
            "com.editorialhuellas.correoboxplot.dev.local-cache/sqlcipher-dek-v1"
        );
        assert_eq!(
            test.target,
            "com.editorialhuellas.correoboxplot.test.unique.local-cache/sqlcipher-dek-smoke-v1"
        );
        assert_eq!(production.persistence, "local");
        assert_eq!(development.persistence, "local");
        assert_eq!(test.persistence, "local");
    }

    #[test]
    fn tauri_configs_and_canonical_dev_script_are_frozen() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let base: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(manifest.join("tauri.conf.json")).expect("base config"),
        )
        .expect("valid base config");
        let development: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(manifest.join("tauri.dev.conf.json"))
                .expect("development overlay"),
        )
        .expect("valid development overlay");
        let package: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(
                manifest
                    .parent()
                    .expect("repository root")
                    .join("package.json"),
            )
            .expect("package manifest"),
        )
        .expect("valid package manifest");

        assert_eq!(base["identifier"], PRODUCTION_IDENTIFIER);
        assert_eq!(base["productName"], "Correo Boxplot");
        assert_eq!(development["identifier"], DEVELOPMENT_IDENTIFIER);
        assert_eq!(development["productName"], "Correo Boxplot Dev");
        assert_eq!(development.as_object().expect("overlay object").len(), 2);
        assert_eq!(
            package["scripts"]["dev"],
            "tauri dev --config src-tauri/tauri.dev.conf.json"
        );
    }
}
