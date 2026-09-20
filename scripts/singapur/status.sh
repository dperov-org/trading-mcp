#!/usr/bin/env bash
set -euo pipefail

bybit_port="${BYBIT_MCP_HTTP_PORT:-8791}"
mexc_port="${MEXC_MCP_HTTP_PORT:-8792}"

echo "== screen =="
screen -ls || true

echo
echo "== local health =="
for endpoint in \
  "bybit-mcp http://127.0.0.1:$bybit_port/healthz" \
  "mexc-mcp http://127.0.0.1:$mexc_port/healthz"; do
  name="${endpoint%% *}"
  url="${endpoint#* }"
  if curl -fsS --max-time 3 "$url" >/tmp/singapur-status-body 2>/tmp/singapur-status-error; then
    echo "$name ok"
  else
    echo "$name failed: $(cat /tmp/singapur-status-error)"
  fi
done

echo
echo "== Codex remote access =="
echo "ChatGPT Work reaches the host-managed Codex runtime over SSH."
echo "Web UI (:8787) and the project codex app-server (:8790) are intentionally unmanaged."
ps -eo pid=,ppid=,args= | grep -E '[c]odex (app-server --remote-control|app-server daemon)' || true

echo
echo "== tailscale serve =="
tailscale serve status --json || true

echo
echo "== tailscale funnel =="
tailscale funnel status --json || true
