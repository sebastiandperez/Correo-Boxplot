# SQLCipher vendor provenance

## Frozen identities

- `libsqlite3-sys`: upstream crates.io package `0.38.2`
- Upstream crate archive SHA-256: `f1d20bef17f513b9b3004532233187769cd072d790971f4e4da0e346eb6401e8`
- SQLCipher repository: `https://github.com/sqlcipher/sqlcipher`
- SQLCipher tag: `v4.17.0`
- Annotated tag object: `f9788efa8ac4dfed75c03e4756b1666a1d0845da`
- Peeled commit: `810db22f575ee7cf94ea96a3e91622b5fcece3dc`
- SQLite baseline: `3.53.3`
- Generated SQLite source ID: `2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d78alt1`
- Linux optimized-build backport: official SQLCipher commit `124c1fa07535fc95247717ecfc5f87486b668033` (`Fix relocation truncated to fit error for optimized GCC builds`, issue `#600`)
- Original generated `sqlite3.c` SHA-256 before the backport: `8adaff6b464052a74e7adaa3cfa2725400f48eca68f47856fa806eaf30bdf2c9`
- Bindgen: `0.72.1`, generated once and committed

## Acquisition and generation

The tag and peeled commit were verified with `git ls-remote` against the official repository. A detached shallow checkout of the exact tag was configured with SQLCipher codec support and the required temporary-store policy. The amalgamation was generated with the official build system using `make sqlite3.c`; no third-party amalgamation was used.

The generated `sqlite3.c`, `sqlite3.h`, `sqlite3ext.h`, SQLCipher license and pregenerated Rust bindings replace only the corresponding `sqlcipher/` artifacts from upstream `libsqlite3-sys 0.38.2`. Normal builds do not execute bindgen and do not download SQLCipher source.

Artifact hashes are frozen in `vendor/sqlcipher-artifacts.sha256` and checked by `scripts/check-sqlcipher-vendor.sh`.

## Intentional patch delta

1. `Cargo.toml` contains Correo Boxplot provenance metadata only.
2. `build.rs` rejects the upstream environment overrides that would force pkg-config linkage or disable vendored OpenSSL while the pinned bundled feature is active. It otherwise remains upstream.
3. `sqlcipher/sqlite3.c` is the official SQLCipher `v4.17.0` amalgamation with the three-line source fix from official post-release commit `124c1fa07535fc95247717ecfc5f87486b668033`. This narrowly backports issue `#600` without changing the runtime version.
4. `sqlcipher/sqlite3.h` and `sqlcipher/sqlite3ext.h` match that amalgamation.
5. `sqlcipher/bindgen_bundled_version.rs` was regenerated from the 3.53.3 header.
6. `sqlcipher/LICENSE` is the license distributed by the frozen SQLCipher tag.

All other vendored crate files are byte-for-byte upstream `libsqlite3-sys 0.38.2`. Registry-only metadata files and the crate-local lockfile are intentionally not vendored.

## Licenses

- `vendor/libsqlite3-sys-0.38.2-sqlcipher-4.17/LICENSE`: upstream crate MIT license.
- `vendor/libsqlite3-sys-0.38.2-sqlcipher-4.17/sqlcipher/LICENSE`: SQLCipher Community Edition BSD-style license.
- `vendor/licenses/`: rusqlite and OpenSSL source/license notices resolved by the frozen Cargo graph.

The release incorporates cryptographic software through SQLCipher and OpenSSL. Distribution/export review remains a release responsibility; no legal conclusion is encoded in the application.
