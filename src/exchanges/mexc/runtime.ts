import { startExchangeRuntimeServer, type ExchangeRuntime } from '../../core/exchange-runtime.js';
import { VERSION } from '../../version.js';
import { checkVersionForTool } from '../../version-check.js';
import { getMexcAuthSummary, getMexcConfig } from './config.js';
import { mexcFuturesTools, mexcSpotTools } from './tools/index.js';

export async function createMexcRuntime(): Promise<ExchangeRuntime> {
  const config = getMexcConfig();
  const tools = [
    ...(config.enableSpot ? mexcSpotTools : []),
    ...(config.enableFutures ? mexcFuturesTools : []),
  ];

  return {
    id: 'mexc',
    serverName: 'trading-mcp-mexc',
    serverVersion: VERSION,
    tools,
    beforeToolCall: checkVersionForTool,
    startupDetails: getMexcAuthSummary,
  };
}

export async function startMexcServer(): Promise<void> {
  const runtime = await createMexcRuntime();
  await startExchangeRuntimeServer(runtime);
}
