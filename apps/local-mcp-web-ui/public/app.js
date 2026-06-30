const CHATKIT_BUNDLE_URL = "/vendor/chatkit.js";
const CHATKIT_LOAD_TIMEOUT_MS = 15000;
const CHATKIT_RENDER_TIMEOUT_MS = 6000;
const defaultThreadStorageKey = "local-mcp-web-ui.thread";
const chatkitElement = document.getElementById("chatkit");
const sessionStatusElement = document.getElementById("session-status");
let statusElement = null;
let networkDiagnosticsInstalled = false;
let currentThreadId = null;
let externalReloadTimer = null;
let currentThreadStorageKey = null;
let lastLocalThreadChangeAt = 0;
let lastLocalThreadChangeId = null;

function ensureStatusElement() {
  if (statusElement?.isConnected) {
    return statusElement;
  }

  statusElement = document.createElement("div");
  statusElement.className = "chatkit-status";
  statusElement.hidden = true;
  chatkitElement.parentElement.insertBefore(statusElement, chatkitElement);
  return statusElement;
}

function showStatus(message, variant = "error") {
  const element = ensureStatusElement();
  element.hidden = false;
  element.dataset.variant = variant;
  element.textContent = message;
}

function hideStatus() {
  if (!statusElement) {
    return;
  }

  statusElement.hidden = true;
  statusElement.textContent = "";
  statusElement.dataset.variant = "";
}

function formatShortId(value) {
  if (!value) {
    return "none";
  }
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function formatDateTime(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extractTokenTotal(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") {
    return null;
  }
  const direct = tokenUsage.total_tokens ?? tokenUsage.totalTokens;
  if (Number.isFinite(Number(direct))) {
    return Number(direct);
  }
  const nested = tokenUsage.total?.total_tokens ?? tokenUsage.total?.totalTokens;
  if (Number.isFinite(Number(nested))) {
    return Number(nested);
  }
  const input =
    tokenUsage.input_tokens ??
    tokenUsage.inputTokens ??
    tokenUsage.total?.input_tokens ??
    tokenUsage.total?.inputTokens;
  const output =
    tokenUsage.output_tokens ??
    tokenUsage.outputTokens ??
    tokenUsage.total?.output_tokens ??
    tokenUsage.total?.outputTokens;
  if (Number.isFinite(Number(input)) || Number.isFinite(Number(output))) {
    return (Number(input) || 0) + (Number(output) || 0);
  }
  return null;
}

function renderCurrentSessionStatus(status) {
  if (!sessionStatusElement) {
    return;
  }

  const mode = status?.mode || "new";
  const syncState = status?.sync_state || "unknown";
  const title = status?.title || "No active thread";
  const updatedAt = formatDateTime(status?.updated_at);
  const tokenTotal = extractTokenTotal(status?.token_usage);
  const fields = [
    ["Mode", mode],
    ["Sync", syncState, "sync"],
    ["Codex", formatShortId(status?.codex_thread_id_short || status?.codex_thread_id)],
    ["Web UI", formatShortId(status?.webui_thread_id_short || status?.webui_thread_id)],
    status?.source ? ["Source", status.source] : null,
    status?.cwd ? ["CWD", status.cwd] : null,
    updatedAt ? ["Updated", updatedAt] : null,
    tokenTotal !== null ? ["Tokens", tokenTotal.toLocaleString(), "tokens"] : null,
  ].filter(Boolean);

  sessionStatusElement.replaceChildren();
  const state = document.createElement("span");
  state.className = "session-status__state";
  state.textContent = title;
  sessionStatusElement.appendChild(state);

  for (const [label, value, kind] of fields) {
    const pill = document.createElement("span");
    pill.className = "session-status__pill";
    if (kind) {
      pill.dataset.kind = kind;
    }
    pill.textContent = `${label}: ${value}`;
    sessionStatusElement.appendChild(pill);
  }
}

async function refreshCurrentSessionStatus(threadId = currentThreadId) {
  const query = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : "";
  try {
    const response = await fetch(`/api/current-session${query}`, {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`current-session failed with ${response.status}`);
    }
    const payload = await response.json();
    renderCurrentSessionStatus(payload);
  } catch (error) {
    renderCurrentSessionStatus({
      mode: threadId ? "browser" : "new",
      webui_thread_id: threadId || null,
      codex_thread_id: threadId || null,
      title: threadId ? "Session status unavailable" : "No active thread",
      sync_state: "error",
    });
    reportClientEvent("warn", "current_session_status_failed", {
      message: error?.message || String(error),
    });
  }
}

async function reportClientEvent(level, event, data = {}) {
  try {
    await fetch("/client-log", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        level,
        event,
        data,
      }),
      keepalive: true,
    });
  } catch {
    // Ignore logging failures in the browser.
  }
}

