#!/usr/bin/env bash
set -euo pipefail

repo_root="${SINGAPUR_REPO_ROOT:-/root/projects/trading-mcp}"
screen_name="${SINGAPUR_WEBUI_SCREEN:-webui}"
webui_port="${WEB_UI_PORT:-8787}"
codex_port="${CODEX_APP_SERVER_PORT:-8790}"
codex_ws_url="${WEB_UI_CODEX_APP_SERVER_URL:-ws://127.0.0.1:$codex_port}"

screen -S "$screen_name" -X quit >/dev/null 2>&1 || true

screen -dmS "$screen_name" bash -lc "
  set -euo pipefail
  cd '$repo_root'
  export WEB_UI_PORT='$webui_port'
  export WEB_UI_CODEX_MODE=external
  export WEB_UI_CODEX_APP_SERVER_URL='$codex_ws_url'
  exec npm run webui:funnel
"

echo "started screen $screen_name for Web UI funnel"
echo "webui: http://127.0.0.1:$webui_port"
echo "codex ws: $codex_ws_url"
