import { startExchangeRuntimeServer, type ExchangeRuntime } from '../../core/exchange-runtime.js';
import type { ToolDefinition } from '../../core/tool-runtime/types.js';
import { subscriptionTools } from '../../tools/subscription/index.js';
import { resolveSignConfig } from '../../utils/auth.js';
import { VERSION } from '../../version.js';
import { checkVersionForTool } from '../../version-check.js';

async function loadBybitTools(): Promise<ToolDefinition[]> {
  let generatedTools: ToolDefinition[] = [];

  try {
    const mod = await import('../../tools/index.js');
    generatedTools = mod.allTools ?? [];
  } catch {
    // No tools generated yet — server starts with the manual subscription tools only.
  }

  return [...generatedTools, ...subscriptionTools];
}

function getBybitAuthSummary(): string {
  if (!process.env.BYBIT_API_KEY) {
    return 'auth: unauthenticated';
  }

  try {
    const signConfig = resolveSignConfig();
    return `auth: ${signConfig.type === 'rsa' ? 'RSA-SHA256' : 'HMAC-SHA256'}`;
  } catch (error) {
    return `auth: config error — ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function createBybitRuntime(): Promise<ExchangeRuntime> {
  return {
    id: 'bybit',
    serverName: 'trading-mcp',
    serverVersion: VERSION,
    tools: await loadBybitTools(),
    beforeToolCall: checkVersionForTool,
    startupDetails: getBybitAuthSummary,
  };
}

export async function startBybitServer(): Promise<void> {
  const runtime = await createBybitRuntime();
  await startExchangeRuntimeServer(runtime);
}
