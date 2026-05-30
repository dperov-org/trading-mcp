import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { appRoot, applyToolExecutionEnv, requireEnv } from './config.mjs';
import { selectRegistry, toOpenAiFunctionTools } from './filter-registry.mjs';

const DEFAULT_MODEL_CANDIDATES = ['gpt-5', 'gpt-5-mini', 'gpt-4.1'];

export async function runQuestion(question, options = {}) {
  requireEnv('OPENAI_API_KEY');
  applyToolExecutionEnv();

  const registry = selectRegistry(options);
  if (registry.length === 0) {
    throw new Error('No tools matched the requested group/tool filters');
  }

  const toolIndex = new Map(registry.map((entry) => [entry.name, entry]));
  const functionTools = toOpenAiFunctionTools(registry, options);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const instructions = options.instructions ?? defaultInstructions();
  const parallelToolCalls = options.parallelToolCalls ?? false;
  const maxSteps = options.maxSteps ?? 8;

  let responseState = await createResponseWithFallback(client, (model) => ({
    model,
    input: question,
    instructions,
    tools: functionTools,
    parallel_tool_calls: parallelToolCalls,
    max_output_tokens: options.maxOutputTokens ?? 1200,
  }));

  const transcript = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const functionCalls = (responseState.response.output ?? []).filter((item) => item.type === 'function_call');

    if (functionCalls.length === 0) {
      const answer = responseState.response.output_text?.trim() || summarizeTranscript(transcript);
      return {
        model: responseState.model,
        response: responseState.response,
        answer,
        transcript,
        exposedTools: registry.map((entry) => entry.name),
      };
    }

    const outputs = [];
    for (const call of functionCalls) {
      const executed = await executeFunctionCall(toolIndex, call);
      transcript.push(executed);
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(executed.result, null, 2),
      });
    }

    responseState = await createResponseWithFallback(client, (model) => ({
      model,
      previous_response_id: responseState.response.id,
      input: outputs,
      instructions,
      tools: functionTools,
      parallel_tool_calls: parallelToolCalls,
      max_output_tokens: options.maxOutputTokens ?? 1200,
    }));
  }

  throw new Error(`Model did not finish after ${maxSteps} tool-calling step(s)`);
}

export async function writeJsonArtifact(prefix, payload) {
  const artifactsDir = path.join(appRoot, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = path.join(artifactsDir, `${prefix}-${stamp}.json`);
  await fs.writeFile(artifactPath, JSON.stringify(payload, null, 2));
  return artifactPath;
}

function defaultInstructions() {
  return [
    'You are operating against the local Bybit tool layer through OpenAI function tools.',
    'Use tools when needed and answer with retrieved facts.',
    'Do not invent parameter values.',
    'If a tool call fails validation or the upstream API rejects the arguments, correct the arguments and retry only when you have a clear fix.',
  ].join(' ');
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

async function executeFunctionCall(toolIndex, call) {
  const toolEntry = toolIndex.get(call.name);
  if (!toolEntry) {
    return {
      callId: call.call_id,
      name: call.name,
      arguments: safeParseArguments(call.arguments),
      ok: false,
      result: {
        ok: false,
        error: `Tool not found in adapter registry: ${call.name}`,
      },
    };
  }

  const args = safeParseArguments(call.arguments);
  const normalizedArgs = normalizeArgumentsForZodSchema(args, toolEntry.tool.inputSchema);
  try {
    const parsed = toolEntry.tool.inputSchema.parse(normalizedArgs);
    const output = await toolEntry.tool.handler(parsed);
    return {
      callId: call.call_id,
      name: call.name,
      arguments: args,
      normalizedArguments: normalizedArgs,
      ok: true,
      result: {
        ok: true,
        data: output,
      },
    };
  } catch (error) {
    return {
      callId: call.call_id,
      name: call.name,
      arguments: args,
      normalizedArguments: normalizedArgs,
      ok: false,
      result: {
        ok: false,
        error: formatError(error),
      },
    };
  }
}

function safeParseArguments(argumentsJson) {
  if (!argumentsJson) {
    return {};
  }

  try {
    return JSON.parse(argumentsJson);
  } catch (error) {
    throw new Error(`Function call arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatError(error) {
  if (error && typeof error === 'object' && Array.isArray(error.errors)) {
    return `Validation error: ${error.errors
      .map((item) => `${item.path?.join?.('.') || 'input'}: ${item.message}`)
      .join('; ')}`;
  }

  return error instanceof Error ? error.message : String(error);
}

function summarizeTranscript(transcript) {
  for (const entry of transcript) {
    if (!entry.ok) {
      continue;
    }

    const payload = entry.result?.data;
    if (!payload || typeof payload !== 'object') {
      continue;
    }

    if (entry.name === 'getTickers') {
      const ticker = payload?.result?.list?.[0];
      if (ticker?.lastPrice) {
        return `${ticker.lastPrice}`;
      }
    }

    if (entry.name === 'getWalletBalance') {
      const account = payload?.result?.list?.[0];
      if (account?.accountType) {
        return [
          `Account type: ${account.accountType}`,
          `Total wallet balance: ${account.totalWalletBalance}`,
          `Total equity: ${account.totalEquity}`,
          `Total margin balance: ${account.totalMarginBalance}`,
          `Total available balance: ${account.totalAvailableBalance}`,
        ].join('\n');
      }
    }

    if (entry.name === 'getOpenOrders') {
      const count = Array.isArray(payload?.result?.list) ? payload.result.list.length : null;
      if (count !== null) {
        return `${count}`;
      }
    }
  }

  return '';
}

function normalizeArgumentsForZodSchema(value, schema) {
  const normalized = normalizeWithSchema(value, schema);
  return normalized === OMIT ? {} : normalized;
}

const OMIT = Symbol('omit');

function normalizeWithSchema(value, schema) {
  const unwrapped = unwrapForInput(schema);

  if (value === null && unwrapped.omittable && !unwrapped.acceptsNull) {
    return OMIT;
  }

  if (value === undefined) {
    return unwrapped.omittable ? OMIT : undefined;
  }

  const typeName = unwrapped.schema?._def?.typeName;

  if (typeName === 'ZodObject' && value && typeof value === 'object' && !Array.isArray(value)) {
    const shape = unwrapped.schema._def.shape();
    const output = { ...value };

    for (const [key, childSchema] of Object.entries(shape)) {
      if (!(key in value)) {
        continue;
      }

      const childValue = normalizeWithSchema(value[key], childSchema);
      if (childValue === OMIT) {
        delete output[key];
      } else {
        output[key] = childValue;
      }
    }

    return output;
  }

  if (typeName === 'ZodArray' && Array.isArray(value)) {
    return value.map((item) => {
      const normalizedItem = normalizeWithSchema(item, unwrapped.schema._def.type);
      return normalizedItem === OMIT ? undefined : normalizedItem;
    });
  }

  return value;
}

function unwrapForInput(schema) {
  let current = schema;
  let omittable = false;
  let acceptsNull = false;

  while (current?._def?.typeName) {
    const typeName = current._def.typeName;

    if (typeName === 'ZodOptional') {
      omittable = true;
      current = current._def.innerType;
      continue;
    }

    if (typeName === 'ZodDefault') {
      omittable = true;
      current = current._def.innerType;
      continue;
    }

    if (typeName === 'ZodNullable') {
      acceptsNull = true;
      current = current._def.innerType;
      continue;
    }

    break;
  }

  return {
    schema: current,
    omittable,
    acceptsNull,
  };
}
