use std::{fmt::Write, process::Command};

use crate::security::{
    CREDENTIAL_USER, CredentialIdentity, DEVELOPMENT_IDENTIFIER, Dek, DekLookup, DekStore,
    OsDekStore,
};

const SMOKE_USER: &str = "sqlcipher-dek-smoke-v1";
const ACCEPTANCE_ACCOUNT_KEY: &str = "local-env-doctor-acceptance";

pub fn maybe_run_development_acceptance(app: &tauri::App) {
    use tauri::Manager;

    let action = std::env::args().find_map(|argument| {
        argument
            .strip_prefix("--local-env-acceptance=")
            .map(str::to_owned)
    });
    let Some(action) = action else {
        return;
    };
    let result = (|| {
        if app.config().identifier != DEVELOPMENT_IDENTIFIER {
            return Err("acceptance requires the Development Tauri identifier");
        }
        let lifecycle = app.state::<crate::ipc::ManagedLocalEngine>();
        let engine = lifecycle
            .lease()
            .ok_or("Development Local Engine is unavailable")?;
        match action.as_str() {
            "seed" => {
                engine
                    .register_account(&crate::persistence::Account {
                        key: ACCEPTANCE_ACCOUNT_KEY.to_owned(),
                        service_key: "local-env-doctor-service".to_owned(),
                        jmap_account_id: "local-env-doctor-remote-account".to_owned(),
                    })
                    .map_err(|_| "could not persist Development acceptance state")?;
                println!("DEVELOPMENT_BOOTSTRAP: READY");
                println!("DEVELOPMENT_PERSISTENCE_SEED: PASS");
            }
            "verify" => {
                if !matches!(
                    engine.read_account(ACCEPTANCE_ACCOUNT_KEY),
                    Ok(crate::persistence::LocalEntity::Present(_))
                ) {
                    return Err("persisted Development acceptance state is absent");
                }
                println!("DEVELOPMENT_REOPEN: READY");
                println!("DEVELOPMENT_PERSISTED_STATE: PASS");
            }
            _ => return Err("unknown local environment acceptance action"),
        }
        Ok(())
    })();
    match result {
        Ok(()) => app.handle().exit(0),
        Err(message) => {
            eprintln!("LOCAL_ENV_ACCEPTANCE: FAIL ({message})");
            app.handle().exit(1);
        }
    }
}

pub fn run(arguments: impl Iterator<Item = String>) -> i32 {
    let arguments = arguments.collect::<Vec<_>>();
    match arguments.as_slice() {
        [] => check(),
        [mode] if mode == "check" => check(),
        [mode] if mode == "smoke" => smoke(),
        _ => {
            eprintln!("usage: local-env-doctor [check|smoke]");
            2
        }
    }
}

fn check() -> i32 {
    println!("mode: CHECK (read-only)");
    println!("os: {}", std::env::consts::OS);
    println!("expected_tauri_flavor: Development");
    println!("tauri_identifier: {DEVELOPMENT_IDENTIFIER}");
    println!("credential_service: com.editorialhuellas.correoboxplot.dev.local-cache");
    println!("credential_user: {CREDENTIAL_USER}");
    println!("app_local_data_dir: resolved by Tauri from the Development identifier");
    println!("database_filename: mail-cache.sqlite3");
    println!("cache_lock_filename: local-cache-v1.lock");
    println!("production_isolation_guard: enabled");

    #[cfg(target_os = "linux")]
    {
        let dbus = std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some();
        println!("desktop: {}", diagnostic_env("XDG_CURRENT_DESKTOP"));
        println!("session_type: {}", diagnostic_env("XDG_SESSION_TYPE"));
        println!("user_dbus: {}", available(dbus));
        let service = Command::new("busctl")
            .args(["--user", "status", "org.freedesktop.secrets"])
            .output();
        let service_available = service.as_ref().is_ok_and(|output| output.status.success());
        println!("org.freedesktop.secrets: {}", available(service_available));
        println!("provider: {}", provider_name(service.as_ref().ok()));

        let Ok(run_id) = run_id() else {
            println!("test_namespace_generation: unavailable");
            println!("result: BLOCKED");
            return 1;
        };
        let identity = CredentialIdentity::isolated_test(&run_id, "sqlcipher-dek-check-v1");
        let store_usable = OsDekStore::new(identity)
            .and_then(|store| store.load())
            .is_ok();
        println!("default_collection_store: {}", available(store_usable));
        if dbus && service_available && store_usable {
            println!("result: PASS");
            return 0;
        }
        println!("result: BLOCKED");
        1
    }

    #[cfg(target_os = "windows")]
    {
        println!("backend: Windows Credential Manager");
        println!("required_persistence: Local");
        println!("result: PASS (logical configuration; run SMOKE for mutation)");
        0
    }

    #[cfg(target_os = "macos")]
    {
        println!("backend: macOS Keychain (acceptance outside this block)");
        println!("result: PASS (configuration only)");
        0
    }
}