function normalizeRequestUrl(input) {
  try {
    if (typeof input === "string") {
      return new URL(input, window.location.origin).toString();
    }

    if (input instanceof URL) {
      return input.toString();
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
      return new URL(input.url, window.location.origin).toString();
    }
  } catch {
    // Fall through.
  }

  return String(input || "");
}

function shouldSkipClientLog(url) {
  return normalizeRequestUrl(url).includes("/client-log");
}

function installNetworkDiagnostics() {
  if (networkDiagnosticsInstalled) {
    return;
  }

  networkDiagnosticsInstalled = true;

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function patchedFetch(input, init) {
      const url = normalizeRequestUrl(input);
      const method =
        String(
          init?.method ||
            (typeof Request !== "undefined" && input instanceof Request
              ? input.method
              : "GET"),
        ).toUpperCase();

      try {
        const response = await originalFetch(input, init);

        if (
          !shouldSkipClientLog(url) &&
          (!response.ok || url.includes("/chatkit") || url.includes("/auth/"))
        ) {
          reportClientEvent(
            response.ok ? "debug" : "warn",
            "fetch_response",
            {
              url,
              method,
              status: response.status,
              ok: response.ok,
              redirected: response.redirected,
              type: response.type,
            },
          );
        }

        return response;
      } catch (error) {
        if (!shouldSkipClientLog(url)) {
          reportClientEvent("error", "fetch_failed", {
            url,
            method,
            message: error?.message || String(error),
            stack: error?.stack || null,
          });
        }
        throw error;
      }
    };
  }

  if (typeof XMLHttpRequest !== "undefined") {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__localChatkitMethod = String(method || "GET").toUpperCase();
      this.__localChatkitUrl = normalizeRequestUrl(url);
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const url = this.__localChatkitUrl || "";
      const method = this.__localChatkitMethod || "GET";

      const handleLoadEnd = () => {
        if (shouldSkipClientLog(url)) {
          return;
        }

        if (this.status >= 400 || url.includes("/chatkit") || url.includes("/auth/")) {
          reportClientEvent(this.status >= 400 ? "warn" : "debug", "xhr_response", {
            url,
            method,
            status: this.status,
            readyState: this.readyState,
          });
        }
      };

      const handleError = () => {
        if (shouldSkipClientLog(url)) {
          return;
        }

        reportClientEvent("error", "xhr_failed", {
          url,
          method,
          status: this.status,
          readyState: this.readyState,
        });
      };

      this.addEventListener("loadend", handleLoadEnd, { once: true });
      this.addEventListener("error", handleError, { once: true });
      return originalSend.call(this, body);
    };
  }
}

function makeThreadStorageKey(sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    return defaultThreadStorageKey;
  }

  return `${defaultThreadStorageKey}.${sessionId}`;
}

async function fetchServerSessionState() {
  const response = await fetch("/healthz", {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`healthz failed with ${response.status}`);
  }

  const payload = await response.json();
  return {
    sessionId:
      typeof payload?.session_id === "string" ? payload.session_id : null,
    authMode:
      typeof payload?.auth_mode === "string" ? payload.auth_mode : "unknown",
    chatkitDomainHost:
      typeof payload?.chatkit_domain_host === "string"
        ? payload.chatkit_domain_host
        : null,
    chatkitDomainKey:
      typeof payload?.chatkit_domain_key === "string" &&
      payload.chatkit_domain_key.trim()
        ? payload.chatkit_domain_key.trim()
        : "local-dev",
    authenticated: Boolean(payload?.authenticated),
  };
}

