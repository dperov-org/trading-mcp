# Web UI External Changes Support Plan

Date: 2026-06-17

## Goal

Make `apps/local-mcp-web-ui` reflect Codex thread changes that are created outside the Web UI process.

Target examples:

- `codex --remote ws://singapur.tail3e0cf.ts.net:8790 resume <thread-id>`
- `codex --remote ws://singapur.tail3e0cf.ts.net:8790 resume --last`
- future external clients that call `thread/resume`, `turn/start`, or other thread mutation APIs against the same Codex app-server

Current behavior: Web UI only shows messages that pass through its own `/chatkit` endpoint. External Codex changes update Codex state/rollout, but not the Web UI `ChatKitStore`, so the browser does not show them.

## Current State

Web UI architecture:

```text
browser ChatKit
  -> POST /chatkit
  -> apps/local-mcp-web-ui/src/server.mjs
  -> ChatKitStore JSON file
  -> CodexAppServerClient
  -> codex app-server
```

Important current implementation details:

- `server.mjs` handles ChatKit `threads.create` and `threads.add_user_message`.
- `server.mjs` starts a temporary Codex notification listener only during a single `/chatkit` SSE response.
- `ChatKitStore` is the only source served to ChatKit for `threads.list`, `threads.get_by_id`, and `items.list`.
- `ChatKitStore` filters visible threads by Web UI `session_id`.
- There is no long-running background synchronization from Codex app-server into `ChatKitStore`.
- There is no server-to-browser update channel except the active ChatKit request stream.

Codex app-server behavior relevant to this plan:

- In `ws://` mode, multiple initialized clients can connect.
- App-server emits thread/turn/item notifications.
- Some notifications are broadcast, some are scoped to connections attached to a thread.
- Running-thread resume/rejoin exists in app-server, but Web UI currently does not translate external notifications into ChatKit records.

## Desired Behavior

When an external Codex client continues a thread that Web UI knows about:

1. Web UI records the external user input in `ChatKitStore`.
2. Web UI records assistant output, command/tool progress summaries, and final assistant message.
3. Browser with that thread open updates without a manual refresh when technically possible.
4. Browser history shows the updated thread order and latest items.
5. Duplicate events from reconnect/replay do not create duplicate ChatKit items.
6. Web UI shows a compact current-session status row so the user can see whether they are working in a new Web UI thread or a resumed Codex thread.

When an external Codex client creates or resumes a thread that Web UI does not know about:

- Phase 1: ignore by default unless the thread can be mapped to this Web UI session.
- Phase 2: optionally import discoverable Codex threads into Web UI history.

## Non-Goals

- Do not make Web UI the owner of all Codex persistence.
- Do not replace Codex state DB or rollout files.
- Do not require browser clients to speak Codex app-server protocol directly.
- Do not expose Codex app-server publicly through Funnel.
- Do not make `codex exec` magically update Web UI unless it targets the same remote app-server or an explicit import/sync path is added.

## Design Overview

Add a Web UI synchronization layer:

```text
Codex app-server ws://
  -> CodexAppServerClient persistent connection
  -> ExternalChangeSync
  -> ChatKitStore
  -> Browser update channel
  -> ChatKit UI refresh/update
```

The key change is that Web UI must have a long-running Codex event consumer independent of a single ChatKit request.

## Phase 1: Server-Side Store Sync

### 1. Add Codex Event Normalizer

Create a module:

```text
apps/local-mcp-web-ui/src/codex-event-normalizer.mjs
```

Responsibilities:

- Accept Codex app-server notifications.
- Normalize event names and ids:
  - `thread/started`
  - `turn/started`
  - `item/started`
  - `item/agentMessage/delta`
  - `item/completed`
  - `turn/completed`
  - thread status/name/goal updates if needed
- Produce internal normalized events:
  - `external_thread_seen`
  - `external_turn_started`
  - `external_user_message_seen`
  - `external_assistant_delta`
  - `external_assistant_done`
  - `external_progress`
  - `external_turn_done`

The normalizer should preserve original Codex ids for idempotency.

### 2. Extend ChatKitStore Schema

Current store item ids are generated independently. Add metadata fields to support external synchronization:

```json
{
  "id": "assistant_...",
  "metadata": {
    "source": "webui|codex_external",
    "codex_thread_id": "...",
    "codex_turn_id": "...",
    "codex_item_id": "...",
    "codex_event_source": "notification|history_import",
    "updated_at": "..."
  }
}
```

Add store helpers:

- `upsertThreadFromCodex(thread)`
- `appendItemIfMissing(threadId, item, dedupeKey)`
- `upsertAssistantDraft(threadId, codexTurnId, codexItemId, delta)`
- `finalizeAssistantDraft(threadId, codexTurnId, codexItemId, finalText)`
- `markTurnCompleted(threadId, codexTurnId)`

