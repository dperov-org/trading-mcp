#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "$repo_root/scripts/load-project-env.sh"
load_project_env "$repo_root"

export BYBIT_MCP_TRANSPORT="${BYBIT_MCP_TRANSPORT:-http}"
export BYBIT_MCP_HTTP_HOST="${BYBIT_MCP_HTTP_HOST:-127.0.0.1}"
export BYBIT_MCP_HTTP_PORT="${BYBIT_MCP_HTTP_PORT:-8791}"
export BYBIT_MCP_HTTP_PATH="${BYBIT_MCP_HTTP_PATH:-/mcp/bybit}"

cd "$repo_root"
exec node --env-file=.env --import tsx/esm src/index.ts
