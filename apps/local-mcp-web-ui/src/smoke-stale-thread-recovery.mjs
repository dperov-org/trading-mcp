import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WebSocketServer } from "ws";

import { startWebUiServer } from "./server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify({ jsonrpc: "2.0", ...payload }));
}

function readSseEvents(response) {
  return (async () => {
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    const events = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));
        if (data.length > 0) {
          events.push(JSON.parse(data.join("\n")));
        }
      }
    }

    return events;
  })();
}

async function postChatkit(url, body) {
  const response = await fetch(`${url}/chatkit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(response.ok, `ChatKit returned ${response.status}`);
  return readSseEvents(response);
}

function chatInput(text) {
  return {
    content: [{ type: "input_text", text }],
    attachments: [],
    inference_options: { model: "gpt-5.5" },
  };
}

function createFakeAppServer() {
  const staleThreadId = "stale-thread";
  const replacementThreadId = "replacement-thread";
  const turnStarts = [];
  let threadStartCount = 0;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  server.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === "initialized") {
        return;
      }

      if (message.method === "initialize") {
        sendJson(ws, { id: message.id, result: { userAgent: "stale-thread-smoke" } });
        return;
      }

      if (message.method === "thread/read") {
        if (message.params.threadId === staleThreadId) {
          sendJson(ws, {
            id: message.id,
            error: { code: -32600, message: `thread not found: ${staleThreadId}` },
          });
          return;
        }
        sendJson(ws, {
          id: message.id,
          result: { thread: { id: message.params.threadId } },
        });
        return;
      }

      if (message.method === "thread/start") {
        threadStartCount += 1;
        sendJson(ws, {
          id: message.id,
          result: {
            thread: {
              id: threadStartCount === 1 ? staleThreadId : replacementThreadId,
            },
          },
        });
        return;
      }

      if (message.method === "turn/start") {
        turnStarts.push(message.params);
        const turnId = `turn-${turnStarts.length}`;
        const itemId = `agent-${turnStarts.length}`;
        sendJson(ws, { id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
        queueMicrotask(() => {
          sendJson(ws, {
            method: "turn/started",
            params: { threadId: message.params.threadId, turn: { id: turnId } },
          });
          sendJson(ws, {
            method: "item/started",
            params: {
              threadId: message.params.threadId,
              turnId,
              item: { id: itemId, type: "agentMessage" },
            },
          });
          sendJson(ws, {
            method: "item/agentMessage/delta",
            params: { threadId: message.params.threadId, turnId, itemId, delta: "Recovered answer" },
          });
          sendJson(ws, {
            method: "item/completed",
            params: {
              threadId: message.params.threadId,
              turnId,
              item: { id: itemId, type: "agentMessage", text: "Recovered answer" },
            },
          });
          sendJson(ws, {
            method: "turn/completed",
            params: {
              threadId: message.params.threadId,
              turn: {
                id: turnId,
                status: "completed",
                items: [{ id: itemId, type: "agentMessage", text: "Recovered answer" }],
              },
            },
          });
        });
        return;
      }

      throw new Error(`Unexpected fake app-server request: ${message.method}`);
    });
  });

  return { server, staleThreadId, replacementThreadId, turnStarts };
}

async function main() {
  const fake = createFakeAppServer();
  await once(fake.server, "listening");
  const fakePort = fake.server.address().port;
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "webui-stale-thread-"));
  const storePath = path.join(temporaryDir, "store.json");
  const previous = Object.fromEntries(
    ["WEB_UI_PORT", "WEB_UI_AUTH_MODE", "WEB_UI_CODEX_MODE", "WEB_UI_CODEX_APP_SERVER_URL", "WEB_UI_STORE_PATH"]
      .map((key) => [key, process.env[key]]),
  );
  process.env.WEB_UI_PORT = "8893";
  process.env.WEB_UI_AUTH_MODE = "none";
  process.env.WEB_UI_CODEX_MODE = "external";
  process.env.WEB_UI_CODEX_APP_SERVER_URL = `ws://127.0.0.1:${fakePort}`;
  process.env.WEB_UI_STORE_PATH = storePath;

  let runtime = null;
  try {
    runtime = await startWebUiServer();
    const created = await postChatkit(runtime.url, {
      type: "threads.create",
      params: { input: chatInput("First message") },
    });
    const threadId = created.find((event) => event.type === "thread.created")?.thread?.id;
    assert(threadId === fake.staleThreadId, "Initial thread was not created by the fake app-server");

    const recovered = await postChatkit(runtime.url, {
      type: "threads.add_user_message",
      params: { thread_id: threadId, input: chatInput("Continue with the previous answer") },
    });
    const assistant = recovered.find(
      (event) => event.type === "thread.item.done" && event.item?.type === "assistant_message",
    );
    assert(assistant?.item?.content?.[0]?.text === "Recovered answer", "Recovery did not stream an assistant answer");
    assert(fake.turnStarts.at(-1)?.threadId === fake.replacementThreadId, "Turn was not rerouted to replacement thread");
    assert(
      fake.turnStarts.at(-1)?.input?.[0]?.text?.includes("previous Codex app-server session was restarted"),
      "Persisted ChatKit history was not supplied to replacement thread",
    );
    const stored = JSON.parse(await fs.readFile(storePath, "utf8"));
    assert(
      stored.threads?.[0]?.metadata?.codex_thread_id === fake.replacementThreadId,
      "ChatKit thread was not remapped to replacement Codex thread",
    );
    console.log(JSON.stringify({ ok: true, threadId, replacementThreadId: fake.replacementThreadId }, null, 2));
  } finally {
    if (runtime) {
      await runtime.close();
    }
    await new Promise((resolve) => fake.server.close(resolve));
    await fs.rm(temporaryDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

await main();