function getInitialThread(threadStorageKey) {
  const saved = window.localStorage.getItem(threadStorageKey);
  return saved && saved.trim() ? saved : null;
}

function buildOptions(initialThread, chatkitDomainKey) {
  return {
    api: {
      url: "/chatkit",
      domainKey: chatkitDomainKey,
    },
    initialThread,
    frameTitle: "Bybit MCP Chat",
    theme: {
      colorScheme: "light",
      radius: "round",
      density: "normal",
      typography: {
        fontFamily: "'Space Grotesk', sans-serif",
        baseSize: 15,
      },
      color: {
        accent: {
          primary: "#0b7a75",
          level: 2,
        },
        grayscale: {
          hue: 200,
          tint: 2,
          shade: -1,
        },
      },
    },
    header: {
      title: {
        text: "Bybit MCP",
      },
    },
    history: {
      enabled: true,
      showDelete: false,
      showRename: false,
    },
    thread: {
      autoScroll: true,
    },
    threadItemActions: {
      feedback: false,
      retry: false,
    },
    composer: {
      placeholder: "Ask about BTC/USDT, wallet balance, open orders...",
      attachments: {
        enabled: false,
      },
      models: [
        {
          id: "gpt-5.5",
          label: "GPT-5.5",
          default: true,
        },
      ],
    },
    disclaimer: {
      text: "This MVP runs a local codex app-server and the project-local Bybit MCP server.",
    },
    startScreen: {
      greeting: "What do you want to check on Bybit?",
      prompts: [
        {
          label: "BTC price",
          icon: "chart",
          prompt: "What is the current BTC/USDT price?",
        },
        {
          label: "Wallet balance",
          icon: "profile-card",
          prompt: "What's my wallet balance?",
        },
        {
          label: "Open spot orders",
          icon: "notebook",
          prompt: "Do I currently have any open spot orders?",
        },
      ],
    },
  };
}

function installExternalChangeEvents(threadStorageKey) {
  if (typeof EventSource === "undefined") {
    return;
  }

  const events = new EventSource("/events");
  events.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!payload || payload.type === "connected") {
      return;
    }

    const affectedThreadId = payload.thread_id || null;
    const activeThreadId =
      currentThreadId || window.localStorage.getItem(threadStorageKey);
    if (affectedThreadId && activeThreadId && affectedThreadId !== activeThreadId) {
      return;
    }

    reportClientEvent("info", "external_change_event", payload);
    refreshCurrentSessionStatus(activeThreadId);
    if (
      affectedThreadId &&
      affectedThreadId === lastLocalThreadChangeId &&
      Date.now() - lastLocalThreadChangeAt < 30000
    ) {
      reportClientEvent("info", "external_change_reload_suppressed", {
        thread_id: affectedThreadId,
        reason: "recent_local_thread_change",
      });
      return;
    }

    showStatus("Conversation updated externally. Refreshing...", "info");
    window.clearTimeout(externalReloadTimer);
    externalReloadTimer = window.setTimeout(() => {
      window.location.reload();
    }, 1500);
  });

  events.addEventListener("error", () => {
    reportClientEvent("warn", "external_change_events_error", {});
  });
}

