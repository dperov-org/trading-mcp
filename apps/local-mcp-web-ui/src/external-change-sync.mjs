import {
  assistantMessageFromCodexItem,
  codexThreadTitle,
  pendingAssistantFromCodex,
  userMessageFromCodexItem,
} from "./codex-event-normalizer.mjs";

function threadIdFromParams(params) {
  return params?.threadId || params?.thread?.id || null;
}

function turnIdFromParams(params) {
  return params?.turnId || params?.turn?.id || null;
}

function itemIdFromParams(params) {
  return params?.itemId || params?.item?.id || null;
}

export class ExternalChangeSync {
  constructor({
    codexClient,
    store,
    eventHub,
    logger = null,
    model = "gpt-5.5",
    enabled = true,
    ignoredTurnIds = null,
    ignoredThreadIds = null,
  }) {
    this.codexClient = codexClient;
    this.store = store;
    this.eventHub = eventHub;
    this.logger = logger;
    this.model = model;
    this.enabled = enabled;
    this.ignoredTurnIds = ignoredTurnIds;
    this.ignoredThreadIds = ignoredThreadIds;
    this.started = false;
    this.lastEventAt = null;
    this.lastError = null;
    this.onNotification = this.onNotification.bind(this);
  }

  start() {
    if (!this.enabled || this.started) {
      return;
    }
    this.started = true;
    this.codexClient.on("notification", this.onNotification);
    this.logger?.info("external-sync", "started", {});
  }

  stop() {
    if (!this.started) {
      return;
    }
    this.codexClient.off("notification", this.onNotification);
    this.started = false;
    this.logger?.info("external-sync", "stopped", {});
  }

  status() {
    return {
      enabled: this.enabled,
      started: this.started,
      last_event_at: this.lastEventAt,
      last_error: this.lastError,
    };
  }

  async onNotification(message) {
    if (!message?.method || !this.enabled) {
      return;
    }

    this.lastEventAt = new Date().toISOString();

    try {
      await this.#handleNotification(message);
    } catch (error) {
      this.lastError = error?.message || String(error);
      this.logger?.error("external-sync", "notification_failed", {
        method: message.method,
        error,
      });
    }
  }

  async #ensureThread(threadId, thread = null) {
    if (!threadId) {
      return null;
    }

    return this.store.upsertCodexThread({
      threadId,
      title: thread ? codexThreadTitle(thread) : null,
      model: this.model,
      createdAt: null,
    });
  }

  async #handleNotification(message) {
    const params = message.params || {};
    const threadId = threadIdFromParams(params);
    const turnId = turnIdFromParams(params);
    if (threadId && this.ignoredThreadIds?.has(threadId)) {
      return;
    }
    if (turnId && this.ignoredTurnIds?.has(turnId)) {
      return;
    }

    switch (message.method) {
      case "thread/started": {
        const thread = params.thread || null;
        await this.#ensureThread(threadId, thread);
        this.eventHub?.broadcast({
          type: "threads.changed",
          thread_id: threadId,
        });
        break;
      }

      case "turn/started": {
        await this.#ensureThread(threadId);
        const items = Array.isArray(params.turn?.items) ? params.turn.items : [];
        await this.#syncCompletedItems(threadId, turnId, items);
        this.eventHub?.broadcast({
          type: "thread.updated",
          thread_id: threadId,
        });
        break;
      }

      case "item/started": {
        await this.#ensureThread(threadId);
        if (params.item?.type === "userMessage") {
          const item = userMessageFromCodexItem({
            threadId,
            turnId,
            item: params.item,
            model: this.model,
          });
          if (item) {
            await this.store.appendItemIfMissing(threadId, item);
            this.eventHub?.broadcast({
              type: "thread.item.added",
              thread_id: threadId,
              item_id: item.id,
            });
          }
        }
        break;
      }

      case "item/agentMessage/delta": {
        await this.#ensureThread(threadId);
        const draft = pendingAssistantFromCodex({
          threadId,
          turnId,
          itemId: params.itemId,
        });
        if (draft) {
          const item = await this.store.upsertAssistantDraft(
            threadId,
            draft,
            params.delta || "",
          );
          this.eventHub?.broadcast({
            type: "thread.item.updated",
            thread_id: threadId,
            item_id: item?.id || draft.id,
          });
        }
        break;
      }

      case "item/completed": {
        await this.#ensureThread(threadId);
        if (params.item?.type === "userMessage") {
          const item = userMessageFromCodexItem({
            threadId,
            turnId,
            item: params.item,
            model: this.model,
          });
          if (item) {
            await this.store.appendItemIfMissing(threadId, item);
          }
        } else if (params.item?.type === "agentMessage") {
          const item = assistantMessageFromCodexItem({
            threadId,
            turnId,
            item: params.item,
          });
          if (item) {
            await this.store.finalizeAssistantDraft(
              threadId,
              item,
              params.item.text || "",
            );
          }
        }
        this.eventHub?.broadcast({
          type: "thread.item.updated",
          thread_id: threadId,
          item_id: itemIdFromParams(params),
        });
        break;
      }

      case "turn/completed": {
        await this.#ensureThread(threadId);
        const items = Array.isArray(params.turn?.items) ? params.turn.items : [];
        await this.#syncCompletedItems(threadId, turnId, items);
        this.eventHub?.broadcast({
          type: "thread.updated",
          thread_id: threadId,
        });
        break;
      }

      default:
        break;
    }
  }

  async #syncCompletedItems(threadId, turnId, items) {
    if (!threadId || !turnId || !Array.isArray(items)) {
      return;
    }

    for (const codexItem of items) {
      if (codexItem?.type === "userMessage") {
        const item = userMessageFromCodexItem({
          threadId,
          turnId,
          item: codexItem,
          model: this.model,
        });
        if (item) {
          await this.store.appendItemIfMissing(threadId, item);
        }
      } else if (codexItem?.type === "agentMessage") {
        const item = assistantMessageFromCodexItem({
          threadId,
          turnId,
          item: codexItem,
        });
        if (item) {
          await this.store.finalizeAssistantDraft(threadId, item, codexItem.text || "");
        }
      }
    }
  }
}
