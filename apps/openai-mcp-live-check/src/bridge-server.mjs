import http from 'node:http';
import process from 'node:process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getChildMcpEnv, getToolAllowlist, repoRoot } from './env.mjs';

const BRIDGE_NAME = 'trading-mcp-openai-http-bridge';
const BRIDGE_VERSION = '0.1.0';

function buildFilteredTools(tools, allowlist) {
  if (!allowlist) {
    return tools;
  }

  const allowed = new Set(allowlist);
  return tools.filter((tool) => allowed.has(tool.name));
}

function attachChildLogs(transport) {
  const stderr = transport.stderr;
  if (!stderr) {
    return;
  }

  stderr.on('data', (chunk) => {
    process.stderr.write(`[child-mcp] ${String(chunk)}`);
  });
}

function createProxyServer(filteredTools, innerClient) {
  const server = new Server(
    { name: BRIDGE_NAME, version: BRIDGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: filteredTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return innerClient.callTool({
      name: request.params.name,
      arguments: request.params.arguments ?? {},
    });
  });

  return server;
}

export async function startBridgeServer(options = {}) {
  const allowlist = options.allowlist ?? getToolAllowlist();
  const innerTransport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      'tsx/esm',
      '--eval',
      "import('./src/server.ts').then(({ startServer }) => startServer().catch((error) => { console.error(error); process.exit(1); }))",
    ],
    cwd: repoRoot,
    env: getChildMcpEnv(),
    stderr: 'pipe',
  });
  attachChildLogs(innerTransport);

  const innerClient = new Client(
    { name: `${BRIDGE_NAME}-client`, version: BRIDGE_VERSION },
    { capabilities: {} },
  );
  await innerClient.connect(innerTransport);

  const listedTools = await innerClient.listTools();
  const filteredTools = buildFilteredTools(listedTools.tools, allowlist);

  if (allowlist) {
    const missing = allowlist.filter(
      (toolName) => !filteredTools.some((tool) => tool.name === toolName),
    );
    if (missing.length > 0) {
      throw new Error(`Requested bridge tool(s) not found: ${missing.join(', ')}`);
    }
  }

  const app = createMcpExpressApp({ host: '0.0.0.0' });

  app.use((req, _res, next) => {
    if (process.env.DEBUG_BRIDGE === '1') {
      console.log(`[bridge] ${req.method} ${req.url}`);
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      toolCount: filteredTools.length,
      tools: filteredTools.map((tool) => tool.name),
    });
  });

  app.post('/mcp', async (req, res) => {
    const server = createProxyServer(filteredTools, innerClient);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Bridge request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal bridge error',
          },
          id: null,
        });
      }
    } finally {
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine bridge server address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    port: address.port,
    filteredTools,
    innerClient,
    innerTransport,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await innerClient.close();
      await innerTransport.close();
    },
  };
}

async function main() {
  const bridge = await startBridgeServer();
  console.log(`Bridge listening on ${bridge.baseUrl}/mcp`);
  console.log(`Exposed tools: ${bridge.filteredTools.map((tool) => tool.name).join(', ')}`);
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
