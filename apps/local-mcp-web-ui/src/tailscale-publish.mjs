import { spawn } from "node:child_process";

function parseMode(argv) {
  const mode = String(argv[2] || "").trim().toLowerCase();
  if (mode === "serve" || mode === "funnel") {
    return mode;
  }

  throw new Error("Usage: node tailscale-publish.mjs <serve|funnel>");
}

function wantsJson(argv) {
  return argv.includes("--json");
}

function runCommand(command, args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Timed out running ${command} ${args.join(" ")} after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      const output = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      };

      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with code ${code}\n${output.stderr || output.stdout}`,
          ),
        );
        return;
      }

      resolve(output);
    });
  });
}

function maybeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractPublishedUrl(statusJson) {
  if (!statusJson || typeof statusJson !== "object") {
    return null;
  }

  const webEntries =
    statusJson.Web && typeof statusJson.Web === "object"
      ? Object.keys(statusJson.Web)
      : [];

  if (webEntries.length === 0) {
    return null;
  }

  const first = webEntries[0];
  return first ? `https://${first.replace(/:443$/, "")}/` : null;
}

async function main() {
  const mode = parseMode(process.argv);
  const jsonOutput = wantsJson(process.argv);
  process.env.WEB_UI_HOST = "127.0.0.1";
  process.env.WEB_UI_AUTH_MODE = mode === "funnel" ? "session" : "none";

  const { getAppConfig } = await import("./config.mjs");
  const config = getAppConfig();

  if (mode === "funnel" && !config.sessionPassword) {
    throw new Error(
      "WEB_UI_SESSION_PASSWORD must be configured for tailscale funnel mode",
    );
  }

  const { startWebUiServer } = await import("./server.mjs");
  const runtime = await startWebUiServer();
  let shutdownStarted = false;

  const stop = async () => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    await runtime.close();

    if (String(process.env.WEB_UI_TAILSCALE_RESET_ON_EXIT || "") === "1") {
      try {
        await runCommand("tailscale", [mode, "reset"], { timeoutMs: 15_000 });
      } catch (error) {
        console.error(`[webui:${mode}] reset failed`, error.message);
      }
    }
  };

  process.on("SIGINT", async () => {
    await stop();
    process.exit(130);
  });

  process.on("SIGTERM", async () => {
    await stop();
    process.exit(143);
  });

  try {
    const publishResult = await runCommand("tailscale", [mode, "--bg", "--yes", String(config.port)], {
      timeoutMs: 30_000,
    });
    const statusResult = await runCommand("tailscale", [mode, "status", "--json"], {
      timeoutMs: 15_000,
    });
    const tailscaleStatus =
      maybeParseJson(statusResult.stdout) || statusResult.stdout;
    const publishedUrl = extractPublishedUrl(tailscaleStatus);
    const result = {
      ok: true,
      mode,
      localUrl: runtime.url,
      publishedUrl,
      authMode: config.authMode,
      publishStdout: publishResult.stdout || null,
      publishStderr: publishResult.stderr || null,
      tailscaleStatus,
      resetOnExit: String(process.env.WEB_UI_TAILSCALE_RESET_ON_EXIT || "") === "1",
    };

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`[webui:${mode}] local URL: ${runtime.url}`);
    if (publishedUrl) {
      console.log(`[webui:${mode}] published URL: ${publishedUrl}`);
    }
    console.log(`[webui:${mode}] auth mode: ${config.authMode}`);
    if (mode === "funnel") {
      console.log(
        `[webui:${mode}] trusted domain key source: ${process.env.WEB_UI_CHATKIT_DOMAIN_KEYS || process.env.WEB_UI_CHATKIT_DOMAIN_KEYS_JSON ? "host-mapped" : "single default"}`,
      );
    }
    console.log(
      `[webui:${mode}] stop with: tailscale ${mode} reset`,
    );
  } catch (error) {
    await stop();
    throw error;
  }
}

await main();
