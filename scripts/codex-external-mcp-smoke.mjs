import { spawn } from "node:child_process";

import { CodexAppServerClient } from "../apps/local-mcp-web-ui/src/codex-app-server-client.mjs";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(300);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function spawnMcp({ exchange, port, path }) {
  const script = exchange === "mexc" ? "src/mexc.ts" : "src/index.ts";
  const envPrefix = exchange.toUpperCase();
  const child = spawn("node", ["--env-file=.env", "--import", "tsx/esm", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [`${envPrefix}_MCP_TRANSPORT`]: "http",
      [`${envPrefix}_MCP_HTTP_HOST`]: "127.0.0.1",
      [`${envPrefix}_MCP_HTTP_PORT`]: String(port),
      [`${envPrefix}_MCP_HTTP_PATH`]: path,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function main() {
  const bybit = { exchange: "bybit", port: 8893, path: "/mcp/bybit" };
  const mexc = { exchange: "mexc", port: 8894, path: "/mcp/mexc" };
  const codexPort = 8873;
  const codexUrl = `ws://127.0.0.1:${codexPort}`;
  const bybitUrl = `http://127.0.0.1:${bybit.port}${bybit.path}`;
  const mexcUrl = `http://127.0.0.1:${mexc.port}${mexc.path}`;
  const bybitServerName = "trading_mcp_bybit_local";
  const mexcServerName = "trading_mcp_mexc_local";

  const children = [spawnMcp(bybit), spawnMcp(mexc)];
  const codexStderr = [];
  let codex = null;
  let codexClient = null;

  try {
    await waitForHealth(`http://127.0.0.1:${bybit.port}/healthz`);
    await waitForHealth(`http://127.0.0.1:${mexc.port}/healthz`);

    codex = spawn(
      "codex",
      [
        "-C",
        process.cwd(),
        "app-server",
        "--listen",
        codexUrl,
        "-c",
        `mcp_servers.${bybitServerName}.url='${bybitUrl}'`,
        "-c",
        `mcp_servers.${mexcServerName}.url='${mexcUrl}'`,
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    codex.stderr.on("data", (chunk) => codexStderr.push(Buffer.from(chunk)));
    await waitForHealth(`http://127.0.0.1:${codexPort}/readyz`);

    codexClient = new CodexAppServerClient({
      mode: "external",
      appServerUrl: codexUrl,
      cwd: process.cwd(),
      allowShellCommands: false,
    });

    const initializeResponse = await codexClient.start();
    const threadStart = await codexClient.sendRequest("thread/start", {
      cwd: process.cwd(),
      model: process.env.WEB_UI_MODEL || "gpt-5.5",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: true,
    });

    const bybitToolCall = await codexClient.sendRequest("mcpServer/tool/call", {
      threadId: threadStart.thread.id,
      server: bybitServerName,
      tool: "getServerTime",
      arguments: {},
    });
    const mexcToolCall = await codexClient.sendRequest("mcpServer/tool/call", {
      threadId: threadStart.thread.id,
      server: mexcServerName,
      tool: "getMexcCapabilityGuide",
      arguments: {},
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          codexUrl,
          bybitUrl,
          mexcUrl,
          initializeResponse,
          threadId: threadStart.thread.id,
          bybitToolCall,
          mexcToolCall,
        },
        null,
        2,
      ),
    );
  } finally {
    if (codexClient) {
      await codexClient.stop();
    }
    if (codex) {
      await stopChild(codex);
    }
    for (const child of children) {
      await stopChild(child);
    }
    const codexLog = Buffer.concat(codexStderr).toString("utf8").trim();
    if (codexLog) {
      console.error(codexLog);
    }
  }
}

await main();
