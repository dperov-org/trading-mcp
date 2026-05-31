import crypto from "node:crypto";

export function makePage(data = [], hasMore = false, after = null) {
  return {
    data,
    has_more: hasMore,
    after,
  };
}

export function makeThreadTitle(input) {
  const parts = (input?.content || [])
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      return typeof part.text === "string" ? part.text.trim() : "";
    })
    .filter(Boolean);

  const joined = parts.join(" ").trim();
  if (!joined) {
    return "New thread";
  }

  return joined.length > 72 ? `${joined.slice(0, 69)}...` : joined;
}

export function normalizeChatKitInput(input, defaultModel) {
  const content = Array.isArray(input?.content)
    ? input.content
        .map((part) => {
          if (part?.type === "input_tag") {
            return {
              type: "input_tag",
              id: String(part.id || crypto.randomUUID()),
              text: String(part.text || ""),
              data:
                part.data && typeof part.data === "object" ? part.data : {},
              group: typeof part.group === "string" ? part.group : null,
              interactive: Boolean(part.interactive),
            };
          }

          return {
            type: "input_text",
            text: String(part?.text || ""),
          };
        })
        .filter((part) => part.text.trim().length > 0)
    : [];

  return {
    content: content.length > 0 ? content : [{ type: "input_text", text: "" }],
    attachments: Array.isArray(input?.attachments)
      ? input.attachments.map((value) => String(value))
      : [],
    quoted_text:
      typeof input?.quoted_text === "string" ? input.quoted_text : null,
    inference_options: {
      model:
        typeof input?.inference_options?.model === "string" &&
        input.inference_options.model.trim()
          ? input.inference_options.model.trim()
          : defaultModel,
      tool_choice:
        typeof input?.inference_options?.tool_choice?.id === "string"
          ? { id: input.inference_options.tool_choice.id }
          : null,
    },
  };
}

export function toCodexUserInput(chatkitInput) {
  const text = chatkitInput.content
    .map((part) => {
      if (part.type === "input_tag") {
        return part.text;
      }

      return part.text;
    })
    .join(" ")
    .trim();

  const finalText = chatkitInput.quoted_text
    ? `${chatkitInput.quoted_text}\n\n${text}`
    : text;

  return [
    {
      type: "text",
      text: finalText,
      text_elements: [],
    },
  ];
}

export function createUserMessageItem({ threadId, input, createdAt }) {
  return {
    id: `message_${crypto.randomUUID()}`,
    thread_id: threadId,
    created_at: createdAt,
    type: "user_message",
    content: input.content,
    attachments: [],
    quoted_text: input.quoted_text,
    inference_options: input.inference_options,
  };
}

export function createAssistantMessageItem({ threadId, itemId, text, createdAt }) {
  return {
    id: itemId,
    thread_id: threadId,
    created_at: createdAt,
    type: "assistant_message",
    content: [
      {
        type: "output_text",
        text,
        annotations: [],
      },
    ],
  };
}

export function createPendingAssistantMessageItem({ threadId, itemId, createdAt }) {
  return {
    id: itemId,
    thread_id: threadId,
    created_at: createdAt,
    type: "assistant_message",
    content: [],
  };
}

export function streamOptionsEvent() {
  return {
    type: "stream_options",
    stream_options: {
      allow_cancel: true,
    },
  };
}

export function progressEvent(text, icon = "bolt") {
  return {
    type: "progress_update",
    icon,
    text,
  };
}

export function errorEvent(message, allowRetry = true) {
  return {
    type: "error",
    code: "custom",
    message,
    allow_retry: allowRetry,
  };
}
