# Local MCP Web UI Implementation Plan

## Goal

Add a separate feature that exposes the existing local Bybit MCP stack through a ChatGPT-like web UI.

Implementation update as of May 31, 2026:

- Phase 0-4 are implemented
- Phase 5 is implemented
- Tailscale publication is now handled by `apps/local-mcp-web-ui/src/tailscale-publish.mjs`
- two publication profiles are implemented:
  - `tailscale serve` without app-auth
  - `tailscale funnel` with backend session auth

Constraints for this MVP:

- use `codex app-server` via a dedicated shell launcher
- use `ChatKit` for the frontend instead of building a custom chat surface
- do not add safety restrictions, allowlists, or approval policy hardening in MVP
- minimize the amount of custom web backend code
- use `Tailscale Funnel` for easy external access
- design the feature as cross-platform from the start
- explicitly support both Linux and Windows launch paths

## Decision Summary

### Chosen architecture

```text
Browser
  -> ChatKit web app
  -> HTTPS

Thin web backend
  -> ChatKit session/token endpoints
  -> thread/turn HTTP + streaming endpoints
  -> bridge to local codex app-server

codex app-server
  -> launched by a dedicated project shell script
  -> connected to project-local Bybit MCP over stdio

trading-mcp
  -> existing Bybit MCP server
```

### Why not connect ChatKit directly to `codex app-server`

For this repository, direct browser -> `codex app-server` is not the right design:

- `codex app-server` is intended as a local protocol/runtime layer, not a public browser endpoint
- its remote WebSocket mode is not the preferred transport for this use case; `stdio`/local process is the stable path
- `ChatKit` advanced integration still assumes an application backend under our control
- browser-side direct access would push session handling, auth, and low-level protocol concerns into the client

So the practical minimum is not "no backend", but "a very thin backend".

### Cross-platform requirement

This feature must be designed as cross-platform by default:

- Linux remains the primary deployment target
- Windows must be a supported local/runtime target, not an afterthought
- platform-specific behavior should be isolated to launcher and environment-loading layers
- the backend, ChatKit frontend, and Bybit MCP integration should remain platform-neutral Node.js code

This means we should avoid baking Linux-only assumptions into:

- path handling
- shell quoting
- process spawning
- `.env` loading
- Tailscale helper commands

## Scope

This feature should be added as a separate app and must not disturb the existing MCP server entrypoints.

Proposed location:

```text
apps/local-mcp-web-ui/
  README.md
  package.json
  .env.example
  src/
    server/
    client/
    shared/
  scripts/
```

The existing root `src/` tree remains the MCP/tool runtime.

## High-Level Design

### 1. Dedicated launcher for `codex app-server`

Add dedicated launchers for both Linux and Windows.

Proposed scripts:

```text
scripts/start-codex-app-server-with-mcp.sh
scripts/start-codex-app-server-with-mcp.ps1
```

Responsibilities:

- load project `.env`
- normalize env vars exactly like the existing Linux Codex launcher
- ensure Bybit credentials are available to the MCP runtime
- start `codex app-server` locally
- inject project-local MCP configuration so the app-server can spawn `trading-mcp`

Important: this launcher should mirror the existing logic in:

- `scripts/load-project-env.sh`
- `scripts/run-trading-mcp-for-codex.sh`
- `scripts/start-codex-with-mcp.sh`

but target `codex app-server` instead of interactive `codex`.

Windows-specific requirements:

- add a PowerShell equivalent for env loading and path normalization
- preserve the current `.env` compatibility behavior, including handling CRLF correctly
- ensure `codex app-server` and the spawned MCP process inherit the correct working directory
- use PowerShell-safe quoting for inline configuration and child-process arguments

Recommendation:

- implement one shared config builder in Node.js where possible
- keep only the process bootstrap thin and platform-specific

### 2. Thin backend instead of a large custom adapter

We should still introduce a backend, but keep it narrow.

Responsibilities:

