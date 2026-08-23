# Windows native acceptance

WINDOWS-NATIVE-ACCEPTANCE-01 is **COMPLETE / PASS** as of 23 August 2026. This runbook records the real x86_64 Windows/MSVC acceptance; a cross-build from Linux is not equivalent.

## Certified environment

- Windows build `10.0.26200.8875`, x64.
- Visual Studio Community 2026 `18.0.0`, MSVC `19.50.35717`, Windows SDK `10.0.26100`.
- Rust `1.97.1`, host and target `x86_64-pc-windows-msvc`.
- Node `24.19.0`, Corepack `0.35.0`, pnpm `11.20.0`.
- Microsoft Edge WebView2 and EdgeDriver `151.0.4129.72`.
- `tauri-driver 2.0.6`, Strawberry Perl `5.42.2.1`, NASM `3.02`.

Use the x64 Developer PowerShell environment. If `tauri-winres` cannot discover the SDK resource compiler, set `RC` explicitly to the x64 `rc.exe` from the installed Windows SDK; do not substitute a GNU target.

Repository text is normalized to LF by `.gitattributes`, independently of a developer's global `core.autocrlf`. Vendored sources are excluded from text conversion so their frozen SHA-256 identities remain exact.

## Reproducible commands

```powershell
pnpm install --frozen-lockfile
bash scripts/check-sqlcipher-vendor.sh
pnpm native:doctor
pnpm native:doctor:smoke
pnpm check

cargo check --locked --manifest-path src-tauri/Cargo.toml --features conformance
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --features conformance -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml --features local-env-doctor

$env:TAURI_NATIVE_WEBDRIVER = 'C:\path\to\matching\msedgedriver.exe'
pnpm test:production-conformance
pnpm native:package:dev:windows
```

The NSIS acceptance must install `Correo Boxplot Dev_0.1.0_x64-setup.exe`, then execute the installed `correo-boxplot.exe --local-env-acceptance=seed`, wait for exit, and execute a new installed process with `--local-env-acceptance=verify`. Both arguments are acceptance-only Rust paths behind `local-env-doctor`; they are not IPC surface.

Inspect the release and installed executables with the x64 MSVC tools:

```powershell
dumpbin /HEADERS correo-boxplot.exe
dumpbin /DEPENDENTS correo-boxplot.exe
```

The image must be x64 and must not depend on `sqlcipher.dll`, `sqlite3.dll`, `libcrypto*.dll` or `libssl*.dll`.

## Recorded evidence

- Doctor CHECK: SQLCipher `4.17.0 community`; SQLite `3.53.3`; provider `openssl`; provider version `OpenSSL 3.6.3 9 Jun 2026`; Windows Credential Manager; required persistence `Local`; PASS.
- Doctor SMOKE: random test namespace write/read/compare, native persistence `Local`, delete and absence verification; PASS. No key bytes were printed.
- Development build and installed NSIS: bootstrap/seed PASS, process exit, reopen from a new process and persisted-state read PASS.
- Development database: `147456` bytes during acceptance; first 32 bytes were `d8 30 08 dd d0 fd c3 3b 0f 2b 33 08 99 f9 86 14 0d b7 5e e1 7f 82 6d 56 cb 19 88 90 79 fb 6f 83`, not `SQLite format 3`.
- Wrong key: rejected by native baseline and bootstrap tests.
- Production conformance: P-01 `45/45`, P-02 `91/91`, P-03 `23/23`, system `20/20`; total `179/179`; production command inventory `25`; smokes `5/5`.
- NSIS artifact: `src-tauri/target/release/bundle/nsis/Correo Boxplot Dev_0.1.0_x64-setup.exe`; `6,377,449` bytes; SHA-256 `6A6D08E207C6EC33C140DD34160733022F6F92EF6C583F15F4E9917C47964454`; build, silent install and installed execution PASS.
- PE: machine `8664 (x64)`; dependencies limited to Windows/UCRT DLLs; no external SQLite, SQLCipher or OpenSSL DLL.
- Full regression: Prettier, `vue-tsc`, ESLint (zero errors), Vitest `489/489`, rustfmt, baseline Clippy with warnings denied, baseline Cargo tests, plus conformance/local-doctor feature checks all PASS.
- The acceptance used only the Development application identifier and credential service. Test smokes used random isolated namespaces with cleanup; no Production bootstrap or credential mutation was invoked.

MSVC emits LNK4099 diagnostics for the absent `ossl_static.pdb` in the vendored OpenSSL archive. These warnings mean dependency debug symbols are unavailable; they do not change the successful static link or introduce a runtime crypto DLL.
