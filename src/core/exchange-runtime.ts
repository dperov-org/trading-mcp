import { startMcpHttpServer, startMcpServer, type McpServerConfig } from './mcp/server.js';
import type { ToolDefinition } from './tool-runtime/types.js';

export interface ExchangeRuntime {
  id: string;
  serverName: string;
  serverVersion: string;
  tools: ToolDefinition[];
  beforeToolCall?: McpServerConfig['beforeToolCall'];
  startupDetails?: McpServerConfig['startupDetails'];
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envNameForRuntime(runtime: ExchangeRuntime, suffix: string): string {
  return `${runtime.id.toUpperCase()}_MCP_${suffix}`;
}

function getRuntimeTransport(runtime: ExchangeRuntime): 'stdio' | 'http' {
  const raw =
    process.env[envNameForRuntime(runtime, 'TRANSPORT')] || process.env.MCP_TRANSPORT || 'stdio';
  return String(raw).trim().toLowerCase() === 'http' ? 'http' : 'stdio';
}

function getRuntimeHttpOptions(runtime: ExchangeRuntime): {
  host: string;
  port: number;
  path: string;
} {
  const upperId = runtime.id.toUpperCase();
  return {
    host:
      process.env[`${upperId}_MCP_HTTP_HOST`] ||
      process.env.MCP_HTTP_HOST ||
      '127.0.0.1',
    port: toInt(
      process.env[`${upperId}_MCP_HTTP_PORT`] || process.env.MCP_HTTP_PORT,
      runtime.id === 'mexc' ? 8792 : 8791,
    ),
    path:
      process.env[`${upperId}_MCP_HTTP_PATH`] ||
      process.env.MCP_HTTP_PATH ||
      `/mcp/${runtime.id}`,
  };
}

export async function startExchangeRuntimeServer(runtime: ExchangeRuntime): Promise<void> {
  const config = {
    serverName: runtime.serverName,
    serverVersion: runtime.serverVersion,
    tools: runtime.tools,
    beforeToolCall: runtime.beforeToolCall,
    startupDetails: runtime.startupDetails,
  };

  if (getRuntimeTransport(runtime) === 'http') {
    await startMcpHttpServer(config, getRuntimeHttpOptions(runtime));
    return;
  }

  await startMcpServer(config);
}
