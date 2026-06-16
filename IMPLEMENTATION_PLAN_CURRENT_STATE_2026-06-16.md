# Trading MCP implementation plan: current state and next steps

Date: 2026-06-16

This document supersedes the older planning notes as a current-state implementation plan for the local trading MCP stack: Bybit MCP, MEXC MCP, Codex app-server wiring, and the local ChatKit Web UI.

## 1. Current Baseline

### Repository state

- Branch: `main`
- Local/remote baseline: `a19b2b0 Add Bybit RW key selection and option TP SL`
- Package: `bybit-official-trading-server@2.1.5`
- Node runtime requirement: `>=20.6`
- Primary validation command: `npm run verify`
- Current local workspace note: `BOT_API_RESEARCH_2026-06-08.md` exists as an uncommitted report file.

### Runtime layout

The project now has a shared exchange-runtime layer:

- `src/core/mcp/server.ts`
  - owns MCP stdio server setup;
  - registers `tools/list` and `tools/call`;
  - converts Zod schemas to JSON schema;
  - executes tools through `src/core/tool-runtime/execute.ts`.
- `src/core/exchange-runtime.ts`
  - wraps exchange-specific tool arrays into a common MCP server config.
- `src/index.ts` -> `src/server.ts` -> `src/exchanges/bybit/runtime.ts`
  - default package entrypoint;
  - starts Bybit MCP server.
- `src/mexc.ts` -> `src/exchanges/mexc/runtime.ts`
  - separate MEXC MCP entrypoint.

## 2. Bybit MCP Current State

### Entrypoint and server identity

- Entrypoint: `src/index.ts`
- Runtime: `src/exchanges/bybit/runtime.ts`
- MCP server name: `trading-mcp`
- Tool count observed via runtime creation: `331`

### Credentials

Bybit credential selection is centralized in `src/exchanges/bybit/config.ts`.

Current rules:

1. If `BYBIT_API_KEY` is already set, use direct `BYBIT_API_*`.
2. Otherwise, if `BYBIT_USE_RW_KEYS` is enabled or unset and `BYBIT_RW_API_KEY` exists, map `BYBIT_RW_*` to `BYBIT_API_*`.
3. Otherwise, fall back to `BYBIT_RO_*`.
4. `BYBIT_USE_RW_KEYS=false` forces read-only alias selection when direct `BYBIT_API_*` is not set.

The runtime startup summary reports auth type and key source.

### Implemented capability areas

Bybit remains the broadest MCP surface in this repository. Current generated tools include:

- market data;
- trade order create/amend/cancel/batch/pre-check;
- account and wallet;
- positions, including option TP/SL support through `setTradingStop`;
- user and sub-account read tools;
- asset/deposit/withdrawal read tools and selected asset write tools;
- spot margin / UTA margin;
- WebSocket snapshot/subscription tools;
- WebSocket trade tools;
- earn, loan, RFQ, spread, broker, affiliate, P2P, strategy, and bot groups.

Recent important implementation state:

- `setTradingStop` now accepts `category="option"` for full-position market TP/SL.
- Bybit RW smoke exists as `npm run smoke:bybit:rw` and validates that `queryAPIKey.readOnly` is false.
- Default Bybit runtime now prefers RW aliases, while `npm run smoke:bybit` intentionally stays read-only.

### Known Bybit gaps

- Asset transfer write endpoints are still not implemented:
  - `POST /v5/asset/transfer/inter-transfer`
  - `POST /v5/asset/transfer/universal-transfer`
- Withdrawal write endpoints are still not implemented:
  - `POST /v5/asset/withdraw/create`
  - `POST /v5/asset/withdraw/cancel`
- User/sub-account management write endpoints are not implemented.
- Bybit Strategy API has newer `pov` support according to current docs/changelog, but local strategy tools cover only `twap`, `iceberg`, and `chaseOrder`.
- No dedicated read-only active bot/strategy review snapshot exists yet.

## 3. MEXC MCP Current State

### Entrypoint and server identity

- Entrypoint: `src/mexc.ts`
- Runtime: `src/exchanges/mexc/runtime.ts`
- MCP server name: `trading-mcp-mexc`
- Tool count observed via runtime creation: `82`

### Credentials and feature flags

MEXC config lives in `src/exchanges/mexc/config.ts`.

Current rules:

- spot credentials:
  - `MEXC_SPOT_API_KEY` / `MEXC_SPOT_API_SECRET`
  - fallback to `MEXC_API_KEY` / `MEXC_SECRET_KEY` / `MEXC_API_SECRET`
