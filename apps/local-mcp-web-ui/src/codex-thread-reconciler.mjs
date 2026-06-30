import {
  assistantMessageFromCodexItem,
  codexThreadTitle,
  codexThreadUpdatedAt,
  userMessageFromCodexItem,
} from "./codex-event-normalizer.mjs";

function sortTurnsAscending(turns = []) {
  return [...turns].sort((left, right) => {
    const leftStarted = left.startedAt || left.started_at || "";
    const rightStarted = right.startedAt || right.started_at || "";
    if (leftStarted && rightStarted && leftStarted !== rightStarted) {
      return leftStarted.localeCompare(rightStarted);
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function extractTokenUsage(thread) {
  const tokenUsage = thread?.tokenUsage || thread?.token_usage || null;
  if (!tokenUsage || typeof tokenUsage !== "object") {
    return null;
  }
  return tokenUsage;
}

export class CodexThreadReconciler {
  constructor({ codexClient, store, logger = null, model = "gpt-5.5", repoRoot = null }) {
    this.codexClient = codexClient;
    this.store = store;
    this.logger = logger;
    this.model = model;
    this.repoRoot = repoRoot;
  }

  async listThreads({ limit = 20, cwd = this.repoRoot } = {}) {
    const response = await this.codexClient.sendRequest(
      "thread/list",
      {
        limit,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        ...(cwd ? { cwd } : {}),
      },
      30_000,
    );
    return Array.isArray(response?.data) ? response.data : [];
  }

  async latestThread() {
    const threads = await this.listThreads({ limit: 1 });
    return threads[0] || null;
  }

  async reconcileThread(threadId) {
    if (!threadId) {
      throw new Error("threadId is required");
    }

    const response = await this.codexClient.sendRequest(
      "thread/read",
      {
        threadId,
        includeTurns: true,
      },
      60_000,
    );
    const thread = response?.thread;
    if (!thread?.id) {
      throw new Error(`Codex thread not found: ${threadId}`);
    }

    await this.store.upsertCodexThread({
      threadId: thread.id,
      title: codexThreadTitle(thread),
      model: this.model,
      createdAt: thread.createdAt || thread.created_at || null,
      updatedAt: codexThreadUpdatedAt(thread),
      source: "codex_reconcile",
      tokenUsage: extractTokenUsage(thread),
      cwd: thread.cwd || null,
    });

    let importedItemCount = 0;
    for (const turn of sortTurnsAscending(thread.turns || [])) {
      const turnId = turn?.id;
      if (!turnId || !Array.isArray(turn.items)) {
        continue;
      }

      for (const codexItem of turn.items) {
        if (codexItem?.type === "userMessage") {
          const item = userMessageFromCodexItem({
            threadId: thread.id,
            turnId,
            item: codexItem,
            model: this.model,
            source: "codex_reconcile",
          });
          if (item && (await this.store.appendItemIfMissing(thread.id, item))) {
            importedItemCount += 1;
          }
        } else if (codexItem?.type === "agentMessage") {
          const item = assistantMessageFromCodexItem({
            threadId: thread.id,
            turnId,
            item: codexItem,
            source: "codex_reconcile",
          });
          if (item && (await this.store.finalizeAssistantDraft(thread.id, item, codexItem.text || ""))) {
            importedItemCount += 1;
          }
        }
      }
    }

    this.logger?.info("reconciler", "thread_reconciled", {
      threadId: thread.id,
      turnCount: Array.isArray(thread.turns) ? thread.turns.length : 0,
      importedItemCount,
    });

    return {
      threadId: thread.id,
      importedItemCount,
      thread,
    };
  }
}
