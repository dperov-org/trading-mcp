# Decoupled MCP, Codex, and Web UI implementation plan

Date: 2026-06-16

## Goal

Prepare the project for an important runtime split:

- MCP servers can run as standalone long-lived services.
- Codex can connect to already running external MCP servers instead of always spawning MCP stdio children.
- Codex app-server can run separately from the Web UI.
- Web UI can connect to an already running external Codex app-server instead of always spawning it.
- The selected mode must be controlled by configuration parameters.

Required production topology for `singapur`:

1. MCP servers run separately in their own `screen` session and are reachable through Tailscale.
2. Codex app-server runs separately in its own `screen` session and is reachable through Tailscale.
3. Web UI runs separately in its own `screen` session and is published through Tailscale Funnel as before.

## Current state

Current local shape:

```text
Browser
  -> local Web UI backend
    -> spawned codex app-server over stdio
      -> spawned Bybit MCP stdio child
      -> spawned MEXC MCP stdio child
```

Relevant existing files:

- MCP stdio server:
  - `src/core/mcp/server.ts`
  - `src/index.ts`
  - `src/mexc.ts`
- Codex launchers:
  - `scripts/start-codex-with-mcp.sh`
  - `scripts/start-codex-app-server-with-mcp.sh`
  - `scripts/start-codex-with-mcp.ps1`
  - `scripts/start-codex-app-server-with-mcp.ps1`
  - `scripts/get-codex-mcp-config-overrides.ps1`
- MCP stdio wrappers:
  - `scripts/run-trading-mcp-for-codex.sh`
  - `scripts/run-mexc-mcp-for-codex.sh`
  - Windows equivalents
- Web UI app-server bridge:
  - `apps/local-mcp-web-ui/src/codex-app-server-client.mjs`
  - `apps/local-mcp-web-ui/src/server.mjs`
  - `apps/local-mcp-web-ui/src/config.mjs`
- Web UI Tailscale publisher:
  - `apps/local-mcp-web-ui/src/tailscale-publish.mjs`

Current limitations:

- MCP servers are stdio-only in the local runtime.
- Codex launchers always configure MCP as child processes.
- Web UI always starts its own `codex app-server` child process.
- There is no stable config model for internal vs external MCP or internal vs external Codex app-server.
- Current `singapur` screen process combines Web UI, Codex app-server, and MCP children under one lifecycle.

## Target topology

Target `singapur` shape:

```text
Tailscale tailnet
  -> MCP service endpoint(s)
      screen: trading-mcp
      Bybit MCP
      MEXC MCP

  -> Codex app-server endpoint
      screen: codex-app
      codex app-server
      connects to external MCP endpoints

Public HTTPS via Tailscale Funnel
  -> Web UI backend
      screen: webui
      no MCP children
      no Codex child in external-codex mode
      connects to external Codex app-server endpoint
```

Development mode must continue to work:

```text
Browser
  -> Web UI backend
    -> spawned local codex app-server
      -> spawned local MCP stdio children
```

The default developer path should remain low-friction. The split deployment should be enabled by explicit env/config.

## Key design decisions

### Transport decision

MCP currently uses `StdioServerTransport`. To make MCP servers reachable independently, add an HTTP/SSE or streamable HTTP transport supported by `@modelcontextprotocol/sdk`.

Preferred target:

- add an HTTP MCP transport mode to the exchange runtime;
- keep stdio as the default;
- expose Bybit and MEXC on separate local ports;
- publish those ports only through Tailscale, not public Funnel.
- do not add application-level auth for MCP inside the `singapur` tailnet.
- run Bybit and MEXC as separate HTTP MCP services for operational isolation.

Candidate service URLs:

```text
http://127.0.0.1:8791/mcp/bybit
http://127.0.0.1:8792/mcp/mexc
```

Tailscale serve can publish them inside the tailnet under stable HTTPS hostnames/paths. Exact Tailscale mapping should be finalized after confirming Codex MCP remote config syntax.

### Config model

Add explicit runtime modes:

```text
MCP_TRANSPORT=stdio|http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=8791
MCP_HTTP_PATH=/mcp

BYBIT_MCP_TRANSPORT=stdio|http
BYBIT_MCP_HTTP_HOST=127.0.0.1
BYBIT_MCP_HTTP_PORT=8791
BYBIT_MCP_HTTP_PATH=/mcp/bybit

MEXC_MCP_TRANSPORT=stdio|http
MEXC_MCP_HTTP_HOST=127.0.0.1
MEXC_MCP_HTTP_PORT=8792
MEXC_MCP_HTTP_PATH=/mcp/mexc
```

