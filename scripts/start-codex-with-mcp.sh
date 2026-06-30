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
remote_url="${CODEX_TUI_REMOTE_URL:-${CODEX_APP_SERVER_URL:-${WEB_UI_CODEX_APP_SERVER_URL:-}}}"
remote_cwd="${CODEX_TUI_REMOTE_CWD:-/root/projects/trading-mcp}"

launch_args=()

if [[ -n "$remote_url" ]]; then
  launch_args+=(--remote "$remote_url")
  launch_args+=(-C "$remote_cwd")
elif [[ "$mcp_mode" == "external" ]]; then
  launch_args+=(-C "$repo_root")
  bybit_mcp_url="${CODEX_BYBIT_MCP_URL:?CODEX_BYBIT_MCP_URL is required when CODEX_MCP_MODE=external}"
  mexc_mcp_url="${CODEX_MEXC_MCP_URL:?CODEX_MEXC_MCP_URL is required when CODEX_MCP_MODE=external}"
  launch_args+=(
    -c "mcp_servers.$server_name.url='$bybit_mcp_url'"
    -c "mcp_servers.$mexc_server_name.url='$mexc_mcp_url'"
  )
else
  launch_args+=(-C "$repo_root")
  launch_args+=(
    -c "mcp_servers.$server_name.command='$bash_path'"
    -c "mcp_servers.$server_name.args=['$wrapper_script']"
    -c "mcp_servers.$server_name.cwd='$repo_root'"
    -c "mcp_servers.$mexc_server_name.command='$bash_path'"
    -c "mcp_servers.$mexc_server_name.args=['$mexc_wrapper_script']"
    -c "mcp_servers.$mexc_server_name.cwd='$repo_root'"
  )
fi

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