- futures credentials:
  - `MEXC_FUTURES_API_KEY` / `MEXC_FUTURES_API_SECRET`
  - fallback to `MEXC_API_KEY` / `MEXC_SECRET_KEY` / `MEXC_API_SECRET`
- `MEXC_ENABLE_SPOT` defaults to true.
- `MEXC_ENABLE_FUTURES` defaults to true.
- `MEXC_RECV_WINDOW` defaults to 5000.

### Implemented capability areas

MEXC tools are hand-curated under `src/exchanges/mexc/tools`.

Implemented groups:

- high-level guide/review:
  - `getMexcTradingReviewSnapshot`
  - `getMexcCapabilityGuide`
- spot market:
  - server time, exchange info, tickers, orderbook, trades, klines, extended historical/aggregate helpers;
- spot account:
  - wallet/account/open orders/order history/my trades/API permissions;
- spot trade:
  - create test order, create order, cancel order, cancel all orders, get order;
- MEXC WebSocket:
  - orderbook, tickers, trades subscriptions;
- futures market/account/trade:
  - futures market data;
  - futures account data;
  - futures order create/cancel/cancel all;
  - futures trigger/plan orders;
  - futures TP/SL update and cancel helpers.

### Known MEXC gaps

- No native MEXC grid/bot API exists in this repository.
- Public MEXC docs reviewed so far do not expose official native bot management endpoints; MEXC grid bots appear to be a UI product, not public API.
- A custom MEXC grid/DCA/TWAP runtime is not implemented yet.
- MEXC does not provide a sandbox in the same way Bybit does, so all write smoke tests must stay guarded and small-notional.
- MEXC futures API availability has historically shifted; live smoke tests remain important.

## 4. Codex MCP Wiring

### Project-local MCP servers

Codex sessions and Web UI app-server use project-local MCP config, not global registration.

Default local server names:

- `trading_mcp_bybit_local`
- `trading_mcp_mexc_local`

Key launchers:

- Windows interactive session:
  - `scripts/start-codex-with-mcp.ps1`
- Linux interactive session:
  - `scripts/start-codex-with-mcp.sh`
- Windows app-server:
  - `scripts/start-codex-app-server-with-mcp.ps1`
- Linux app-server:
  - `scripts/start-codex-app-server-with-mcp.sh`
- Bybit stdio wrapper:
  - `scripts/run-trading-mcp-for-codex.ps1`
  - `scripts/run-trading-mcp-for-codex.sh`
- MEXC stdio wrapper:
  - `scripts/run-mexc-mcp-for-codex.ps1`
  - `scripts/run-mexc-mcp-for-codex.sh`

### Important current behavior

- Linux app-server launcher wires both Bybit and MEXC MCP servers.
- Windows app-server launcher goes through `get-codex-mcp-config-overrides.ps1`; verify it keeps parity with Linux whenever adding new servers or args.
- Browser Web UI denies shell command execution by default.
- Browser Web UI allows built-in web search by default.
- MCP tool call approvals are auto-approved by the Web UI bridge, while local shell/file-change requests are blocked or constrained by Web UI policy.

## 5. Local MCP Web UI Current State

### Architecture

App path: `apps/local-mcp-web-ui`

Runtime shape:

1. Browser loads local static UI and vendored ChatKit assets.
2. Node backend serves static files and ChatKit-compatible HTTP endpoints.
3. Backend spawns local `codex app-server` over stdio.
4. Codex app-server gets project-local Bybit and MEXC MCP servers.
5. Assistant output and progress events stream back to ChatKit.

The browser does not connect to `codex app-server` directly. All browser traffic goes through the Node backend in `apps/local-mcp-web-ui/src/server.mjs`; only that backend talks to `codex app-server` through `CodexAppServerClient`.

### Backend responsibilities

The Web UI backend is a protocol and safety bridge between ChatKit in the browser and the local Codex runtime. Current functionality:

- serves `index.html`, login UI, CSS/JS, and vendored ChatKit assets from `public`;
- exposes `/healthz` with auth/session state and ChatKit domain-key bootstrap data;
- handles backend session auth through `/auth/login` and `/auth/logout`, including cookie issuance and protected-route behavior;
- receives browser diagnostics through `/client-log` and writes structured logs;
- accepts `POST /chatkit/domain_keys/verify` locally and always returns successful verification;
- implements the ChatKit-compatible `/chatkit` API for thread list/get/update/delete, message persistence, user-turn submission, and SSE response streaming;
- stores ChatKit thread history locally in `apps/local-mcp-web-ui/.data/store.json`;
- starts and owns the child `codex app-server --listen stdio://` process via the configured platform launcher;
- initializes JSON-RPC with the app server, sends `turn/start`, receives app-server notifications, and converts them to ChatKit stream events;
- maps app-server progress notifications for MCP calls, web search, reasoning, shell commands, file changes, and plan updates into browser-visible stream items;
- enforces Web UI runtime policy: shell command execution is denied by default, web search is allowed by default, and MCP tool-call approvals are auto-approved by the bridge;
- relies on the app-server launcher scripts to attach project-local Bybit and MEXC MCP servers.

