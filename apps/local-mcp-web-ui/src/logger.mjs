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

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dateKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function rotationStamp(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().replace(/[:.]/g, "-");
}

export class WebUiLogger {
  constructor({
    logDir,
    sessionId,
    consoleLevel = "warn",
    maxFileBytes = 10 * 1024 * 1024,
    retentionDays = 30,
    maxFiles = 100,
  }) {
    this.logDir = logDir;
    this.sessionId = sessionId;
    this.consoleLevel = levelWeights[consoleLevel] ? consoleLevel : "warn";
    this.logPath = path.join(logDir, `webui-${sessionId}.jsonl`);
    this.latestLogPath = path.join(logDir, "webui-latest.jsonl");
    this.maxFileBytes = positiveInteger(maxFileBytes, 10 * 1024 * 1024);
    this.retentionMs = positiveInteger(retentionDays, 30) * 24 * 60 * 60 * 1000;
    this.maxFiles = positiveInteger(maxFiles, 100);
    this.activeDate = dateKey();
    this.writeChain = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.logDir, { recursive: true });
    await this.prune();
    await fs.writeFile(this.logPath, "", "utf8");
    await fs.writeFile(this.latestLogPath, "", "utf8");
  }

  async statOrNull(filePath) {
    try {
      return await fs.stat(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async rotateIfNeeded(nextLineBytes) {
    const currentDate = dateKey();
    const currentSize = (await this.statOrNull(this.logPath))?.size || 0;
    const shouldRotate =
      currentDate !== this.activeDate || currentSize + nextLineBytes > this.maxFileBytes;

    if (!shouldRotate) {
      return;
    }

    const suffix = rotationStamp();
    for (const filePath of [this.logPath, this.latestLogPath]) {
      if (await this.statOrNull(filePath)) {
        const parsed = path.parse(filePath);
        await fs.rename(filePath, path.join(parsed.dir, `${parsed.name}.${suffix}${parsed.ext}`));
      }
      await fs.writeFile(filePath, "", "utf8");
    }

    this.activeDate = currentDate;
    await this.prune();
  }

  async prune() {
    const entries = await fs.readdir(this.logDir, { withFileTypes: true });
    const candidates = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("webui-") || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      const filePath = path.join(this.logDir, entry.name);
      if (filePath === this.logPath || filePath === this.latestLogPath) {
        continue;
      }

      const stat = await this.statOrNull(filePath);
      if (!stat) {
        continue;
      }

      if (Date.now() - stat.mtimeMs > this.retentionMs) {
        await fs.unlink(filePath);
        continue;
      }

      candidates.push({ filePath, mtimeMs: stat.mtimeMs });
    }

    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    await Promise.all(candidates.slice(this.maxFiles).map(({ filePath }) => fs.unlink(filePath)));
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
      await this.rotateIfNeeded(Buffer.byteLength(line, "utf8"));
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
