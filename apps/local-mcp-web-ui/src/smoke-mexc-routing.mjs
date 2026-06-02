import { getAppConfig } from './config.mjs';
import { CodexAppServerClient } from './codex-app-server-client.mjs';
import { normalizeChatKitInput, toCodexUserInput } from './chatkit-protocol.mjs';

async function main() {
  const config = getAppConfig();
  const codexClient = new CodexAppServerClient({
    launcher: config.launcher,
    cwd: config.repoRoot,
    allowShellCommands: config.allowShellCommands,
  });

  const observed = {
    mexcCalls: [],
    bybitCalls: [],
    assistantText: '',
  };

  try {
    await codexClient.start();
    const threadStart = await codexClient.sendRequest('thread/start', {
      cwd: config.repoRoot,
      model: config.model,
      approvalPolicy: config.approvalPolicy,
      sandbox: 'danger-full-access',
      ephemeral: true,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for MEXC routing turn completion'));
      }, 120_000);

      const onNotification = (message) => {
        if (message.params?.threadId !== threadStart.thread.id) {
          return;
        }

        if (message.method === 'item/started' && message.params?.item?.type === 'mcpToolCall') {
          const server = message.params.item.server;
          const tool = message.params.item.tool;
          if (server === config.mexcServerName) {
            observed.mexcCalls.push(tool);
          }
          if (server === config.serverName) {
            observed.bybitCalls.push(tool);
          }
          return;
        }

        if (message.method === 'item/agentMessage/delta') {
          observed.assistantText += message.params?.delta || '';
          return;
        }

        if (message.method === 'turn/completed') {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        codexClient.off('notification', onNotification);
      };

      codexClient.on('notification', onNotification);

      const input = normalizeChatKitInput(
        {
          content: [{ text: 'проанализируй сделки на mexc' }],
        },
        config.model,
      );

      codexClient
        .sendRequest('turn/start', {
          threadId: threadStart.thread.id,
          input: toCodexUserInput(input, { allowShellCommands: config.allowShellCommands }),
          model: config.model,
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });

    if (observed.mexcCalls.length === 0) {
      throw new Error('The agent did not call any MEXC MCP tools during the MEXC routing smoke test');
    }

    if (observed.bybitCalls.length > 0) {
      throw new Error(
        `The agent called Bybit MCP tools during the MEXC routing smoke test: ${observed.bybitCalls.join(', ')}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          threadId: threadStart.thread.id,
          mexcServerName: config.mexcServerName,
          bybitServerName: config.serverName,
          mexcCalls: observed.mexcCalls,
          bybitCalls: observed.bybitCalls,
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
