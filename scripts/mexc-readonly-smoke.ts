import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { getKycStatus, getSelfSymbols } from '../src/exchanges/mexc/tools/account/extended.ts';
import { getCapitalConfig } from '../src/exchanges/mexc/tools/capital/index.ts';
import {
  getFuturesAssets,
  getFuturesOpenOrders,
  getFuturesOpenPositions,
  getFuturesOrderDeals,
  getFuturesOrderHistory,
  getFuturesStopOrders,
  getFuturesTriggerOrders,
} from '../src/exchanges/mexc/tools/futuresAccount/index.ts';
import {
  getFuturesContracts,
  getFuturesFundingRate,
  getFuturesOrderbook,
  getFuturesTicker,
} from '../src/exchanges/mexc/tools/futuresMarket/index.ts';
import {
  getAggregateTrades,
  getAveragePrice,
  getBookTicker,
  getDefaultSymbols,
  getHistoricalTrades,
  getPing,
  getPriceTicker,
} from '../src/exchanges/mexc/tools/market/extended.ts';

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
      name: 'spot:getPing',
      args: {},
      handler: getPing.handler,
      summarize: () => 'pong/empty response accepted',
    },
    {
      name: 'spot:getDefaultSymbols',
      args: {},
      handler: getDefaultSymbols.handler,
      summarize: (result) => `defaults=${countItems((result as { data?: unknown[] })?.data ?? result)}`,
    },
    {
      name: 'spot:getPriceTicker(BTCUSDT)',
      args: { symbol: 'BTCUSDT' },
      handler: getPriceTicker.handler,
      summarize: (result) => `price=${stringValue((result as Record<string, unknown>)?.price)}`,
    },
    {
      name: 'spot:getBookTicker(BTCUSDT)',
      args: { symbol: 'BTCUSDT' },
      handler: getBookTicker.handler,
      summarize: (result) => {
        const payload = result as Record<string, unknown>;
        return `bid=${stringValue(payload.bidPrice)} ask=${stringValue(payload.askPrice)}`;
      },
    },
    {
      name: 'spot:getAveragePrice(BTCUSDT)',
      args: { symbol: 'BTCUSDT' },
      handler: getAveragePrice.handler,
      summarize: (result) => `avg=${stringValue((result as Record<string, unknown>)?.price)}`,
    },
    {
      name: 'spot:getHistoricalTrades(BTCUSDT)',
      args: { symbol: 'BTCUSDT', limit: 5 },
      handler: getHistoricalTrades.handler,
      summarize: (result) => `trades=${countItems(result)}`,
    },
    {
      name: 'spot:getAggregateTrades(BTCUSDT)',
      args: { symbol: 'BTCUSDT', limit: 5 },
      handler: getAggregateTrades.handler,
      summarize: (result) => `aggTrades=${countItems(result)}`,
    },
    {
      name: 'spot:getSelfSymbols',
      args: {},
      handler: getSelfSymbols.handler,
      summarize: (result) => `symbols=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'spot:getKycStatus',
      args: {},
      handler: getKycStatus.handler,
      summarize: (result) => `status=${stringValue((result as Record<string, unknown>)?.status)}`,
    },
    {
      name: 'spot:getCapitalConfig',
      args: {},
      handler: getCapitalConfig.handler,
      summarize: (result) => `coins=${countItems(result)}`,
    },
    {
      name: 'futures:getFuturesContracts(BTC_USDT)',
      args: { symbol: 'BTC_USDT' },
      handler: getFuturesContracts.handler,
      summarize: (result) => `contracts=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'futures:getFuturesTicker(BTC_USDT)',
      args: { symbol: 'BTC_USDT' },
      handler: getFuturesTicker.handler,
      summarize: (result) => `lastPrice=${stringValue((result as { data?: Record<string, unknown> })?.data?.lastPrice)}`,
    },
    {
      name: 'futures:getFuturesOrderbook(BTC_USDT)',
      args: { symbol: 'BTC_USDT', limit: 5 },
      handler: getFuturesOrderbook.handler,
      summarize: (result) => {
        const data = (result as { data?: { bids?: unknown[]; asks?: unknown[] } })?.data;
        return `bids=${countItems(data?.bids)} asks=${countItems(data?.asks)}`;
      },
    },
    {
      name: 'futures:getFuturesFundingRate(BTC_USDT)',
      args: { symbol: 'BTC_USDT' },
      handler: getFuturesFundingRate.handler,
      summarize: (result) => `fundingRate=${stringValue((result as { data?: Record<string, unknown> })?.data?.fundingRate)}`,
    },
    {
      name: 'futures:getFuturesAssets',
      args: {},
      handler: getFuturesAssets.handler,
      summarize: (result) => `assets=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'futures:getFuturesOpenPositions(BTC_USDT)',
      args: { symbol: 'BTC_USDT' },
      handler: getFuturesOpenPositions.handler,
      summarize: (result) => `positions=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'futures:getFuturesOpenOrders(BTC_USDT)',
      args: { symbol: 'BTC_USDT', page_num: 1, page_size: 20 },
      handler: getFuturesOpenOrders.handler,
      summarize: (result) => `openOrders=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'futures:getFuturesOrderHistory(BTC_USDT)',
      args: { symbol: 'BTC_USDT', page_num: 1, page_size: 5 },
      handler: getFuturesOrderHistory.handler,
      summarize: (result) => `history=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'futures:getFuturesOrderDeals(BTC_USDT)',
      args: { symbol: 'BTC_USDT', page_num: 1, page_size: 5 },
      handler: getFuturesOrderDeals.handler,
      summarize: (result) => `deals=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'futures:getFuturesTriggerOrders(BTC_USDT)',
      args: { symbol: 'BTC_USDT', page_num: 1, page_size: 20 },
      handler: getFuturesTriggerOrders.handler,
      summarize: (result) => `triggerOrders=${countItems((result as { data?: unknown[] })?.data)}`,
    },
    {
      name: 'futures:getFuturesStopOrders(BTC_USDT)',
      args: { symbol: 'BTC_USDT', page_num: 1, page_size: 20 },
      handler: getFuturesStopOrders.handler,
      summarize: (result) => `stopOrders=${countItems((result as { data?: unknown[] })?.data)}`,
    },
  ];

  console.error('mexc readonly smoke target: mainnet');

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

function countItems(value: unknown) {
  return Array.isArray(value) ? value.length : 'n/a';
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? 'n/a' : String(value);
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
