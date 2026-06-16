#!/usr/bin/env bash
set -euo pipefail

bybit_port="${BYBIT_MCP_HTTP_PORT:-8791}"
mexc_port="${MEXC_MCP_HTTP_PORT:-8792}"
codex_port="${CODEX_APP_SERVER_PORT:-8790}"
webui_port="${WEB_UI_PORT:-8787}"

echo "== screen =="
screen -ls || true

echo
echo "== local health =="
for endpoint in \
  "bybit-mcp http://127.0.0.1:$bybit_port/healthz" \
  "mexc-mcp http://127.0.0.1:$mexc_port/healthz" \
  "codex-ready http://127.0.0.1:$codex_port/readyz" \
  "codex-health http://127.0.0.1:$codex_port/healthz" \
  "webui http://127.0.0.1:$webui_port/healthz"; do
  name="${endpoint%% *}"
  url="${endpoint#* }"
  if curl -fsS --max-time 3 "$url" >/tmp/singapur-status-body 2>/tmp/singapur-status-error; then
    echo "$name ok"
  else
    echo "$name failed: $(cat /tmp/singapur-status-error)"
  fi
done

echo
echo "== tailscale serve =="
tailscale serve status --json || true

echo
echo "== tailscale funnel =="
tailscale funnel status --json || true
