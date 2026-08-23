use std::path::PathBuf;

use super::{DEMO1_IDENTIFIER, DEMO2_IDENTIFIER};

#[test]
fn demo_overlays_and_package_scripts_pin_distinct_strict_ports() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let demo1: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("tauri.demo1.conf.json")).unwrap())
            .unwrap();
    let demo2: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("tauri.demo2.conf.json")).unwrap())
            .unwrap();
    let package: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.parent().unwrap().join("package.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(demo1["identifier"], DEMO1_IDENTIFIER);
    assert_eq!(demo2["identifier"], DEMO2_IDENTIFIER);
    assert_eq!(demo1["build"]["devUrl"], "http://127.0.0.1:1421");
    assert_eq!(demo2["build"]["devUrl"], "http://127.0.0.1:1422");
    assert!(
        demo1["build"]["beforeDevCommand"]
            .as_str()
            .unwrap()
            .contains("--port 1421 --strictPort")
    );
    assert!(
        demo2["build"]["beforeDevCommand"]
            .as_str()
            .unwrap()
            .contains("--port 1422 --strictPort")
    );
    assert_eq!(
        package["scripts"]["dev"],
        "tauri dev --config src-tauri/tauri.dev.conf.json"
    );
    assert_eq!(
        package["scripts"]["dev:demo1"],
        "tauri dev --config src-tauri/tauri.demo1.conf.json"
    );
    assert_eq!(
        package["scripts"]["dev:demo2"],
        "tauri dev --config src-tauri/tauri.demo2.conf.json"
    );
}
