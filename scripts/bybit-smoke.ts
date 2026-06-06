import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { getAccountInfo } from '../src/tools/account/getAccountInfo.ts';
import { getWalletBalance } from '../src/tools/account/getWalletBalance.ts';
import { getOrderbook } from '../src/tools/market/getOrderbook.ts';
import { getServerTime } from '../src/tools/market/getServerTime.ts';
import { getTickers } from '../src/tools/market/getTickers.ts';
import { getOpenOrders } from '../src/tools/trade/getOpenOrders.ts';
import { queryAPIKey } from '../src/tools/user/queryAPIKey.ts';

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
  const credentialMode = parseCredentialMode();
  await loadEnvFile(path.join(process.cwd(), '.env'));
  mapBybitEnvAliases(credentialMode);
  validateAuthEnv(credentialMode);

  const tests: SmokeCase[] = [
    {
      name: 'public:getServerTime',
      args: {},
      handler: getServerTime.handler,
      summarize: (result) => {
        const data = unwrapResult<{ timeSecond?: string; timeNano?: string }>(result);
        return `timeSecond=${data?.timeSecond ?? 'n/a'} timeNano=${data?.timeNano ?? 'n/a'}`;
      },
    },
    {
      name: 'public:getTickers(BTCUSDT spot)',
      args: { category: 'spot', symbol: 'BTCUSDT' },
      handler: getTickers.handler,
      summarize: (result) => {
        const item = unwrapListItem(result);
        return `symbol=${item?.symbol ?? 'n/a'} lastPrice=${item?.lastPrice ?? 'n/a'} bid1=${item?.bid1Price ?? 'n/a'} ask1=${item?.ask1Price ?? 'n/a'}`;
      },
    },
    {
      name: 'public:getOrderbook(BTCUSDT spot)',
      args: { category: 'spot', symbol: 'BTCUSDT', limit: 1 },
      handler: getOrderbook.handler,
      summarize: (result) => {
        const data = unwrapResult<{ b?: string[][]; a?: string[][]; u?: number | string; seq?: number | string }>(result);
        const bid = data?.b?.[0]?.slice(0, 2).join('@') ?? 'n/a';
        const ask = data?.a?.[0]?.slice(0, 2).join('@') ?? 'n/a';
        return `bestBid=${bid} bestAsk=${ask} u=${data?.u ?? 'n/a'} seq=${data?.seq ?? 'n/a'}`;
      },
    },
    {
      name: 'auth:queryAPIKey',
      args: {},
      handler: queryAPIKey.handler,
      summarize: (result) => {
        const data = unwrapResult<Record<string, unknown>>(result) ?? {};
        const permissions = data.permissions;
        const permissionGroups =
          permissions && typeof permissions === 'object' ? Object.keys(permissions as Record<string, unknown>).length : 0;
        return `readOnly=${stringValue(data.readOnly)} isMaster=${stringValue(data.isMaster)} unified=${stringValue(data.unified)} uta=${stringValue(data.uta)} permissionGroups=${permissionGroups}`;
      },
    },
    {
      name: 'auth:getAccountInfo',
      args: {},
      handler: getAccountInfo.handler,
      summarize: (result) => {
        const data = unwrapResult<Record<string, unknown>>(result) ?? {};
        return `unifiedMarginStatus=${stringValue(data.unifiedMarginStatus)} marginMode=${stringValue(data.marginMode)} dcpStatus=${stringValue(data.dcpStatus)}`;
      },
    },
    {
      name: 'auth:getWalletBalance(UNIFIED)',
      args: { accountType: 'UNIFIED' },
      handler: getWalletBalance.handler,
      summarize: (result) => {
        const item = unwrapListItem(result);
        return `accountType=${item?.accountType ?? 'n/a'} totalEquity=${item?.totalEquity ?? 'n/a'} totalWalletBalance=${item?.totalWalletBalance ?? 'n/a'} coinCount=${Array.isArray(item?.coin) ? item.coin.length : 'n/a'}`;
      },
    },
    {
      name: 'auth:getOpenOrders(spot)',
      args: { category: 'spot', limit: 1, openOnly: '0' },
      handler: getOpenOrders.handler,
      summarize: (result) => {
        const data = unwrapResult<{ list?: unknown[]; nextPageCursor?: string }>(result);
        return `openOrders=${Array.isArray(data?.list) ? data.list.length : 'n/a'} nextCursor=${data?.nextPageCursor ?? 'n/a'}`;
      },
    },
  ];

  console.error(`bybit smoke target: ${process.env.BYBIT_TESTNET === 'true' ? 'testnet' : 'mainnet'}`);
  console.error(`auth mode: ${process.env.BYBIT_API_PRIVATE_KEY_PATH ? 'rsa' : 'hmac'}`);
  console.error(`api key source: ${describeApiKeySource(credentialMode)}`);

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

  console.error('bybit smoke summary:');
  for (const result of results) {
    if (result.ok) {
      console.error(`- OK   ${result.name} (${result.durationMs} ms) ${result.summary}`);
    } else {
      console.error(`- FAIL ${result.name} (${result.durationMs} ms) ${result.error}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  const apiKeyResult = results.find((result) => result.name === 'auth:queryAPIKey');
  if (credentialMode === 'rw' && apiKeyResult?.ok) {
    try {
      const rawResult = await queryAPIKey.handler({});
      const data = unwrapResult<Record<string, unknown>>(rawResult) ?? {};
      if (isReadOnlyValue(data.readOnly)) {
        failed.push({
          name: 'auth:queryAPIKey(readOnly=false)',
          ok: false,
          durationMs: 0,
          error: `Expected RW API key, got readOnly=${stringValue(data.readOnly)}`,
        });
        console.error(`- FAIL auth:queryAPIKey(readOnly=false) Expected RW API key, got readOnly=${stringValue(data.readOnly)}`);
      } else {
        console.error(`- OK   auth:queryAPIKey(readOnly=false) readOnly=${stringValue(data.readOnly)}`);
      }
    } catch (error) {
      failed.push({
        name: 'auth:queryAPIKey(readOnly=false)',
        ok: false,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`- FAIL auth:queryAPIKey(readOnly=false) ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function parseCredentialMode(): 'ro' | 'rw' {
  if (process.argv.includes('--rw')) {
    return 'rw';
  }

  if (process.argv.includes('--ro')) {
    return 'ro';
  }

  return 'ro';
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

function mapBybitEnvAliases(credentialMode: 'ro' | 'rw') {
  const keyName = credentialMode === 'rw' ? 'BYBIT_RW_API_KEY' : 'BYBIT_RO_API_KEY';
  const secretName = credentialMode === 'rw' ? 'BYBIT_RW_API_SECRET' : 'BYBIT_RO_API_SECRET';

  const selectedKey = process.env[keyName];
  const selectedSecret = process.env[secretName];

  if (selectedKey) {
    process.env.BYBIT_API_KEY = selectedKey;
  } else if (!process.env.BYBIT_API_KEY && credentialMode === 'ro' && process.env.BYBIT_RO_API_KEY) {
    process.env.BYBIT_API_KEY = process.env.BYBIT_RO_API_KEY;
  }

  if (selectedSecret) {
    process.env.BYBIT_API_SECRET = selectedSecret;
  } else if (!process.env.BYBIT_API_SECRET && credentialMode === 'ro' && process.env.BYBIT_RO_API_SECRET) {
    process.env.BYBIT_API_SECRET = process.env.BYBIT_RO_API_SECRET;
  }
}

function validateAuthEnv(credentialMode: 'ro' | 'rw') {
  const keyName = credentialMode === 'rw' ? 'BYBIT_RW_API_KEY' : 'BYBIT_RO_API_KEY';
  const secretName = credentialMode === 'rw' ? 'BYBIT_RW_API_SECRET' : 'BYBIT_RO_API_SECRET';

  if (!process.env.BYBIT_API_KEY) {
    throw new Error(`Missing BYBIT_API_KEY or ${keyName} in .env`);
  }

  if (!process.env.BYBIT_API_SECRET && !process.env.BYBIT_API_PRIVATE_KEY_PATH) {
    throw new Error(`Missing BYBIT_API_SECRET/${secretName} or BYBIT_API_PRIVATE_KEY_PATH in .env`);
  }
}

function unwrapResult<T>(result: unknown): T | undefined {
  if (!result || typeof result !== 'object') return undefined;
  return (result as { result?: T }).result;
}

function unwrapListItem(result: unknown): Record<string, any> | undefined {
  const data = unwrapResult<{ list?: Record<string, any>[] }>(result);
  return Array.isArray(data?.list) ? data.list[0] : undefined;
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? 'n/a' : String(value);
}

function describeApiKeySource(credentialMode: 'ro' | 'rw') {
  const keyName = credentialMode === 'rw' ? 'BYBIT_RW_API_KEY' : 'BYBIT_RO_API_KEY';
  return process.env[keyName] ? `${keyName.replace('_API_KEY', '')}_* alias` : 'BYBIT_API_* direct';
}

function isReadOnlyValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
