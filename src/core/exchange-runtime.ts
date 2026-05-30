import { startMcpServer, type McpServerConfig } from './mcp/server.js';
import type { ToolDefinition } from './tool-runtime/types.js';

export interface ExchangeRuntime {
  id: string;
  serverName: string;
  serverVersion: string;
  tools: ToolDefinition[];
  beforeToolCall?: McpServerConfig['beforeToolCall'];
  startupDetails?: McpServerConfig['startupDetails'];
}

export async function startExchangeRuntimeServer(runtime: ExchangeRuntime): Promise<void> {
  await startMcpServer({
    serverName: runtime.serverName,
    serverVersion: runtime.serverVersion,
    tools: runtime.tools,
    beforeToolCall: runtime.beforeToolCall,
    startupDetails: runtime.startupDetails,
  });
}
