import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { SessionAuth } from "./auth.mjs";
import { ChatKitStore } from "./chatkit-store.mjs";
import { getAppConfig } from "./config.mjs";
import { CodexAppServerClient } from "./codex-app-server-client.mjs";
import { codexMetadata } from "./codex-event-normalizer.mjs";
import { CodexThreadReconciler } from "./codex-thread-reconciler.mjs";
import { ExternalChangeSync } from "./external-change-sync.mjs";
import { WebUiLogger } from "./logger.mjs";
import { WebUiEventHub } from "./webui-events.mjs";
import {
  createAssistantMessageItem,
  createPendingAssistantMessageItem,
  createUserMessageItem,
  errorEvent,
  makePage,
  makeThreadTitle,
  normalizeChatKitInput,
  progressEvent,
  streamOptionsEvent,
  toCodexUserInput,
} from "./chatkit-protocol.mjs";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".map", "application/json; charset=utf-8"],
]);

function nowIsoString() {
  return new Date().toISOString();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendRedirect(response, location) {
  response.writeHead(302, {
    location,
  });
  response.end();
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function streamEvent(response, payload, { logger = null, context = {} } = {}) {
  const serialized = `data: ${JSON.stringify(payload)}\n\n`;
  const writeAccepted = response.write(serialized);
  logger?.debug("sse", "event_written", {
    ...context,
    payload,
    byteLength: Buffer.byteLength(serialized, "utf8"),
    writeAccepted,
    writableEnded: response.writableEnded,
    destroyed: response.destroyed,
  });
  return writeAccepted;
}

async function readJsonBody(request) {
  const raw = (await readRawBody(request)).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function createThreadRecord({ threadId, title, model, sessionId }) {
  const createdAt = nowIsoString();
  return {
    id: threadId,
    title,
    created_at: createdAt,
    status: { type: "active" },
    metadata: {
      model,
      session_id: sessionId,
      updated_at: createdAt,
      source: "webui",
      codex_thread_id: threadId,
    },
    items: [],
  };
}

function describeCodexItem(item) {
  switch (item?.type) {
    case "mcpToolCall":
      return progressEvent(`Calling ${item.server}/${item.tool}`, "bolt");
    case "commandExecution":
      return progressEvent(`Running shell command: ${item.command}`, "square-code");
    case "fileChange":
      return progressEvent("Applying file changes", "document");
    case "reasoning":
      return progressEvent("Reasoning about the request", "lightbulb");
    case "plan":
      return progressEvent("Updating the plan", "notebook");
    case "webSearch":
      return progressEvent(`Searching the web for: ${item.query}`, "search");
    default:
      return null;
  }
}

function isHtmlRequest(request) {
  return String(request.headers.accept || "").includes("text/html");
}

function getRequestHost(request) {
  const forwardedHost = String(request.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  if (forwardedHost) {
    return forwardedHost;
  }

  return String(request.headers.host || "").trim();
}

function makeLoginLocation(requestUrl) {
  const next = requestUrl.pathname === "/login" ? "/" : requestUrl.pathname;
  const query = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return `/login${query}`;
}

function isMissingCodexThreadError(error) {
  return (
    error?.code === -32600 &&
    typeof error?.message === "string" &&
    error.message.toLowerCase().includes("thread not found")
  );
}

function itemTextForRecovery(item) {
  if (!Array.isArray(item?.content)) {
    return "";
  }

  return item.content
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildRecoveryContext(items = [], { maxItems = 16, maxChars = 32_000 } = {}) {
  const entries = items
    .slice(-maxItems)
    .map((item) => {
      const text = itemTextForRecovery(item);
      if (!text) {
        return "";
      }

      const speaker = item.type === "assistant_message" ? "Assistant" : "User";
      return `${speaker}: ${text}`;
    })
    .filter(Boolean);

  if (entries.length === 0) {
    return "";
  }

  const transcript = entries.join("\n\n");
  const limitedTranscript =
    transcript.length > maxChars ? transcript.slice(-maxChars) : transcript;
  return [
    "The previous Codex app-server session was restarted. The following persisted ChatKit history belongs to this conversation. Use it as context; do not claim that you executed actions mentioned in it.",
    "",
    limitedTranscript,
    "",
    "Continue by answering the new user message below.",
  ].join("\n");
}

function addRecoveryContextToInput(input, recoveryContext) {
  if (!recoveryContext) {
    return input;
  }

  return {
    ...input,
    content: [
      {
        type: "input_text",
        text: recoveryContext,
      },
      ...(Array.isArray(input?.content) ? input.content : []),
    ],
  };
}

async function ensureCodexThreadAvailable({
  codexClient,
  store,
  logger,
  config,
  chatkitThreadId,
  codexThreadId,
  threadItems,
  model,
  httpRequestId,
  requestId,
  activeWebUiThreads,
}) {
  try {
    const response = await codexClient.sendRequest(
      "thread/read",
      { threadId: codexThreadId, includeTurns: false },
      30_000,
    );
    logger.debug("chatkit", "codex_thread_available", {
      httpRequestId,
      requestId,
      chatkitThreadId,
      codexThreadId,
      response,
    });
    return {
      codexThreadId,
      recovered: false,
      recoveryContext: "",
    };
  } catch (error) {
    if (!isMissingCodexThreadError(error)) {
      logger.error("chatkit", "codex_thread_availability_check_failed", {
        httpRequestId,
        requestId,
        chatkitThreadId,
        codexThreadId,
        error,
      });
      throw error;
    }
  }

  const recoveryContext = buildRecoveryContext(threadItems);
  logger.warn("chatkit", "codex_thread_recovery_started", {
    httpRequestId,
    requestId,
    chatkitThreadId,
    staleCodexThreadId: codexThreadId,
    persistedItemCount: Array.isArray(threadItems) ? threadItems.length : 0,
    recoveryContextLength: recoveryContext.length,
  });

  const threadStartParams = {
    cwd: config.repoRoot,
    model,
    approvalPolicy: config.approvalPolicy,
    sandbox: "danger-full-access",
    ephemeral: false,
  };
  const replacement = await codexClient.sendRequest("thread/start", threadStartParams);
  const replacementCodexThreadId = replacement?.thread?.id;
  if (!replacementCodexThreadId) {
    throw new Error("Codex did not return an ID for the replacement thread");
  }

  activeWebUiThreads?.add(replacementCodexThreadId);
  setTimeout(() => activeWebUiThreads?.delete(replacementCodexThreadId), 300_000).unref?.();
  const recoveredAt = nowIsoString();
  const updatedThread = await store.updateThread(chatkitThreadId, async (record) => {
    record.metadata ||= {};
    record.metadata.codex_thread_id = replacementCodexThreadId;
    record.metadata.codex_thread_recovered_from = codexThreadId;
    record.metadata.codex_thread_recovered_at = recoveredAt;
    record.metadata.updated_at = recoveredAt;
  });
  if (!updatedThread) {
    throw new Error(`ChatKit thread not found while recovering: ${chatkitThreadId}`);
  }

  logger.warn("chatkit", "codex_thread_recovered", {
    httpRequestId,
    requestId,
    chatkitThreadId,
    staleCodexThreadId: codexThreadId,
    replacementCodexThreadId,
    recoveryContextLength: recoveryContext.length,
    replacement,
  });
  return {
    codexThreadId: replacementCodexThreadId,
    recovered: true,
    recoveryContext,
  };
}

function shortId(value) {
  return typeof value === "string" && value.length > 12
    ? `${value.slice(0, 8)}...${value.slice(-4)}`
    : value || null;
}

function makeCurrentSessionStatus({ thread = null, selectedThreadId = null, externalSync }) {
  const metadata = thread?.metadata || {};
  const codexThreadId = metadata.codex_thread_id || thread?.id || selectedThreadId || null;
  const tokenUsage = metadata.token_usage || null;
  const syncStatus = externalSync.status();
  const syncState = syncStatus.last_error
    ? "error"
    : syncStatus.started
      ? "live"
      : syncStatus.enabled
        ? "offline"
        : "disabled";

  return {
    mode: thread ? metadata.source || "browser" : "new",
    webui_thread_id: thread?.id || selectedThreadId || null,
    webui_thread_id_short: shortId(thread?.id || selectedThreadId || null),
    codex_thread_id: codexThreadId,
    codex_thread_id_short: shortId(codexThreadId),
    title: thread?.title || null,
    source: metadata.source || null,
    cwd: metadata.cwd || null,
    updated_at: metadata.updated_at || thread?.created_at || null,
    sync_state: syncState,
    token_usage: tokenUsage,
  };
}

async function serveStaticFile(config, requestPath, response) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.join(config.publicDir, relativePath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(config.publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await fs.readFile(normalized);
    response.writeHead(200, {
      "content-type":
        contentTypes.get(path.extname(normalized)) ||
        "application/octet-stream",
    });
    response.end(data);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

async function acceptChatkitVerify({
  request,
  response,
  logger,
  httpRequestId,
}) {
  const body = await readRawBody(request);

  logger.info("chatkit", "verify_accepted", {
    httpRequestId,
    method: request.method,
    contentLength: body.length,
    origin: request.headers.origin || null,
  });

  sendJson(response, 200, {
    ok: true,
    valid: true,
    verified: true,
    local: true,
  });
}

async function streamCodexTurn({
  codexClient,
  store,
  threadId,
  codexThreadId = threadId,
  input,
  model,
  response,
  logger,
  httpRequestId,
  requestId,
  allowShellCommands,
  allowWebSearch,
  activeWebUiTurns,
}) {
  let activeTurnId = null;
  let settled = false;
  let finishTurn;
  let shellExecutionBlocked = false;
  const assistantItems = new Map();
  const pendingAssistantFinalizations = new Set();
  const streamContext = () => ({
    httpRequestId,
    requestId,
    threadId,
    codexThreadId,
    turnId: activeTurnId,
  });
  const emit = (payload) => streamEvent(response, payload, {
    logger,
    context: streamContext(),
  });

  const cleanup = () => {
    codexClient.off("notification", onNotification);
    logger.debug("turn", "listener_cleanup", {
      requestId,
      threadId,
      activeTurnId,
    });
  };

  const ensureAssistantStream = (codexItemId) => {
    let state = assistantItems.get(codexItemId);
    if (state) {
      return state;
    }

    state = {
      codexItemId,
      assistantItemId: `assistant_${crypto.randomUUID()}`,
      createdAt: nowIsoString(),
      text: "",
      done: false,
    };
    assistantItems.set(codexItemId, state);

    logger.info("turn", "assistant_stream_opened", {
      requestId,
      threadId,
      codexItemId,
      assistantItemId: state.assistantItemId,
    });
    emit({
      type: "thread.item.added",
      item: createPendingAssistantMessageItem({
        threadId,
        itemId: state.assistantItemId,
        createdAt: state.createdAt,
      }),
    });
    emit({
      type: "thread.item.updated",
      item_id: state.assistantItemId,
      update: {
        type: "assistant_message.content_part.added",
        content_index: 0,
        content: {
          type: "output_text",
          text: "",
          annotations: [],
        },
      },
    });

    return state;
  };

  const finalizeAssistant = async (codexItem, fallbackText = "") => {
    const codexItemId = codexItem?.id || `fallback_${crypto.randomUUID()}`;
    const state = ensureAssistantStream(codexItemId);
    if (state.done) {
      return;
    }

    const finalText =
      state.text.trim() ||
      String(fallbackText || codexItem?.text || "").trim() ||
      "No assistant message was produced.";

    state.done = true;
    logger.info("turn", "assistant_finalized", {
      requestId,
      threadId,
      codexItemId,
      assistantItemId: state.assistantItemId,
      phase: codexItem?.phase || null,
      textLength: finalText.length,
    });
    const assistantItem = createAssistantMessageItem({
      threadId,
      itemId: state.assistantItemId,
      text: finalText,
      createdAt: state.createdAt,
      metadata:
        codexItem?.id && activeTurnId
          ? codexMetadata({
              threadId: codexThreadId,
              turnId: activeTurnId,
              itemId: codexItem.id,
              kind: "agentMessage",
              source: "webui",
              status: "completed",
            })
          : null,
    });

    await store.appendItem(threadId, assistantItem);
    emit({
      type: "thread.item.done",
      item: assistantItem,
    });
  };

  const queueAssistantFinalization = (codexItem) => {
    const task = finalizeAssistant(codexItem).catch((error) => {
      logger.error("turn", "assistant_finalize_failed", {
        ...streamContext(),
        itemId: codexItem?.id || null,
        error,
      });
    });
    pendingAssistantFinalizations.add(task);
    void task.finally(() => pendingAssistantFinalizations.delete(task));
  };

  const waitForAssistantFinalizations = async () => {
    if (pendingAssistantFinalizations.size === 0) {
      return;
    }

    logger.debug("turn", "assistant_finalizations_waiting", {
      ...streamContext(),
      count: pendingAssistantFinalizations.size,
    });
    await Promise.all([...pendingAssistantFinalizations]);
    logger.debug("turn", "assistant_finalizations_completed", {
      ...streamContext(),
    });
  };

  const onNotification = (message) => {
    if (!message?.method) {
      logger.debug("turn", "notification_ignored", {
        ...streamContext(),
        reason: "missing_method",
        message,
      });
      return;
    }

    const params = message.params || {};
    if (params.threadId && params.threadId !== codexThreadId) {
      logger.debug("turn", "notification_ignored", {
        ...streamContext(),
        reason: "different_thread",
        notificationMethod: message.method,
        notificationThreadId: params.threadId,
        expectedCodexThreadId: codexThreadId,
        message,
      });
      return;
    }

    if (activeTurnId && params.turnId && params.turnId !== activeTurnId) {
      logger.debug("turn", "notification_ignored", {
        ...streamContext(),
        reason: "different_turn",
        notificationMethod: message.method,
        notificationTurnId: params.turnId,
        message,
      });
      return;
    }

    logger.debug("turn", "notification_received", {
      ...streamContext(),
      notificationMethod: message.method,
      message,
    });

    switch (message.method) {
      case "item/started": {
        logger.info("turn", "item_started", {
          requestId,
          threadId,
          turnId: params.turnId,
          itemType: params.item?.type,
          itemId: params.item?.id,
        });

        if (params.item?.type === "agentMessage" && params.item?.id) {
          ensureAssistantStream(params.item.id);
          break;
        }

        if (params.item?.type === "commandExecution" && !allowShellCommands) {
          shellExecutionBlocked = true;
          logger.warn("turn", "shell_execution_blocked", {
            requestId,
            threadId,
            turnId: params.turnId,
            itemId: params.item?.id,
            command: params.item?.command || null,
          });
          emit(
            errorEvent(
              "Shell command execution is disabled for this web UI session. Use MCP tools only.",
              false,
            ),
          );
          break;
        }

        const progress = describeCodexItem(params.item);
        if (progress) {
          emit(progress);
        }
        break;
      }

      case "item/completed":
        logger.info("turn", "item_completed", {
          requestId,
          threadId,
          turnId: params.turnId,
          itemType: params.item?.type,
          itemId: params.item?.id,
        });
        if (params.item?.type === "agentMessage") {
          queueAssistantFinalization(params.item);
        }
        break;

      case "item/mcpToolCall/progress":
        logger.info("turn", "mcp_tool_progress", {
          requestId,
          threadId,
          turnId: params.turnId,
          itemId: params.itemId,
          message: params.message,
        });
        emit(progressEvent(params.message, "bolt"));
        break;

      case "warning":
        logger.warn("turn", "warning", {
          requestId,
          threadId,
          message: params.message,
        });
        emit(progressEvent(params.message, "info"));
        break;

      case "item/agentMessage/delta": {
        const assistantState = ensureAssistantStream(
          params.itemId || `delta_${crypto.randomUUID()}`,
        );
        assistantState.text += params.delta || "";
        logger.debug("turn", "assistant_delta", {
          requestId,
          threadId,
          turnId: params.turnId,
          itemId: params.itemId,
          deltaLength: (params.delta || "").length,
          aggregatedLength: assistantState.text.length,
        });
        emit({
          type: "thread.item.updated",
          item_id: assistantState.assistantItemId,
          update: {
            type: "assistant_message.content_part.text_delta",
            content_index: 0,
            delta: params.delta || "",
          },
        });
        break;
      }

      case "turn/started":
        activeTurnId = params.turn?.id || activeTurnId;
        logger.info("turn", "started", {
          requestId,
          threadId,
          turnId: activeTurnId,
        });
        break;

      case "turn/completed":
        activeTurnId = params.turn?.id || activeTurnId;
        settled = true;
        logger.info("turn", "completed_notification", {
          requestId,
          threadId,
          turnId: activeTurnId,
        });
        finishTurn?.(params.turn);
        break;

      default:
        break;
    }
  };

  codexClient.on("notification", onNotification);

  try {
    const completedTurnPromise = new Promise((resolve, reject) => {
      finishTurn = resolve;
    });

    const turnStartParams = {
      threadId: codexThreadId,
      input: toCodexUserInput(input, { allowShellCommands, allowWebSearch }),
      model,
    };
    const turnStartAt = Date.now();
    logger.info("turn", "start_request", {
      ...streamContext(),
      params: turnStartParams,
      responseState: {
        writableEnded: response.writableEnded,
        destroyed: response.destroyed,
      },
    });
    const turnResponse = await codexClient.sendRequest("turn/start", turnStartParams);
    activeTurnId = turnResponse?.turn?.id || activeTurnId;
    if (activeTurnId) {
      activeWebUiTurns?.add(activeTurnId);
      setTimeout(() => activeWebUiTurns?.delete(activeTurnId), 300_000).unref?.();
    }
    logger.info("turn", "turn_start_response", {
      ...streamContext(),
      initialStatus: turnResponse?.turn?.status,
      response: turnResponse,
    });

    const completedTurn = await new Promise((resolve, reject) => {
      const heartbeat = setInterval(() => {
        logger.warn("turn", "completion_still_waiting", {
          ...streamContext(),
          elapsedMs: Date.now() - turnStartAt,
          partialAssistantLength: [...assistantItems.values()].reduce(
            (total, item) => total + item.text.length,
            0,
          ),
          assistantItemCount: assistantItems.size,
          responseState: {
            writableEnded: response.writableEnded,
            destroyed: response.destroyed,
          },
        });
      }, 15_000);
      heartbeat.unref?.();

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        clearInterval(heartbeat);
        cleanup();
        logger.error("turn", "completion_timeout", {
          requestId,
          threadId,
          turnId: activeTurnId,
          timeoutMs: 180_000,
          partialAssistantLength: [...assistantItems.values()].reduce(
            (total, item) => total + item.text.length,
            0,
          ),
        });
        reject(new Error("Timed out waiting for turn completion"));
      }, 180_000);

      const handleExit = ({ code, signal }) => {
        if (settled) {
          return;
        }

        settled = true;
        clearInterval(heartbeat);
        cleanup();
        logger.error("turn", "app_server_exit_during_turn", {
          requestId,
          threadId,
          turnId: activeTurnId,
          code,
          signal,
        });
        reject(
          new Error(
            `codex app-server exited during turn (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          ),
        );
      };

      codexClient.once("exit", handleExit);

      completedTurnPromise.then(
        (turn) => {
          clearTimeout(timeout);
          clearInterval(heartbeat);
          codexClient.off("exit", handleExit);
          cleanup();
          logger.info("turn", "completion_resolved", {
            ...streamContext(),
            finalStatus: turn?.status,
            completedTurn: turn,
          });
          resolve(turn);
        },
        (error) => {
          clearTimeout(timeout);
          clearInterval(heartbeat);
          codexClient.off("exit", handleExit);
          cleanup();
          logger.error("turn", "completion_rejected", {
            requestId,
            threadId,
            turnId: activeTurnId,
            error,
          });
          reject(error);
        },
      );
    });

    await waitForAssistantFinalizations();

    const fallbackMessages = (completedTurn?.items || []).filter(
      (item) => item.type === "agentMessage" && typeof item.text === "string",
    );

    if (completedTurn?.status === "failed" || completedTurn?.error) {
      const rawMessage = String(
        completedTurn?.error?.message || "Codex could not complete this request.",
      );
      const message = /responses\/compact|remote compact task/i.test(rawMessage)
        ? "This conversation is too large to continue because Codex context compaction failed. Start a new chat and resend your request."
        : rawMessage;

      logger.error("turn", "completed_with_error", {
        ...streamContext(),
        status: completedTurn?.status || null,
        error: completedTurn?.error || null,
      });
      emit(errorEvent(message, true));
      return;
    }

    for (const item of fallbackMessages) {
      const existingState = assistantItems.get(item.id);
      if (!existingState || !existingState.done) {
        await finalizeAssistant(item, item.text);
      }
    }

    if (assistantItems.size === 0) {
      const fallbackText = fallbackMessages
        .map((item) => item.text)
        .join("\n\n")
        .trim();

      if (fallbackText) {
        logger.info("turn", "assistant_fallback_text_used", {
          ...streamContext(),
          fallbackLength: fallbackText.length,
        });
        await finalizeAssistant(null, fallbackText);
      }
    }

    logger.info("turn", "succeeded", {
      ...streamContext(),
      completedStatus: completedTurn?.status || null,
      completedItemCount: Array.isArray(completedTurn?.items) ? completedTurn.items.length : 0,
      fallbackMessageCount: fallbackMessages.length,
      assistantItemCount: assistantItems.size,
      assistantTextLength: [...assistantItems.values()].reduce(
        (total, item) => total + item.text.length,
        0,
      ),
    });
  } catch (error) {
    cleanup();

    if (!settled) {
      settled = true;
      const surfacedError = isMissingCodexThreadError(error)
        ? new Error(
            "This chat thread belongs to an older app-server session. Start a new chat or refresh the page.",
          )
        : error;
      if (!shellExecutionBlocked) {
        logger.error("turn", "stream_failed", {
          ...streamContext(),
          error: surfacedError,
        });
        emit(errorEvent(surfacedError.message, true));
      }
    }
  }
}

function createChatKitApi({
  config,
  store,
  codexClient,
  logger,
  activeWebUiTurns,
  activeWebUiThreads,
}) {
  return async function handleChatKitRequest(body, response, { httpRequestId = null } = {}) {
    const requestId = crypto.randomUUID();
    const requestType = body?.type || "unknown";
    logger.info("chatkit", "request_received", {
      httpRequestId,
      requestId,
      type: requestType,
      body,
    });

    switch (body?.type) {
      case "threads.list": {
        const page = await store.listThreads(body.params || {});
        logger.info("chatkit", "threads_listed", {
          requestId,
          count: page.data.length,
          hasMore: page.has_more,
        });
        sendJson(response, 200, page);
        return;
      }

      case "threads.get_by_id": {
        const thread = await store.getThread(body?.params?.thread_id);
        if (!thread) {
          logger.warn("chatkit", "thread_not_found", {
            requestId,
            threadId: body?.params?.thread_id,
            operation: "threads.get_by_id",
          });
          sendJson(response, 404, { error: "Thread not found" });
          return;
        }

        logger.info("chatkit", "thread_loaded", {
          requestId,
          threadId: thread.id,
          itemCount: thread.items?.data?.length || 0,
        });
        sendJson(response, 200, thread);
        return;
      }

      case "items.list": {
        const items = await store.getItems(body?.params?.thread_id, body.params || {});
        if (!items) {
          logger.warn("chatkit", "thread_not_found", {
            requestId,
            threadId: body?.params?.thread_id,
            operation: "items.list",
          });
          sendJson(response, 404, { error: "Thread not found" });
          return;
        }

        logger.info("chatkit", "items_listed", {
          requestId,
          threadId: body?.params?.thread_id,
          count: items.data.length,
          hasMore: items.has_more,
        });
        sendJson(response, 200, items);
        return;
      }

      case "threads.update": {
        const thread = await store.updateThread(body?.params?.thread_id, async (record) => {
          record.title = body.params.title;
          record.metadata.updated_at = nowIsoString();
        });

        if (!thread) {
          logger.warn("chatkit", "thread_not_found", {
            requestId,
            threadId: body?.params?.thread_id,
            operation: "threads.update",
          });
          sendJson(response, 404, { error: "Thread not found" });
          return;
        }

        logger.info("chatkit", "thread_updated", {
          requestId,
          threadId: thread.id,
          title: thread.title,
        });
        sendJson(response, 200, thread);
        return;
      }

      case "threads.delete": {
        await store.deleteThread(body?.params?.thread_id);
        logger.info("chatkit", "thread_deleted", {
          requestId,
          threadId: body?.params?.thread_id,
        });
        sendJson(response, 200, {});
        return;
      }

      case "items.feedback":
        logger.info("chatkit", "feedback_ignored", {
          requestId,
          params: body.params,
        });
        sendJson(response, 200, {});
        return;

      case "threads.retry_after_item": {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });

        try {
          streamEvent(response, streamOptionsEvent(), {
            logger,
            context: { httpRequestId, requestId, requestType, phase: "retry" },
          });

          const threadId = body?.params?.thread_id;
          const itemId = body?.params?.item_id;
          const context = await store.getItemContext(threadId, itemId);
          const retrySource = context?.previousUserMessage;

          logger.info("chatkit", "retry_after_item_requested", {
            requestId,
            threadId,
            itemId,
            foundItem: Boolean(context?.item),
            retrySourceItemId: retrySource?.id || null,
          });

          if (!context) {
            logger.warn("chatkit", "thread_not_found", {
              requestId,
              threadId,
              operation: "threads.retry_after_item",
            });
            streamEvent(response, errorEvent("Thread not found", false), {
              logger,
              context: { httpRequestId, requestId, requestType, threadId },
            });
            response.end();
            return;
          }

          if (!retrySource) {
            logger.warn("chatkit", "retry_source_not_found", {
              requestId,
              threadId,
              itemId,
            });
            streamEvent(response, errorEvent("No user message found to retry", false), {
              logger,
              context: { httpRequestId, requestId, requestType, threadId, itemId },
            });
            response.end();
            return;
          }

          if (context.item?.id) {
            const truncated = await store.truncateAfterItem(threadId, context.item.id);
            logger.info("chatkit", "thread_truncated_for_retry", {
              requestId,
              threadId,
              itemId: context.item.id,
              removedCount: truncated?.removed?.length || 0,
            });
          }

          const input = normalizeChatKitInput(
            {
              content: retrySource.content,
              attachments: retrySource.attachments,
              quoted_text: retrySource.quoted_text,
              inference_options: retrySource.inference_options,
            },
            config.model,
          );
          const recovery = await ensureCodexThreadAvailable({
            codexClient,
            store,
            logger,
            config,
            chatkitThreadId: threadId,
            codexThreadId: context.thread?.metadata?.codex_thread_id || threadId,
            threadItems: context.thread?.items?.data || [],
            model: input.inference_options.model,
            httpRequestId,
            requestId,
            activeWebUiThreads,
          });
          const inputForCodex = addRecoveryContextToInput(input, recovery.recoveryContext);

          await streamCodexTurn({
            codexClient,
            store,
            threadId,
            codexThreadId: recovery.codexThreadId,
            input: inputForCodex,
            model: input.inference_options.model,
            response,
            logger,
            httpRequestId,
            requestId,
            allowShellCommands: config.allowShellCommands,
            allowWebSearch: config.allowWebSearch,
            activeWebUiTurns,
          });

          logger.info("chatkit", "retry_stream_finished", {
            requestId,
            threadId,
            itemId,
          });
        } catch (error) {
          logger.error("chatkit", "retry_stream_handler_failed", {
            requestId,
            type: requestType,
            error,
          });
          streamEvent(response, errorEvent(error.message, true), {
            logger,
            context: { httpRequestId, requestId, requestType, phase: "retry_handler" },
          });
        }

        response.end();
        return;
      }

      case "threads.create":
      case "threads.add_user_message": {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });

        try {
          streamEvent(response, streamOptionsEvent(), {
            logger,
            context: { httpRequestId, requestId, requestType, phase: "new_turn" },
          });

          const input = normalizeChatKitInput(body?.params?.input, config.model);
          const threadId =
            body.type === "threads.create" ? null : body?.params?.thread_id;
          logger.info("chatkit", "stream_started", {
            httpRequestId,
            requestId,
            type: requestType,
            existingThreadId: threadId,
            model: input.inference_options.model,
          });

          let resolvedThreadId = threadId;
          let resolvedCodexThreadId = threadId;
          let inputForCodex = input;
          let threadRecord = null;

          if (body.type === "threads.create") {
            const threadStartParams = {
              cwd: config.repoRoot,
              model: input.inference_options.model,
              approvalPolicy: config.approvalPolicy,
              sandbox: "danger-full-access",
              ephemeral: false,
            };
            logger.info("chatkit", "thread_start_request", {
              httpRequestId,
              requestId,
              params: threadStartParams,
            });
            const threadStart = await codexClient.sendRequest("thread/start", threadStartParams);
            logger.info("chatkit", "thread_start_response", {
              httpRequestId,
              requestId,
              response: threadStart,
            });

            resolvedThreadId = threadStart.thread.id;
            resolvedCodexThreadId = resolvedThreadId;
            activeWebUiThreads?.add(resolvedThreadId);
            setTimeout(() => {
              activeWebUiThreads?.delete(resolvedThreadId);
            }, 300_000).unref?.();
            threadRecord = createThreadRecord({
              threadId: resolvedThreadId,
              title: makeThreadTitle(input),
              model: input.inference_options.model,
              sessionId: config.sessionId,
            });

            const createdThread = await store.createThread(threadRecord);
            logger.info("chatkit", "thread_created", {
              httpRequestId,
              requestId,
              threadId: resolvedThreadId,
              title: threadRecord.title,
            });
            streamEvent(response, {
              type: "thread.created",
              thread: createdThread,
            }, {
              logger,
              context: { httpRequestId, requestId, requestType, threadId: resolvedThreadId },
            });
          } else {
            const existingThread = await store.getThread(resolvedThreadId);
            if (!existingThread) {
              logger.warn("chatkit", "thread_not_found", {
                requestId,
                threadId: resolvedThreadId,
                operation: "threads.add_user_message",
              });
              streamEvent(response, errorEvent("Thread not found", false), {
                logger,
                context: { httpRequestId, requestId, requestType, threadId: resolvedThreadId },
              });
              response.end();
              return;
            }

            const recovery = await ensureCodexThreadAvailable({
              codexClient,
              store,
              logger,
              config,
              chatkitThreadId: resolvedThreadId,
              codexThreadId: existingThread.metadata?.codex_thread_id || resolvedThreadId,
              threadItems: existingThread.items?.data || [],
              model: input.inference_options.model,
              httpRequestId,
              requestId,
              activeWebUiThreads,
            });
            resolvedCodexThreadId = recovery.codexThreadId;
            inputForCodex = addRecoveryContextToInput(input, recovery.recoveryContext);
          }

          const userItem = createUserMessageItem({
            threadId: resolvedThreadId,
            input,
            createdAt: nowIsoString(),
          });

          await store.appendItem(resolvedThreadId, userItem);
          logger.info("chatkit", "user_message_appended", {
            httpRequestId,
            requestId,
            threadId: resolvedThreadId,
            userItemId: userItem.id,
            contentLength: JSON.stringify(userItem.content).length,
          });
          streamEvent(response, {
            type: "thread.item.done",
            item: userItem,
          }, {
            logger,
            context: { httpRequestId, requestId, requestType, threadId: resolvedThreadId },
          });

          await streamCodexTurn({
            codexClient,
            store,
            threadId: resolvedThreadId,
            codexThreadId: resolvedCodexThreadId,
            input: inputForCodex,
            model: input.inference_options.model,
            response,
            logger,
            httpRequestId,
            requestId,
            allowShellCommands: config.allowShellCommands,
            allowWebSearch: config.allowWebSearch,
            activeWebUiTurns,
          });
          logger.info("chatkit", "stream_finished", {
            httpRequestId,
            requestId,
            threadId: resolvedThreadId,
          });
        } catch (error) {
          logger.error("chatkit", "stream_handler_failed", {
            httpRequestId,
            requestId,
            type: requestType,
            error,
          });
          streamEvent(response, errorEvent(error.message, true), {
            logger,
            context: { httpRequestId, requestId, requestType, phase: "stream_handler" },
          });
        }

        response.end();
        return;
      }

      default:
        logger.warn("chatkit", "unsupported_request_type", {
          requestId,
          type: requestType,
        });
        sendJson(response, 400, {
          error: `Unsupported ChatKit request type: ${body?.type || "unknown"}`,
        });
    }
  };
}

export async function startWebUiServer() {
  const config = getAppConfig();
  const logger = new WebUiLogger({
    logDir: config.logDir,
    sessionId: config.sessionId,
    consoleLevel: config.consoleLogLevel,
    maxFileBytes: config.logMaxBytes,
    retentionDays: config.logRetentionDays,
    maxFiles: config.logMaxFiles,
  });
  await logger.initialize();
  logger.info("server", "startup", {
    sessionId: config.sessionId,
    host: config.host,
    port: config.port,
    platform: config.platform,
    logDir: config.logDir,
    logMaxBytes: config.logMaxBytes,
    logRetentionDays: config.logRetentionDays,
    logMaxFiles: config.logMaxFiles,
    storePath: config.storePath,
    allowShellCommands: config.allowShellCommands,
    allowWebSearch: config.allowWebSearch,
    approvalPolicy: config.approvalPolicy,
    codexMode: config.codexMode,
    codexAppServerUrl:
      config.codexMode === "external" ? config.codexAppServerUrl : null,
    externalChangeSync: config.externalChangeSync,
    browserEvents: config.browserEvents,
    reconcileOnStart: config.reconcileOnStart,
  });
  const store = new ChatKitStore({
    filePath: config.storePath,
    sessionId: config.sessionId,
  });
  const auth = new SessionAuth({
    mode: config.authMode,
    password: config.sessionPassword,
    secret: config.sessionSecret,
    cookieName: config.sessionCookieName,
    ttlMs: config.sessionTtlMs,
    logger,
  });
  await store.initialize();
  logger.info("store", "initialized", {
    storePath: config.storePath,
  });

  const codexClient = new CodexAppServerClient({
    launcher: config.launcher,
    mode: config.codexMode,
    appServerUrl: config.codexAppServerUrl,
    cwd: config.repoRoot,
    logger,
    allowShellCommands: config.allowShellCommands,
  });
  await codexClient.start();
  const eventHub = new WebUiEventHub();
  const activeWebUiTurns = new Set();
  const activeWebUiThreads = new Set();
  const externalChangeSync = new ExternalChangeSync({
    codexClient,
    store,
    eventHub,
    logger,
    model: config.model,
    enabled: config.externalChangeSync,
    ignoredTurnIds: activeWebUiTurns,
    ignoredThreadIds: activeWebUiThreads,
  });
  externalChangeSync.start();
  const reconciler = new CodexThreadReconciler({
    codexClient,
    store,
    logger,
    model: config.model,
    repoRoot: config.repoRoot,
  });
  if (config.reconcileOnStart) {
    setImmediate(async () => {
      try {
        const threadIds = await store.listKnownCodexThreadIds({ limit: 20 });
        for (const threadId of threadIds) {
          await reconciler.reconcileThread(threadId);
        }
        logger.info("reconciler", "startup_reconcile_completed", {
          threadCount: threadIds.length,
        });
      } catch (error) {
        logger.warn("reconciler", "startup_reconcile_failed", { error });
      }
    });
  }

  const handleChatKitRequest = createChatKitApi({
    config,
    store,
    codexClient,
    logger,
    activeWebUiTurns,
    activeWebUiThreads,
  });

  const server = http.createServer(async (request, response) => {
    const httpRequestId = crypto.randomUUID();
    const startedAt = Date.now();
    logger.info("http", "request_started", {
      httpRequestId,
      method: request.method,
      url: request.url,
      remoteAddress: request.socket.remoteAddress,
      remotePort: request.socket.remotePort,
    });

    response.on("close", () => {
      logger.info("http", "request_closed", {
        httpRequestId,
        method: request.method,
        url: request.url,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        writableEnded: response.writableEnded,
      });
    });
    response.on("finish", () => {
      logger.info("http", "response_finished", {
        httpRequestId,
        method: request.method,
        url: request.url,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        writableEnded: response.writableEnded,
      });
    });
    response.on("error", (error) => {
      logger.error("http", "response_error", {
        httpRequestId,
        method: request.method,
        url: request.url,
        error,
      });
    });
    request.on("aborted", () => {
      logger.warn("http", "request_aborted", {
        httpRequestId,
        method: request.method,
        url: request.url,
        durationMs: Date.now() - startedAt,
      });
    });

    try {
      const requestUrl = new URL(request.url || "/", "http://localhost");

      if (request.method === "GET" && requestUrl.pathname === "/readyz") {
        sendJson(response, 200, {
          ok: true,
          auth_mode: config.authMode,
          allow_shell_commands: config.allowShellCommands,
          allow_web_search: config.allowWebSearch,
          approval_policy: config.approvalPolicy,
          codex_mode: config.codexMode,
          codex_app_server_url:
            config.codexMode === "external" ? config.codexAppServerUrl : null,
          external_sync: externalChangeSync.status(),
          reconcile_on_start: config.reconcileOnStart,
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/auth/login") {
        const body = await readJsonBody(request);
        const loginResult = auth.authenticate(body?.password);
        if (!loginResult.ok) {
          sendJson(response, 401, {
            ok: false,
            error: loginResult.error,
          });
          return;
        }

        auth.writeLoginCookie(response, loginResult.sessionId);
        sendJson(response, 200, {
          ok: true,
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/auth/logout") {
        auth.writeLogoutCookie(response);
        sendJson(response, 200, {
          ok: true,
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/auth/status") {
        const session = auth.getSession(request);
        sendJson(response, 200, {
          ok: true,
          auth_mode: config.authMode,
          authenticated: Boolean(session),
        });
        return;
      }

      const isPublicAuthAsset =
        request.method === "GET" &&
        ["/login", "/login.js", "/styles.css"].includes(requestUrl.pathname);

      if (auth.enabled && !isPublicAuthAsset && !auth.isAuthenticated(request)) {
        logger.warn("auth", "request_blocked", {
          httpRequestId,
          method: request.method,
          url: requestUrl.pathname,
        });
        if (request.method === "GET" && isHtmlRequest(request)) {
          sendRedirect(response, makeLoginLocation(requestUrl));
          return;
        }

        sendJson(response, 401, {
          ok: false,
          error: "Authentication required",
        });
        return;
      }

      if (auth.enabled && request.method === "GET" && requestUrl.pathname === "/login") {
        if (auth.isAuthenticated(request)) {
          sendRedirect(response, "/");
          return;
        }

        await serveStaticFile(config, "/login.html", response);
        logger.debug("http", "static_served", {
          httpRequestId,
          path: "/login.html",
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/healthz") {
        const requestHost = getRequestHost(request);
        const chatkitDomainKey = config.resolveChatkitDomainKey(requestHost);
        sendJson(response, 200, {
          ok: true,
          session_id: config.sessionId,
          auth_mode: config.authMode,
          allow_shell_commands: config.allowShellCommands,
          allow_web_search: config.allowWebSearch,
          approval_policy: config.approvalPolicy,
          codex_mode: config.codexMode,
          codex_app_server_url:
            config.codexMode === "external" ? config.codexAppServerUrl : null,
          external_sync: externalChangeSync.status(),
          reconcile_on_start: config.reconcileOnStart,
          chatkit_domain_key: chatkitDomainKey,
          chatkit_domain_host: requestHost || null,
          authenticated: auth.isAuthenticated(request),
          app_server:
            auth.enabled && !auth.isAuthenticated(request)
              ? null
              : codexClient.initializeResponse,
        });
        logger.debug("http", "healthz_served", {
          httpRequestId,
          requestHost,
          chatkitDomainKey,
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/sessions") {
        const threads = await reconciler.listThreads({ limit: 30 });
        sendJson(response, 200, {
          data: threads.map((thread) => ({
            thread_id: thread.id,
            title: thread.name || thread.title || null,
            cwd: thread.cwd || null,
            updated_at: thread.updatedAt || thread.updated_at || null,
            created_at: thread.createdAt || thread.created_at || null,
            source: thread.source || thread.sourceKind || null,
            status: thread.status || null,
          })),
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/current-session") {
        const selectedThreadId = String(requestUrl.searchParams.get("thread_id") || "").trim();
        const thread = selectedThreadId ? await store.getThread(selectedThreadId) : null;
        sendJson(
          response,
          200,
          makeCurrentSessionStatus({
            thread,
            selectedThreadId: selectedThreadId || null,
            externalSync: externalChangeSync,
          }),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/session/select") {
        const body = await readJsonBody(request);
        const threadId = String(body?.thread_id || body?.threadId || "").trim();
        if (!threadId) {
          sendJson(response, 400, { ok: false, error: "thread_id is required" });
          return;
        }
        const result = await reconciler.reconcileThread(threadId);
        eventHub.broadcast({
          type: "thread.updated",
          thread_id: result.threadId,
        });
        sendJson(response, 200, {
          ok: true,
          thread_id: result.threadId,
          imported_item_count: result.importedItemCount,
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/events") {
        if (!config.browserEvents) {
          sendJson(response, 404, { error: "Browser events are disabled" });
          return;
        }
        eventHub.addClient(response);
        logger.info("events", "client_connected", {
          httpRequestId,
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/client-log") {
        const body = await readJsonBody(request);
        const level = String(body?.level || "info").toLowerCase();
        const event = String(body?.event || "client_event");
        const data =
          body && typeof body.data === "object" && body.data !== null
            ? body.data
            : {};

        const logMethod =
          level === "error"
            ? logger.error.bind(logger)
            : level === "warn"
              ? logger.warn.bind(logger)
              : level === "debug"
                ? logger.debug.bind(logger)
                : logger.info.bind(logger);

        logMethod("browser", event, {
          httpRequestId,
          userAgent: request.headers["user-agent"] || null,
          ...data,
        });
        sendJson(response, 200, {
          ok: true,
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/chatkit/domain_keys/verify"
      ) {
        await acceptChatkitVerify({
          request,
          response,
          logger,
          httpRequestId,
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/chatkit") {
        const body = await readJsonBody(request);
        await handleChatKitRequest(body, response, { httpRequestId });
        return;
      }

      if (request.method === "GET") {
        await serveStaticFile(config, requestUrl.pathname, response);
        logger.debug("http", "static_served", {
          httpRequestId,
          path: requestUrl.pathname,
        });
        return;
      }

      sendJson(response, 405, { error: "Method not allowed" });
      logger.warn("http", "method_not_allowed", {
        httpRequestId,
        method: request.method,
        path: requestUrl.pathname,
      });
    } catch (error) {
      logger.error("http", "request_failed", {
        httpRequestId,
        method: request.method,
        url: request.url,
        error,
      });
      sendJson(response, 500, {
        error: error.message,
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  logger.info("server", "listening", {
    url: `http://${config.host}:${config.port}`,
  });

  const close = async () => {
    logger.info("server", "shutdown_started", {});
    externalChangeSync.stop();
    eventHub.close();
    await codexClient.stop();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await logger.flush();
  };

  return {
    config,
    codexClient,
    server,
    logger,
    url: `http://${config.host}:${config.port}`,
    close,
  };
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFile && path.resolve(currentFile) === entryFile) {
  const runtime = await startWebUiServer();
  console.log(`Local MCP Web UI listening on ${runtime.url}`);
  console.log(`Web UI logs: ${path.join(runtime.config.logDir, "webui-latest.jsonl")}`);

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
