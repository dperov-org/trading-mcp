# Web UI local assets implementation

Date: 2026-06-16

This document records the current Web UI implementation and the remaining work needed to move browser JavaScript and frame assets fully onto the local server, with no dependency on external asset storage at runtime.

## Current Web UI architecture

The Web UI lives in `apps/local-mcp-web-ui`.

Runtime path:

1. Browser opens the local Web UI.
2. The Node backend serves static files from `apps/local-mcp-web-ui/public`.
3. Browser loads the local ChatKit bundle from `/vendor/chatkit.js`.
4. ChatKit uses the local backend endpoint `/chatkit`.
5. The backend starts `codex app-server` over stdio.
6. `codex app-server` runs with project-local Bybit and MEXC MCP servers.
7. Assistant output, MCP progress, and errors are streamed back through the backend to ChatKit.

The browser does not call `codex app-server` directly.

## Current backend functionality

The backend is implemented mainly in:

- `apps/local-mcp-web-ui/src/server.mjs`
- `apps/local-mcp-web-ui/src/codex-app-server-client.mjs`
- `apps/local-mcp-web-ui/src/chatkit-store.mjs`
- `apps/local-mcp-web-ui/src/auth.mjs`
- `apps/local-mcp-web-ui/src/config.mjs`

Implemented responsibilities:

- serves `index.html`, `login.html`, `app.js`, `login.js`, `styles.css`, `/vendor/*`, and `/assets/*`;
- exposes `/healthz` with auth state and ChatKit domain-key bootstrap data;
- exposes `/readyz` for launcher readiness checks;
- handles session auth through `/auth/login` and `/auth/logout`;
- receives browser diagnostics through `/client-log`;
- accepts `POST /chatkit/domain_keys/verify` locally and always returns successful verification;
- implements ChatKit-compatible `/chatkit` thread and streaming APIs;
- persists local ChatKit thread history to `apps/local-mcp-web-ui/.data/store.json`;
- starts `codex app-server --listen stdio://` through the platform launcher;
- translates app-server notifications into browser-visible ChatKit stream events;
- blocks shell command execution by default while allowing MCP tool calls.

## Current local asset implementation

The browser bootstrap is already local-first.

Relevant files:

- `apps/local-mcp-web-ui/public/index.html`
- `apps/local-mcp-web-ui/public/app.js`
- `apps/local-mcp-web-ui/public/vendor/chatkit.js`
- `apps/local-mcp-web-ui/public/vendor/index-qHsKwIyx09.html`
- `apps/local-mcp-web-ui/public/assets/ck1/*`
- `apps/local-mcp-web-ui/scripts/fetch-chatkit-vendor.mjs`
- `apps/local-mcp-web-ui/src/smoke-chatkit-assets.mjs`

Current behavior:

- `public/app.js` loads ChatKit from the local path `/vendor/chatkit.js`.
- `fetch-chatkit-vendor.mjs` downloads the ChatKit browser bundle from `https://cdn.platform.openai.com/deployments/chatkit/chatkit.js`.
- The vendor script follows the embedded frame HTML and first-layer asset graph.
- It writes the browser bundle to `public/vendor/chatkit.js`.
- It writes the embedded frame HTML to `public/vendor/index-*.html`.
- It writes frame chunks, locale chunks, UMD chunks, CSS, favicon, and other discovered frame assets to `public/assets/ck1`.
- It patches ChatKit frame code so `https://api.openai.com/v1/chatkit/domain_keys/verify` is called through the local backend path `/chatkit/domain_keys/verify`.
- The backend no longer proxies that request to OpenAI; it returns a local success response with `ok=true`, `valid=true`, and `verified=true`.
- `smoke-chatkit-assets.mjs` checks that the locally served asset graph returns `200` for required files.

This means the normal browser bootstrap does not depend on `cdn.platform.openai.com` at runtime when the vendored files are present and complete.

## What is already decoupled from external asset storage

Already local:

- top-level Web UI HTML, CSS, and application JavaScript;
- ChatKit browser bundle;
- ChatKit embedded frame HTML;
- first-layer frame assets;
- lazy-loaded `index-*` chunks discovered by the vendor script;
- locale chunks under `/assets/ck1`;
- ChatKit static image/favicon assets discovered during vendoring;
- ChatKit API traffic, because the browser sends it to local `/chatkit`.

Still external by design:

- OpenAI/Codex model execution through `codex app-server`;
- optional built-in web search;
- Bybit and MEXC exchange APIs;
- Tailscale serve/funnel publication;
- ChatKit vendor refresh command, which intentionally downloads a new asset snapshot from the CDN.

## Remaining work for full runtime detachment from external asset storage

The main remaining work is not large in code volume, but it needs strict validation because ChatKit is a vendor bundle with lazy-loaded assets.

### 1. Add a local asset manifest

Create a generated manifest such as:

```text
apps/local-mcp-web-ui/public/vendor/chatkit-assets.manifest.json
```

The manifest should include:

