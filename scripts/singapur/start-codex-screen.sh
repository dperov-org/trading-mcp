#!/usr/bin/env bash
set -euo pipefail

repo_root="${SINGAPUR_REPO_ROOT:-/root/projects/trading-mcp}"
screen_name="${SINGAPUR_CODEX_SCREEN:-codex-app}"
codex_port="${CODEX_APP_SERVER_PORT:-8790}"
bybit_port="${BYBIT_MCP_HTTP_PORT:-8791}"
mexc_port="${MEXC_MCP_HTTP_PORT:-8792}"

bybit_mcp_url="${CODEX_BYBIT_MCP_URL:-http://127.0.0.1:$bybit_port/mcp/bybit}"
mexc_mcp_url="${CODEX_MEXC_MCP_URL:-http://127.0.0.1:$mexc_port/mcp/mexc}"

screen -S "$screen_name" -X quit >/dev/null 2>&1 || true

screen -dmS "$screen_name" bash -lc "
  set -euo pipefail
  cd '$repo_root'
  export CODEX_MCP_MODE=external
  export CODEX_BYBIT_MCP_URL='$bybit_mcp_url'
  export CODEX_MEXC_MCP_URL='$mexc_mcp_url'
  export CODEX_APP_SERVER_LISTEN_URL='ws://127.0.0.1:$codex_port'
  exec npm run codex:app-server:linux
"

echo "started screen $screen_name for codex app-server"
echo "codex ws: ws://127.0.0.1:$codex_port"
echo "bybit mcp: $bybit_mcp_url"
echo "mexc mcp:  $mexc_mcp_url"
