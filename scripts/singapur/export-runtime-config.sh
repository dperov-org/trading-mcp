#!/usr/bin/env bash
set -euo pipefail

# Exports non-secret operational facts for the next singapur health check.
# Never copy .env, process environments, API credentials, or private keys here.

repo_root="${SINGAPUR_REPO_ROOT:-/root/projects/trading-mcp}"
output_dir="${SINGAPUR_INVENTORY_DIR:-$repo_root/artifacts/singapur}"
generated_at="$(date -Is)"

mkdir -p "$output_dir"

{
  printf '%s\n' '# singapur runtime inventory'
  printf '\nGenerated: %s\n' "$generated_at"
  cat <<'EOF'

This directory is safe to inspect and share inside the project: it intentionally excludes .env values, API credentials, session secrets, private keys, and complete process environments.

- `system.txt`: OS, installed runtime versions, screen sessions, listeners, and project process tree.
- `tailscale-serve-status.json`: active Tailscale Serve/Funnel routing.
- `nginx-routing.txt`: public listener and routing directives only; no private key material.
- `project-runtime.env.example`: non-secret ports, modes, and log-rotation defaults used by the deployment scripts.
EOF
} >"$output_dir/README.md"

{
  printf 'generated_at=%s\n\n' "$generated_at"
  printf '== host ==\n'
  hostnamectl 2>/dev/null || hostname
  printf '\n== kernel ==\n'
  uname -a
  printf '\n== runtime versions ==\n'
  for command in node npm codex tailscale nginx screen; do
    if command -v "$command" >/dev/null 2>&1; then
      printf '%s: ' "$command"
      "$command" --version 2>&1 | head -n 1 || true
    fi
  done
  printf '\n== screens ==\n'
  screen -ls || true
  printf '\n== listeners ==\n'
  ss -ltnp | grep -E ':(443|8787|8790|8791|8792)([[:space:]]|$)' || true
  printf '\n== project process tree ==\n'
  ps -eo pid,ppid,lstart,args | grep -E 'trading-mcp|codex.*app-server|tailscale-publish' | grep -v grep || true
} >"$output_dir/system.txt"

tailscale serve status --json >"$output_dir/tailscale-serve-status.json" 2>&1 || true

nginx -T 2>/dev/null |
  grep -E '^[[:space:]]*(listen|server_name|root|proxy_pass|ssl_certificate[[:space:]])' \
  >"$output_dir/nginx-routing.txt" || true

cat >"$output_dir/project-runtime.env.example" <<'EOF'
# Non-secret singapur runtime settings. Store secrets only in .env or the host secret manager.
BYBIT_MCP_TRANSPORT=http
BYBIT_MCP_HTTP_HOST=127.0.0.1
BYBIT_MCP_HTTP_PORT=8791
BYBIT_MCP_HTTP_PATH=/mcp/bybit
MEXC_MCP_TRANSPORT=http
MEXC_MCP_HTTP_HOST=127.0.0.1
MEXC_MCP_HTTP_PORT=8792
MEXC_MCP_HTTP_PATH=/mcp/mexc
CODEX_MCP_MODE=external
CODEX_APP_SERVER_PORT=8790
WEB_UI_CODEX_MODE=external
WEB_UI_CODEX_APP_SERVER_URL=ws://127.0.0.1:8790
WEB_UI_PORT=8787
WEB_UI_LOG_MAX_BYTES=10485760
WEB_UI_LOG_RETENTION_DAYS=30
WEB_UI_LOG_MAX_FILES=100
EOF

printf 'Wrote runtime inventory to %s\n' "$output_dir"
