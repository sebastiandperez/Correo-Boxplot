#!/usr/bin/env bash
set -euo pipefail

repository_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_dir="${BOXPLOT_MAIL_SERVER_DIR:-$(cd "$repository_dir/.." && pwd)/Servidor-Boxplot}"

if [[ ! -x "$server_dir/.venv/bin/python" ]]; then
  echo "Servidor-Boxplot virtualenv is missing: $server_dir/.venv/bin/python" >&2
  exit 1
fi

BOXPLOT_MAIL_SERVER_DIR="$server_dir" \
  cargo test --locked --manifest-path "$repository_dir/src-tauri/Cargo.toml" \
  --test native_mail_real -- --ignored --nocapture
