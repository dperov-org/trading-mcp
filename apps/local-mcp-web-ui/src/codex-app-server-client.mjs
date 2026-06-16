import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

function createJsonRpcEnvelope(payload) {
  return JSON.stringify({
    jsonrpc: "2.0",
    ...payload,
  });
}

function toError(responseError) {
  if (!responseError) {
    return new Error("Unknown JSON-RPC error");
  }

  const message = responseError.message || "Unknown JSON-RPC error";
  const error = new Error(message);
  error.code = responseError.code;
  error.data = responseError.data;
  return error;
}

function nowMs() {
  return Date.now();
}

export class CodexAppServerClient extends EventEmitter {
  constructor({
    launcher,
    appServerUrl = null,
    mode = "spawn",
    cwd,
    startupTimeoutMs = 30_000,
    logger = null,
    allowShellCommands = false,
  }) {
    super();
    this.launcher = launcher;
    this.appServerUrl = appServerUrl;
    this.mode = mode === "external" ? "external" : "spawn";
    this.cwd = cwd;
    this.startupTimeoutMs = startupTimeoutMs;
    this.logger = logger;
    this.allowShellCommands = allowShellCommands;
    this.child = null;
    this.ws = null;
    this.pending = new Map();
    this.requestId = 0;
    this.initializeResponse = null;
    this.blockedCommandTurns = new Set();
  }

