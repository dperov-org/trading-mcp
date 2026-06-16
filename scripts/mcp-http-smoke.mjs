import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((candidate) => candidate.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(300);
  }

  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const exchange = getArg("exchange", "bybit");
  const port = Number.parseInt(getArg("port", exchange === "mexc" ? "8792" : "8791"), 10);
  const path = getArg("path", `/mcp/${exchange}`);
  const expectedTool = getArg(
    "expected-tool",
    exchange === "mexc" ? "getMexcCapabilityGuide" : "getServerTime",
  );

  const script = exchange === "mexc" ? "src/mexc.ts" : "src/index.ts";
  const envPrefix = exchange.toUpperCase();
  const env = {
    ...process.env,
    [`${envPrefix}_MCP_TRANSPORT`]: "http",
    [`${envPrefix}_MCP_HTTP_HOST`]: "127.0.0.1",
    [`${envPrefix}_MCP_HTTP_PORT`]: String(port),
    [`${envPrefix}_MCP_HTTP_PATH`]: path,
  };

  const child = spawn("node", ["--env-file=.env", "--import", "tsx/esm", script], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

  try {
    const health = await waitForHealth(`http://127.0.0.1:${port}/healthz`);
    const client = new Client({
      name: `mcp-http-smoke-${exchange}`,
      version: "0.0.1",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}${path}`),
    );

    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert(
      toolNames.includes(expectedTool),
      `Expected tool ${expectedTool} was not listed; got ${toolNames.slice(0, 20).join(", ")}`,
    );

    await client.close();

    console.log(
      JSON.stringify(
        {
          ok: true,
          exchange,
          url: `http://127.0.0.1:${port}${path}`,
          health,
          toolCount: toolNames.length,
          expectedTool,
        },
        null,
        2,
      ),
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    const stderrText = Buffer.concat(stderr).toString("utf8").trim();
    if (stderrText) {
      console.error(stderrText);
    }
  }
}

await main();
