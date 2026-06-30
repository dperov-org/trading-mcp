import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChatKitStore } from "./chatkit-store.mjs";
import { ExternalChangeSync } from "./external-change-sync.mjs";

class FakeEventHub {
  constructor() {
    this.events = [];
  }

  broadcast(event) {
    this.events.push(event);
  }
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webui-external-sync-"));
  const store = new ChatKitStore({
    filePath: path.join(dir, "store.json"),
    sessionId: "test-session",
  });
  await store.initialize();

  const codexClient = new EventEmitter();
  const eventHub = new FakeEventHub();
  const sync = new ExternalChangeSync({
    codexClient,
    store,
    eventHub,
    model: "gpt-5.5",
    enabled: true,
  });

  sync.start();
  await sync.onNotification({
    method: "thread/started",
    params: {
      threadId: "thread-1",
      thread: {
        id: "thread-1",
        name: "External thread",
      },
    },
  });
  await sync.onNotification({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "userMessage",
        id: "user-1",
        content: [{ type: "text", text: "Continue task" }],
      },
    },
  });
  await sync.onNotification({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "assistant-1",
      delta: "Done",
    },
  });
  await sync.onNotification({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "agentMessage",
        id: "assistant-1",
        text: "Done.",
      },
    },
  });
  await sync.onNotification({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "agentMessage",
        id: "assistant-1",
        text: "Done.",
      },
    },
  });
  const thread = await store.getThread("thread-1");
  assert.equal(thread.title, "External thread");
  assert.equal(thread.items.data.length, 2);
  assert.equal(thread.items.data[0].type, "user_message");
  assert.equal(thread.items.data[0].content[0].text, "Continue task");
  assert.equal(thread.items.data[1].type, "assistant_message");
  assert.equal(thread.items.data[1].content[0].text, "Done.");
  assert.ok(eventHub.events.length > 0);

  sync.stop();

  const ignoredEventHub = new FakeEventHub();
  const ignoredSync = new ExternalChangeSync({
    codexClient,
    store,
    eventHub: ignoredEventHub,
    model: "gpt-5.5",
    enabled: true,
    ignoredThreadIds: new Set(["thread-ignored"]),
  });
  await ignoredSync.onNotification({
    method: "thread/started",
    params: {
      threadId: "thread-ignored",
      thread: {
        id: "thread-ignored",
        name: "Ignored Web UI thread",
      },
    },
  });
  assert.equal(ignoredEventHub.events.length, 0);
  assert.equal(await store.getThread("thread-ignored"), null);

  await fs.rm(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true }));
}

await main();
