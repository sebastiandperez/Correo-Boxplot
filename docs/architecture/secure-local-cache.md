# Secure local cache bootstrap

## Status

SECURE-BOOTSTRAP-01 is implemented for the Tauri MVP. The production Local Engine obtains one installation-scoped SQLCipher DEK from the native operating-system credential store entirely inside Rust. Domain, Ports and the 25-command IPC contract do not expose this lifecycle. SQLCIPHER-PACKAGING-01 pins the native engine to SQLCipher `4.17.0 community` / SQLite `3.53.3` through the repository-local `libsqlite3-sys 0.38.2` patch and vendored OpenSSL; bootstrap fails closed on any runtime-version mismatch.

LOCAL-SECURE-STORE-01 separates Production and Development as distinct Tauri application flavors. The Tauri `identifier` is the sole cache-flavor selector; environment variables, CLI inputs and frontend state cannot select a cache identity. The canonical identities are:

| Flavor | Product | Tauri identifier | Credential service |
| --- | --- | --- | --- |
| Production | Correo Boxplot | `com.editorialhuellas.correoboxplot` | `com.editorialhuellas.correoboxplot.local-cache` |
| Development | Correo Boxplot Dev | `com.editorialhuellas.correoboxplot.dev` | `com.editorialhuellas.correoboxplot.dev.local-cache` |

Both use credential account `sqlcipher-dek-v1`. Their Tauri-derived `appLocalDataDir` values, databases, sidecars, locks and markers are disjoint. Automated and doctor-smoke credentials instead use a random `com.editorialhuellas.correoboxplot.test.<RUN_ID>.local-cache` service and never reuse either application namespace.

Raw development execution with the Production identifier fails before credential-store initialization or cache filesystem side effects. A debug build also cannot open Production state. Unknown identifiers fail closed; a Development identifier remains Development in both dev and packaged builds.

The tested Linux build uses `keyring-core` with `zbus-secret-service-keyring-store` and its Rust cryptography backend. New Linux credentials store the canonical DEK as `cbx-dek-v1:` plus exactly 64 lowercase hexadecimal characters so specification-compatible providers can preserve it as UTF-8. The decoded SQLCipher key remains the original 32 random bytes; the envelope is not a password. Exactly 32 raw bytes remain readable as `LegacyLinuxRawV0`, without mandatory rewrite.

Windows selects Windows Credential Manager through `windows-native-keyring-store`. Every entry uses an explicit collision-safe target `<service>/sqlcipher-dek-v1` and `Local` persistence. An existing Session/Enterprise credential is rewritten with the same DEK and verified as Local before bootstrap continues; failure is fail-closed. macOS retains the standard Keychain Services backend through `apple-native-keyring-store`'s `keychain` feature. There is no Stronghold, file, environment-variable, browser-storage or plaintext fallback.

## Architecture and credential identity

```text
OS native credential store
        ↓ binary secret
OsDekStore
        ↓
Dek(Zeroizing<[u8; 32]>)
        ↓
crash-safe bootstrap + Local Engine lifecycle
        ↓
PersistentLocalEngine
        ↓
SQLite + SQLCipher
```

Exactly one credential identifies the local-cache DEK:

| Field | Stable value |
| --- | --- |
| Service | `com.editorialhuellas.correoboxplot.local-cache` |
| User/account label | `sqlcipher-dek-v1` |

This identity is application/installation scoped. It does not contain an email address, `AccountKey`, JMAP identity, username, token or database path. Changing either constant requires an explicit credential migration.

## Secret boundary and memory handling

The DEK is exactly 32 bytes and is generated directly in a zeroizing Rust buffer using the OS random source through `getrandom`. The credential uses the binary `set_secret`/`get_secret` path. A retrieved buffer must have exactly 32 bytes; other lengths fail closed and are zeroized rather than padded, truncated, hashed or replaced.

The DEK never appears in TypeScript, IPC DTOs, commands, results, events, logs, configuration or a filesystem secret file. SQLCipher's raw-key pragma is built in a short-lived zeroizing string. The single keyed opener verifies exact SQLCipher/SQLite runtime identity and performs a real schema read before migrations. There is no system-SQLCipher, ordinary-SQLite or plaintext fallback.

`zeroize` protects application-owned Rust buffers against compiler-elided clearing. It does not erase copies held internally by SQLCipher, native libraries or the OS, and it does not protect against debugger/process-memory inspection. No `mlock`, `VirtualLock` or hardware-backed-key guarantee is claimed.

## Local files and process coordination

Rust resolves the cache root with Tauri's `app_local_data_dir()`. The exact lifecycle artifacts are:

* `mail-cache.sqlite3`;
* `mail-cache.sqlite3-wal`;
* `mail-cache.sqlite3-shm`;
* `mail-cache.sqlite3-journal`;
* `bootstrap-create-v1.marker`;
* `cache-reset-v1.marker`;
* `local-cache-v1.lock`.

