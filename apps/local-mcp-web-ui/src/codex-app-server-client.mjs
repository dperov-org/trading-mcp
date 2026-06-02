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
    cwd,
    startupTimeoutMs = 30_000,
    logger = null,
    allowShellCommands = false,
  }) {
    super();
    this.launcher = launcher;
    this.cwd = cwd;
    this.startupTimeoutMs = startupTimeoutMs;
    this.logger = logger;
    this.allowShellCommands = allowShellCommands;
    this.child = null;
    this.pending = new Map();
    this.requestId = 0;
    this.initializeResponse = null;
    this.blockedCommandTurns = new Set();
  }

  async start() {
    if (this.child) {
      return this.initializeResponse;
    }

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
      initializeResponse: this.initializeResponse,
    });

    return this.initializeResponse;
  }

  async stop() {
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
    if (!this.child) {
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
    if (!this.child?.stdin) {
      throw new Error("codex app-server stdin is not available");
    }

    this.child.stdin.write(`${createJsonRpcEnvelope(payload)}\n`);
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