Add Codex MCP connection mode:

```text
CODEX_MCP_MODE=stdio|external
CODEX_BYBIT_MCP_SERVER_NAME=trading_mcp_bybit_local
CODEX_MEXC_MCP_SERVER_NAME=trading_mcp_mexc_local
CODEX_BYBIT_MCP_URL=https://singapur.tail3e0cf.ts.net/mcp/bybit
CODEX_MEXC_MCP_URL=https://singapur.tail3e0cf.ts.net/mcp/mexc
CODEX_MCP_AUTH=none
```

`CODEX_MCP_AUTH=none` is the required `singapur` mode. MCP endpoints are protected by Tailscale network access only, without additional application-level auth headers.

Add Web UI Codex app-server mode:

```text
WEB_UI_CODEX_MODE=spawn|external
WEB_UI_CODEX_APP_SERVER_URL=ws://127.0.0.1:8790
WEB_UI_CODEX_APP_SERVER_TRANSPORT=ws|stdio
```

For `singapur`, expected values:

```text
CODEX_MCP_MODE=external
WEB_UI_CODEX_MODE=external
WEB_UI_CODEX_APP_SERVER_URL=<tailscale-reachable codex app-server URL>
WEB_UI_CODEX_APP_SERVER_TRANSPORT=ws
```

Keep existing names as compatibility aliases:

```text
SERVER_NAME -> CODEX_BYBIT_MCP_SERVER_NAME
MEXC_SERVER_NAME -> CODEX_MEXC_MCP_SERVER_NAME
```

### Lifecycle decision

Do not make Web UI responsible for managing Codex app-server in external mode.

Do not make Codex app-server responsible for managing MCP services in external mode.

Each service should have:

- own screen name;
- own log file;
- own health check;
- own restart command;
- own Tailscale publication command/status check where applicable.

## Implementation phases

## Phase 1: inventory and protocol confirmation

Tasks:

1. Confirm which remote MCP server transports the installed `codex` CLI supports in MCP config:
   - stdio child process: confirmed by current launchers;
   - streamable HTTP URL: confirmed by `codex mcp add --url <URL>`;
   - optional bearer token env var exists, but the `singapur` tailnet deployment will not use auth for MCP inside Tailscale.
2. Confirm which listen transports `codex app-server` supports:
   - confirmed by `codex app-server --help`: `stdio://`, `unix://`, `unix://PATH`, `ws://IP:PORT`, and `off`;
   - preferred split mode is `ws://127.0.0.1:<port>` with Tailscale serve in front if tailnet reachability is required.
3. Exact `-c` config override keys for remote MCP servers are confirmed:

```text
-c "mcp_servers.<server_name>.url='<streamable-http-url>'"
```

`codex mcp get <server_name>` reports this as `transport: streamable_http`.

4. Web UI can speak the app-server websocket protocol directly. A local probe sent the same JSON-RPC `initialize` envelope currently used over stdio to `ws://127.0.0.1:<port>` and received the expected app-server initialize response.

Deliverable:

- short protocol note added to this plan or a follow-up plan section with confirmed CLI syntax.

Risk:

- Web UI still needs a dedicated websocket client implementation, but no protocol proxy is expected.
- App-server websocket currently binds loopback in the tested mode; `singapur` should expose it through Tailscale serve rather than binding it publicly.

Fallbacks:

- MCP fallback: run lightweight local stdio proxy wrappers that connect to remote MCP services.
- Codex app-server fallback: keep Codex app-server colocated with Web UI but separate MCP externally first.

## Phase 2: standalone MCP service mode

Tasks:

1. Extend `src/core/mcp/server.ts` or add `src/core/mcp/http-server.ts`.
2. Keep existing stdio behavior unchanged.
3. Add HTTP transport startup for Bybit and MEXC runtimes.
4. Add service-specific commands:

```text
npm run mcp:bybit:http
npm run mcp:mexc:http
npm run mcp:all:http
```

5. Add Linux wrappers:

```text
scripts/start-bybit-mcp-http.sh
scripts/start-mexc-mcp-http.sh
scripts/start-mcp-services.sh
```