Before touching the credential, database or lifecycle markers, startup takes a non-blocking exclusive filesystem lock and retains its file handle for the process lifetime. A second process receives internal `LocalCacheAlreadyInUse` and the Local Engine remains unavailable. The lock coordinates cooperating application processes; it is not a security boundary against malicious software.

## Normal bootstrap matrix

Without a lifecycle marker:

| Database artifacts | Credential result | Result |
| --- | --- | --- |
| absent | absent | Generate/store DEK, create and verify encrypted DB |
| absent | valid DEK | Reuse DEK, create and verify encrypted DB |
| present | valid DEK | Open and verify existing encrypted DB |
| present | `NoEntry` | `KeyLost`; preserve DB; no new key |
| any | store unavailable | `SecureStoreUnavailable`; preserve DB |
| any | corrupt store data | `SecureStoreCorrupt`; preserve DB |
| any | secret length other than 32 | `InvalidStoredDek`; preserve DB |
| present | valid but wrong DEK / unreadable DB | `DatabaseUnreadable`; preserve DB |
| main DB absent, orphan WAL/SHM/journal | any | `DatabaseUnreadable`; fail closed |

`NoEntry` is the only absence signal. A locked keychain, missing D-Bus session, provider failure or denied storage access is temporary unavailability, never inferred key loss. None of these cases triggers automatic reset.

## First-run crash recovery

The first-run ordering is:

```text
process lock
→ load or generate DEK
→ store DEK successfully
→ durably create bootstrap-create-v1.marker
→ create/migrate/verify SQLCipher DB
→ durably remove marker
→ install Ready engine
```

The DEK is stored before committed database state exists. If startup finds the create marker, the previous creation never became Ready: exact DB/WAL/SHM/journal artifacts are discarded, the existing valid credential is reused when present, and a fresh encrypted DB is created. If the store is unavailable, recovery stops with the marker retained. A crash after storing the DEK but before creating the DB reuses that DEK.

Markers contain no secret, are flushed with `sync_all`, and parent-directory metadata is synchronized where supported. This provides process-crash recovery under platform filesystem guarantees; it is not an unlimited claim about arbitrary hardware failure.

## Authorized destructive reset

Reset exists only as an internal Rust core for a separately authorized future UI flow. It has no IPC command in this phase and never runs automatically.

Under the exclusive lifecycle gate it:

1. durably creates `cache-reset-v1.marker`;
2. transitions to `Resetting`, waiting for active semantic leases to drain;
3. drops the old engine;
4. deletes only the known DB/WAL/SHM/journal artifacts;
5. deletes the old credential (`NoEntry` is idempotent success);
6. generates and stores a fresh 32-byte DEK;
7. creates and verifies a fresh encrypted DB;
8. removes the reset marker;
9. only then installs the new engine as `Ready`.

Any failure after marker creation leaves the cache unavailable. Startup seeing the marker resumes destructive reset and cannot return to the old cache. No engine becomes Ready while the marker exists. Reset destroys all local state, including unconfirmed `PendingMutation`. Routine, non-destructive DEK rotation and `PRAGMA rekey` remain outside the MVP.

## Lifecycle and IPC behavior

The Rust lifecycle distinguishes `Initializing`, `Ready`, `Resetting` and classified `Unavailable`. Semantic reads and writes obtain a shared lifecycle lease; reset obtains exclusive access. A successful P-02 lease remains held through transaction completion and initiation of `local-state-changed`, preventing deletion between commit and event emission.

Expected bootstrap failures keep the application process alive and retain an internal classification. Existing P-01/P-02 calls see only their frozen `unavailable` error. There is no bootstrap-status, DEK, path, secure-store or reset IPC command. Production inventory remains 15 reads plus 10 writes.

## Threat model

The native credential store, random DEK and SQLCipher primarily protect copied/stolen cache files, offline inspection of app data and file/backup exfiltration where the OS credential is absent.

They do not protect against malware running as the user while the credential store/application is available, process injection, debugger or memory inspection, root/admin/kernel compromise, malicious code already inside the application, screen capture, displayed content or future remote application vulnerabilities. No hardware-backed DEK claim is made.

## Platform acceptance still required

The implementation selects explicit native backends for Windows, macOS and Linux, but release acceptance requires runtime smoke tests on each supported platform:

* Windows Credential Manager;
* a signed macOS build using standard Keychain Services, including future sandbox/provisioning review;
* a Linux desktop with a usable user D-Bus session and Secret Service provider.

The current Arch Linux GNOME/Wayland developer session passed real Secret Service CHECK and isolated write/read/delete smoke through GNOME Keyring. The Development Tauri flavor and its generated DEB payload passed exact SQLCipher `4.17.0 community` / SQLite `3.53.3` diagnostics, encrypted bootstrap, restart and semantic-state persistence against the real app-local database and credential; the DB header is not plaintext SQLite. Production fails closed when no provider is usable and never installs or configures one. Windows runtime, installer, dependency and Credential Manager acceptance remain pending on an actual Windows x86_64 MSVC host.