### UI assets

The Web UI vendors ChatKit runtime locally:

- `public/vendor/chatkit.js`
- `public/vendor/index-qHsKwIyx09.html`
- `public/assets/ck1/*`

This avoids runtime dependence on `cdn.platform.openai.com` for the ChatKit bundle and frame assets.

### Auth and publication

The Web UI supports:

- local HTTP mode:
  - `npm run webui:http`
  - default URL: `http://127.0.0.1:8787`
- Tailscale serve:
  - `npm run webui:serve`
  - forces `WEB_UI_AUTH_MODE=none`
- Tailscale funnel:
  - `npm run webui:funnel`
  - forces `WEB_UI_AUTH_MODE=session`
  - requires `WEB_UI_SESSION_PASSWORD`

Session auth:

- cookie name defaults to `local_mcp_web_ui_session`;
- session TTL defaults to 168 hours;
- unauthenticated browser access is redirected to `/login` or blocked with `401` depending on request type.

ChatKit domain verification:

- Backend accepts `POST /chatkit/domain_keys/verify` locally and returns successful verification without calling OpenAI.
- Multiple domain keys are supported via `WEB_UI_CHATKIT_DOMAIN_KEYS` and `WEB_UI_CHATKIT_DOMAIN_KEYS_JSON`.

### Storage and logs

Thread storage:

- `apps/local-mcp-web-ui/.data/store.json`

Structured logs:

- `apps/local-mcp-web-ui/artifacts/logs/webui-latest.jsonl`
- `apps/local-mcp-web-ui/artifacts/logs/webui-<session-id>.jsonl`

Screen log used on `singapur`:

- `apps/local-mcp-web-ui/artifacts/logs/screen-funnel.log`

## 6. Deployed State: singapur

As checked on 2026-06-16:

- Server: `singapur`
- Repo path: `/root/projects/trading-mcp`
- Git revision: `a19b2b0`
- Git tree on server: clean
- Main Web UI screen: `1164104.mcp`
- Web UI process:
  - `npm run webui:http`
  - `node apps/local-mcp-web-ui/src/server.mjs`
  - listens on `127.0.0.1:8787`
- Local `/login` health check:
  - `200 text/html`
- Tailscale Funnel:
  - `singapur.tail3e0cf.ts.net:443` proxies to `http://127.0.0.1:8787`
- Current observation:
  - multiple child Bybit/MEXC MCP stdio processes are present under the long-running Codex app-server;
  - this is operationally acceptable while memory/CPU are low, but should be monitored or cleaned up if process accumulation continues.

## 7. Verification Commands

Core:

```bash
npm run typecheck
npm run verify
```

Bybit:

```bash
npm run smoke:bybit
npm run smoke:bybit:rw
npm run codex:mcp:smoke
```

MEXC:

```bash
npm run smoke:mexc
npm run smoke:mexc:readonly
npm run smoke:mexc:write
npm run smoke:mexc:ws
npm run codex:mcp:smoke:mexc
```

Web UI:

```bash
npm run webui:chatkit-assets:smoke
npm run webui:chatkit-verify-proxy:smoke
npm run webui:web-search:smoke
npm run webui:app-server:smoke
npm run webui:mexc-routing:smoke
npm run webui:smoke
```

Deployment checks on `singapur`:

```bash
ssh singapur "cd /root/projects/trading-mcp && git status --short --branch && git log --oneline -3"
ssh singapur "screen -ls"
ssh singapur "curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8787/login"
ssh singapur "tailscale funnel status --json"
```

## 8. Implementation Plan

### Phase 1: Stabilize deployed Web UI runtime

Goal: keep `singapur` reliable as the primary always-on UI.

Tasks:

- Add a lightweight health command that reports:
  - git revision;
  - Web UI PID;
  - codex app-server PID;
  - count of child Bybit/MEXC MCP processes;
  - local `/login` HTTP status;
  - Tailscale Funnel status.
- Decide whether the accumulated child MCP stdio processes are expected Codex behavior or a leak.
- If it is a leak, update Web UI/Codex client lifecycle handling:
  - detect stale child MCP processes;
  - restart app-server when process count crosses a threshold;
  - add log markers for app-server child process cleanup.
