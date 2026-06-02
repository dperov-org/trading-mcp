#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "$repo_root/scripts/load-project-env.sh"
load_project_env "$repo_root"

cd "$repo_root"
exec node --import tsx/esm src/mexc.ts
