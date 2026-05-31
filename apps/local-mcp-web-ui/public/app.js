const CHATKIT_CDN_URL =
  "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
const CHATKIT_LOAD_TIMEOUT_MS = 15000;
const CHATKIT_RENDER_TIMEOUT_MS = 6000;
const defaultThreadStorageKey = "local-mcp-web-ui.thread";
const chatkitElement = document.getElementById("chatkit");
let statusElement = null;

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
    const existing = document.querySelector(`script[src="${CHATKIT_CDN_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${CHATKIT_CDN_URL}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CHATKIT_CDN_URL;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${CHATKIT_CDN_URL}`)),
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
  window.addEventListener("error", (event) => {
    reportClientEvent("error", "window_error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientEvent("error", "unhandled_rejection", {
      reason:
        typeof event.reason === "object"
          ? event.reason?.message || String(event.reason)
          : String(event.reason),
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
  const initialThread = getInitialThread(threadStorageKey);
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
    if (threadId) {
      window.localStorage.setItem(threadStorageKey, threadId);
    } else {
      window.localStorage.removeItem(threadStorageKey);
    }

    reportClientEvent("info", "thread_changed", {
      threadId,
      threadStorageKey,
    });
  });

  chatkitElement.addEventListener("chatkit.error", (event) => {
    const message = event.detail?.error?.message || String(event.detail?.error);
    console.error("ChatKit error", event.detail?.error);
    reportClientEvent("error", "chatkit_error", {
      message,
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
