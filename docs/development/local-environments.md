# Local development environments

## Application flavors

Production and Development are separate logical Tauri applications:

| Concern | Production | Development |
| --- | --- | --- |
| Product name | Correo Boxplot | Correo Boxplot Dev |
| Identifier | `com.editorialhuellas.correoboxplot` | `com.editorialhuellas.correoboxplot.dev` |
| Credential service | `com.editorialhuellas.correoboxplot.local-cache` | `com.editorialhuellas.correoboxplot.dev.local-cache` |
| Credential account | `sqlcipher-dek-v1` | `sqlcipher-dek-v1` |
| Local data | Tauri-derived Production root | Tauri-derived Development root |

The canonical developer command is `pnpm dev`. Its package script always applies `src-tauri/tauri.dev.conf.json`, which is a two-field RFC-7396 overlay. Raw `tauri dev` without that overlay is unsupported and intentionally fails closed. Production cache access additionally requires a non-debug release build.

No environment variable, frontend flag or IPC input selects the flavor. Unknown identifiers are rejected. Development and Production may run side by side because their DB, WAL, SHM, journal, lock and lifecycle markers are independent.

## Native environment doctor

The doctor is a feature-gated Rust binary and is absent from Application IPC:

```text
cargo run --locked --manifest-path src-tauri/Cargo.toml \
  --features local-env-doctor --bin local-env-doctor -- check

cargo run --locked --manifest-path src-tauri/Cargo.toml \
  --features local-env-doctor --bin local-env-doctor -- smoke
```

`check` is read-only and reports the OS, expected Development identity, session diagnostics and native-store availability without displaying secrets. `smoke` clearly declares mutation and uses a random test-only service to write, read, compare, delete and verify absence of a random DEK. Cleanup is always attempted.

## Linux

Linux consumes the Freedesktop Secret Service. It does not require a specific desktop product and contains no GNOME/KDE/Hyprland storage branches. New values use the UTF-8-safe `cbx-dek-v1:<64 lowercase hex>` envelope; legacy raw 32-byte values remain readable. Missing D-Bus, provider or usable default collection maps to `SecureStoreUnavailable`; there is no fallback.

On Arch, diagnose before changing the host. Check `XDG_CURRENT_DESKTOP`, `XDG_SESSION_TYPE`, `DBUS_SESSION_BUS_ADDRESS`, `org.freedesktop.secrets`, installed providers and user services. If Secret Service already works, use it. For GNOME prefer the existing GNOME Keyring session; for Plasma prefer its existing KWallet compatibility; for minimal sessions configure one compatible user provider manually. The application never runs `sudo`, installs packages, edits PAM or starts privileged services.

The current Arch GNOME/Wayland host has a user D-Bus and GNOME Keyring providing `org.freedesktop.secrets`; CHECK and real native SMOKE pass. No one-time host change was needed.

Development and release builds use the same repository-pinned SQLCipher `4.17.0 community` / SQLite `3.53.3` engine and vendored OpenSSL. The deterministic Development package command is `pnpm native:package:dev:linux`; the current Linux artifact is a DEB. Package acceptance runs its embedded doctor, then launches the embedded application with `--local-env-acceptance=seed` and in a new process with `--local-env-acceptance=verify`. These internal acceptance arguments are feature-gated and are not IPC commands.

## Windows

Windows uses Windows Credential Manager. Entries have explicit target `<credential-service>/sqlcipher-dek-v1`, native binary 32-byte content and `Local` (`CRED_PERSIST_LOCAL_MACHINE`) persistence. Development and Production targets differ. An existing Session or Enterprise entry is migrated by preserving the same DEK, rewriting it as Local and verifying the attribute; migration failure stops bootstrap. On an actual x86_64 Windows/MSVC host, use locked dependencies, `pnpm native:doctor`, `pnpm native:doctor:smoke` and `pnpm native:package:dev:windows`, then run the Development seed/reopen flow and inspect the NSIS package for external SQLite/SQLCipher/OpenSSL DLLs. Windows runtime and installer acceptance remain pending; Linux cross-checks do not certify them.

## Test identity policy

Tests and doctor smokes use `com.editorialhuellas.correoboxplot.test.<RUN_ID>.local-cache`, an isolated account label and temporary filesystem state. They never inspect or mutate Development/Production credentials. Test identity creation is compiled only for unit tests or the doctor feature and is not an application flavor.
