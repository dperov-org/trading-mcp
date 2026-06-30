import crypto from "node:crypto";

import {
  createAssistantMessageItem,
  createPendingAssistantMessageItem,
  createUserMessageItem,
} from "./chatkit-protocol.mjs";

export function nowIsoString() {
  return new Date().toISOString();
}

function textFromCodexUserContent(content = []) {
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

function chatkitInputFromCodexUserItem(item, model) {
  const text = textFromCodexUserContent(item?.content);
  return {
    content: [
      {
        type: "input_text",
        text,
      },
    ],
    attachments: [],
    quoted_text: null,
    inference_options: {
      model,
      tool_choice: null,
    },
  };
}

export function codexMetadata({
  threadId,
  turnId,
  itemId,
  kind,
  source = "codex_external",
  status = null,
}) {
  return {
    source,
    codex_thread_id: threadId,
    codex_turn_id: turnId,
    codex_item_id: itemId,
    codex_item_kind: kind,
    codex_event_source: "notification",
    updated_at: nowIsoString(),
    ...(status ? { status } : {}),
  };
}

export function codexThreadTitle(thread) {
  if (typeof thread?.name === "string" && thread.name.trim()) {
    return thread.name.trim();
  }
  if (typeof thread?.title === "string" && thread.title.trim()) {
    return thread.title.trim();
  }
  if (typeof thread?.id === "string" && thread.id.trim()) {
    return `Codex ${thread.id.slice(0, 8)}`;
  }
  return "External Codex thread";
}

export function codexThreadUpdatedAt(thread) {
  const candidates = [
    thread?.updatedAt,
    thread?.updated_at,
    thread?.createdAt,
    thread?.created_at,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

export function userMessageFromCodexItem({
  threadId,
  turnId,
  item,
  model = "gpt-5.5",
  source = "codex_external",
}) {
  if (!threadId || !turnId || item?.type !== "userMessage" || !item.id) {
    return null;
  }

  return createUserMessageItem({
    threadId,
    input: chatkitInputFromCodexUserItem(item, model),
    createdAt: nowIsoString(),
    metadata: codexMetadata({
      threadId,
      turnId,
      itemId: item.id,
      kind: "userMessage",
      source,
      status: "completed",
    }),
  });
}

export function pendingAssistantFromCodex({
  threadId,
  turnId,
  itemId,
  source = "codex_external",
}) {
  if (!threadId || !turnId || !itemId) {
    return null;
  }

  return createPendingAssistantMessageItem({
    threadId,
    itemId: `assistant_codex_${crypto.randomUUID()}`,
    createdAt: nowIsoString(),
    metadata: codexMetadata({
      threadId,
      turnId,
      itemId,
      kind: "agentMessage",
      source,
      status: "in_progress",
    }),
  });
}

export function assistantMessageFromCodexItem({
  threadId,
  turnId,
  item,
  source = "codex_external",
}) {
  if (!threadId || !turnId || item?.type !== "agentMessage" || !item.id) {
    return null;
  }

  return createAssistantMessageItem({
    threadId,
    itemId: `assistant_codex_${crypto.randomUUID()}`,
    text: String(item.text || ""),
    createdAt: nowIsoString(),
    metadata: codexMetadata({
      threadId,
      turnId,
      itemId: item.id,
      kind: "agentMessage",
      source,
      status: "completed",
    }),
  });
}