- serve the ChatKit-enabled web app
- create ChatKit sessions / session tokens if required by the integration mode
- create/read/list threads
- start turns and stream turn events to the browser
- translate between web-friendly transport and the local `codex app-server` protocol

Non-goals for MVP:

- multi-user authorization
- role separation
- write-tool restrictions
- audit policy
- approval policy hardening

This backend is still needed even if the UI uses ChatKit, because ChatKit does not replace the application server that owns session state and agent execution.

### 3. ChatKit frontend

Use `ChatKit` instead of custom React chat widgets.

Frontend goals:

- ChatGPT-like message surface
- thread list
- streaming assistant output
- tool activity display where ChatKit supports it
- input box, stop/retry controls, session restore

The frontend should not know anything about Bybit secrets or direct MCP mechanics.

### 4. Tailscale publication

For MVP:

- backend listens only on localhost
- tailnet-only access is exposed through `tailscale serve`
- public access is exposed through `tailscale funnel`
- public access requires backend session auth

Implemented operator flow:

```bash
npm run webui:serve
npm run webui:funnel
```

Implemented behavior:

- `webui:serve`
  - forces `WEB_UI_AUTH_MODE=none`
  - publishes with `tailscale serve --bg`
- `webui:funnel`
  - forces `WEB_UI_AUTH_MODE=session`
  - requires `WEB_UI_SESSION_PASSWORD`
  - publishes with `tailscale funnel --bg`

Windows note:

- the web app can run on Windows
- `tailscale serve` and `tailscale funnel` should be treated as optional operator helpers, not a hard dependency of the app itself
- the Node backend must not assume that Funnel is available locally

## Proposed Runtime Flow

### Session bootstrap

1. User opens the web page.
2. Frontend requests a session from the thin backend.
3. Backend creates or reuses a local bridge session.
4. Backend ensures a `codex app-server` child process exists for that session or for the singleton app runtime.
5. Backend returns the session metadata required by ChatKit.

### Conversation turn

1. Frontend sends a message.
2. Backend maps it to `thread/start` or `turn/start`.
3. Backend forwards the request to local `codex app-server`.
4. Backend consumes streamed notifications/events from `codex app-server`.
5. Backend converts them to frontend-consumable stream events.
6. ChatKit renders the assistant response and intermediate activity.

### Tool execution

1. `codex app-server` invokes the project-local Bybit MCP server.
2. Existing `trading-mcp` handlers run unchanged.
3. Tool results flow back through `codex app-server`.
4. Backend streams the result state to ChatKit.

## Implementation Phases

## Phase 0: Documentation and feasibility lock

Goal: confirm exact ChatKit integration path and pin the architecture.

Tasks:

- confirm the current ChatKit advanced integration requirements
- confirm the recommended backend contract for session creation and response streaming
- confirm the current `codex app-server` transport and lifecycle expectations
- document the final transport choice: local child-process bridge, not remote WebSocket
- define the cross-platform boundary: what stays platform-neutral and what is split into Linux/Windows launchers

Deliverable:

- final architecture note in the app README

## Phase 1: `codex app-server` launcher

Goal: create a stable local process launcher for the web feature.

Tasks:

- add `scripts/start-codex-app-server-with-mcp.sh`
- add `scripts/start-codex-app-server-with-mcp.ps1`
- reuse env loading and CRLF trimming logic from `scripts/load-project-env.sh`
- add or reuse PowerShell env-loading logic for Windows
- reuse MCP inline configuration pattern from current Codex launchers
- add a smoke command that starts the app-server and verifies initialization

Proposed commands:

```text
npm run webui:app-server
npm run webui:app-server:windows
npm run webui:app-server:smoke
npm run webui:app-server:smoke:windows
```

Verification:

- app-server starts successfully on Linux
- app-server starts successfully on Windows
- app-server can see the local Bybit MCP tools
- simple thread initialization succeeds

## Phase 2: thin backend

