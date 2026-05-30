import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createToolTextResponse, executeToolCall } from '../tool-runtime/execute.js';
import type { ToolDefinition } from '../tool-runtime/types.js';

export interface McpServerConfig {
  serverName: string;
  serverVersion: string;
  tools: ToolDefinition[];
  beforeToolCall?: () => Promise<string | null>;
  startupDetails?: () => string | Promise<string>;
}

export async function startMcpServer(config: McpServerConfig): Promise<void> {
  const { serverName, serverVersion, tools, beforeToolCall, startupDetails } = config;

  const server = new Server(
    { name: serverName, version: serverVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema, { target: 'openApi3' }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) {
      return createToolTextResponse(`Tool not found: ${name}`, true);
    }

    if (beforeToolCall) {
      const preflightError = await beforeToolCall();
      if (preflightError) {
        return createToolTextResponse(preflightError, true);
      }
    }

    return executeToolCall(tool, args as Record<string, unknown> | undefined);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const detailText = startupDetails ? await startupDetails() : '';
  const suffix = detailText ? `, ${detailText}` : '';
  console.error(`${serverName} started — ${tools.length} tool(s) registered${suffix}`);
}