fn smoke() -> i32 {
    println!("mode: SMOKE (mutating isolated temporary credential)");
    let run_id = match run_id() {
        Ok(run_id) => run_id,
        Err(()) => {
            println!("test_namespace_generation: FAIL");
            return 1;
        }
    };
    let identity = CredentialIdentity::isolated_test(&run_id, SMOKE_USER);
    println!("test_namespace: {}", identity.service);
    println!("credential_user: {}", identity.user);
    let store = match OsDekStore::new(identity) {
        Ok(store) => store,
        Err(error) => {
            println!("store_initialization: FAIL ({error:?})");
            return 1;
        }
    };
    let dek = match Dek::generate() {
        Ok(dek) => dek,
        Err(_) => {
            println!("random_generation: FAIL");
            return 1;
        }
    };
    let result = (|| {
        store.store(&dek)?;
        println!("write: PASS");
        match store.load()? {
            DekLookup::Present(loaded) if loaded.expose() == dek.expose() => {
                println!("read: PASS");
                println!("comparison: PASS");
            }
            _ => return Err(crate::security::DekStoreError::Corrupt),
        }
        store.delete()?;
        println!("delete: PASS");
        if matches!(store.load()?, DekLookup::Absent) {
            println!("verify_absent: PASS");
            Ok(())
        } else {
            Err(crate::security::DekStoreError::Corrupt)
        }
    })();
    let cleanup = store.delete();
    println!("cleanup: {}", if cleanup.is_ok() { "PASS" } else { "FAIL" });
    match result {
        Ok(()) if cleanup.is_ok() => {
            println!("result: PASS");
            0
        }
        Ok(()) | Err(_) => {
            println!("result: FAIL");
            1
        }
    }
}

fn run_id() -> Result<String, ()> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| ())?;
    let mut id = String::with_capacity(32);
    for byte in bytes {
        write!(id, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(id)
}

#[cfg(target_os = "linux")]
fn diagnostic_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| "unavailable".to_owned())
}

#[cfg(target_os = "linux")]
fn available(value: bool) -> &'static str {
    if value { "available" } else { "unavailable" }
}

#[cfg(target_os = "linux")]
fn provider_name(output: Option<&std::process::Output>) -> &'static str {
    let Some(output) = output else {
        return "unavailable";
    };
    let text = String::from_utf8_lossy(&output.stdout);
    if text.contains("gnome-keyring-daemon") {
        "GNOME Keyring (best effort)"
    } else if text.contains("kwallet") {
        "KWallet Secret Service compatibility (best effort)"
    } else if output.status.success() {
        "Secret Service provider available (unidentified)"
    } else {
        "unavailable"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_doctor_identity_never_uses_application_namespaces() {
        let identity = CredentialIdentity::isolated_test(
            &run_id().expect("OS random source is available"),
            SMOKE_USER,
        );
        assert!(
            identity
                .service
                .starts_with("com.editorialhuellas.correoboxplot.test.")
        );
        assert!(identity.service.ends_with(".local-cache"));
        assert_ne!(
            identity.service,
            "com.editorialhuellas.correoboxplot.local-cache"
        );
        assert_ne!(
            identity.service,
            "com.editorialhuellas.correoboxplot.dev.local-cache"
        );
        assert_eq!(identity.user, SMOKE_USER);
    }
}
