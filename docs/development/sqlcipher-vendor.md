# SQLCipher vendor maintenance

## Frozen packaging identity

Correo Boxplot links one repository-controlled native database engine:

```text
rusqlite 0.40.2
↓
patched libsqlite3-sys 0.38.2
↓
SQLCipher 4.17.0 / SQLite 3.53.3
↓
openssl-sys vendored / OpenSSL 3.6.3
↓
static native linkage
```

`src-tauri/Cargo.toml` selects `bundled-sqlcipher-vendored-openssl` and redirects `libsqlite3-sys` through `[patch.crates-io]`. Neither `SQLCIPHER_LIB_DIR`, `pkg-config`, a host SQLCipher package nor a host OpenSSL installation selects the database implementation.

The local build script fails closed if `LIBSQLITE3_SYS_USE_PKG_CONFIG` attempts to bypass bundled source or if `OPENSSL_NO_VENDOR` attempts to disable the selected vendored provider. Ordinary `OPENSSL_DIR`/SQLCipher discovery variables do not select the pinned path.

The authoritative source identities and hashes are recorded in `vendor/sqlcipher-provenance.md`. Run `scripts/check-sqlcipher-vendor.sh` after `cargo fetch --locked` to verify artifacts and ensure that the local crate has not accumulated unrelated differences from upstream `0.38.2`.

## Explicit upgrade procedure

1. Select a specific SQLCipher release and verify its official annotated tag and peeled commit.
2. Confirm the SQLite baseline from the official source and release notes.
3. Generate the SQLCipher amalgamation from that exact checkout; never download `latest` during a Cargo build.
4. Replace only the vendored SQLCipher amalgamation, headers and license.
5. Regenerate the bundled Rust bindings once from the new header and commit them.
6. Update SHA-256 hashes and provenance.
7. Update the exact expected runtime constants and tests.
8. Run the isolated native create/encrypt/reopen/wrong-key checks, compatibility fixture, full Rust/TypeScript matrix and production conformance.
9. Review `diff -qr` against the frozen upstream `libsqlite3-sys` release and reject unrelated fork drift.

Normal application and end-user builds use pregenerated bindings and vendored source; they do not require bindgen or a SQLCipher download.

## Runtime and compatibility gates

The canonical keyed opener rejects any runtime other than exactly `4.17.0 community` with SQLite `3.53.3`. The local doctor reports expected and actual versions without exposing key material.

`src-tauri/tests/fixtures/sqlcipher-4.14.0.db` is a real SQLCipher 4.14.0/SQLite 3.51.3 encrypted PERSIST-01 fixture using the documented non-secret test key `[0x2a; 32]`. Its regression test copies the immutable fixture, opens it with 4.17.0, reads and writes semantic state, and reopens with the same key. It performs no reset, export or rekey.

## Platform commands

Linux x86_64:

- `cargo build --manifest-path src-tauri/Cargo.toml --locked --offline`
- `pnpm native:doctor`
- `pnpm test:production-conformance`
- `pnpm native:package:dev:linux`

The verified Linux package is the generated Development DEB. Its extracted payload passed exact runtime diagnostics, real Secret Service smoke, semantic seed/reopen and encrypted-header inspection. AppImage was also attempted: the release binary compiled, but Tauri's downloaded linuxdeploy tooling cannot package this Arch host's current RELR libraries and gdk-pixbuf 2.44 built-in-loader layout. That tooling issue does not alter the verified DEB or native SQLCipher linkage.

Windows x86_64 MSVC requires the Rust MSVC target and Visual Studio C++ build tools. On that host run the same locked checks, `pnpm native:doctor`, `pnpm native:doctor:smoke`, `pnpm native:package:dev:windows`, Development bootstrap/reopen acceptance and PE dependency inspection. Confirm `CRED_PERSIST_LOCAL_MACHINE`, absence of external `sqlcipher.dll`, `sqlite3.dll` and OpenSSL DLLs, encrypted DB header, restart persistence and untouched Production namespace. A Linux cross-check is not Windows certification.

## Upstream issue review

The optimized Linux x86_64 package build reproduced official SQLCipher issue `#600`: GCC emitted an `R_X86_64_TPOFF32` relocation that the shared-library link could not represent. The vendored amalgamation contains only the official source correction from commit `124c1fa07535fc95247717ecfc5f87486b668033`, which splits the TLS-address assignment. Runtime identity remains SQLCipher 4.17.0 / SQLite 3.53.3; no compiler/linker flag workaround or version downgrade is used.

The remaining open official reports reviewed for the target platforms did not require another Linux x86_64 or Windows x86_64/MSVC source workaround. Any future mitigation must be tied to a reproduced upstream issue and documented here—never implemented as a silent downgrade.

## Licensing and release review

The vendored tree retains the libsqlite3-sys and SQLCipher licenses. `vendor/licenses/` retains the resolved rusqlite and OpenSSL notices. Packaging/distribution must include applicable notices. Cryptographic/export review remains an explicit release activity outside application semantics.
