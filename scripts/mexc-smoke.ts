import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { getAccountInfo } from '../src/exchanges/mexc/tools/account/getAccountInfo.ts';
import { getMyTrades } from '../src/exchanges/mexc/tools/account/getMyTrades.ts';
import { getOpenOrders } from '../src/exchanges/mexc/tools/account/getOpenOrders.ts';
import { getWalletBalance } from '../src/exchanges/mexc/tools/account/getWalletBalance.ts';
import { queryApiPermissions } from '../src/exchanges/mexc/tools/account/queryApiPermissions.ts';
import { getExchangeInfo } from '../src/exchanges/mexc/tools/market/getExchangeInfo.ts';
import { getKlines } from '../src/exchanges/mexc/tools/market/getKlines.ts';
import { getOrderbook } from '../src/exchanges/mexc/tools/market/getOrderbook.ts';
import { getRecentTrades } from '../src/exchanges/mexc/tools/market/getRecentTrades.ts';
import { getServerTime } from '../src/exchanges/mexc/tools/market/getServerTime.ts';
import { getTickers } from '../src/exchanges/mexc/tools/market/getTickers.ts';
import { createTestOrder } from '../src/exchanges/mexc/tools/trade/createTestOrder.ts';

type SmokeCase = {
  name: string;
  args: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
  summarize: (result: unknown) => string;
};

type SmokeResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  summary?: string;
  error?: string;
};

