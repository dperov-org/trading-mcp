#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "$repo_root/scripts/load-project-env.sh"
load_project_env "$repo_root"

if [[ -z "${BYBIT_API_KEY:-}" && -n "${BYBIT_RO_API_KEY:-}" ]]; then
  export BYBIT_API_KEY="$BYBIT_RO_API_KEY"
fi

if [[ -z "${BYBIT_API_SECRET:-}" && -n "${BYBIT_RO_API_SECRET:-}" ]]; then
  export BYBIT_API_SECRET="$BYBIT_RO_API_SECRET"
fi

cd "$repo_root"
exec node --import tsx/esm src/index.ts