Idempotency key:

```text
codex:<threadId>:<turnId>:<itemId>:<itemKind>
```

For ChatKit-created items, also write Codex metadata so later external events can be matched instead of duplicated.

### 3. Add ExternalChangeSync Service

Create:

```text
apps/local-mcp-web-ui/src/external-change-sync.mjs
```

Responsibilities:

- Subscribe to `codexClient.on("notification", ...)` for the lifetime of the server.
- Ignore events produced by Web UI's currently active `/chatkit` stream until idempotency is in place.
- Convert Codex events into ChatKitStore mutations.
- Emit local Web UI events when store changes.

Integration point:

```text
startWebUiServer()
  -> create store
  -> create codexClient
  -> codexClient.start()
  -> externalChangeSync.start()
```

Important: this must not write to the HTTP SSE response directly. It only updates store and emits Web UI-side notifications.

### 4. Track Active Web UI Turns

`streamCodexTurn()` currently owns a temporary listener. Keep that path for low-latency streaming, but register active Web UI turns in a shared tracker:

```text
activeWebUiTurns:
  codexThreadId -> codexTurnId -> requestId
```

ExternalChangeSync should either:

- skip active Web UI turns, because `streamCodexTurn()` already writes them, or
- use the same idempotent store APIs and allow duplicate event delivery safely.

Preferred implementation: use idempotent store APIs and keep a conservative skip only for direct browser stream events.

## Phase 2: Browser Update Channel

ChatKit currently polls/loads via `/chatkit`, and active responses are SSE only for the request that started the turn.

Add a Web UI event channel:

```text
GET /events
```

SSE payload examples:

```json
{ "type": "thread.updated", "thread_id": "..." }
{ "type": "thread.item.added", "thread_id": "...", "item_id": "..." }
{ "type": "thread.item.updated", "thread_id": "...", "item_id": "..." }
{ "type": "threads.changed" }
```

Server responsibilities:

- Maintain connected browser SSE clients.
- Broadcast store mutation events from `ExternalChangeSync`.
- Include monotonically increasing event ids for reconnect.
- Keep auth checks identical to the main Web UI session.

Client responsibilities in `public/app.js`:

- Open `EventSource("/events")` after auth/session bootstrap.
- On event for the current thread, trigger a ChatKit refresh if ChatKit exposes one.
- If ChatKit has no public refresh API, use the least invasive workaround:
  - update `initialThread` only on reload;
  - show a small non-blocking "Conversation updated" status with a reload action;
  - or remount ChatKit after debounced external updates.

Research task: inspect the local ChatKit bundle/API for refresh/reload methods before choosing the client strategy.

## Phase 3: History Import / Reconciliation

Notifications only cover live events while Web UI is connected. Add reconciliation for missed changes:

1. On Web UI startup:
   - call Codex app-server thread list APIs if available;
   - find threads relevant to Web UI repo/session;
   - import missing turns/items.
2. On browser opening a thread:
   - compare ChatKitStore latest known Codex turn/item with app-server thread history;
   - import missing items before returning `threads.get_by_id` or `items.list`.
3. On app-server reconnect:
   - run the same reconciliation for known Web UI threads.

Candidate app-server APIs to use:

- `thread/list`
- `thread/resume` with `excludeTurns`
- `thread/turns/list`
- `thread/turn/items/list`
- `thread/get` if available in the current protocol

Need to verify exact request names and response shapes against Codex `app-server-protocol` before implementation.

## Phase 4: Explicit Session Selection URLs

Add explicit Web UI routes that let the user decide whether to continue an existing Codex session or start a new one.

Routes:

```text
GET /select
GET /last
GET /new
```

### `/select`

Purpose: show a lightweight session picker before opening ChatKit.

Behavior:

1. Web UI queries Codex app-server for resumable threads.
2. Web UI filters sessions to the current project/repo where possible.
3. Page displays:
   - recent Codex sessions;
   - current Web UI-known ChatKit threads;
   - a clear "Start new session" action.
4. Selecting a session:
   - imports/reconciles that Codex thread into `ChatKitStore`;
   - stores selected thread id in browser localStorage/session cookie;
   - redirects to `/`.
5. Selecting "new":
   - clears selected thread id from localStorage/session cookie;
   - redirects to `/new`.

Session rows should show enough context to avoid accidental selection:

- thread id short form;
- title/name if available;
- cwd/repo;
- updated timestamp;
- source/client if available;
- whether it already exists in Web UI store.

### `/last`

Purpose: one-click "continue latest suitable Codex session".

Behavior:

