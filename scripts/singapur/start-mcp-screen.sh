#!/usr/bin/env bash
set -euo pipefail

repo_root="${SINGAPUR_REPO_ROOT:-/root/projects/trading-mcp}"
screen_name="${SINGAPUR_MCP_SCREEN:-trading-mcp}"

bybit_port="${BYBIT_MCP_HTTP_PORT:-8791}"
mexc_port="${MEXC_MCP_HTTP_PORT:-8792}"

screen -S "$screen_name" -X quit >/dev/null 2>&1 || true

screen -dmS "$screen_name" bash -lc "
  set -euo pipefail
  cd '$repo_root'
  export BYBIT_MCP_TRANSPORT=http
  export BYBIT_MCP_HTTP_HOST=127.0.0.1
  export BYBIT_MCP_HTTP_PORT='$bybit_port'
  export BYBIT_MCP_HTTP_PATH=/mcp/bybit
  export MEXC_MCP_TRANSPORT=http
  export MEXC_MCP_HTTP_HOST=127.0.0.1
  export MEXC_MCP_HTTP_PORT='$mexc_port'
  export MEXC_MCP_HTTP_PATH=/mcp/mexc
  exec npm run mcp:all:http
"

echo "started screen $screen_name for MCP services"
echo "bybit: http://127.0.0.1:$bybit_port/mcp/bybit"
echo "mexc:  http://127.0.0.1:$mexc_port/mcp/mexc"
