#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
patch_dir="${repository_root}/vendor/libsqlite3-sys-0.38.2-sqlcipher-4.17"
registry_root="${CARGO_HOME:-${HOME}/.cargo}/registry/src"
upstream_dir="${1:-}"

if [[ -z "${upstream_dir}" ]]; then
  upstream_dir="$(find "${registry_root}" -mindepth 2 -maxdepth 2 -type d -name libsqlite3-sys-0.38.2 -print -quit)"
fi
if [[ -z "${upstream_dir}" || ! -d "${upstream_dir}" ]]; then
  echo "libsqlite3-sys 0.38.2 upstream source is unavailable; run cargo fetch --locked" >&2
  exit 1
fi

cd "${repository_root}"
sha256sum --check vendor/sqlcipher-artifacts.sha256

unexpected=0
while IFS= read -r difference; do
  case "${difference}" in
    *": .cargo-ok" | *": .cargo_vcs_info.json" | *": .gitignore" | *": Cargo.lock") ;;
    *"/Cargo.toml and "*"/Cargo.toml differ") ;;
    *"/build.rs and "*"/build.rs differ") ;;
    *"/sqlcipher/LICENSE and "*"/sqlcipher/LICENSE differ") ;;
    *"/sqlcipher/bindgen_bundled_version.rs and "*"/sqlcipher/bindgen_bundled_version.rs differ") ;;
    *"/sqlcipher/sqlite3.c and "*"/sqlcipher/sqlite3.c differ") ;;
    *"/sqlcipher/sqlite3.h and "*"/sqlcipher/sqlite3.h differ") ;;
    *"/sqlcipher/sqlite3ext.h and "*"/sqlcipher/sqlite3ext.h differ") ;;
    "") ;;
    *)
      echo "unexpected vendor drift: ${difference}" >&2
      unexpected=1
      ;;
  esac
done < <(diff -qr "${upstream_dir}" "${patch_dir}" || true)

if [[ "${unexpected}" -ne 0 ]]; then
  exit 1
fi
echo "SQLCIPHER_VENDOR_PATCH: PASS"