1. Web UI queries Codex app-server for latest resumable thread.
2. Applies the same repo/session filters as `/select`.
3. Imports/reconciles the selected thread into `ChatKitStore`.
4. Persists it as the browser's selected thread.
5. Redirects to `/`.

If no suitable thread is found:

- redirect to `/new`, or
- show `/select` with an empty-state message.

Preferred behavior: redirect to `/select?empty=last`.

### `/new`

Purpose: force a fresh Web UI conversation.

Behavior:

1. Clears browser-selected thread state.
2. Clears any server-side selected-thread cookie if introduced.
3. Redirects to `/`.
4. First user message creates a new Codex `thread/start` as today.

This must not delete old Codex sessions or ChatKitStore history.

### Browser State

Current browser selection lives only in localStorage:

```text
local-mcp-web-ui.thread.<sessionId>
```

For `/select`, `/last`, and `/new`, localStorage alone is awkward because server-side redirects cannot directly update it.

Recommended implementation:

1. Add a small `/session-choice.js` helper page/script for `/select`, `/last`, `/new` redirects that can update localStorage client-side.
2. Alternatively add a short-lived signed cookie:

```text
local_mcp_web_ui_selected_thread=<thread-id|new>
```

Preferred approach: use signed cookie plus localStorage synchronization in `public/app.js`.

`public/app.js` startup priority should become:

1. explicit selected thread from `/healthz` or selected-thread cookie;
2. localStorage thread id;
3. no thread, start screen.

### API Additions

Add internal endpoints:

```text
GET /api/sessions
POST /api/session/select
POST /api/session/new
```

These should be protected by the same session auth as `/chatkit`.

`GET /api/sessions` returns:

```json
{
  "data": [
    {
      "thread_id": "...",
      "title": "...",
      "cwd": "/root/projects/trading-mcp",
      "updated_at": "...",
      "source": "cli|exec|webui|unknown",
      "known_to_webui": true
    }
  ]
}
```

`POST /api/session/select`:

- validates requested thread id;
- imports/reconciles it;
- sets selected-thread cookie;
- returns redirect target or JSON `{ ok: true, thread_id }`.

`POST /api/session/new`:

- clears selected-thread cookie;
- returns redirect target or JSON `{ ok: true }`.

### UI Requirements

`/select` should be a simple operational page, not a marketing/landing page:

- table/list of sessions;
- clear timestamps;
- buttons:
  - Continue
  - Start new
  - Refresh
- no external assets required beyond existing local CSS.

### Current Session Status Row

Add a compact status row above ChatKit on `/` showing the active session context.

Required fields:

- mode: `new`, `browser`, `selected`, `last`, or `external`;
- Web UI thread id short form;
- Codex thread id short form;
- title/name if known;
- source/client if known;
- cwd/repo if known;
- last updated timestamp;
- sync state:
  - `live`
  - `syncing`
  - `stale`
  - `offline`
  - `error`

Optional fields, if available from Codex app-server notifications/history:

- total input tokens;
- total output tokens;
- total tokens;
- last turn token usage;
- model;
- service tier.

Implementation notes:

- Token statistics should be best-effort. Do not block session selection or chat rendering if app-server does not expose usage in a stable payload.
- Prefer app-server `thread/tokenUsage/updated` notifications or persisted turn usage if available.
- Store token usage in `ChatKitStore.thread.metadata.token_usage`.
- Expose status via `/healthz` and a lightweight endpoint:

```text
GET /api/current-session
```

Suggested response:

```json
{
  "mode": "selected",
  "webui_thread_id": "...",
  "codex_thread_id": "...",
  "title": "...",
  "source": "webui|codex_external|unknown",
  "cwd": "/root/projects/trading-mcp",
  "updated_at": "...",
  "sync_state": "live",
  "token_usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

Browser behavior:

- `public/app.js` fetches `/api/current-session` on startup.
- Render the row before/above ChatKit.
- Update it on `/events` messages.
- If token usage is unavailable, hide token fields rather than showing zero as a real value.

### Acceptance Criteria

- Opening `/new` always lands on ChatKit start screen with no active thread.
- Opening `/last` resumes/imports the latest suitable Codex session and then opens `/`.
- Opening `/select` lets the user choose a specific session or start new.
- Selected thread survives page reload.
- `/` shows the current-session status row.
- Status row updates after external changes or page reload.
- Token stats are shown when app-server provides them and omitted otherwise.
- Browser localStorage and server-selected state do not fight each other.
- Auth applies to `/select`, `/last`, `/new`, and session APIs.
- Existing `/` behavior remains compatible for users who do not use these URLs.

## Thread Ownership Rules

Avoid importing unrelated Codex sessions into this Web UI by default.

A Codex thread is considered Web UI-owned if any of these are true:

- it exists in `ChatKitStore`;
- its cwd/repo root matches `config.repoRoot` and it has Web UI metadata;
- it was created by Web UI and has `metadata.session_id`;
- later: app-server thread metadata includes `client_name=local-mcp-web-ui` or a custom marker.

Add a custom Web UI marker when creating threads if supported by Codex thread metadata. If not supported, store the mapping only in `ChatKitStore`.

## Handling `codex exec resume`

Plain `codex exec resume --last "..."` currently starts an in-process app-server inside the CLI process. It does not use the Web UI's app-server connection and will not produce live notifications for Web UI.

Supported paths after this plan:

1. `codex --remote ws://... resume ...`
   - live external updates can be captured by Web UI.
