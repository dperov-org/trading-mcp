import { spawn } from "node:child_process";

import { startWebUiServer } from "./server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/readyz`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`readyz returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(300);
  }
  throw lastError || new Error(`Timed out waiting for ${url}/readyz`);
}

async function main() {
  const codexPort = 8872;
  const codexUrl = `ws://127.0.0.1:${codexPort}`;
  const codexHttpUrl = `http://127.0.0.1:${codexPort}`;
  const codex = spawn("codex", ["-C", process.cwd(), "app-server", "--listen", codexUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  codex.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

  const previous = {
    WEB_UI_PORT: process.env.WEB_UI_PORT,
    WEB_UI_AUTH_MODE: process.env.WEB_UI_AUTH_MODE,
    WEB_UI_CODEX_MODE: process.env.WEB_UI_CODEX_MODE,
    WEB_UI_CODEX_APP_SERVER_URL: process.env.WEB_UI_CODEX_APP_SERVER_URL,
  };

  process.env.WEB_UI_PORT = process.env.WEB_UI_PORT || "8802";
  process.env.WEB_UI_AUTH_MODE = "none";
  process.env.WEB_UI_CODEX_MODE = "external";
  process.env.WEB_UI_CODEX_APP_SERVER_URL = codexUrl;

  let runtime = null;
  try {
    await waitForReady(codexHttpUrl);
    runtime = await startWebUiServer();
    const health = await fetch(`${runtime.url}/healthz`).then((response) => response.json());
    assert(health?.ok === true, "Web UI healthz did not return ok=true");
    assert(health?.codex_mode === "external", `Unexpected codex_mode: ${health?.codex_mode}`);
    assert(
      health?.codex_app_server_url === codexUrl,
      `Unexpected codex_app_server_url: ${health?.codex_app_server_url}`,
    );
    assert(health?.app_server?.userAgent, "External app-server initialize response missing");

    console.log(
      JSON.stringify(
        {
          ok: true,
          webUiUrl: runtime.url,
          codexUrl,
          codexMode: health.codex_mode,
        },
        null,
        2,
      ),
    );
  } finally {
    if (runtime) {
      await runtime.close();
    }
    codex.kill("SIGTERM");
    await new Promise((resolve) => codex.once("exit", resolve));

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    const stderrText = Buffer.concat(stderr).toString("utf8").trim();
    if (stderrText) {
      console.error(stderrText);
    }
  }
}

await main();
