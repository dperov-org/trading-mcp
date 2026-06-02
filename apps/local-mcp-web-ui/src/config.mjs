import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const currentFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(currentFile);
const appRoot = path.resolve(srcDir, "..");
const repoRoot = path.resolve(appRoot, "..", "..");

function toInt(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toConsoleLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "none"
  ) {
    return normalized;
  }

  return "warn";
}

function toAuthMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "session") {
    return "session";
  }

  return "none";
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeHost(host) {
  const raw = String(host || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  const withoutPort = raw.replace(/:\d+$/, "");
  return withoutPort.replace(/^\[(.*)\]$/, "$1");
}

function parseDomainKeyPairs(raw) {
  const result = new Map();
  if (!raw) {
    return result;
  }

  for (const entry of String(raw).split(/[,\n;]/)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const host = normalizeHost(trimmed.slice(0, separatorIndex));
    const key = trimmed.slice(separatorIndex + 1).trim();
    if (!host || !key) {
      continue;
    }

    result.set(host, key);
  }

  return result;
}

function parseDomainKeyJson(raw) {
  const result = new Map();
  if (!raw) {
    return result;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return result;
    }

    for (const [host, key] of Object.entries(parsed)) {
      const normalizedHost = normalizeHost(host);
      const normalizedKey = String(key || "").trim();
      if (!normalizedHost || !normalizedKey) {
        continue;
      }

      result.set(normalizedHost, normalizedKey);
    }
  } catch {
    return result;
  }

  return result;
}

function mergeDomainKeyMaps(...maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [host, key] of map.entries()) {
      merged.set(host, key);
    }
  }

  return merged;
}

function resolveDomainKeyForHost({ host, domainKeys, defaultKey }) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    return defaultKey;
  }

  if (domainKeys.has(normalizedHost)) {
    return domainKeys.get(normalizedHost);
  }

  for (const [candidateHost, candidateKey] of domainKeys.entries()) {
    if (!candidateHost.startsWith("*.")) {
      continue;
    }

    const suffix = candidateHost.slice(1);
    if (normalizedHost.endsWith(suffix) && normalizedHost.length > suffix.length) {
      return candidateKey;
    }
  }

  return defaultKey;
}

function readDotEnvFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadProjectEnv(repoRoot) {
  const envFilePath = path.join(repoRoot, ".env");
  const raw = readDotEnvFile(envFilePath);
  if (!raw) {
    return;
  }

  for (const rawLine of raw.split(/\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

export function getAppConfig() {
  const platform = process.env.WEB_UI_PLATFORM || process.platform;
  const launcherScript =
    platform === "win32"
      ? path.join(repoRoot, "scripts", "start-codex-app-server-with-mcp.ps1")
      : path.join(repoRoot, "scripts", "start-codex-app-server-with-mcp.sh");

  loadProjectEnv(repoRoot);

  const authMode = toAuthMode(process.env.WEB_UI_AUTH_MODE);
  const sessionPassword = process.env.WEB_UI_SESSION_PASSWORD || "";
  const defaultChatkitDomainKey =
    process.env.WEB_UI_CHATKIT_DOMAIN_KEY ||
    process.env.OPENAI_CHATKIT_DOMAIN_KEY ||
    "local-dev";
  const chatkitDomainKeys = mergeDomainKeyMaps(
    parseDomainKeyPairs(process.env.WEB_UI_CHATKIT_DOMAIN_KEYS),
    parseDomainKeyJson(process.env.WEB_UI_CHATKIT_DOMAIN_KEYS_JSON),
  );
  const sessionSecret =
    process.env.WEB_UI_SESSION_SECRET ||
    crypto
      .createHash("sha256")
      .update(`${repoRoot}:${sessionPassword || "no-password-configured"}`)
      .digest("hex");

  return {
    appRoot,
    repoRoot,
    publicDir: path.join(appRoot, "public"),
    artifactsDir: path.join(appRoot, "artifacts"),
    logDir: path.join(appRoot, "artifacts", "logs"),
    storePath:
      process.env.WEB_UI_STORE_PATH ||
      path.join(appRoot, ".data", "store.json"),
    host: process.env.WEB_UI_HOST || "127.0.0.1",
    port: toInt(process.env.WEB_UI_PORT || process.env.PORT, 8787),
    model: process.env.WEB_UI_MODEL || "gpt-5.5",
    chatkitDomainKey: defaultChatkitDomainKey,
    chatkitDomainKeys,
    chatkitVerifyUrl:
      process.env.WEB_UI_CHATKIT_VERIFY_URL ||
      "https://api.openai.com/v1/chatkit/domain_keys/verify",
    resolveChatkitDomainKey(host) {
      return resolveDomainKeyForHost({
        host,
        domainKeys: chatkitDomainKeys,
        defaultKey: defaultChatkitDomainKey,
      });
    },
    serverName: process.env.SERVER_NAME || "trading_mcp_bybit_local",
    mexcServerName: process.env.MEXC_SERVER_NAME || "trading_mcp_mexc_local",
    allowShellCommands: toBoolean(process.env.WEB_UI_ALLOW_SHELL_COMMANDS, false),
    approvalPolicy: process.env.WEB_UI_APPROVAL_POLICY || "never",
    platform,
    consoleLogLevel: toConsoleLevel(process.env.WEB_UI_CONSOLE_LOG_LEVEL),
    authMode,
    sessionCookieName:
      process.env.WEB_UI_SESSION_COOKIE_NAME || "local_mcp_web_ui_session",
    sessionPassword,
    sessionSecret,
    sessionTtlMs:
      toInt(process.env.WEB_UI_SESSION_TTL_HOURS, 24 * 7) * 60 * 60 * 1000,
    sessionId:
      process.env.WEB_UI_SESSION_ID ||
      `${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID().slice(0, 8)}`,
    launcher:
      platform === "win32"
        ? {
            command: "powershell",
            args: ["-ExecutionPolicy", "Bypass", "-File", launcherScript],
          }
        : {
            command: "bash",
            args: [launcherScript],
          },
  };
}
