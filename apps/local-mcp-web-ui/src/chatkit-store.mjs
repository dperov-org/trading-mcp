import fs from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
