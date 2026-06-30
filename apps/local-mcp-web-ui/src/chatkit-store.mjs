import fs from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIsoString() {
  return new Date().toISOString();
}

function codexItemKey(metadata = {}) {
  const threadId = metadata.codex_thread_id;
  const turnId = metadata.codex_turn_id;
  const itemId = metadata.codex_item_id;
  const kind = metadata.codex_item_kind || "item";

  if (!threadId || !turnId || !itemId) {
    return null;
  }

  return `codex:${threadId}:${turnId}:${itemId}:${kind}`;
}

function itemMatchesCodexKey(item, key) {
  return key && codexItemKey(item?.metadata) === key;
}

function emptyPage() {
  return {
    data: [],
    has_more: false,
    after: null,
  };
}

function makePage(items, limit, after) {
  const pageItems = [...items];

  if (after) {
    const afterIndex = pageItems.findIndex((item) => item.id === after);
    if (afterIndex >= 0) {
      pageItems.splice(0, afterIndex + 1);
    }
  }

  if (!limit || pageItems.length <= limit) {
    return {
      data: pageItems,
      has_more: false,
      after: null,
    };
  }

  return {
    data: pageItems.slice(0, limit),
    has_more: true,
    after: pageItems[limit - 1].id,
  };
}

function makeThreadResponse(record, includeItems) {
  return {
    id: record.id,
    title: record.title,
    created_at: record.created_at,
    status: record.status,
    metadata: clone(record.metadata),
    items: includeItems ? makePage(record.items, null, null) : emptyPage(),
  };
}

export class ChatKitStore {
  constructor({ filePath, sessionId }) {
    this.filePath = filePath;
    this.sessionId = sessionId;
    this.writeChain = Promise.resolve();
  }

