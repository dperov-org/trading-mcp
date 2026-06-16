#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "$repo_root/scripts/load-project-env.sh"
load_project_env "$repo_root"

export MEXC_MCP_TRANSPORT="${MEXC_MCP_TRANSPORT:-http}"
export MEXC_MCP_HTTP_HOST="${MEXC_MCP_HTTP_HOST:-127.0.0.1}"
export MEXC_MCP_HTTP_PORT="${MEXC_MCP_HTTP_PORT:-8792}"
export MEXC_MCP_HTTP_PATH="${MEXC_MCP_HTTP_PATH:-/mcp/mexc}"

cd "$repo_root"
exec node --env-file=.env --import tsx/esm src/mexc.ts
