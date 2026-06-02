import { getAppConfig } from "./config.mjs";
import { CodexAppServerClient } from "./codex-app-server-client.mjs";
import { normalizeChatKitInput, toCodexUserInput } from "./chatkit-protocol.mjs";

async function main() {
  const config = getAppConfig();
  const codexClient = new CodexAppServerClient({
    launcher: config.launcher,
    cwd: config.repoRoot,
    allowShellCommands: config.allowShellCommands,
  });

  const observed = {
    webSearchQueries: [],
    shellExecutionStarted: false,
    assistantText: "",
  };

  try {
    await codexClient.start();
    const threadStart = await codexClient.sendRequest("thread/start", {
      cwd: config.repoRoot,
      model: config.model,
      approvalPolicy: config.approvalPolicy,
      sandbox: "danger-full-access",
      ephemeral: true,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for web-search smoke completion"));
      }, 120_000);

      const onNotification = (message) => {
        if (message.params?.threadId !== threadStart.thread.id) {
          return;
        }

        if (message.method === "item/started") {
          if (message.params?.item?.type === "webSearch") {
            observed.webSearchQueries.push(message.params.item.query || "");
            return;
          }

          if (message.params?.item?.type === "commandExecution") {
            observed.shellExecutionStarted = true;
            return;
          }
        }

        if (message.method === "item/agentMessage/delta") {
          observed.assistantText += message.params?.delta || "";
          return;
        }

        if (message.method === "turn/completed") {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        codexClient.off("notification", onNotification);
      };

      codexClient.on("notification", onNotification);

      const input = normalizeChatKitInput(
        {
          content: [
            {
              text: "Use web search to find one current public Bitcoin news headline and answer in one short sentence. Do not use shell commands.",
            },
          ],
        },
        config.model,
      );

      codexClient
        .sendRequest("turn/start", {
          threadId: threadStart.thread.id,
          input: toCodexUserInput(input, {
            allowShellCommands: config.allowShellCommands,
            allowWebSearch: config.allowWebSearch,
          }),
          model: config.model,
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });

    if (observed.webSearchQueries.length === 0) {
      throw new Error("The agent did not start any webSearch item during the smoke test");
    }

    if (observed.shellExecutionStarted) {
      throw new Error("The agent attempted shell execution during the web-search smoke test");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          threadId: threadStart.thread.id,
          allowWebSearch: config.allowWebSearch,
          webSearchQueries: observed.webSearchQueries,
          assistantPreview: observed.assistantText.slice(0, 400),
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