  #isVisibleThread(thread) {
    return thread?.metadata?.session_id === this.sessionId;
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(
        this.filePath,
        JSON.stringify({ threads: [] }, null, 2),
        "utf8",
      );
    }
  }

  async #readState() {
    await this.initialize();
    const raw = await fs.readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw);
    parsed.threads ||= [];
    return parsed;
  }

  async #writeState(state) {
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  async #mutate(mutator) {
    const operation = this.writeChain.then(async () => {
      const state = await this.#readState();
      const result = await mutator(state);
      await this.#writeState(state);
      return result;
    });

    this.writeChain = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  async createThread(record) {
    return this.#mutate(async (state) => {
      const existing = state.threads.find((thread) => thread.id === record.id);
      if (existing) {
        return makeThreadResponse(existing, true);
      }

      state.threads.unshift({
        ...clone(record),
        items: clone(record.items || []),
      });

      return makeThreadResponse(record, true);
    });
  }

  async listThreads({ limit = null, after = null, order = "desc" } = {}) {
    const state = await this.#readState();
    const threads = state.threads.filter((thread) => this.#isVisibleThread(thread)).sort((left, right) => {
      const leftUpdated = left.metadata?.updated_at || left.created_at;
      const rightUpdated = right.metadata?.updated_at || right.created_at;
      return leftUpdated.localeCompare(rightUpdated);
    });

    if (order !== "asc") {
      threads.reverse();
    }

    const page = makePage(
      threads.map((thread) => makeThreadResponse(thread, false)),
      limit,
      after,
    );

    return page;
  }

  async listKnownCodexThreadIds({ limit = 20 } = {}) {
    const state = await this.#readState();
    return state.threads
      .filter((thread) => this.#isVisibleThread(thread))
      .map((thread) => thread.metadata?.codex_thread_id || thread.id)
      .filter(Boolean)
      .slice(0, limit);
  }

  async getThread(threadId) {
    const state = await this.#readState();
    const thread = state.threads.find(
      (entry) => entry.id === threadId && this.#isVisibleThread(entry),
    );
    return thread ? makeThreadResponse(thread, true) : null;
  }

  async getItems(threadId, { limit = null, after = null, order = "asc" } = {}) {
    const state = await this.#readState();
    const thread = state.threads.find(
      (entry) => entry.id === threadId && this.#isVisibleThread(entry),
    );
    if (!thread) {
      return null;
    }

    const items = [...thread.items];
    if (order === "desc") {
      items.reverse();
    }

    return makePage(items, limit, after);
  }

  async getItemContext(threadId, itemId) {
    const state = await this.#readState();
    const thread = state.threads.find(
      (entry) => entry.id === threadId && this.#isVisibleThread(entry),
    );
    if (!thread) {
      return null;
    }

    const itemIndex = thread.items.findIndex((entry) => entry.id === itemId);
    if (itemIndex < 0) {
      return {
        thread: makeThreadResponse(thread, true),
        item: null,
        itemIndex: -1,
        previousUserMessage: null,
      };
    }

    const item = thread.items[itemIndex];
    const previousUserMessage = [...thread.items.slice(0, itemIndex + 1)]
      .reverse()
      .find((entry) => entry.type === "user_message") || null;

    return {
      thread: makeThreadResponse(thread, true),
      item: clone(item),
      itemIndex,
      previousUserMessage: previousUserMessage ? clone(previousUserMessage) : null,
    };
  }

  async truncateAfterItem(threadId, itemId) {
    return this.#mutate(async (state) => {
      const thread = state.threads.find(
        (entry) => entry.id === threadId && this.#isVisibleThread(entry),
      );
      if (!thread) {
        return null;
      }

      const itemIndex = thread.items.findIndex((entry) => entry.id === itemId);
      if (itemIndex < 0) {
        return null;
      }

      const removed = thread.items.splice(itemIndex + 1);
      thread.metadata.updated_at =
        thread.items[itemIndex]?.created_at || nowIsoString();

      return {
        thread: makeThreadResponse(thread, true),
        removed: clone(removed),
      };
    });
  }

  async appendItem(threadId, item) {
    return this.#mutate(async (state) => {
      const thread = state.threads.find(
        (entry) => entry.id === threadId && this.#isVisibleThread(entry),
      );
      if (!thread) {
        throw new Error(`Thread not found: ${threadId}`);
      }

      thread.items.push(clone(item));
      thread.metadata.updated_at = item.created_at;
      return clone(item);
    });
  }

  async appendItemIfMissing(threadId, item) {
    return this.#mutate(async (state) => {
      const thread = state.threads.find(
        (entry) => entry.id === threadId && this.#isVisibleThread(entry),
      );
      if (!thread) {
        return null;
      }

      const key = codexItemKey(item?.metadata);
      const existing = thread.items.find(
        (entry) => entry.id === item.id || itemMatchesCodexKey(entry, key),
      );
      if (existing) {
        return clone(existing);
      }

      thread.items.push(clone(item));
      thread.metadata.updated_at = item.created_at || nowIsoString();
      return clone(item);
    });
  }

  async upsertCodexThread({
    threadId,
    title = null,
    model = null,
    createdAt = null,
    updatedAt = null,
    source = "codex_external",
    tokenUsage = null,
    cwd = null,
  }) {
    return this.#mutate(async (state) => {
      const existing = state.threads.find((entry) => entry.id === threadId);
      if (existing) {
        existing.metadata.session_id ||= this.sessionId;
        existing.metadata.codex_thread_id ||= threadId;
        existing.metadata.updated_at = updatedAt || existing.metadata.updated_at || nowIsoString();
        existing.metadata.source ||= source;
        if (model) {
          existing.metadata.model = model;
        }
        if (cwd) {
          existing.metadata.cwd = cwd;
        }
        if (tokenUsage) {
          existing.metadata.token_usage = tokenUsage;
        }
        if (title && (!existing.title || existing.title === "New thread")) {
          existing.title = title;
        }
        return makeThreadResponse(existing, true);
      }

      const timestamp = createdAt || nowIsoString();
      const updateTimestamp = updatedAt || timestamp;
      const record = {
        id: threadId,
        title: title || "External Codex thread",
        created_at: timestamp,
        status: { type: "active" },
        metadata: {
          model,
          session_id: this.sessionId,
          updated_at: updateTimestamp,
          source,
          codex_thread_id: threadId,
          ...(cwd ? { cwd } : {}),
          ...(tokenUsage ? { token_usage: tokenUsage } : {}),
        },
        items: [],
      };

      state.threads.unshift(record);
      return makeThreadResponse(record, true);
    });
  }

  async upsertAssistantDraft(threadId, item, textDelta = "") {
    return this.#mutate(async (state) => {
      const thread = state.threads.find(
        (entry) => entry.id === threadId && this.#isVisibleThread(entry),
      );
      if (!thread) {
        return null;
      }

      const key = codexItemKey(item?.metadata);
      let existing = thread.items.find(
        (entry) => entry.id === item.id || itemMatchesCodexKey(entry, key),
      );

      if (!existing) {
        existing = clone(item);
        if (!Array.isArray(existing.content) || existing.content.length === 0) {
          existing.content = [
            {
              type: "output_text",
              text: "",
              annotations: [],
            },
          ];
        }
        thread.items.push(existing);
      }

      const content = existing.content?.[0];
      if (content && typeof content.text === "string" && textDelta) {
        content.text += textDelta;
      }
      existing.metadata ||= {};
      existing.metadata.updated_at = nowIsoString();
      existing.metadata.status = "in_progress";
      thread.metadata.updated_at = existing.metadata.updated_at;
      return clone(existing);
    });
  }

  async finalizeAssistantDraft(threadId, item, finalText = "") {
    return this.#mutate(async (state) => {
      const thread = state.threads.find(
        (entry) => entry.id === threadId && this.#isVisibleThread(entry),
      );
      if (!thread) {
        return null;
      }

      const key = codexItemKey(item?.metadata);
      let existing = thread.items.find(
        (entry) => entry.id === item.id || itemMatchesCodexKey(entry, key),
      );

      if (!existing) {
        existing = clone(item);
        thread.items.push(existing);
      }

      if (finalText) {
        existing.content = [
          {
            type: "output_text",
            text: finalText,
            annotations: [],
          },
        ];
      } else if (!Array.isArray(existing.content) || existing.content.length === 0) {
        existing.content = [
          {
            type: "output_text",
            text: "",
            annotations: [],
          },
        ];
      }

      existing.metadata ||= {};
      existing.metadata.updated_at = nowIsoString();
      existing.metadata.status = "completed";
      thread.metadata.updated_at = existing.created_at || existing.metadata.updated_at;
      return clone(existing);
    });
  }

  async updateThread(threadId, updater) {
    return this.#mutate(async (state) => {
      const thread = state.threads.find(
        (entry) => entry.id === threadId && this.#isVisibleThread(entry),
      );
      if (!thread) {
        return null;
      }

      await updater(thread);
      return makeThreadResponse(thread, true);
    });
  }

  async deleteThread(threadId) {
    return this.#mutate(async (state) => {
      const threadIndex = state.threads.findIndex(
        (entry) => entry.id === threadId && this.#isVisibleThread(entry),
      );
      if (threadIndex >= 0) {
        state.threads.splice(threadIndex, 1);
      }
    });
  }
}
