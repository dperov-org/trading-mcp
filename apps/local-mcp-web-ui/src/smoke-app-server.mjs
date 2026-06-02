import { getAppConfig } from "./config.mjs";
import { CodexAppServerClient } from "./codex-app-server-client.mjs";

async function main() {
  const config = getAppConfig();
  const codexClient = new CodexAppServerClient({
    launcher: config.launcher,
    cwd: config.repoRoot,
    allowShellCommands: config.allowShellCommands,
  });
  const shellAttempt = {
    sawCommandExecutionStarted: false,
    sawCommandExecutionOutput: false,
    sawTurnCompleted: false,
  };

  try {
    const initializeResponse = await codexClient.start();
    const threadStart = await codexClient.sendRequest("thread/start", {
      cwd: config.repoRoot,
      model: config.model,
      approvalPolicy: config.approvalPolicy,
      sandbox: "danger-full-access",
      ephemeral: true,
    });

    const toolCall = await codexClient.sendRequest("mcpServer/tool/call", {
      threadId: threadStart.thread.id,
      server: config.serverName,
      tool: "getServerTime",
      arguments: {},
    });

    const mexcToolCall = await codexClient.sendRequest("mcpServer/tool/call", {
      threadId: threadStart.thread.id,
      server: config.mexcServerName,
      tool: "getServerTime",
      arguments: {},
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for shell blocking verification"));
      }, 20_000);

      const onNotification = (message) => {
        if (message.params?.threadId !== threadStart.thread.id) {
          return;
        }

        if (
          message.method === "item/started" &&
          message.params?.item?.type === "commandExecution"
        ) {
          shellAttempt.sawCommandExecutionStarted = true;
          return;
        }

        if (message.method === "item/commandExecution/outputDelta") {
          shellAttempt.sawCommandExecutionOutput = true;
          return;
        }

        if (message.method === "turn/completed") {
          shellAttempt.sawTurnCompleted = true;
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        codexClient.off("notification", onNotification);
      };

      codexClient.on("notification", onNotification);

      codexClient
        .sendRequest("turn/start", {
          threadId: threadStart.thread.id,
          input: [
            {
              type: "text",
              text: "Run the shell command pwd and only tell me its output.",
              text_elements: [],
            },
          ],
          model: config.model,
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });

    if (shellAttempt.sawCommandExecutionOutput) {
      throw new Error("Shell command output was produced even though shell access is disabled");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          initializeResponse,
          threadId: threadStart.thread.id,
          approvalPolicy: config.approvalPolicy,
          bybitToolCall: toolCall,
          mexcToolCall,
          shellAttempt,
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
