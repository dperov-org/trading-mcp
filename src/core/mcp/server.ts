import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

export interface McpHttpServerOptions {
  host: string;
  port: number;
  path: string;
}

function createConfiguredServer(config: McpServerConfig): Server {
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

  return server;
}

export async function startMcpServer(config: McpServerConfig): Promise<void> {
  const { serverName, tools, startupDetails } = config;
  const server = createConfiguredServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const detailText = startupDetails ? await startupDetails() : '';
  const suffix = detailText ? `, ${detailText}` : '';
  console.error(`${serverName} started — ${tools.length} tool(s) registered${suffix}`);
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

export async function startMcpHttpServer(
  config: McpServerConfig,
  options: McpHttpServerOptions,
): Promise<void> {
  const normalizedPath = options.path.startsWith('/') ? options.path : `/${options.path}`;
  const detailText = config.startupDetails ? await config.startupDetails() : '';

  const httpServer = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      sendJson(response, 200, {
        ok: true,
        server_name: config.serverName,
        transport: 'streamable_http',
        tools: config.tools.length,
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/readyz') {
      sendJson(response, 200, {
        ok: true,
        server_name: config.serverName,
      });
      return;
    }

    if (requestUrl.pathname !== normalizedPath) {
      sendJson(response, 404, {
        jsonrpc: '2.0',
        error: {
          code: -32004,
          message: 'Not found',
        },
        id: null,
      });
      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(405, {
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed.',
          },
          id: null,
        }),
      );
      return;
    }

    const server = createConfiguredServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error(
        `${config.serverName} streamable HTTP request failed — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (!response.headersSent) {
        sendJson(response, 500, {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => resolve());
  });

  const suffix = detailText ? `, ${detailText}` : '';
  console.error(
    `${config.serverName} HTTP MCP started — ${config.tools.length} tool(s) registered, url: http://${options.host}:${options.port}${normalizedPath}${suffix}`,
  );
}
