import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { appRoot, repoRoot, requireEnv } from './env.mjs';

const openAiModels = ['gpt-5-nano', 'gpt-5-mini', 'gpt-5'];
const qwenModels = ['qwen3.6-flash', 'qwen3.8-flash', 'qwen3.7-plus'];
const triggerPrompt = [
  'Выполни безопасный dry-run вариант запроса: «открой в MEXC trigger-ордер на небольшую сумму (BTC perp) и измерь время».',
  'Реальный локальный MEXC MCP уже запущен в dry-run: заявка валидируется, но на биржу не отправляется.',
  'Малый объём для BTC_USDT заранее определён как minVol=1 контракт. Рынок для теста: last price=81000 USDT.',
  'Ровно один раз вызови createFuturesTriggerOrder для открытия long BTC_USDT: vol=1, leverage=2, isolated margin,',
  'one-time market trigger по last price при росте до 89100; stop loss=76950; take profit=93150; обязательно передай JSON boolean reduceOnly=false.',
  'Используй точные коды: side=1, openType=1, triggerType=1, executeCycle=1, orderType=5, trend=1.',
  'Для market orderType=5 не передавай price, positionMode и recvWindow. Коды enum передавай числовыми JSON-значениями, не строками. Не объясняй параметры до tool call.',
].join(' ');

