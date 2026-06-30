import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChatKitStore } from "./chatkit-store.mjs";
import { CodexThreadReconciler } from "./codex-thread-reconciler.mjs";

class FakeCodexClient {
  constructor() {
    this.requests = [];
  }

  async sendRequest(method, params) {
    this.requests.push({ method, params });
    if (method === "thread/list") {
      return {
        data: [
          {
            id: "thread-1",
            name: "Imported thread",
            cwd: "/repo",
            updatedAt: "2026-06-17T10:00:00.000Z",
          },
        ],
      };
    }
    if (method === "thread/read") {
      return {
        thread: {
          id: params.threadId,
          name: "Imported thread",
          cwd: "/repo",
          createdAt: "2026-06-17T09:00:00.000Z",
          updatedAt: "2026-06-17T10:00:00.000Z",
          turns: [
            {
              id: "turn-1",
              startedAt: "2026-06-17T09:30:00.000Z",
              items: [
                {
                  type: "userMessage",
                  id: "user-1",
                  content: [{ type: "text", text: "Resume this" }],
                },
                {
                  type: "agentMessage",
                  id: "assistant-1",
                  text: "Resumed.",
                },
              ],
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected method ${method}`);
  }
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webui-reconcile-"));
  const store = new ChatKitStore({
    filePath: path.join(dir, "store.json"),
    sessionId: "test-session",
  });
  await store.initialize();

  const codexClient = new FakeCodexClient();
  const reconciler = new CodexThreadReconciler({
    codexClient,
    store,
    model: "gpt-5.5",
    repoRoot: "/repo",
  });

  const listed = await reconciler.listThreads();
  assert.equal(listed.length, 1);

  await reconciler.reconcileThread("thread-1");
  await reconciler.reconcileThread("thread-1");

  const thread = await store.getThread("thread-1");
  assert.equal(thread.title, "Imported thread");
  assert.equal(thread.metadata.cwd, "/repo");
  assert.equal(thread.items.data.length, 2);
  assert.equal(thread.items.data[0].content[0].text, "Resume this");
  assert.equal(thread.items.data[1].content[0].text, "Resumed.");

  await fs.rm(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true }));
}

await main();
