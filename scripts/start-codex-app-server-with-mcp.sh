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

launch_args=(
  -C "$repo_root"
  app-server
  --listen stdio://
  -c "mcp_servers.$server_name.command='$bash_path'"
  -c "mcp_servers.$server_name.args=['$wrapper_script']"
  -c "mcp_servers.$server_name.cwd='$repo_root'"
  -c "mcp_servers.$mexc_server_name.command='$bash_path'"
  -c "mcp_servers.$mexc_server_name.args=['$mexc_wrapper_script']"
  -c "mcp_servers.$mexc_server_name.cwd='$repo_root'"
)

launch_args+=("$@")

cd "$repo_root"
exec codex "${launch_args[@]}"