const writeCases = [
  {
    id: 'spot-test-market-buy',
    toolName: 'createTestOrder',
    prompt: 'Выполни dry-run проверки Spot-заявки MEXC. Ровно один раз вызови createTestOrder с symbol=BTCUSDT, side=BUY, type=MARKET и quoteOrderQty=10. Не передавай остальные поля и не объясняй параметры до вызова.',
    expected: { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 },
  },
  {
    id: 'spot-create-market-buy',
    toolName: 'createOrder',
    prompt: 'Выполни безопасный dry-run создания Spot-заявки MEXC. Ровно один раз вызови createOrder с symbol=BTCUSDT, side=BUY, type=MARKET и quoteOrderQty=10. Не передавай остальные поля и не объясняй параметры до вызова.',
    expected: { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 },
  },
  {
    id: 'spot-cancel-one',
    toolName: 'cancelOrder',
    prompt: 'Выполни safe dry-run отмены одной Spot-заявки MEXC. Ровно один раз вызови cancelOrder с symbol=BTCUSDT и orderId=dry-run-order-1. Не передавай остальные поля.',
    expected: { symbol: 'BTCUSDT', orderId: 'dry-run-order-1' },
  },
  {
    id: 'spot-cancel-all',
    toolName: 'cancelAllOrders',
    prompt: 'Выполни safe dry-run отмены всех Spot-заявок MEXC для одного символа. Ровно один раз вызови cancelAllOrders с symbol=BTCUSDT. Не передавай остальные поля.',
    expected: { symbol: 'BTCUSDT' },
  },
  {
    id: 'futures-create-market-long',
    toolName: 'createFuturesOrder',
    prompt: 'Выполни безопасный dry-run Futures-заявки MEXC. Ровно один раз вызови createFuturesOrder: symbol=BTC_USDT, vol=1, leverage=2, side=1 (open long), type=5 (market), openType=1 (isolated), reduceOnly=false. Не передавай price, positionMode, externalOid или recvWindow.',
    expected: { symbol: 'BTC_USDT', vol: 1, leverage: 2, side: 1, type: 5, openType: 1, reduceOnly: false },
  },
  {
    id: 'futures-cancel-by-external-id',
    toolName: 'cancelFuturesOrderByExternalId',
    prompt: 'Выполни safe dry-run отмены одной Futures-заявки MEXC. Ровно один раз вызови cancelFuturesOrderByExternalId с symbol=BTC_USDT и externalOid=dry-run-external-1. Не передавай остальные поля.',
    expected: { symbol: 'BTC_USDT', externalOid: 'dry-run-external-1' },
  },
  {
    id: 'futures-cancel-all',
    toolName: 'cancelAllFuturesOrders',
    prompt: 'Выполни safe dry-run отмены всех Futures-заявок MEXC только для BTC_USDT. Ровно один раз вызови cancelAllFuturesOrders с symbol=BTC_USDT. Не передавай остальные поля.',
    expected: { symbol: 'BTC_USDT' },
  },
  {
    id: 'futures-cancel-list',
    toolName: 'cancelFuturesOrders',
    prompt: 'Выполни safe dry-run отмены списка Futures-заявок MEXC. Ровно один раз вызови cancelFuturesOrders с orderIds=["dry-run-order-1"]. Не передавай остальные поля.',
    expected: { orderIds: ['dry-run-order-1'] },
  },
  {
    id: 'futures-create-trigger-long',
    toolName: 'createFuturesTriggerOrder',
    prompt: triggerPrompt,
    expected: { symbol: 'BTC_USDT', vol: 1, leverage: 2, side: 1, openType: 1, triggerPrice: 89100, triggerType: 1, executeCycle: 1, orderType: 5, trend: 1, stopLossPrice: 76950, takeProfitPrice: 93150, reduceOnly: false },
  },
  {
    id: 'futures-cancel-trigger-list',
    toolName: 'cancelFuturesTriggerOrders',
    prompt: 'Выполни safe dry-run отмены конкретного Futures trigger/plan-ордера MEXC. Ровно один раз вызови cancelFuturesTriggerOrders с orders=[{symbol:"BTC_USDT",orderId:"dry-run-trigger-1"}]. Не передавай остальные поля.',
    expected: { orders: [{ symbol: 'BTC_USDT', orderId: 'dry-run-trigger-1' }] },
  },
  {
    id: 'futures-cancel-all-triggers',
    toolName: 'cancelAllFuturesTriggerOrders',
    prompt: 'Выполни safe dry-run отмены всех Futures trigger/plan-ордеров MEXC только для BTC_USDT. Ровно один раз вызови cancelAllFuturesTriggerOrders с symbol=BTC_USDT. Не передавай остальные поля.',
    expected: { symbol: 'BTC_USDT' },
  },
  {
    id: 'futures-update-order-tpsl',
    toolName: 'updateFuturesOrderTpSl',
    prompt: 'Выполни safe dry-run обновления TP/SL Futures-заявки MEXC. Ровно один раз вызови updateFuturesOrderTpSl с orderId=dry-run-order-1, stopLossPrice=76000, takeProfitPrice=90000. Не передавай остальные поля.',
    expected: { orderId: 'dry-run-order-1', stopLossPrice: 76000, takeProfitPrice: 90000 },
  },
  {
    id: 'futures-cancel-stop-list',
    toolName: 'cancelFuturesStopOrders',
    prompt: 'Выполни safe dry-run отмены конкретного Futures stop-loss/take-profit ордера MEXC. Ровно один раз вызови cancelFuturesStopOrders с stopPlanOrderIds=["dry-run-stop-1"]. Не передавай остальные поля.',
    expected: { stopPlanOrderIds: ['dry-run-stop-1'] },
  },
  {
    id: 'futures-cancel-all-stops',
    toolName: 'cancelAllFuturesStopOrders',
    prompt: 'Выполни safe dry-run отмены Futures stop-loss/take-profit ордеров MEXC только для BTC_USDT. Ровно один раз вызови cancelAllFuturesStopOrders с symbol=BTC_USDT. Не передавай positionId или остальные поля.',
    expected: { symbol: 'BTC_USDT' },
  },
  {
    id: 'futures-update-trigger-tpsl',
    toolName: 'updateFuturesTriggerOrderTpSl',
    prompt: 'Выполни safe dry-run обновления TP/SL Futures stop plan-ордера MEXC. Ровно один раз вызови updateFuturesTriggerOrderTpSl с stopPlanOrderId=dry-run-stop-1, stopLossPrice=76000, takeProfitPrice=90000. Не передавай остальные поля.',
    expected: { stopPlanOrderId: 'dry-run-stop-1', stopLossPrice: 76000, takeProfitPrice: 90000 },
  },
];

const evaluationSystemInstruction = [
  'This is a controlled tool-call evaluation, not a user-facing trading session.',
  'The locally spawned production MCP process is verified to run with an external write interceptor in dry-run mode.',
  'Every write handler is bypassed and no request can reach MEXC; nevertheless validate and call the supplied tool exactly once as directed.',
  'Do not ask for confirmation and do not claim that a real exchange order was sent.',
].join(' ');

function scalarEqual(actual, expected) {
  if (typeof expected === 'number') return Number(actual) === expected;
  return actual === expected;
}

function expectedArgumentsMatch(actual, expected) {
  if (!actual || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = actual[key];
    if (Array.isArray(expectedValue)) {
      return Array.isArray(actualValue)
        && actualValue.length === expectedValue.length
        && actualValue.every((item, index) => (
          expectedValue[index] && typeof expectedValue[index] === 'object'
            ? expectedArgumentsMatch(item, expectedValue[index])
            : scalarEqual(item, expectedValue[index])
        ));
    }
    return scalarEqual(actualValue, expectedValue);
  });
}

