#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_name="${SERVER_NAME:-trading_mcp_local}"
mexc_server_name="${MEXC_SERVER_NAME:-trading_mcp_mexc_local}"
wrapper_script="$repo_root/scripts/run-trading-mcp-for-codex.sh"
mexc_wrapper_script="$repo_root/scripts/run-mexc-mcp-for-codex.sh"
bash_path="$(command -v bash)"
artifacts_dir="$repo_root/artifacts/codex"
output_path="$artifacts_dir/codex-mcp-mexc-smoke-last-message.txt"

source "$repo_root/scripts/load-project-env.sh"
load_project_env "$repo_root"

mkdir -p "$artifacts_dir"

prompt="$(cat <<'EOF'
Use the MCP server named trading_mcp_mexc_local if it is available.
Tell me my current MEXC wallet balance summary in a short answer.
If the MCP server is unavailable, reply with exactly MCP_UNAVAILABLE.
EOF
)"

launch_args=(
  -c "mcp_servers.$server_name.command='$bash_path'"
  -c "mcp_servers.$server_name.args=['$wrapper_script']"
  -c "mcp_servers.$server_name.cwd='$repo_root'"
  -c "mcp_servers.$mexc_server_name.command='$bash_path'"
  -c "mcp_servers.$mexc_server_name.args=['$mexc_wrapper_script']"
  -c "mcp_servers.$mexc_server_name.cwd='$repo_root'"
  -m gpt-5.5
  exec
  --cd "$repo_root"
  --dangerously-bypass-approvals-and-sandbox
  --output-last-message "$output_path"
  --color never
  "$prompt"
)

cd "$repo_root"
codex "${launch_args[@]}" < /dev/null

message="$(tr -d '\r' < "$output_path" | sed -e 's/[[:space:]]*$//')"
if [[ -z "$message" ]]; then
  echo "Codex MEXC smoke test produced an empty final message." >&2
  exit 1
fi

if [[ "$message" == "MCP_UNAVAILABLE" ]]; then
  echo "Codex MEXC smoke test could not access the configured MCP server." >&2
  exit 1
fi

echo "Codex MEXC MCP smoke output:"
echo "$message"
