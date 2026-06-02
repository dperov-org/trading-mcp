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
  -c "mcp_servers.$server_name.command='$bash_path'"
  -c "mcp_servers.$server_name.args=['$wrapper_script']"
  -c "mcp_servers.$server_name.cwd='$repo_root'"
  -c "mcp_servers.$mexc_server_name.command='$bash_path'"
  -c "mcp_servers.$mexc_server_name.args=['$mexc_wrapper_script']"
  -c "mcp_servers.$mexc_server_name.cwd='$repo_root'"
)

has_bypass_flag=false
has_model_flag=false
for arg in "$@"; do
  if [[ "$arg" == "--dangerously-bypass-approvals-and-sandbox" ]]; then
    has_bypass_flag=true
  fi
  if [[ "$arg" == "-m" || "$arg" == "--model" ]]; then
    has_model_flag=true
  fi
done

if [[ "$has_bypass_flag" == false ]]; then
  launch_args+=(--dangerously-bypass-approvals-and-sandbox)
fi

if [[ "$has_model_flag" == false ]]; then
  launch_args+=(-m gpt-5.5)
fi

launch_args+=("$@")

cd "$repo_root"
exec codex "${launch_args[@]}"