function parseArguments(raw) {
  try {
    return { arguments: JSON.parse(raw) };
  } catch (error) {
    return { rawArguments: raw, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function parseJson(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function sanitizeMcpResult(result) {
  return {
    isError: result.isError === true,
    content: result.content?.map((item) => (
      item.type === 'text' ? { type: 'text', text: item.text } : { type: item.type }
    )) ?? [],
  };
}

async function startDryRunMcp(allowedToolNames) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx/esm', 'src/mexc.ts'],
    cwd: repoRoot,
    env: { ...process.env, MEXC_WRITE_MODE: 'dry-run' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mexc-dry-run-model-eval', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  const listed = await client.listTools();
  const tools = listed.tools.filter((tool) => allowedToolNames.has(tool.name));
  const missing = [...allowedToolNames].filter((name) => !tools.some((tool) => tool.name === name));
  if (missing.length > 0) throw new Error(`Real MEXC MCP did not publish: ${missing.join(', ')}`);
  return {
    client,
    tools,
    async close() {
      await client.close();
      await transport.close();
    },
  };
}

async function callMcp(client, calls, name, args) {
  const startedAt = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const event = {
    name,
    arguments: args,
    elapsedMs: Date.now() - startedAt,
    result: sanitizeMcpResult(result),
  };
  calls.push(event);
  return event;
}

function toOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: normalizeOpenApiSchema(tool.inputSchema),
    // The production MCP schemas have optional fields, so strict mode would alter their contract.
    strict: false,
  }));
}

function normalizeOpenApiSchema(value) {
  if (Array.isArray(value)) return value.map(normalizeOpenApiSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeOpenApiSchema(child)]));
  // zod-to-json-schema's OpenAPI 3 target uses a boolean exclusiveMinimum;
  // OpenAI function schemas use the JSON Schema numeric form instead.
  if (result.exclusiveMinimum === true && typeof result.minimum === 'number') {
    result.exclusiveMinimum = result.minimum;
    delete result.minimum;
  }
  if (result.exclusiveMaximum === true && typeof result.maximum === 'number') {
    result.exclusiveMaximum = result.maximum;
    delete result.maximum;
  }
  return result;
}

function toQwenTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

async function runOpenAi(model, mcp, testCase) {
  const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY'), timeout: 120000, maxRetries: 0 });
  const mcpCalls = [];
  const startedAt = Date.now();
  let response = await client.responses.create({
    model,
    input: testCase.prompt,
    instructions: evaluationSystemInstruction,
    tools: toOpenAiTools(mcp.tools),
    tool_choice: 'required',
    parallel_tool_calls: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 4000,
  });

  for (let step = 0; step < 4; step += 1) {
    const functionCalls = (response.output ?? []).filter((item) => item.type === 'function_call');
    if (functionCalls.length === 0) {
      return {
        answer: response.output_text?.trim() ?? '',
        elapsedMs: Date.now() - startedAt,
        mcpCalls,
        responseStatus: response.status,
        outputTypes: (response.output ?? []).map((item) => item.type),
      };
    }
    const outputs = [];
    for (const call of functionCalls) {
      const parsed = parseArguments(call.arguments);
      if (!parsed.arguments) {
        mcpCalls.push({ name: call.name, ...parsed, elapsedMs: 0, result: null });
        continue;
      }
      const event = await callMcp(mcp.client, mcpCalls, call.name, parsed.arguments);
      if (call.name === testCase.toolName) {
        return { answer: '', elapsedMs: Date.now() - startedAt, mcpCalls };
      }
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(event.result),
      });
    }
    if (outputs.length === 0) break;
    response = await client.responses.create({
      model,
      previous_response_id: response.id,
      input: outputs,
      instructions: evaluationSystemInstruction,
      tools: toOpenAiTools(mcp.tools),
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 4000,
    });
  }
  return { answer: '', elapsedMs: Date.now() - startedAt, mcpCalls, error: 'Model did not reach dry-run write within 4 tool steps' };
}

