import process from 'node:process';
import localtunnel from 'localtunnel';
import OpenAI from 'openai';
import { startBridgeServer } from './bridge-server.mjs';
import { requireEnv } from './env.mjs';

const DEFAULT_MODEL_CANDIDATES = ['gpt-5', 'gpt-5-mini', 'gpt-4.1'];
const TEST_INSTRUCTIONS = [
  'You are validating a Bybit MCP server.',
  'Use the MCP tools when needed and answer concisely with the retrieved facts.',
  'For BTC/USDT price, prefer getTickers with category="spot" and symbol="BTCUSDT".',
  'For wallet balance, prefer getWalletBalance with accountType="UNIFIED" and omit coin unless the user explicitly asks for a specific coin.',
  'For open spot orders, prefer getOpenOrders with category="spot".',
].join(' ');

function parseJson(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarizeFromToolCalls(output) {
  const calls = (output ?? []).filter(
    (item) => item.type === 'mcp_call' && item.status === 'completed',
  );

  for (const call of calls) {
    const payload = parseJson(call.output);
    if (!payload) {
      continue;
    }

    if (call.name === 'getTickers') {
      const ticker = payload?.result?.list?.[0];
      if (ticker?.lastPrice) {
        return `${ticker.lastPrice}`;
      }
    }

    if (call.name === 'getOpenOrders') {
      const count = Array.isArray(payload?.result?.list) ? payload.result.list.length : null;
      if (count !== null) {
        return `${count}`;
      }
    }

    if (call.name === 'getWalletBalance') {
      const account = payload?.result?.list?.[0];
      if (!account) {
        continue;
      }

      return `Wallet balance retrieved for ${account.accountType}: total wallet balance ${account.totalWalletBalance} USD, available balance ${account.totalAvailableBalance} USD.`;
    }
  }

  return '';
}

async function createResponseWithFallback(client, requestFactory) {
  const configuredModel = process.env.OPENAI_MODEL?.trim();
  const candidates = configuredModel ? [configuredModel] : DEFAULT_MODEL_CANDIDATES;
  let lastError;

  for (const model of candidates) {
    try {
      const response = await client.responses.create(requestFactory(model));
      return { model, response };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/model|unsupported|not found|does not exist|permission/i.test(message)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function ensureTextAnswer(client, model, response) {
  if (response.output_text?.trim()) {
    return response;
  }

  return client.responses.create({
    model,
    previous_response_id: response.id,
    input:
      'Summarize the already retrieved MCP results in one short sentence. Do not call any more tools unless absolutely necessary.',
    max_output_tokens: 300,
    parallel_tool_calls: false,
  });
}

export async function askQuestion(question) {
  requireEnv('OPENAI_API_KEY');

  const bridge = await startBridgeServer();
  const tunnel = await localtunnel({ port: bridge.port, local_host: '127.0.0.1' });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { model, response: initialResponse } = await createResponseWithFallback(client, (chosenModel) => ({
      model: chosenModel,
      instructions: TEST_INSTRUCTIONS,
      input: question,
      max_output_tokens: 700,
      parallel_tool_calls: false,
      tools: [
        {
          type: 'mcp',
          server_label: 'trading_mcp',
          server_description:
            'Read-only Bybit account and market data MCP bridge for smoke tests.',
          server_url: `${tunnel.url}/mcp`,
          require_approval: 'never',
        },
      ],
    }));
    const response = await ensureTextAnswer(client, model, initialResponse);

    const toolCalls = (initialResponse.output ?? []).filter((item) => item.type === 'mcp_call');
    const answer = response.output_text?.trim() || summarizeFromToolCalls(initialResponse.output);

    return {
      model,
      publicUrl: tunnel.url,
      answer,
      toolCalls: toolCalls.map((item) => ({
        name: item.name,
        status: item.status ?? null,
        error: item.error ?? null,
      })),
    };
  } finally {
    tunnel.close();
    await bridge.close();
  }
}

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    throw new Error('Usage: npm run ask -- "What is the current BTC/USDT price?"');
  }

  const result = await askQuestion(question);
  console.log(`Model: ${result.model}`);
  console.log(`Public MCP URL: ${result.publicUrl}/mcp`);
  console.log(`Tool calls: ${JSON.stringify(result.toolCalls, null, 2)}`);
  console.log('');
  console.log(result.answer);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
