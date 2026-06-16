#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$repo_root/artifacts/mcp"

"$repo_root/scripts/start-bybit-mcp-http.sh" >"$repo_root/artifacts/mcp/bybit.log" 2>&1 &
bybit_pid=$!

"$repo_root/scripts/start-mexc-mcp-http.sh" >"$repo_root/artifacts/mcp/mexc.log" 2>&1 &
mexc_pid=$!

cleanup() {
  kill "$bybit_pid" "$mexc_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

wait -n "$bybit_pid" "$mexc_pid"
exit_code=$?
cleanup
exit "$exit_code"