function waitForChatKitDefinition(timeoutMs) {
  return Promise.race([
    customElements.whenDefined("openai-chatkit"),
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for openai-chatkit to be defined`,
          ),
        );
      }, timeoutMs);
    }),
  ]);
}

function ensureChatKitScript() {
  if (customElements.get("openai-chatkit")) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHATKIT_BUNDLE_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${CHATKIT_BUNDLE_URL}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CHATKIT_BUNDLE_URL;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${CHATKIT_BUNDLE_URL}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

function watchForVisibleRender() {
  const hasVisibleRender = () => {
    if (!chatkitElement) {
      return false;
    }

    const rect = chatkitElement.getBoundingClientRect();
    const shadowRoot = chatkitElement.shadowRoot;
    const shadowText = shadowRoot?.innerText?.trim() || "";
    const shadowMarkupLength = shadowRoot?.innerHTML?.length || 0;

    return rect.height > 120 && (shadowText.length > 0 || shadowMarkupLength > 256);
  };

  if (hasVisibleRender()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if (hasVisibleRender()) {
        window.clearInterval(intervalId);
        hideStatus();
        resolve();
        return;
      }

      if (Date.now() - startedAt < CHATKIT_RENDER_TIMEOUT_MS) {
        return;
      }

      window.clearInterval(intervalId);
      reject(new Error("ChatKit rendered no visible UI after initialization"));
    }, 250);
  });
}

function installClientErrorHandlers() {
  installNetworkDiagnostics();

  window.addEventListener("error", (event) => {
    reportClientEvent("error", "window_error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack || null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientEvent("error", "unhandled_rejection", {
      reason:
        typeof event.reason === "object"
          ? event.reason?.message || String(event.reason)
          : String(event.reason),
      stack:
        typeof event.reason === "object" && event.reason
          ? event.reason?.stack || null
          : null,
    });
  });
}

async function main() {
  installClientErrorHandlers();
  showStatus("Loading Chat UI...", "info");

  const sessionState = await fetchServerSessionState();
  await reportClientEvent("info", "app_bootstrap_started", sessionState);

  await ensureChatKitScript();
  await waitForChatKitDefinition(CHATKIT_LOAD_TIMEOUT_MS);
  await reportClientEvent("info", "chatkit_defined", {
    sessionId: sessionState.sessionId,
  });

  const threadStorageKey = makeThreadStorageKey(sessionState.sessionId);
  currentThreadStorageKey = threadStorageKey;
  const initialThread = getInitialThread(threadStorageKey);
  currentThreadId = initialThread;
  await refreshCurrentSessionStatus(initialThread);
  chatkitElement.setOptions(
    buildOptions(initialThread, sessionState.chatkitDomainKey),
  );
  await reportClientEvent("info", "chatkit_options_set", {
    initialThread,
    threadStorageKey,
    chatkitDomainHost: sessionState.chatkitDomainHost,
    chatkitDomainKey: sessionState.chatkitDomainKey,
  });

  chatkitElement.addEventListener("chatkit.thread.change", (event) => {
    const threadId = event.detail.threadId;
    currentThreadId = threadId || null;
    lastLocalThreadChangeAt = Date.now();
    lastLocalThreadChangeId = threadId || null;
    if (threadId) {
      window.localStorage.setItem(threadStorageKey, threadId);
    } else {
      window.localStorage.removeItem(threadStorageKey);
    }

    reportClientEvent("info", "thread_changed", {
      threadId,
      threadStorageKey,
    });
    refreshCurrentSessionStatus(threadId || null);
  });

  installExternalChangeEvents(threadStorageKey);

  chatkitElement.addEventListener("chatkit.error", (event) => {
    const message = event.detail?.error?.message || String(event.detail?.error);
    console.error("ChatKit error", event.detail?.error);
    reportClientEvent("error", "chatkit_error", {
      message,
      stack: event.detail?.error?.stack || null,
    });
    showStatus(
      "Chat UI reported an internal error. Reload the page. If it persists, disable privacy or ad-blocking extensions for this site and try again.",
    );
  });

  await watchForVisibleRender();
  await reportClientEvent("info", "chatkit_visible", {
    sessionId: sessionState.sessionId,
  });
  hideStatus();
}

main().catch(async (error) => {
  console.error("Failed to initialize ChatKit", error);
  await reportClientEvent("error", "bootstrap_failed", {
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
  showStatus(
    "Chat UI failed to initialize. Reload the page. If it persists, disable privacy or ad-blocking extensions for this site and try again.",
  );
});