Goal: provide the minimum server-side glue that ChatKit needs.

Suggested stack:

- Node.js
- Fastify
- SSE for outbound streaming to browser

Cross-platform backend rule:

- backend code must use `child_process.spawn()` with explicit executable/args arrays
- no shell-dependent command construction in application code
- platform-specific launch selection must happen in a small runtime abstraction

Internal modules:

```text
apps/local-mcp-web-ui/src/server/
  app.ts
  config.ts
  codex-app-server-client.ts
  sessions.ts
  threads.ts
  stream.ts
```

Responsibilities by module:

- `config.ts`
  - ports
  - Tailscale/public URL hints
  - launcher paths
  - platform detection
- `codex-app-server-client.ts`
  - spawn child process
  - send JSON-RPC requests
  - match responses by `id`
  - forward notifications/events
- `sessions.ts`
  - map browser session to local runtime session
- `threads.ts`
  - create/list/read/resume threads
- `stream.ts`
  - SSE fanout for live turn events

Minimum endpoints:

```text
GET  /healthz
POST /api/session
GET  /api/threads
POST /api/threads
GET  /api/threads/:threadId
POST /api/threads/:threadId/turns
POST /api/threads/:threadId/interrupt
GET  /api/threads/:threadId/events
```

Verification:

- backend can start app-server through the launcher
- backend can create a thread
- backend can send one prompt
- backend can stream the response incrementally
- backend works against both launcher variants without code changes in the frontend

## Phase 3: ChatKit frontend

Goal: replace a custom chat UI with ChatKit while keeping backend ownership local.

Suggested structure:

```text
apps/local-mcp-web-ui/src/client/
  main.tsx
  App.tsx
  chatkit.ts
  api.ts
```

Tasks:

- initialize ChatKit in advanced integration mode
- bind ChatKit session startup to `POST /api/session`
- connect message send flow to backend thread/turn endpoints
- render assistant streaming
- expose thread history and thread switching

Verification:

- browser can open the UI
- new thread creation works
- existing threads reload correctly
- live streamed answer appears without page reload
- the same frontend build works unchanged against Linux and Windows backends

## Phase 4: MVP live checks

Goal: validate the full path end to end with real tools.

Smoke scenarios:

1. "What is the current BTC/USDT price?"
2. "What's my wallet balance?"
3. "Do I currently have any open spot orders?"

Expected path:

- browser -> ChatKit app
- backend -> `codex app-server`
- `codex app-server` -> local Bybit MCP
- Bybit tool result returns to browser as streamed assistant output

Artifacts:

- saved smoke transcript
- backend log
- launcher log
- one verified Linux run
- one verified Windows run

## Phase 5: Tailscale publication

Goal: make the MVP reachable remotely with minimal ops work.

Status: implemented

Tasks:

- add a helper script for `tailscale serve`
- add a helper script for `tailscale funnel`
- add backend session auth for public mode
- document operator steps

Implemented helper:

```text
apps/local-mcp-web-ui/src/tailscale-publish.mjs
```

Implemented commands:

```text
npm run webui:serve
npm run webui:serve:status
npm run webui:serve:reset
npm run webui:funnel
npm run webui:funnel:status
npm run webui:funnel:reset
```

Verification:

- local URL works
- tailnet URL works through `serve`
- public URL works through `funnel`
- public URL is gated by backend session auth

Windows note:

- Windows support for the app itself is required
- Windows support for Tailscale publication is desirable, but not a blocker for the first backend/frontend milestone
- if Funnel behavior differs operationally on Windows, Linux can remain the recommended publishing host while Windows remains a supported development/runtime host

## Repo Changes

### New app

```text
apps/local-mcp-web-ui/
```

### New root scripts

Likely additions to root `package.json`:

```text
webui:start
webui:app-server
webui:app-server:smoke
webui:serve
webui:serve:status
webui:serve:reset
webui:funnel
webui:funnel:status
webui:funnel:reset
webui:smoke
```