6. Add Windows equivalents if local Windows parity is required:

```text
scripts/start-bybit-mcp-http.ps1
scripts/start-mexc-mcp-http.ps1
```

7. Add health endpoints for HTTP MCP services:

```text
GET /healthz
GET /readyz
```

8. Add smoke tests:

```text
npm run mcp:bybit:http:smoke
npm run mcp:mexc:http:smoke
npm run mcp:http:smoke
```

Expected behavior:

- stdio MCP remains the default for existing scripts;
- HTTP MCP starts only when configured explicitly;
- Bybit and MEXC can run independently and fail independently.

## Phase 3: Codex external MCP mode

Tasks:

1. Refactor Codex launcher scripts so MCP config is generated from `CODEX_MCP_MODE`.
2. For `CODEX_MCP_MODE=stdio`, keep current child-process config:

```text
mcp_servers.<name>.command
mcp_servers.<name>.args
mcp_servers.<name>.cwd
```

3. For `CODEX_MCP_MODE=external`, generate remote MCP URL config once confirmed:

```text
mcp_servers.<name>.url=<CODEX_BYBIT_MCP_URL>
mcp_servers.<name>.url=<CODEX_MEXC_MCP_URL>
```

4. Update both interactive and app-server launchers:

```text
scripts/start-codex-with-mcp.sh
scripts/start-codex-app-server-with-mcp.sh
scripts/get-codex-mcp-config-overrides.ps1
```

5. Add explicit app-server command:

```text
npm run codex:app-server
npm run codex:app-server:linux
```

6. Add smoke test that starts Codex app-server with external MCP URLs and calls:

```text
trading_mcp_bybit_local.getServerTime
trading_mcp_mexc_local.getMexcCapabilityGuide
```

Expected behavior:

- local developer mode remains unchanged;
- production can run Codex app-server without spawning Bybit/MEXC MCP children;
- process tree clearly shows Codex separate from MCP service screens.

## Phase 4: Web UI external Codex mode

Tasks:

1. Split `CodexAppServerClient` into transport-specific clients:

```text
SpawnedStdioCodexAppServerClient
ExternalCodexAppServerClient
```

2. Keep existing spawned stdio behavior under:

```text
WEB_UI_CODEX_MODE=spawn
```

3. Add external mode:

```text
WEB_UI_CODEX_MODE=external
WEB_UI_CODEX_APP_SERVER_URL=<url>
```

4. If Codex app-server supports HTTP directly:
   - implement JSON-RPC over HTTP/SSE/WebSocket according to confirmed protocol.
5. If Codex app-server is stdio-only:
   - implement a small `codex-app-server-proxy` service that owns the stdio child and exposes a network API to Web UI;
   - in that case, the separate `codex` screen runs the proxy plus child app-server, and Web UI connects to the proxy.
6. Update `startWebUiServer()` startup logs and `/healthz`:

```json
{
  "codex_mode": "external",
  "codex_app_server_url": "...",
  "app_server": "connected"
}
```

7. Update smoke tests:

```text
npm run webui:external-codex:smoke
npm run webui:smoke
```

Expected behavior:

- Web UI can start without spawning Codex.
- Web UI fails fast if external Codex app-server is unavailable.
- Existing spawned mode remains available for local development.

## Phase 5: Tailscale and screen deployment scripts

Add dedicated scripts for `singapur`.

Proposed scripts:

```text
scripts/singapur/start-mcp-screen.sh
scripts/singapur/start-codex-screen.sh
scripts/singapur/start-webui-screen.sh
scripts/singapur/status.sh
scripts/singapur/restart-all.sh
scripts/singapur/stop-all.sh
```

Screen sessions:

```text
trading-mcp
codex-app
webui
```

MCP screen command:

```bash
screen -dmS trading-mcp bash -lc '
  cd /root/projects/trading-mcp &&
  CODEX_MCP_MODE=external \
  BYBIT_MCP_TRANSPORT=http \
  MEXC_MCP_TRANSPORT=http \
  npm run mcp:all:http
'
```

Codex screen command:

```bash
screen -dmS codex-app bash -lc '
  cd /root/projects/trading-mcp &&
  CODEX_MCP_MODE=external \
  CODEX_BYBIT_MCP_URL=<tailscale-bybit-mcp-url> \
  CODEX_MEXC_MCP_URL=<tailscale-mexc-mcp-url> \
  npm run codex:app-server:linux -- --listen <confirmed-listen-url>
'
```

