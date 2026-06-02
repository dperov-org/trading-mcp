#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_name="${SERVER_NAME:-trading_mcp_bybit_local}"
wrapper_script="$repo_root/scripts/run-trading-mcp-for-codex.sh"
bash_path="$(command -v bash)"
artifacts_dir="$repo_root/artifacts/codex"
output_path="$artifacts_dir/codex-mcp-smoke-last-message.txt"

source "$repo_root/scripts/load-project-env.sh"
load_project_env "$repo_root"

mkdir -p "$artifacts_dir"

prompt="$(cat <<'EOF'
Use the MCP server named trading_mcp_bybit_local if it is available.
Call only the MCP tool getWalletBalance with arguments {"accountType":"UNIFIED"}.
Summarize the result in a short answer.
If the MCP server is unavailable, reply with exactly MCP_UNAVAILABLE.
If the tool call fails, reply with the exact tool error text.
EOF
)"

launch_args=(
  -c "mcp_servers.$server_name.command='$bash_path'"
  -c "mcp_servers.$server_name.args=['$wrapper_script']"
  -c "mcp_servers.$server_name.cwd='$repo_root'"
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
  echo "Codex smoke test produced an empty final message." >&2
  exit 1
fi

if [[ "$message" == "MCP_UNAVAILABLE" ]]; then
  echo "Codex smoke test could not access the configured MCP server." >&2
  exit 1
fi

echo "Codex MCP smoke output:"
echo "$message"
