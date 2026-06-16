#!/usr/bin/env bash
set -euo pipefail

bybit_port="${BYBIT_MCP_HTTP_PORT:-8791}"
mexc_port="${MEXC_MCP_HTTP_PORT:-8792}"
codex_port="${CODEX_APP_SERVER_PORT:-8790}"

tailscale serve --bg --http "$bybit_port" "$bybit_port"
tailscale serve --bg --http "$mexc_port" "$mexc_port"
tailscale serve --bg --http "$codex_port" "$codex_port"

echo "published tailnet-only services:"
echo "  http://singapur.tail3e0cf.ts.net:$bybit_port -> 127.0.0.1:$bybit_port"
echo "  http://singapur.tail3e0cf.ts.net:$mexc_port  -> 127.0.0.1:$mexc_port"
echo "  http://singapur.tail3e0cf.ts.net:$codex_port -> 127.0.0.1:$codex_port"