async function runQwen(model, mcp, testCase) {
  const client = new OpenAI({
    apiKey: requireEnv('QWEN_TOKEN_PLAN_API_KEY'),
    baseURL: requireEnv('QWEN_TOKEN_PLAN_BASE_URL'),
    timeout: 120000,
    maxRetries: 0,
  });
  const mcpCalls = [];
  const startedAt = Date.now();
  const messages = [{ role: 'system', content: evaluationSystemInstruction }, { role: 'user', content: testCase.prompt }];

  for (let step = 0; step < 4; step += 1) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools: toQwenTools(mcp.tools),
      tool_choice: 'auto',
      temperature: 0,
      max_tokens: 600,
    });
    const message = response.choices[0]?.message;
    if (!message) return { answer: '', elapsedMs: Date.now() - startedAt, mcpCalls, error: 'Qwen returned no message' };
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { answer: message.content?.trim() ?? '', elapsedMs: Date.now() - startedAt, mcpCalls };
    }
    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: toolCalls });
    for (const toolCall of toolCalls) {
      const parsed = parseArguments(toolCall.function.arguments);
      if (!parsed.arguments) {
        mcpCalls.push({ name: toolCall.function.name, ...parsed, elapsedMs: 0, result: null });
        continue;
      }
      const event = await callMcp(mcp.client, mcpCalls, toolCall.function.name, parsed.arguments);
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(event.result) });
      if (toolCall.function.name === testCase.toolName) {
        return { answer: '', elapsedMs: Date.now() - startedAt, mcpCalls };
      }
    }
  }
  return { answer: '', elapsedMs: Date.now() - startedAt, mcpCalls, error: 'Model did not reach dry-run write within 4 tool steps' };
}

async function runOne(provider, model, testCase) {
  const mcp = await startDryRunMcp(new Set([testCase.toolName]));
  try {
    const result = provider === 'openai' ? await runOpenAi(model, mcp, testCase) : await runQwen(model, mcp, testCase);
    const writeCall = result.mcpCalls.find((call) => call.name === testCase.toolName);
    const dryRun = parseJson(writeCall?.result?.content?.[0]?.text);
    return {
      provider,
      model,
      testCase: testCase.id,
      ...result,
      passed: dryRun?.mode === 'dry-run'
        && dryRun?.exchangeRequestSent === false
        && dryRun?.operation === testCase.toolName
        && expectedArgumentsMatch(dryRun?.validatedArguments, testCase.expected),
      writeOperationElapsedMs: writeCall?.elapsedMs ?? null,
      validatedArguments: dryRun?.validatedArguments ?? null,
    };
  } catch (error) {
    return { provider, model, passed: false, error: error instanceof Error ? error.message : String(error), mcpCalls: [] };
  } finally {
    await mcp.close();
  }
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(appRoot, 'artifacts', 'mexc-dry-run-model-eval', stamp);
  await fs.mkdir(outputDir, { recursive: true });
  const results = [];
  const providerFilter = process.argv.find((argument) => argument.startsWith('--provider='))?.slice('--provider='.length);
  const suite = process.argv.find((argument) => argument.startsWith('--suite='))?.slice('--suite='.length) ?? 'trigger';
  const caseFilter = process.argv.find((argument) => argument.startsWith('--case='))?.slice('--case='.length);
  if (!['trigger', 'all-writes'].includes(suite)) throw new Error(`Unknown suite: ${suite}`);
  const suiteCases = suite === 'all-writes'
    ? writeCases
    : writeCases.filter((testCase) => testCase.id === 'futures-create-trigger-long');
  const selectedCases = caseFilter
    ? suiteCases.filter((testCase) => testCase.id === caseFilter)
    : suiteCases;
  if (selectedCases.length === 0) throw new Error(`No case selected for --case=${caseFilter}`);
  const providers = [['openai', openAiModels], ['qwen', qwenModels]];
  for (const [provider, models] of providers) {
    if (providerFilter && provider !== providerFilter) continue;
    for (const testCase of selectedCases) {
      for (const model of models) {
        const result = await runOne(provider, model, testCase);
        results.push(result);
        console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.provider}/${result.model} ${testCase.id} total=${result.elapsedMs ?? '-'}ms write=${result.writeOperationElapsedMs ?? '-'}ms`);
      }
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    suite,
    cases: selectedCases.map(({ id, toolName, prompt, expected }) => ({ id, toolName, prompt, expected })),
    safety: 'Real local MEXC MCP with MEXC_WRITE_MODE=dry-run. Read-only market data may be fetched; write handlers do not run and no exchange order is sent.',
    results,
  };
  const summaryPath = path.join(outputDir, 'summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Artifact: ${summaryPath}`);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