  async start() {
    if (this.child || this.ws) {
      return this.initializeResponse;
    }

    if (this.mode === "external") {
      await this.#startWebSocket();
    } else {
      this.#startChild();
    }

    this.initializeResponse = await this.sendRequest(
      "initialize",
      {
        clientInfo: {
          name: "local-mcp-web-ui",
          title: "Local MCP Web UI",
          version: "0.1.0",
        },
        capabilities: null,
      },
      this.startupTimeoutMs,
    );

    this.#write({
      method: "initialized",
    });
    this.logger?.info("codex-app-server", "initialized", {
      mode: this.mode,
      initializeResponse: this.initializeResponse,
    });

    return this.initializeResponse;
  }

  #startChild() {
    const child = spawn(this.launcher.command, this.launcher.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child = child;
    this.logger?.info("codex-app-server", "spawned", {
      command: this.launcher.command,
      args: this.launcher.args,
      cwd: this.cwd,
      pid: child.pid,
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => this.#handleLine(line));

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      this.logger?.warn("codex-app-server", "stderr", { text });
      this.emit("stderr", text);
    });

    child.on("exit", (code, signal) => {
      const message = `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
      const error = new Error(message);
      this.logger?.warn("codex-app-server", "exit", {
        code,
        signal,
        pendingRequestCount: this.pending.size,
      });

      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }

      this.pending.clear();
      this.child = null;
      this.emit("exit", { code, signal });
    });
  }

  async #startWebSocket() {
    if (!this.appServerUrl) {
      throw new Error("WEB_UI_CODEX_APP_SERVER_URL is required in external Codex mode");
    }

    const ws = new WebSocket(this.appServerUrl);
    this.ws = ws;
    this.logger?.info("codex-app-server", "websocket_connecting", {
      url: this.appServerUrl,
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out connecting to codex app-server websocket after ${this.startupTimeoutMs}ms`,
          ),
        );
      }, this.startupTimeoutMs);

      ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          this.logger?.info("codex-app-server", "websocket_connected", {
            url: this.appServerUrl,
          });
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error(`Failed to connect to codex app-server at ${this.appServerUrl}`));
        },
        { once: true },
      );
    });

    ws.addEventListener("message", (event) => {
      this.#handleLine(String(event.data));
    });
    ws.addEventListener("close", (event) => {
      const message = `codex app-server websocket closed (code=${event.code}, reason=${event.reason || "none"})`;
      const error = new Error(message);
      this.logger?.warn("codex-app-server", "websocket_closed", {
        code: event.code,
        reason: event.reason || null,
        pendingRequestCount: this.pending.size,
      });

      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }

      this.pending.clear();
      this.ws = null;
      this.emit("exit", { code: event.code, signal: "websocket-close" });
    });
  }

  async stop() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      this.logger?.info("codex-app-server", "websocket_stop_requested", {
        url: this.appServerUrl,
      });
      ws.close();
    }

    if (!this.child) {
      return;
    }
    const child = this.child;
    this.child = null;
    this.logger?.info("codex-app-server", "stop_requested", {
      pid: child.pid,
    });
    child.kill();
  }

  async sendRequest(method, params, timeoutMs = 120_000) {
    if (!this.child && !this.ws) {
      await this.start();
    }

    const id = ++this.requestId;
    const startedAt = nowMs();
    this.logger?.debug("codex-app-server", "request_sent", {
      id,
      method,
      params,
      timeoutMs,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.logger?.error("codex-app-server", "request_timeout", {
          id,
          method,
          timeoutMs,
        });
        reject(
          new Error(
            `Timed out waiting for codex app-server response to ${method} after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timer,
        method,
        startedAt,
      });

      this.#write({
        id,
        method,
        params,
      });
    });
  }

  #write(payload) {
    const envelope = createJsonRpcEnvelope(payload);
    if (this.ws) {
      if (this.ws.readyState !== WebSocket.OPEN) {
        throw new Error("codex app-server websocket is not open");
      }
      this.ws.send(envelope);
      return;
    }

    if (!this.child?.stdin) {
      throw new Error("codex app-server transport is not available");
    }

    this.child.stdin.write(`${envelope}\n`);
  }

  async #handleServerRequest(message) {
    let result = {};
    let autoResolved = true;

    if (
      (message.method === "item/commandExecution/requestApproval" ||
        message.method === "execCommandApproval") &&
      !this.allowShellCommands
    ) {
      result = {
        decision: "denied",
        reason: "Shell command execution is disabled for this web UI session.",
      };
    } else if (
      (message.method === "mcpServer/elicitation/request" &&
        message.params?._meta?.codex_approval_kind === "mcp_tool_call") ||
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval" ||
      message.method === "item/permissions/requestApproval" ||
      message.method === "applyPatchApproval" ||
      message.method === "execCommandApproval"
    ) {
      result = { decision: "approved" };
    } else {
      autoResolved = false;
    }

    if (!autoResolved) {
      return;
    }

    this.logger?.info("codex-app-server", "server_request", {
      id: message.id,
      method: message.method,
      params: message.params,
      autoResolved: true,
      result,
    });

    this.#write({
      id: message.id,
      result,
    });
  }

  async #interruptCommandExecution(message) {
    const threadId = message.params?.threadId;
    const turnId = message.params?.turnId;
    if (!threadId || !turnId || this.blockedCommandTurns.has(turnId)) {
      return;
    }

    this.blockedCommandTurns.add(turnId);
    this.logger?.warn("codex-app-server", "shell_execution_interrupting", {
      threadId,
      turnId,
      command: message.params?.item?.command || null,
    });

    try {
      await this.sendRequest(
        "turn/interrupt",
        {
          threadId,
          turnId,
        },
        10_000,
      );
      this.logger?.info("codex-app-server", "shell_execution_interrupted", {
        threadId,
        turnId,
      });
    } catch (error) {
      this.logger?.error("codex-app-server", "shell_execution_interrupt_failed", {
        threadId,
        turnId,
        error,
      });
    }
  }

  #handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.logger?.error("codex-app-server", "protocol_parse_error", {
        error,
        line,
      });
      this.emit("protocolError", { error, line });
      return;
    }

    if (typeof message.method === "string" && message.id !== undefined) {
      void this.#handleServerRequest(message);
      this.emit("serverRequest", message);
      return;
    }

    if (typeof message.method === "string") {
      if (
        !this.allowShellCommands &&
        message.method === "item/started" &&
        message.params?.item?.type === "commandExecution"
      ) {
        void this.#interruptCommandExecution(message);
      }

      if (message.method === "turn/completed") {
        const completedTurnId = message.params?.turn?.id || message.params?.turnId;
        if (completedTurnId) {
          this.blockedCommandTurns.delete(completedTurnId);
        }
      }

      this.logger?.debug("codex-app-server", "notification", {
        method: message.method,
        params: message.params,
      });
      this.emit("notification", message);
      return;
    }

    if (message.id === undefined) {
      this.logger?.error("codex-app-server", "protocol_missing_id", {
        line,
      });
      this.emit("protocolError", {
        error: new Error("Received JSON-RPC message without id or method"),
        line,
      });
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      this.logger?.error("codex-app-server", "protocol_unexpected_response", {
        id: message.id,
        line,
      });
      this.emit("protocolError", {
        error: new Error(`Unexpected JSON-RPC response id ${message.id}`),
        line,
      });
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.error) {
      this.logger?.error("codex-app-server", "request_failed", {
        id: message.id,
        method: pending.method,
        durationMs: nowMs() - pending.startedAt,
        error: message.error,
      });
      pending.reject(toError(message.error));
      return;
    }

    this.logger?.debug("codex-app-server", "request_resolved", {
      id: message.id,
      method: pending.method,
      durationMs: nowMs() - pending.startedAt,
      result: message.result,
    });
    pending.resolve(message.result);
  }
}