### New shell scripts

```text
scripts/start-codex-app-server-with-mcp.sh
scripts/start-codex-app-server-with-mcp.ps1
```

## Technical Notes

### Reuse from current repo

The new feature should reuse these existing pieces instead of inventing a parallel setup:

- `scripts/load-project-env.sh`
- `scripts/run-trading-mcp-for-codex.ps1`
- `scripts/start-codex-with-mcp.ps1`
- `scripts/run-trading-mcp-for-codex.sh`
- current Bybit MCP runtime in `src/`
- existing live Bybit smoke assumptions
- existing Linux deployment path on `singapur`

Additional Windows-specific reusable pieces:

- the current PowerShell-based Codex launch patterns already used for `codex:session`
- existing Node-based project runtime, which is already cross-platform in its core MCP/tool layer

### Platform abstraction

The backend should select the launcher through a small platform abstraction, for example:

- `linux` -> `bash scripts/start-codex-app-server-with-mcp.sh`
- `win32` -> `powershell -ExecutionPolicy Bypass -File scripts/start-codex-app-server-with-mcp.ps1`

Only this launcher selection layer should be platform-aware.

The following should stay platform-neutral:

- ChatKit frontend
- backend routing
- JSON-RPC framing
- thread/session persistence
- event streaming
- tool result rendering

### Session model

For MVP, simplest is a single-user deployment model:

- one operator
- one backend instance
- either one long-lived app-server process or one process per browser session

Recommendation for MVP:

- one backend process
- one app-server process
- multiple threads within that process

This is the lowest-complexity approach for a personal or team-internal deployment.

### Windows support details

Windows support is feasible, but it requires a few explicit additions:

- a PowerShell launcher for `codex app-server`
- a PowerShell helper for local web start and optional Tailscale publication
- path normalization for `cwd`, script paths, and project-local config
- careful child-process spawning without assuming a POSIX shell

Expected limitations:

- Linux is still the cleaner default host for remote publishing with Funnel
- Windows should be treated as a supported runtime and local-dev platform
- if agent shell behavior differs by OS, that should be documented rather than hidden

### Logging

Even without policy controls, add plain logs for:

- backend start/stop
- app-server child process start/exit
- thread creation
- turn start/finish
- MCP/tool error propagation

This will be important for debugging Funnel deployments.

## Risks

### 1. ChatKit integration details may force a slightly different backend shape

If ChatKit expects a specific session or response format, we should adapt the thin backend to that contract rather than force a custom frontend protocol.

### 2. `codex app-server` event model may require translation

Even with ChatKit, the backend will likely need to reshape low-level app-server events into UI-friendly events.

### 3. Public Funnel exposure without MVP restrictions is intentionally permissive

This is acceptable only because the current request explicitly excludes restrictions from MVP. It should be treated as temporary.

### 4. Windows shell/process differences can create subtle launcher bugs

The main risks are:

- quoting differences
- environment propagation differences
- CRLF handling in `.env`
- executable resolution differences between `powershell`, `bash`, and direct process spawn

This is why Windows support must be validated with its own smoke path, not assumed from Linux success.

## Recommended Implementation Order

1. Phase 1: launcher for `codex app-server`
2. Phase 2: thin backend and local smoke
3. Phase 3: ChatKit frontend
4. Windows parity pass for launcher and backend
5. Phase 4: live Bybit smoke scenarios on Linux and Windows
6. Phase 5: `tailscale serve` then `tailscale funnel`

## Exit Criteria

The MVP is complete when all of the following are true:

- a dedicated shell launcher starts `codex app-server` with project-local Bybit MCP access
- both Linux and Windows launcher paths work
- a ChatKit-based web app can create and resume threads
- user messages stream live responses in the browser
- at least the three smoke prompts complete through real Bybit tools
- the same app code works on both Linux and Windows, with only launcher/operator differences
- the app is reachable remotely through Tailscale
