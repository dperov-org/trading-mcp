import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import localtunnel from 'localtunnel';
import OpenAI from 'openai';
import { startBridgeServer } from './bridge-server.mjs';
import { appRoot, requireEnv } from './env.mjs';

const DEFAULT_MODEL_CANDIDATES = ['gpt-5', 'gpt-5-mini', 'gpt-4.1'];
const TEST_INSTRUCTIONS = [
  'You are validating a Bybit MCP server.',
  'Always use the attached MCP tools when relevant.',
  'Answer briefly and only with facts you retrieved.',
  'For BTC/USDT price, prefer getTickers with category="spot" and symbol="BTCUSDT".',
  'For wallet balance, prefer getWalletBalance with accountType="UNIFIED" and omit coin unless the user explicitly asks for a specific coin.',
  'For open spot orders, prefer getOpenOrders with category="spot".',
].join(' ');
const QUESTIONS = [
  'What is the current BTC/USDT price? Use the MCP tools and give me the exact price you retrieved.',
  "What's my wallet balance? Use the MCP tools and summarize the accessible balances.",
  'Do I currently have any open spot orders? Use the MCP tools and answer with the current count if possible.',
];

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

function summarizeToolImport(output) {
  const listItem = (output ?? []).find((item) => item.type === 'mcp_list_tools');
  if (!listItem || !Array.isArray(listItem.tools)) {
    return [];
  }

  return listItem.tools.map((tool) => tool.name);
}

function summarizeToolCalls(output) {
  return (output ?? [])
    .filter((item) => item.type === 'mcp_call')
    .map((item) => ({
      name: item.name,
      status: item.status ?? null,
      error: item.error ?? null,
    }));
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

async function writeReport(report) {
  const artifactsDir = path.join(appRoot, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(artifactsDir, `live-check-${stamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

async function main() {
  requireEnv('OPENAI_API_KEY');

  const bridge = await startBridgeServer();
  const tunnel = await localtunnel({ port: bridge.port, local_host: '127.0.0.1' });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const results = [];
    let selectedModel = process.env.OPENAI_MODEL?.trim() || null;

    for (const question of QUESTIONS) {
      const { model, response: initialResponse } = await createResponseWithFallback(client, (chosenModel) => ({
        model: chosenModel,
        instructions: TEST_INSTRUCTIONS,
        input: question,
        max_output_tokens: 900,
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

      selectedModel = model;
      const answer = response.output_text?.trim() || summarizeFromToolCalls(initialResponse.output);
      results.push({
        question,
        answer,
        importedTools: summarizeToolImport(initialResponse.output),
        toolCalls: summarizeToolCalls(initialResponse.output),
      });
    }

    const report = {
      ranAt: new Date().toISOString(),
      model: selectedModel,
      publicMcpUrl: `${tunnel.url}/mcp`,
      localMcpUrl: `${bridge.baseUrl}/mcp`,
      exposedTools: bridge.filteredTools.map((tool) => tool.name),
      questions: results,
    };

    const reportPath = await writeReport(report);

    console.log(`Model: ${report.model}`);
    console.log(`Public MCP URL: ${report.publicMcpUrl}`);
    console.log(`Report: ${reportPath}`);
    console.log('');

    for (const entry of report.questions) {
      console.log(`Q: ${entry.question}`);
      console.log(`Tool calls: ${entry.toolCalls.map((call) => `${call.name}:${call.status ?? 'n/a'}`).join(', ')}`);
      console.log(`A: ${entry.answer}`);
      console.log('');
    }
  } finally {
    tunnel.close();
    await bridge.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
