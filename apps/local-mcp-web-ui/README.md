# Local MCP Web UI

This app adds a ChatGPT-like web interface on top of the existing local Bybit MCP stack.

Architecture:

- frontend: official `ChatKit` web component
- backend: thin custom API server in Node.js
- agent runtime: local `codex app-server`
- tools:
  - `trading_mcp_bybit_local` for Bybit
  - `trading_mcp_mexc_local` for MEXC

Why this shape:

- `ChatKit` still needs an application backend in advanced integration mode
- `codex app-server` is treated as a local protocol/runtime process, not a browser-facing endpoint
- the only platform-specific layer is the launcher for `codex app-server`

Cross-platform support:

- Windows: `scripts/start-codex-app-server-with-mcp.ps1`
- Linux: `scripts/start-codex-app-server-with-mcp.sh`
- the Node.js backend and ChatKit frontend stay platform-neutral

## Commands

From the repository root:

```bash
npm run webui:http
npm run webui:start
npm run webui:serve
npm run webui:funnel
npm run webui:serve:status
npm run webui:funnel:status
npm run webui:serve:reset
npm run webui:funnel:reset
npm run webui:app-server:smoke
npm run webui:smoke
```

App-local equivalents:

```bash
cd apps/local-mcp-web-ui
npm run http
npm run start
npm run tailscale:serve
npm run tailscale:funnel
npm run tailscale:serve:status
npm run tailscale:funnel:status
npm run tailscale:serve:reset
npm run tailscale:funnel:reset
npm run smoke:app-server
npm run smoke
```

`webui:http` and `start` are equivalent. Both start the local HTTP server on `127.0.0.1:8787` by default.

## What the MVP does

- serves a ChatKit-based browser UI
- persists lightweight ChatKit thread history locally
- starts a local `codex app-server` child process through the dedicated launcher
- lets `codex app-server` use both project-local MCP servers:
  - Bybit
  - MEXC
- streams assistant output and basic tool progress into ChatKit
- supports two publication profiles on top of the same backend:
  - `tailscale serve` without app-auth for tailnet-only use
  - `tailscale funnel` with session auth inside the backend for public access
- denies shell command execution by default, so the agent must use MCP/tools instead of local `npm`/`bash` helper scripts unless explicitly re-enabled

## What the MVP intentionally does not do

- no tool allowlist or write restrictions
- no per-user roles or external IdP integration

## Data storage

Local UI thread data is stored in:

```text
apps/local-mcp-web-ui/.data/store.json
```

This is separate from Codex's own thread persistence. The web UI uses the local store for ChatKit history, while `codex app-server` remains the execution backend for each turn.

## Logs

The web UI now writes structured JSONL logs to:

```text
apps/local-mcp-web-ui/artifacts/logs/webui-latest.jsonl
apps/local-mcp-web-ui/artifacts/logs/webui-<session-id>.jsonl
```

These logs include:

- HTTP request start/close
- ChatKit request types and thread operations
- `codex app-server` spawn, initialize, stderr, and exit events
- JSON-RPC request/response timing
- turn start/completion, timeout, and partial assistant streaming progress
- approval decisions for shell/file execution requests from `codex app-server`

For debugging a hung browser session, start with `webui-latest.jsonl` and look for:

- `request_timeout`
- `completion_timeout`
- `app_server_exit_during_turn`
- `stream_handler_failed`
- repeated `stderr` or `warning` events

Console output is intentionally quieter by default:

- full detail always goes to JSONL log files
- console output defaults to `warn`

To raise the live console verbosity:

```bash
WEB_UI_CONSOLE_LOG_LEVEL=info npm run webui:http
WEB_UI_CONSOLE_LOG_LEVEL=debug npm run webui:http
```

## Auth and Publication Modes

### 1. Tailnet-only mode: `tailscale serve` without app-auth

This mode is intended for private access inside your tailnet only.

Command:

```bash
npm run webui:serve
```

Behavior:

- forces `WEB_UI_AUTH_MODE=none`
- starts the local HTTP backend on `127.0.0.1`
- publishes it through `tailscale serve --bg`

Status / reset:

```bash
npm run webui:serve:status
npm run webui:serve:reset
```

For machine-readable output you can call the underlying launcher directly:

```bash
node apps/local-mcp-web-ui/src/tailscale-publish.mjs serve --json
```

### 2. Public mode: `tailscale funnel` with backend session auth

This mode is intended for public HTTPS exposure through Tailscale Funnel.

Required env:

```text
WEB_UI_SESSION_PASSWORD=<shared password>
WEB_UI_CHATKIT_DOMAIN_KEY=domain_pk_xxx
```

The password can be exported in the shell or stored in the repo `.env`.

Command:

```bash
npm run webui:funnel
```

Behavior:

- forces `WEB_UI_AUTH_MODE=session`
- redirects unauthenticated browser requests to `/login`
- requires a password-based backend session before `/chatkit` requests are accepted
- passes the configured ChatKit domain public key to the browser UI
- publishes the localhost backend through `tailscale funnel --bg`

Status / reset:

```bash
npm run webui:funnel:status
npm run webui:funnel:reset
```

For machine-readable output you can call the underlying launcher directly:

```bash
node apps/local-mcp-web-ui/src/tailscale-publish.mjs funnel --json
```

### Auth-related env vars

```text
WEB_UI_AUTH_MODE=none|session
WEB_UI_SESSION_PASSWORD=<shared password>
WEB_UI_SESSION_SECRET=<optional cookie signing secret>
WEB_UI_SESSION_TTL_HOURS=168
WEB_UI_SESSION_COOKIE_NAME=local_mcp_web_ui_session
WEB_UI_ALLOW_SHELL_COMMANDS=0
WEB_UI_APPROVAL_POLICY=untrusted
WEB_UI_CHATKIT_DOMAIN_KEY=domain_pk_xxx
WEB_UI_CHATKIT_DOMAIN_KEYS=desktop.tail3e0cf.ts.net=domain_pk_xxx,chat.example.com=domain_pk_yyy,*.tailnet.example=domain_pk_zzz
WEB_UI_CHATKIT_DOMAIN_KEYS_JSON={"desktop.tail3e0cf.ts.net":"domain_pk_xxx","chat.example.com":"domain_pk_yyy"}
```

Notes:

- `WEB_UI_AUTH_MODE` is selected automatically by the Tailscale launcher scripts
- `WEB_UI_SESSION_SECRET` is optional; if omitted, a deterministic local secret is derived from repo path and password
- `WEB_UI_ALLOW_SHELL_COMMANDS` defaults to `0`; leave it disabled if you want the browser agent to stay on MCP/tools and avoid local shell-script fallbacks
- `WEB_UI_APPROVAL_POLICY` defaults to `untrusted` while shell access is disabled, and to `never` only when `WEB_UI_ALLOW_SHELL_COMMANDS=1`
- `WEB_UI_CHATKIT_DOMAIN_KEY` should be set to the public key generated in OpenAI `Settings -> Security -> Domain allowlist` for the exact published hostname
- `WEB_UI_CHATKIT_DOMAIN_KEYS` and `WEB_UI_CHATKIT_DOMAIN_KEYS_JSON` let one backend serve multiple trusted domains; exact host matches win, then `*.suffix` wildcard entries are checked, then `WEB_UI_CHATKIT_DOMAIN_KEY` is used as the fallback
- the backend also exposes `GET /readyz` for local launcher readiness checks
