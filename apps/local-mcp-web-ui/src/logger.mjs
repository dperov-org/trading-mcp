import fs from "node:fs/promises";
import path from "node:path";

const levelWeights = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  none: 100,
};

function toSerializable(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code,
      data: value.data,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toSerializable(item)]),
    );
  }

  return value;
}

function nowIsoString() {
  return new Date().toISOString();
}

export class WebUiLogger {
  constructor({ logDir, sessionId, consoleLevel = "warn" }) {
    this.logDir = logDir;
    this.sessionId = sessionId;
    this.consoleLevel = levelWeights[consoleLevel] ? consoleLevel : "warn";
    this.logPath = path.join(logDir, `webui-${sessionId}.jsonl`);
    this.latestLogPath = path.join(logDir, "webui-latest.jsonl");
    this.writeChain = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.logDir, { recursive: true });
    await fs.writeFile(this.logPath, "", "utf8");
    await fs.writeFile(this.latestLogPath, "", "utf8");
  }

  log(level, component, event, data = {}) {
    const entry = {
      ts: nowIsoString(),
      level,
      sessionId: this.sessionId,
      component,
      event,
      data: toSerializable(data),
    };

    const line = `${JSON.stringify(entry)}\n`;

    this.writeChain = this.writeChain.then(async () => {
      await Promise.all([
        fs.appendFile(this.logPath, line, "utf8"),
        fs.appendFile(this.latestLogPath, line, "utf8"),
      ]);
    });

    if (levelWeights[level] >= levelWeights[this.consoleLevel]) {
      if (level === "error") {
        console.error(`[webui:${component}] ${event}`, entry.data);
        return;
      }

      console.log(`[webui:${component}] ${event}`, entry.data);
    }
  }

  debug(component, event, data = {}) {
    this.log("debug", component, event, data);
  }

  info(component, event, data = {}) {
    this.log("info", component, event, data);
  }

  warn(component, event, data = {}) {
    this.log("warn", component, event, data);
  }

  error(component, event, data = {}) {
    this.log("error", component, event, data);
  }

  async flush() {
    await this.writeChain;
  }
}