async function main() {
  await loadEnvFile(path.join(process.cwd(), '.env'));
  validateAuthEnv();

  const tests: SmokeCase[] = [
    {
      name: 'public:getServerTime',
      args: {},
      handler: getServerTime.handler,
      summarize: (result) => {
        const data = result as { serverTime?: number | string };
        return `serverTime=${data?.serverTime ?? 'n/a'}`;
      },
    },
    {
      name: 'public:getExchangeInfo(BTCUSDT)',
      args: { symbol: 'BTCUSDT' },
      handler: getExchangeInfo.handler,
      summarize: (result) => {
        const symbols = Array.isArray((result as { symbols?: unknown[] })?.symbols)
          ? (result as { symbols: unknown[] }).symbols.length
          : 'n/a';
        return `timezone=${stringValue((result as Record<string, unknown>)?.timezone)} symbols=${symbols}`;
      },
    },
    {
      name: 'public:getTickers(BTCUSDT)',
      args: { symbol: 'BTCUSDT' },
      handler: getTickers.handler,
      summarize: (result) => {
        const data = result as Record<string, unknown>;
        return `symbol=${stringValue(data.symbol)} lastPrice=${stringValue(data.lastPrice)} bid=${stringValue(data.bidPrice)} ask=${stringValue(data.askPrice)}`;
      },
    },
    {
      name: 'public:getOrderbook(BTCUSDT)',
      args: { symbol: 'BTCUSDT', limit: 5 },
      handler: getOrderbook.handler,
      summarize: (result) => {
        const data = result as { bids?: string[][]; asks?: string[][] };
        const bid = data?.bids?.[0]?.slice(0, 2).join('@') ?? 'n/a';
        const ask = data?.asks?.[0]?.slice(0, 2).join('@') ?? 'n/a';
        return `bestBid=${bid} bestAsk=${ask}`;
      },
    },
    {
      name: 'public:getRecentTrades(BTCUSDT)',
      args: { symbol: 'BTCUSDT', limit: 5 },
      handler: getRecentTrades.handler,
      summarize: (result) => {
        return `tradeCount=${Array.isArray(result) ? result.length : 'n/a'}`;
      },
    },
    {
      name: 'public:getKlines(BTCUSDT,1m)',
      args: { symbol: 'BTCUSDT', interval: '1m', limit: 5 },
      handler: getKlines.handler,
      summarize: (result) => {
        return `klineCount=${Array.isArray(result) ? result.length : 'n/a'}`;
      },
    },
    {
      name: 'auth:getAccountInfo',
      args: {},
      handler: getAccountInfo.handler,
      summarize: (result) => {
        const data = result as Record<string, unknown>;
        return `canTrade=${stringValue(data.canTrade)} canWithdraw=${stringValue(data.canWithdraw)} accountType=${stringValue(data.accountType)}`;
      },
    },
    {
      name: 'auth:getWalletBalance(omitZeroBalances)',
      args: { omitZeroBalances: true },
      handler: getWalletBalance.handler,
      summarize: (result) => {
        const balances = Array.isArray((result as { balances?: unknown[] })?.balances)
          ? (result as { balances: unknown[] }).balances.length
          : 'n/a';
        return `balances=${balances}`;
      },
    },
    {
      name: 'auth:queryApiPermissions',
      args: {},
      handler: queryApiPermissions.handler,
      summarize: (result) => {
        const data = result as Record<string, unknown>;
        return `canTrade=${stringValue(data.canTrade)} canWithdraw=${stringValue(data.canWithdraw)} canDeposit=${stringValue(data.canDeposit)}`;
      },
    },
    {
      name: 'auth:getOpenOrders(BTCUSDT)',
      args: { symbol: 'BTCUSDT' },
      handler: getOpenOrders.handler,
      summarize: (result) => {
        return `openOrders=${Array.isArray(result) ? result.length : 'n/a'}`;
      },
    },
    {
      name: 'auth:getMyTrades(BTCUSDT)',
      args: { symbol: 'BTCUSDT', limit: 5 },
      handler: getMyTrades.handler,
      summarize: (result) => {
        return `fills=${Array.isArray(result) ? result.length : 'n/a'}`;
      },
    },
  ];

  console.error('mexc smoke target: mainnet');
  console.error('auth mode: hmac');

  const results: SmokeResult[] = [];

  for (const test of tests) {
    const startedAt = Date.now();
    try {
      const result = await test.handler(test.args);
      results.push({
        name: test.name,
        ok: true,
        durationMs: Date.now() - startedAt,
        summary: test.summarize(result),
      });
    } catch (error) {
      results.push({
        name: test.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (process.env.MEXC_API_KEY && process.env.MEXC_SECRET_KEY) {
    const startedAt = Date.now();
    try {
      const testOrderArgs = await buildSafeTestOrderArgs();
      const result = await createTestOrder.handler(testOrderArgs);
      results.push({
        name: 'auth:createTestOrder(BTCUSDT safe validation)',
        ok: true,
        durationMs: Date.now() - startedAt,
        summary: summarizeTestOrder(result, testOrderArgs),
      });
    } catch (error) {
      results.push({
        name: 'auth:createTestOrder(BTCUSDT safe validation)',
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.error('mexc smoke summary:');
  for (const result of results) {
    if (result.ok) {
      console.error(`- OK   ${result.name} (${result.durationMs} ms) ${result.summary}`);
    } else {
      console.error(`- FAIL ${result.name} (${result.durationMs} ms) ${result.error}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

async function buildSafeTestOrderArgs(): Promise<Record<string, unknown>> {
  const [tickerResult, exchangeInfoResult] = await Promise.all([
    getTickers.handler({ symbol: 'BTCUSDT' }),
    getExchangeInfo.handler({ symbol: 'BTCUSDT' }),
  ]);

  const ticker = tickerResult as Record<string, unknown>;
  const exchangeInfo = exchangeInfoResult as { symbols?: Array<Record<string, unknown>> };
  const symbolInfo = Array.isArray(exchangeInfo.symbols) ? exchangeInfo.symbols[0] : null;
  if (!symbolInfo) {
    throw new Error('BTCUSDT symbol info not found');
  }

  const filters = Array.isArray(symbolInfo.filters)
    ? symbolInfo.filters as Array<Record<string, unknown>>
    : [];
  const lotSize = filters.find((filter) => filter.filterType === 'LOT_SIZE');
  const priceFilter = filters.find((filter) => filter.filterType === 'PRICE_FILTER');
  const minNotionalFilter = filters.find((filter) =>
    filter.filterType === 'MIN_NOTIONAL' || filter.filterType === 'NOTIONAL',
  );

  const lastPrice = Number.parseFloat(String(ticker.lastPrice ?? '0'));
  const minQty = Number.parseFloat(String(lotSize?.minQty ?? '0.0001'));
  const stepSize = Number.parseFloat(String(lotSize?.stepSize ?? '0.0001'));
  const tickSize = Number.parseFloat(String(priceFilter?.tickSize ?? '0.01'));
  const minNotional = Number.parseFloat(
    String(
      minNotionalFilter?.minNotional ??
      minNotionalFilter?.notional ??
      '5',
    ),
  );

  if (!(lastPrice > 0) || !(minQty > 0) || !(stepSize > 0) || !(tickSize > 0)) {
    throw new Error('Unable to derive valid BTCUSDT order constraints from exchangeInfo');
  }

  const rawPrice = Math.max(lastPrice * 0.8, tickSize);
  const price = floorToStep(rawPrice, tickSize);
  const qtyForNotional = minNotional > 0 ? (minNotional / price) * 1.1 : minQty;
  const quantity = ceilToStep(Math.max(minQty, qtyForNotional), stepSize);

  return {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: formatDecimal(quantity),
    price: formatDecimal(price),
  };
}

function floorToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function ceilToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function formatDecimal(value: number): string {
  return value.toFixed(12).replace(/\.?0+$/, '');
}

function summarizeTestOrder(result: unknown, args: Record<string, unknown>): string {
  if (result && typeof result === 'object' && Object.keys(result as Record<string, unknown>).length > 0) {
    return `validated order payload accepted for ${stringValue(args.symbol)}`;
  }

  return `validated ${stringValue(args.side)} ${stringValue(args.type)} ${stringValue(args.symbol)} quantity=${stringValue(args.quantity)} price=${stringValue(args.price)}`;
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

function validateAuthEnv() {
  if (!process.env.MEXC_API_KEY && !process.env.MEXC_SPOT_API_KEY) {
    throw new Error('Missing MEXC_API_KEY or MEXC_SPOT_API_KEY in .env');
  }

  if (!process.env.MEXC_SECRET_KEY && !process.env.MEXC_API_SECRET && !process.env.MEXC_SPOT_API_SECRET) {
    throw new Error('Missing MEXC_SECRET_KEY, MEXC_API_SECRET, or MEXC_SPOT_API_SECRET in .env');
  }
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? 'n/a' : String(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
