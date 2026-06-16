#!/usr/bin/env bash
set -euo pipefail

for screen_name in \
  "${SINGAPUR_MCP_SCREEN:-trading-mcp}" \
  "${SINGAPUR_CODEX_SCREEN:-codex-app}" \
  "${SINGAPUR_WEBUI_SCREEN:-webui}"; do
  screen -S "$screen_name" -X quit >/dev/null 2>&1 || true
  echo "stopped screen $screen_name if it existed"
done