Web UI screen command:

```bash
screen -dmS webui bash -lc '
  cd /root/projects/trading-mcp &&
  WEB_UI_CODEX_MODE=external \
  WEB_UI_CODEX_APP_SERVER_URL=<tailscale-codex-app-server-url> \
  npm run webui:funnel
'
```

Tailscale publication:

- MCP: tailnet-only `tailscale serve`, not public Funnel.
- Codex app-server: tailnet-only `tailscale serve`, not public Funnel.
- Web UI: public `tailscale funnel`, same as current behavior.

Important security rule:

- Do not expose MCP or Codex app-server through public Funnel.
- Only Web UI should be public, and it must keep backend session auth.

## Phase 6: observability and health checks

Add health commands:

```text
npm run mcp:status
npm run codex:app-server:status
npm run webui:status
npm run singapur:status
```

`singapur:status` should report:

- screen sessions present;
- process PIDs;
- local ports listening;
- Tailscale serve/funnel status;
- MCP health;
- Codex app-server health;
- Web UI `/healthz`;
- recent log tail paths.

Logs:

```text
apps/local-mcp-web-ui/artifacts/logs/*
artifacts/mcp/bybit.log
artifacts/mcp/mexc.log
artifacts/codex-app-server.log
```

## Required config matrix

### Local development default

```text
MCP_TRANSPORT=stdio
CODEX_MCP_MODE=stdio
WEB_UI_CODEX_MODE=spawn
WEB_UI_AUTH_MODE=none
```

### Local external-MCP test

```text
BYBIT_MCP_TRANSPORT=http
MEXC_MCP_TRANSPORT=http
CODEX_MCP_MODE=external
WEB_UI_CODEX_MODE=spawn
CODEX_MCP_AUTH=none
```

### Full split on singapur

```text
BYBIT_MCP_TRANSPORT=http
MEXC_MCP_TRANSPORT=http
CODEX_MCP_MODE=external
CODEX_MCP_AUTH=none
WEB_UI_CODEX_MODE=external
WEB_UI_AUTH_MODE=session
```

## Validation plan

Minimum validation before deployment:

```text
npm run verify
npm run mcp:http:smoke
npm run codex:app-server:smoke
npm run webui:external-codex:smoke
npm run webui:smoke
```

Server validation on `singapur`:

```bash
screen -ls
tailscale serve status --json
tailscale funnel status --json
curl -fsS http://127.0.0.1:<bybit-mcp-port>/healthz
curl -fsS http://127.0.0.1:<mexc-mcp-port>/healthz
curl -fsS http://127.0.0.1:<codex-port>/healthz
curl -fsS http://127.0.0.1:8787/healthz
```

Functional validation:

- Codex external MCP smoke can call Bybit and MEXC tools.
- Web UI can submit a turn through external Codex.
- Browser cannot trigger shell execution unless explicitly enabled.
- Web UI public Funnel URL still requires session login.

## Rollback plan

Keep current combined mode intact until full split is proven.

Rollback config:

```text
CODEX_MCP_MODE=stdio
WEB_UI_CODEX_MODE=spawn
```

Rollback service action on `singapur`:

1. stop `trading-mcp` and `codex-app` screens;
2. restart old `webui` or `mcp` combined screen with `npm run webui:funnel`;
3. confirm `/login` and `/healthz`;
4. confirm process tree shows app-server and MCP children under Web UI again.

## Resolved questions

Resolved:

1. Remote MCP transport: current `codex mcp add --help` supports streamable HTTP servers through `--url <URL>`.
2. Codex app-server listen modes: current `codex app-server --help` supports `stdio://`, `unix://`, `unix://PATH`, `ws://IP:PORT`, and `off`.
3. MCP auth inside Tailscale: not needed for `singapur`; use `CODEX_MCP_AUTH=none`.
4. MCP service split: use separate Bybit and MEXC HTTP MCP services, with stable Codex server names `trading_mcp_bybit_local` and `trading_mcp_mexc_local`.
5. Inline Codex config override for remote MCP URLs is accepted. Confirmed shape:

```text
-c "mcp_servers.<server_name>.url='<streamable-http-url>'"
```

`codex mcp get <server_name>` reports the configured server as `transport: streamable_http`.