2. `codex exec resume ...` without remote
   - not live;
   - can only be reflected via Phase 3 history import if both processes write to the same Codex state DB/rollout storage and thread ownership can be matched.

If live Web UI updates are required for non-interactive CLI, investigate whether `codex exec` supports `--remote`. If not, add or upstream a remote mode for exec.

## Failure Modes

- App-server websocket disconnects:
  - Web UI should keep serving existing ChatKitStore data.
  - `/readyz` should expose sync status.
  - ExternalChangeSync should reconnect with backoff.
  - Reconciliation should run after reconnect.

- Duplicate notifications:
  - Store writes must be idempotent by Codex ids.

- Partial assistant deltas without final item:
  - Store draft assistant item with `status=in_progress`.
  - Finalize on `item/completed` or `turn/completed`.
  - On reconciliation, replace draft with persisted final text.

- Web UI restarted during external turn:
  - Startup reconciliation should recover final persisted state.
  - Live mid-turn streaming may be missed until app-server provides replay/resume support for active turns.

- ChatKit cannot refresh programmatically:
  - Use a reload/remount fallback and document this limitation.

## Implementation Steps

1. Add store schema metadata and idempotent write helpers.
2. Add tests for `ChatKitStore` idempotent append/upsert/finalize.
3. Add `codex-event-normalizer.mjs`.
4. Add unit tests with captured Codex notification payloads.
5. Add `external-change-sync.mjs`.
6. Wire sync service into `startWebUiServer()`.
7. Update `streamCodexTurn()` to write Codex metadata on Web UI-created user and assistant items.
8. Add `/events` SSE endpoint with auth.
9. Update `public/app.js` to consume `/events`.
10. Research ChatKit refresh API; implement refresh/remount/reload fallback.
11. Add smoke test:
    - start Web UI against external app-server;
    - create a Web UI thread;
    - start a turn through a second Codex app-server client;
    - verify ChatKitStore receives the new items.
12. Add browser smoke test:
    - open thread;
    - trigger external turn;
    - verify UI changes or reload notification appears.
13. Add startup reconciliation for known Web UI threads.
14. Add `/healthz` and `/readyz` fields:
    - `external_sync_enabled`
    - `external_sync_connected`
    - `external_sync_last_event_at`
    - `external_sync_last_reconcile_at`
    - `external_sync_error`

## Suggested Configuration

```env
WEB_UI_EXTERNAL_CHANGE_SYNC=true
WEB_UI_EXTERNAL_CHANGE_SYNC_RECONCILE_ON_START=true
WEB_UI_EXTERNAL_CHANGE_SYNC_RECONCILE_INTERVAL_MS=60000
WEB_UI_BROWSER_EVENTS=true
WEB_UI_IMPORT_UNKNOWN_CODEX_THREADS=false
```

Defaults:

- `WEB_UI_EXTERNAL_CHANGE_SYNC=true` when `WEB_UI_CODEX_MODE=external`
- `WEB_UI_EXTERNAL_CHANGE_SYNC=false` when using spawned stdio app-server unless explicitly enabled
- `WEB_UI_BROWSER_EVENTS=true`
- `WEB_UI_IMPORT_UNKNOWN_CODEX_THREADS=false`

## Acceptance Criteria

- A Web UI-created thread continued from a second remote Codex client appears in Web UI history.
- The external user prompt and assistant answer are visible after refresh.
- If browser is open, it either updates live or shows a clear update/reload state.
- Duplicate notifications do not duplicate messages.
- Web UI still works when app-server is unavailable, using cached store data.
- Existing ChatKit-created turns continue streaming as before.

## Open Questions

1. Does ChatKit expose a supported method to refresh the current thread/items?
2. Which Codex app-server history APIs are stable enough for reconciliation in `0.135.0`?
3. Can `codex exec` use a remote app-server today, or does it always create an in-process app-server?
4. Can Codex app-server accept custom thread metadata at `thread/start` to mark Web UI ownership?
5. Should Web UI import unknown repo-matching Codex threads, or only threads it created itself?
