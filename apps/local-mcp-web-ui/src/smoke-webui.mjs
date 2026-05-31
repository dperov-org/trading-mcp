import fs from "node:fs/promises";
import path from "node:path";

import { startWebUiServer } from "./server.mjs";

async function readSseEvents(response) {
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
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      if (dataLines.length === 0) {
        continue;
      }

      events.push(JSON.parse(dataLines.join("\n")));
    }
  }

  return events;
}

async function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function buildChatKitCreateRequest(prompt) {
  return {
    type: "threads.create",
    params: {
      input: {
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
        attachments: [],
        inference_options: {
          model: "gpt-5.5",
        },
      },
    },
  };
}

function buildChatKitAddMessageRequest(threadId, prompt) {
  return {
    type: "threads.add_user_message",
    params: {
      thread_id: threadId,
      input: {
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
        attachments: [],
        inference_options: {
          model: "gpt-5.5",
        },
      },
    },
  };
}

async function main() {
  const runtime = await startWebUiServer();

  try {
    const prompts = [
      "What is the current BTC/USDT price?",
      "What's my wallet balance?",
      "Do I currently have any open spot orders?",
    ];

    const transcript = [];
    let threadId = null;

    for (const [index, prompt] of prompts.entries()) {
      const response = await postJson(
        `${runtime.url}/chatkit`,
        index === 0
          ? buildChatKitCreateRequest(prompt)
          : buildChatKitAddMessageRequest(threadId, prompt),
      );

      if (!response.ok) {
        throw new Error(`ChatKit smoke request failed with ${response.status}`);
      }

      const events = await readSseEvents(response);
      const createdThreadEvent = events.find((event) => event.type === "thread.created");
      if (createdThreadEvent?.thread?.id) {
        threadId = createdThreadEvent.thread.id;
      }

      const assistantDone = [...events]
        .reverse()
        .find(
          (event) =>
            event.type === "thread.item.done" &&
            event.item?.type === "assistant_message",
        );

      if (!assistantDone) {
        throw new Error(`No assistant message produced for prompt: ${prompt}`);
      }

      transcript.push({
        prompt,
        threadId,
        assistant: assistantDone.item.content?.[0]?.text || "",
        eventCount: events.length,
      });
    }

    await fs.mkdir(runtime.config.artifactsDir, { recursive: true });
    const artifactPath = path.join(
      runtime.config.artifactsDir,
      `smoke-${new Date().toISOString().replaceAll(":", "-")}.json`,
    );

    await fs.writeFile(
      artifactPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          url: runtime.url,
          transcript,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          artifactPath,
          transcript,
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();
  }
}

await main();