6. `codex app-server` exposes network health/readiness endpoints in `ws://` mode. A local probe confirmed:

```text
GET /healthz -> 200
GET /readyz  -> 200
```

The server also prints those URLs on startup.

7. Web UI can connect directly to `codex app-server` over websocket using the same JSON-RPC envelope as stdio. A local probe sent `initialize` over `ws://127.0.0.1:<port>` and received the expected app-server initialize response.

Codex app-server network mode is websocket, not plain HTTP:

```text
codex app-server --listen stdio://
codex app-server --listen unix://
codex app-server --listen unix://PATH
codex app-server --listen ws://IP:PORT
```

This is separate from `codex mcp-server`, which is stdio-only, and separate from Codex remote MCP support, where Codex can connect to streamable HTTP MCP servers through `codex mcp add --url <URL>`.

Implementation consequence:

- no generic HTTP/REST Codex app-server should be assumed;
- external Web UI mode should target `ws://...` / `wss://...`;
- implement `ExternalCodexAppServerClient` over websocket;
- no websocket-to-stdio proxy is currently needed.

## First implementation slice

Start with the smallest useful slice:

1. Add HTTP MCP transport for Bybit only.
2. Add `mcp:bybit:http` and Bybit HTTP smoke.
3. Confirm Codex can connect to that external MCP endpoint.
4. Add MEXC HTTP MCP transport.
5. Add external MCP mode to Codex launchers.
6. Only then split Web UI from Codex app-server.

This reduces risk because MCP externalization is the foundation for the required production topology.

## Implementation progress: first slice

Implemented locally:

- Streamable HTTP MCP transport in `src/core/mcp/server.ts`;
- env-controlled transport selection in `src/core/exchange-runtime.ts`;
- Bybit HTTP MCP wrapper: `scripts/start-bybit-mcp-http.sh`;
- MEXC HTTP MCP wrapper: `scripts/start-mexc-mcp-http.sh`;
- combined MCP service wrapper: `scripts/start-mcp-services.sh`;
- Codex external MCP mode in Linux launchers:
  - `scripts/start-codex-with-mcp.sh`;
  - `scripts/start-codex-app-server-with-mcp.sh`;
- Codex external MCP mode in Windows config helper:
  - `scripts/get-codex-mcp-config-overrides.ps1`;
  - `scripts/start-codex-app-server-with-mcp.ps1`;
- Web UI external Codex mode:
  - `WEB_UI_CODEX_MODE=external`;
  - `WEB_UI_CODEX_APP_SERVER_URL=ws://...`;
  - `CodexAppServerClient` supports websocket JSON-RPC in addition to spawned stdio;
- smoke tests:
  - `npm run mcp:bybit:http:smoke`;
  - `npm run mcp:mexc:http:smoke`;
  - `npm run webui:external-codex:smoke`;
  - `npm run codex:external-mcp:smoke`.
- `singapur` orchestration scripts:
  - `scripts/singapur/start-mcp-screen.sh`;
  - `scripts/singapur/start-codex-screen.sh`;
  - `scripts/singapur/start-webui-screen.sh`;
  - `scripts/singapur/publish-tailnet-services.sh`;
  - `scripts/singapur/status.sh`;
  - `scripts/singapur/stop-all.sh`.

Validated locally:

```text
npm run verify
npm run mcp:bybit:http:smoke
npm run mcp:mexc:http:smoke
npm run webui:external-codex:smoke
npm run codex:external-mcp:smoke
```

Observed local smoke results:

- Bybit HTTP MCP: 331 tools listed, `getServerTime` present;
- MEXC HTTP MCP: 82 tools listed, `getMexcCapabilityGuide` present;
- Web UI external Codex: `/healthz` reports `codex_mode=external` and receives app-server initialize response over websocket;
- Codex external MCP: app-server connected to both HTTP MCP endpoints and successfully called:
  - `trading_mcp_bybit_local.getServerTime`;
  - `trading_mcp_mexc_local.getMexcCapabilityGuide`.

Not implemented yet:

- production rollout/restart on `singapur`.

Deployment readiness note:

- code and local smoke tests are ready for `singapur` deployment;
- before rollout, confirm the target Tailscale base URL in `SINGAPUR_TAILNET_BASE_URL`;
- after rollout, run `npm run singapur:status` on the server and verify screen sessions plus `/healthz`/`/readyz`.
