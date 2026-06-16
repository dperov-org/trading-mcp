#!/usr/bin/env bash
set -euo pipefail

bybit_port="${BYBIT_MCP_HTTP_PORT:-8791}"
mexc_port="${MEXC_MCP_HTTP_PORT:-8792}"
codex_port="${CODEX_APP_SERVER_PORT:-8790}"
bybit_service="${SINGAPUR_BYBIT_MCP_SERVICE:-mcpbybit}"
mexc_service="${SINGAPUR_MEXC_MCP_SERVICE:-mcpmexc}"
codex_service="${SINGAPUR_CODEX_SERVICE:-codexapp}"

tailscale serve --service "$bybit_service" --bg "$bybit_port"
tailscale serve --service "$mexc_service" --bg "$mexc_port"
tailscale serve --service "$codex_service" --bg "$codex_port"

echo "published tailnet-only services:"
echo "  service $bybit_service -> 127.0.0.1:$bybit_port"
echo "  service $mexc_service  -> 127.0.0.1:$mexc_port"
echo "  service $codex_service -> 127.0.0.1:$codex_port"
