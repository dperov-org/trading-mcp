import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { subscribeOrderbook } from '../src/exchanges/mexc/tools/websocket/subscribeOrderbook.ts';
import { subscribeTickers } from '../src/exchanges/mexc/tools/websocket/subscribeTickers.ts';
import { subscribeTrades } from '../src/exchanges/mexc/tools/websocket/subscribeTrades.ts';

type SmokeCase = {
  name: string;
  args: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
  summarize: (result: unknown) => string;
};

async function main() {
  await loadEnvFile(path.join(process.cwd(), '.env'));

  const tests: SmokeCase[] = [
    {
      name: 'ws:subscribeTickers(BTCUSDT)',
      args: { symbol: 'BTCUSDT', messageCount: 1, timeoutMs: 8000 },
      handler: subscribeTickers.handler,
      summarize: (result) => {
        const frame = Array.isArray(result) ? result[0] as Record<string, unknown> : undefined;
        const data = frame?.data as Record<string, unknown> | undefined;
        return `channel=${String(frame?.channel ?? 'n/a')} bid=${String(data?.bidPrice ?? 'n/a')} ask=${String(data?.askPrice ?? 'n/a')}`;
      },
    },
    {
      name: 'ws:subscribeOrderbook(BTCUSDT)',
      args: { symbol: 'BTCUSDT', limit: '5', messageCount: 1, timeoutMs: 8000 },
      handler: subscribeOrderbook.handler,
      summarize: (result) => {
        const frame = Array.isArray(result) ? result[0] as Record<string, unknown> : undefined;
        const data = frame?.data as { bids?: Array<Record<string, unknown>>; asks?: Array<Record<string, unknown>> } | undefined;
        const bid = data?.bids?.[0];
        const ask = data?.asks?.[0];
        return `bestBid=${String(bid?.price ?? 'n/a')}@${String(bid?.quantity ?? 'n/a')} bestAsk=${String(ask?.price ?? 'n/a')}@${String(ask?.quantity ?? 'n/a')}`;
      },
    },
    {
      name: 'ws:subscribeTrades(BTCUSDT)',
      args: { symbol: 'BTCUSDT', messageCount: 1, timeoutMs: 8000 },
      handler: subscribeTrades.handler,
      summarize: (result) => {
        const frame = Array.isArray(result) ? result[0] as Record<string, unknown> : undefined;
        const data = frame?.data as { deals?: Array<Record<string, unknown>> } | undefined;
        const deal = data?.deals?.[0];
        return `tradePrice=${String(deal?.price ?? 'n/a')} quantity=${String(deal?.quantity ?? 'n/a')} side=${String(deal?.tradeType ?? 'n/a')}`;
      },
    },
  ];

  console.error('mexc ws smoke target: mainnet');
  const failures: string[] = [];

  for (const test of tests) {
    const startedAt = Date.now();
    try {
      const result = await test.handler(test.args);
      console.error(`- OK   ${test.name} (${Date.now() - startedAt} ms) ${test.summarize(result)}`);
    } catch (error) {
      failures.push(test.name);
      console.error(`- FAIL ${test.name} (${Date.now() - startedAt} ms) ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function loadEnvFile(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
