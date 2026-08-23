use std::path::PathBuf;

use super::{
    CacheFlavor, CacheIdentity, DEMO1_IDENTIFIER, DEMO2_IDENTIFIER, DEVELOPMENT_IDENTIFIER, Dek,
    InstanceProfile, PRODUCTION_IDENTIFIER, RuntimeMode,
};

#[test]
fn all_fixed_profiles_have_disjoint_cache_and_e2ee_namespaces() {
    let mode = RuntimeMode {
        is_tauri_dev: false,
        has_debug_assertions: false,
    };
    let profiles = [
        (PRODUCTION_IDENTIFIER, "prod"),
        (DEVELOPMENT_IDENTIFIER, "dev"),
        (DEMO1_IDENTIFIER, "demo1"),
        (DEMO2_IDENTIFIER, "demo2"),
    ];
    let identities: Vec<_> = profiles
        .into_iter()
        .map(|(identifier, root)| {
            CacheIdentity::resolve(identifier, PathBuf::from(root), mode).unwrap()
        })
        .collect();
    for left in 0..identities.len() {
        for right in left + 1..identities.len() {
            assert_ne!(
                identities[left].credential.service,
                identities[right].credential.service
            );
            assert_ne!(
                identities[left].paths.database,
                identities[right].paths.database
            );
            assert_ne!(identities[left].paths.lock, identities[right].paths.lock);
        }
    }
    assert_eq!(identities[0].flavor, CacheFlavor::Production);
    assert!(
        identities[1..]
            .iter()
            .all(|identity| identity.flavor == CacheFlavor::Development)
    );
    let e2ee = [
        InstanceProfile::Production,
        InstanceProfile::Development,
        InstanceProfile::Demo1,
        InstanceProfile::Demo2,
    ]
    .map(InstanceProfile::e2ee_credential_service);
    assert_eq!(
        e2ee.into_iter()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        4
    );
}

#[test]
fn independently_generated_demo_deks_are_distinct() {
    let first = Dek::generate().unwrap();
    let second = Dek::generate().unwrap();
    assert_ne!(first.expose(), second.expose());
}

#[test]
fn production_guards_remain_fail_closed_while_demo_profiles_are_development() {
    let debug = RuntimeMode {
        is_tauri_dev: true,
        has_debug_assertions: true,
    };
    assert!(InstanceProfile::resolve(PRODUCTION_IDENTIFIER, debug).is_err());
    assert_eq!(
        InstanceProfile::resolve(DEMO1_IDENTIFIER, debug),
        Ok(InstanceProfile::Demo1)
    );
    assert_eq!(
        InstanceProfile::resolve(DEMO2_IDENTIFIER, debug),
        Ok(InstanceProfile::Demo2)
    );
}