- Add a documented restart command for `singapur` screen `mcp`.

### Phase 2: Improve Web UI safety model

Goal: make browser trading sessions safer before adding more write capabilities.

Tasks:

- Add a tool allowlist/denylist layer for Web UI sessions.
- Add per-tool risk labels:
  - read-only;
  - authenticated read;
  - order placement;
  - order cancellation;
  - asset movement;
  - strategy/bot creation.
- Require explicit browser-side confirmation for high-risk tools before passing approval to Codex.
- Separate read-only chat mode from trading-enabled mode.
- Add visible active key source indicators for Bybit:
  - direct;
  - RW alias;
  - RO alias.

### Phase 3: Bybit coverage completion

Goal: close known Bybit API gaps and improve trading workflows.

Tasks:

- Implement missing asset transfer write tools:
  - internal transfer;
  - universal transfer.
- Implement missing withdraw write tools only behind strict safety gates:
  - create withdraw;
  - cancel withdraw.
- Implement missing user/sub-account management tools only if needed.
- Add Strategy `pov` support.
- Add bot/strategy review snapshot:
  - active grids;
  - active DCA;
  - active TWAP/Iceberg/Chase/POV;
  - PnL/exposure/open orders;
  - risk warnings.
- Add non-destructive bot validation smoke:
  - grid validate;
  - futures grid validate;
  - martingale limit;
  - combo limit.

### Phase 4: MEXC reliability and strategy runtime

Goal: make MEXC safe and useful without relying on undocumented bot endpoints.

Tasks:

- Keep native MEXC tools focused on official public APIs.
- Add a read-only MEXC health snapshot:
  - balances;
  - open orders;
  - recent fills;
  - futures positions;
  - API permission summary.
- Add guarded write smoke for futures with very small notional and cleanup.
- Design custom strategy runtime for MEXC:
  - local persisted state;
  - idempotent reconciliation loop;
  - order/fill recovery after restart;
  - dry-run mode;
  - per-symbol risk limits.
- Implement strategies in this order:
  1. DCA spot;
  2. TWAP spot/futures;
  3. simple spot grid;
  4. guarded futures grid.

### Phase 5: Observability and audit trail

Goal: make trading actions explainable and recoverable.

Tasks:

- Persist every high-risk tool call with:
  - timestamp;
  - user prompt/thread id;
  - tool name;
  - normalized input;
  - exchange response;
  - confirmation state.
- Add redaction for secrets and API keys in all logs.
- Add per-exchange order journal:
  - submitted orders;
  - accepted/rejected status;
  - external/client order ids;
  - linked TP/SL orders.
- Add daily summary reports for:
  - open risk;
  - active bots/strategies;
  - failed tool calls;
  - stale orders.

### Phase 6: Packaging and docs cleanup

Goal: reduce mismatch between original Bybit package identity and current multi-exchange project.

Tasks:

- Decide whether to keep publishing as `bybit-official-trading-server` or split/fork naming for internal use.
- Update README language to reflect:
  - Bybit as primary/original server;
  - MEXC as project-local extension;
  - Web UI as local app, not part of public npm package unless explicitly packaged.
- Split docs into:
  - public Bybit MCP package docs;
  - local multi-exchange operational docs;
  - Web UI deployment docs;
  - server runbook for `singapur`.

## 9. Risk Register

| Risk | Current impact | Mitigation |
| --- | --- | --- |
| Browser session can access write tools once authenticated | High | Add tool allowlist and confirmation gates |
| MEXC has no sandbox | High | Keep write smoke separate, small-notional, with cleanup |
| Long-running Codex app-server may accumulate MCP child processes | Medium | Monitor process count, add restart/cleanup policy |
| `.env` and `.env.enc` handling can surprise deployments | Medium | Document hook behavior and deploy flow |
| Bybit RW aliases are enabled by default | Medium | Display key source, allow read-only Web UI mode |
| Public Funnel receives scanner traffic | Medium | Session auth blocks it; keep auth enabled for public mode |
| Generated tools can overwrite manual edits | Medium | Edit `codegen/tool-inventory.json` or bootstrap intentionally |

## 10. Immediate Next Actions

1. Commit or intentionally leave uncommitted `BOT_API_RESEARCH_2026-06-08.md`.
2. Add this current-state plan to version control.
3. Create `scripts/check-singapur-webui.sh` or equivalent PowerShell wrapper for the health checks above.
4. Add a Web UI risk gate before any new exchange write capability is exposed.
5. Add Bybit Strategy `pov` support and a read-only bot/strategy review snapshot.
