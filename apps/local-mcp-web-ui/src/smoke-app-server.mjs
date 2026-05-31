import { getAppConfig } from "./config.mjs";
import { CodexAppServerClient } from "./codex-app-server-client.mjs";

async function main() {
  const config = getAppConfig();
  const codexClient = new CodexAppServerClient({
    launcher: config.launcher,
    cwd: config.repoRoot,
  });

  try {
    const initializeResponse = await codexClient.start();
    const threadStart = await codexClient.sendRequest("thread/start", {
      cwd: config.repoRoot,
      model: config.model,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: true,
    });

    const toolCall = await codexClient.sendRequest("mcpServer/tool/call", {
      threadId: threadStart.thread.id,
      server: config.serverName,
      tool: "getServerTime",
      arguments: {},
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          initializeResponse,
          threadId: threadStart.thread.id,
          toolCall,
        },
        null,
        2,
      ),
    );
  } finally {
    await codexClient.stop();
  }
}

await main();
