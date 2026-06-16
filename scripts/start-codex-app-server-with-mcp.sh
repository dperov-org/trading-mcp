#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_name="${SERVER_NAME:-trading_mcp_bybit_local}"
mexc_server_name="${MEXC_SERVER_NAME:-trading_mcp_mexc_local}"
wrapper_script="$repo_root/scripts/run-trading-mcp-for-codex.sh"
mexc_wrapper_script="$repo_root/scripts/run-mexc-mcp-for-codex.sh"
bash_path="$(command -v bash)"

source "$repo_root/scripts/load-project-env.sh"
load_project_env "$repo_root"

mcp_mode="${CODEX_MCP_MODE:-stdio}"
listen_url="${CODEX_APP_SERVER_LISTEN_URL:-stdio://}"

launch_args=(
  -C "$repo_root"
  app-server
  --listen "$listen_url"
)

if [[ "$mcp_mode" == "external" ]]; then
  bybit_mcp_url="${CODEX_BYBIT_MCP_URL:?CODEX_BYBIT_MCP_URL is required when CODEX_MCP_MODE=external}"
  mexc_mcp_url="${CODEX_MEXC_MCP_URL:?CODEX_MEXC_MCP_URL is required when CODEX_MCP_MODE=external}"
  launch_args+=(
    -c "mcp_servers.$server_name.url='$bybit_mcp_url'"
    -c "mcp_servers.$mexc_server_name.url='$mexc_mcp_url'"
  )
else
  launch_args+=(
    -c "mcp_servers.$server_name.command='$bash_path'"
    -c "mcp_servers.$server_name.args=['$wrapper_script']"
    -c "mcp_servers.$server_name.cwd='$repo_root'"
    -c "mcp_servers.$mexc_server_name.command='$bash_path'"
    -c "mcp_servers.$mexc_server_name.args=['$mexc_wrapper_script']"
    -c "mcp_servers.$mexc_server_name.cwd='$repo_root'"
  )
fi

launch_args+=("$@")

cd "$repo_root"
exec codex "${launch_args[@]}"