- source ChatKit CDN URL;
- fetched timestamp;
- bundle filename and hash;
- frame HTML filename and hash;
- every `/assets/ck1/*` file and hash;
- discovered import/link graph;
- any skipped external URLs.

Estimated change size:

- `fetch-chatkit-vendor.mjs`: medium update;
- `smoke-chatkit-assets.mjs`: small update to validate manifest coverage;
- documentation: small update.

### 2. Make asset vendoring fail closed

The vendor script should fail if it finds a runtime asset URL that is neither localizable nor explicitly allowlisted.

Current script already follows known `/assets/*` and `/vendor/*` paths. The next step is to make unknown external URLs visible as a hard failure, not only a best-effort download gap.

Required checks:

- no `https://cdn.platform.openai.com` references left in `public/vendor/chatkit.js`;
- no CDN references left in `public/vendor/index-*.html`;
- no CDN references left in local JS/CSS chunks;
- no dynamic import path points outside `/assets/ck1` or `/vendor`;
- every referenced local path exists on disk.

Estimated change size:

- script hardening: medium;
- smoke coverage: medium.

### 3. Add a no-network browser smoke test

Current smoke validates local files over HTTP. It should be extended with a browser-level no-external-network check.

Recommended implementation:

- start the Web UI locally;
- launch Playwright;
- route/block all requests except the local Web UI origin;
- load the UI;
- wait for `openai-chatkit` to be defined;
- verify ChatKit renders;
- fail on any attempted request to `cdn.platform.openai.com` or external asset hosts.

This smoke should not require a live model turn. It only needs to prove the browser shell and ChatKit frame boot without external asset storage.

Estimated change size:

- new smoke script: medium;
- package scripts: small;
- CI/local docs: small.

### 4. ChatKit domain verification is locally accepted

The backend now removes this external runtime dependency. `POST /chatkit/domain_keys/verify` is handled locally and always returns successful verification:

```json
{
  "ok": true,
  "valid": true,
  "verified": true,
  "local": true
}
```

Current implications:

- browser access to OpenAI verify is removed;
- backend access to OpenAI verify is also removed;
- `WEB_UI_CHATKIT_VERIFY_URL` is no longer used by the backend;
- the existing smoke test now verifies local always-true behavior instead of upstream proxy forwarding.

Remaining risk:

- this bypass depends on the current ChatKit frame accepting a successful JSON verification response at the same local endpoint shape;
- every future ChatKit vendor refresh should run the ChatKit asset smoke and browser smoke to catch response-shape changes.

### 5. Pin and refresh ChatKit snapshots deliberately

The vendored ChatKit files are an external binary/runtime snapshot. Full local operation should treat them as pinned artifacts.

Recommended policy:

- commit the vendored files when intentionally refreshed;
- record hashes in the manifest;
- add a short changelog entry for each refresh;
- keep `npm run webui:vendor:chatkit` as a deliberate maintenance command, not a startup requirement.

Estimated change size:

- manifest and docs: small;
- operational process: no runtime code.

### 6. Add Content Security Policy for asset isolation

After no-network smoke is stable, add a CSP header in the backend.

Initial target:

```text
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self' https://api.openai.com;
frame-src 'self';
worker-src 'self' blob:;
```

This must be tested against the current ChatKit bundle. The CSP may need `blob:` or `data:` for frame internals.

For strict asset-detached mode, `connect-src` should be narrowed to `'self'` plus only the explicitly required API endpoints for the selected mode.

Estimated change size:

- server static response headers: small;
- browser smoke tuning: medium.

## Estimated implementation scope

Small version, enough to prove local asset serving:

- add manifest generation;
- harden local path checks;
- add no-network Playwright smoke;
- document the vendor refresh process.

Estimated effort: 0.5-1.0 engineering day.

Strict version, suitable for public operation with auditable local assets:

- all small-version items;
- CSP;
- local always-true ChatKit verification documented and smoke-tested;
- fail-closed external URL scanning;
- committed manifest hashes;
- deployment checklist for refreshing ChatKit.

Estimated effort: 1.5-2.5 engineering days.

Full replacement of ChatKit with a project-owned UI:

- remove ChatKit dependency entirely;
- implement native chat thread list, message renderer, composer, streaming protocol, progress items, auth states, and error states;
- keep the existing Node backend and `codex app-server` bridge;
- remove domain-key verification and ChatKit-specific protocol adapter.

Estimated effort: 5-10 engineering days for a solid first version, more if matching ChatKit polish and edge cases.

## Recommended next implementation plan

1. Keep the current backend and ChatKit integration.
2. Add `chatkit-assets.manifest.json` generation.
3. Add fail-closed scanning for external asset URLs.
4. Add `webui:chatkit-offline:smoke` with Playwright request blocking.
5. Keep `POST /chatkit/domain_keys/verify` local always-true and verify it in smoke tests.
6. Add CSP after the smoke test proves which browser capabilities ChatKit needs.
7. Treat ChatKit vendor refreshes as pinned, reviewed changes.

This gives the project local runtime assets without forcing a full UI rewrite now.
