import { z } from 'zod';
import { mexcSpotRestClient } from '../rest/spot-client.js';
import { mexcFuturesRestClient } from '../rest/futures-client.js';

function sectionOk(name: string, data: unknown) {
  return { name, ok: true, data };
}

function sectionError(name: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { name, ok: false, error: message };
}

async function callSection(name: string, fn: () => Promise<unknown>) {
  try {
    return sectionOk(name, await fn());
  } catch (error) {
    return sectionError(name, error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasNonZeroNumericFields(record: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => toFiniteNumber(record[field]) !== 0);
}

function pickFields(record: Record<string, unknown>, fields: string[]) {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      picked[field] = record[field];
    }
  }
  return picked;
}

function summarizeFuturesCollection(
  payload: unknown,
  itemFields: string[],
  limit: number,
  nonZeroFields: string[] = [],
) {
  if (!isRecord(payload)) {
    return payload;
  }

  const rawItems = Array.isArray(payload.data) ? payload.data.filter(isRecord) : [];
  const filteredItems =
    nonZeroFields.length > 0
      ? rawItems.filter((item) => hasNonZeroNumericFields(item, nonZeroFields))
      : rawItems;

  return {
    success: payload.success ?? null,
    code: payload.code ?? null,
    total: filteredItems.length,
    items: filteredItems.slice(0, limit).map((item) => pickFields(item, itemFields)),
  };
}

export const getMexcTradingReviewSnapshot = {
  name: 'getMexcTradingReviewSnapshot',
  description:
    'Best first tool for a generic MEXC trading review or account analysis request. Returns one aggregated MEXC snapshot with spot balances/open orders plus futures balances, positions, active orders, trigger orders, stop orders, recent fills, and recent order history. Use this first when the user asks to analyze MEXC trading without naming exact endpoints.',
  inputSchema: z.object({
    limit: z.number().int().positive().max(100).optional(),
    includeSpot: z.boolean().optional(),
    includeFutures: z.boolean().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const limit = typeof input.limit === 'number' ? input.limit : 20;
    const includeSpot = input.includeSpot !== false;
    const includeFutures = input.includeFutures !== false;

    const spotSections = includeSpot
      ? await Promise.all([
          callSection('spotWalletBalance', async () => {
            const account = await mexcSpotRestClient.getAuth('/api/v3/account');
            if (!account || typeof account !== 'object' || !('balances' in account)) {
              return account;
            }

            const balances = Array.isArray((account as { balances?: unknown }).balances)
              ? (account as { balances: Array<Record<string, unknown>> }).balances.filter((balance) => {
                  const free = Number.parseFloat(String(balance.free ?? '0'));
                  const locked = Number.parseFloat(String(balance.locked ?? '0'));
                  return free !== 0 || locked !== 0;
                })
              : [];

            return {
              accountType: 'SPOT',
              updateTime: (account as { updateTime?: unknown }).updateTime ?? null,
              balanceCount: balances.length,
              balances: balances.slice(0, limit).map((balance) =>
                pickFields(balance, ['asset', 'free', 'locked']),
              ),
            };
          }),
          callSection('spotOpenOrders', async () => {
            const orders = await mexcSpotRestClient.getAuth('/api/v3/openOrders');
            const rows = Array.isArray(orders) ? orders.filter(isRecord) : [];
            return {
              total: rows.length,
              items: rows.slice(0, limit).map((row) =>
                pickFields(row, [
                  'symbol',
                  'orderId',
                  'clientOrderId',
                  'side',
                  'type',
                  'price',
                  'origQty',
                  'executedQty',
                  'status',
                  'time',
                ]),
              ),
            };
          }),
        ])
      : [];

    const futuresSections = includeFutures
      ? await Promise.all([
          callSection('futuresAssets', async () =>
            summarizeFuturesCollection(
              await mexcFuturesRestClient.getAuth('/api/v1/private/account/assets'),
              [
                'currency',
                'availableBalance',
                'cashBalance',
                'equity',
                'unrealized',
                'positionMargin',
                'frozenBalance',
              ],
              limit,
              ['availableBalance', 'cashBalance', 'equity', 'unrealized', 'positionMargin', 'frozenBalance'],
            ),
          ),
          callSection('futuresOpenPositions', async () =>
            summarizeFuturesCollection(
              await mexcFuturesRestClient.getAuth('/api/v1/private/position/open_positions'),
              [
                'symbol',
                'positionId',
                'holdVol',
                'positionType',
                'openAvgPrice',
                'liquidatePrice',
                'unrealizedPnl',
                'oim',
                'im',
                'leverage',
              ],
              limit,
              ['holdVol', 'unrealizedPnl', 'oim', 'im'],
            ),
          ),
          callSection('futuresOpenOrders', async () =>
            summarizeFuturesCollection(
              await mexcFuturesRestClient.getAuth('/api/v1/private/order/list/open_orders', {
                page_num: 1,
                page_size: limit,
              }),
              [
                'symbol',
                'orderId',
                'externalOid',
                'side',
                'orderType',
                'state',
                'price',
                'vol',
                'dealVol',
                'createTime',
              ],
              limit,
            ),
          ),
          callSection('futuresTriggerOrders', async () =>
            summarizeFuturesCollection(
              await mexcFuturesRestClient.getAuth('/api/v1/private/planorder/list/orders', {
                page_num: 1,
                page_size: limit,
              }),
              [
                'symbol',
                'orderId',
                'triggerPrice',
                'price',
                'vol',
                'side',
                'state',
                'stopLossPrice',
                'takeProfitPrice',
                'createTime',
              ],
              limit,
            ),
          ),
          callSection('futuresStopOrders', async () =>
            summarizeFuturesCollection(
              await mexcFuturesRestClient.getAuth('/api/v1/private/stoporder/list/orders', {
                page_num: 1,
                page_size: limit,
              }),
              [
                'symbol',
                'stopPlanOrderId',
                'positionId',
                'side',
                'stopLossPrice',
                'takeProfitPrice',
                'state',
                'createTime',
              ],
              limit,
            ),
          ),
          callSection('futuresOrderDeals', async () =>
            summarizeFuturesCollection(
              await mexcFuturesRestClient.getAuth('/api/v1/private/order/list/order_deals', {
                page_num: 1,
                page_size: limit,
              }),
              [
                'symbol',
                'orderId',
                'positionId',
                'side',
                'price',
                'vol',
                'profit',
                'fee',
                'state',
                'createTime',
                'externalOid',
              ],
              limit,
            ),
          ),
          callSection('futuresOrderHistory', async () =>
            summarizeFuturesCollection(
              await mexcFuturesRestClient.getAuth('/api/v1/private/order/list/history_orders', {
                page_num: 1,
                page_size: limit,
              }),
              [
                'symbol',
                'orderId',
                'externalOid',
                'side',
                'price',
                'vol',
                'dealVol',
                'profit',
                'state',
                'createTime',
                'updateTime',
              ],
              limit,
            ),
          ),
        ])
      : [];

    return {
      exchange: 'MEXC',
      generatedAt: new Date().toISOString(),
      limit,
      includeSpot,
      includeFutures,
      sections: [...spotSections, ...futuresSections],
      guidance: [
        'For a generic MEXC trading analysis, inspect futuresOpenPositions, futuresOrderDeals, futuresOrderHistory, futuresOpenOrders, futuresTriggerOrders, and futuresStopOrders first.',
        'Use spotWalletBalance and spotOpenOrders for spot exposure and idle order context.',
      ],
    };
  },
};

export const getMexcCapabilityGuide = {
  name: 'getMexcCapabilityGuide',
  description:
    'Return a static guide for the authenticated MEXC MCP server. Use this first when the user explicitly asks about MEXC and you are unsure which MEXC tools to call. The guide maps common MEXC tasks to the exact Spot and Futures tool names available on this server.',
  inputSchema: z.object({}),
  handler: async () => ({
    exchange: 'MEXC',
    server: 'trading_mcp_mexc_local',
    routingRules: [
      'Use only tools from trading_mcp_mexc_local for MEXC requests.',
      'Do not use trading_mcp_bybit_local for MEXC requests.',
      'MEXC Spot and MEXC Futures are separate surfaces; choose futures tools for positions, trigger orders, stop orders, and perpetual contracts.',
      'If the user asks for "open orders" on MEXC without saying spot or futures, check both spot and futures surfaces before concluding that nothing is open.',
    ],
    bestFirstTool: 'getMexcTradingReviewSnapshot',
    spot: {
      marketData: [
        'getServerTime',
        'getExchangeInfo',
        'getTickers',
        'getOrderbook',
        'getRecentTrades',
        'getKlines',
        'getHistoricalTrades',
        'getAggregateTrades',
        'getAveragePrice',
        'getPriceTicker',
        'getBookTicker',
      ],
      account: [
        'getAccountInfo',
        'getWalletBalance',
        'getOpenOrders',
        'getAllOrders',
        'getOrderHistory',
        'getMyTrades',
        'queryApiPermissions',
        'getSelfSymbols',
        'getKycStatus',
      ],
      commonTasks: {
        currentBalances: ['getWalletBalance', 'getAccountInfo'],
        recentTradingHistory: ['getMyTrades', 'getOrderHistory', 'getAllOrders'],
        openSpotOrders: ['getOpenOrders'],
      },
    },
    futures: {
      marketData: [
        'getFuturesContracts',
        'getFuturesTicker',
        'getFuturesOrderbook',
        'getFuturesKlines',
        'getFuturesIndexPrice',
        'getFuturesFairPrice',
        'getFuturesFundingRate',
      ],
      account: [
        'getFuturesAssets',
        'getFuturesAsset',
        'getFuturesOpenPositions',
        'getFuturesOpenOrders',
        'getFuturesOrderHistory',
        'getFuturesOrderDeals',
        'getFuturesStopOrders',
        'getFuturesTriggerOrders',
      ],
      commonTasks: {
        openPositions: ['getFuturesOpenPositions'],
        activeFuturesOrders: ['getFuturesOpenOrders'],
        triggerPlanOrders: ['getFuturesTriggerOrders'],
        tpSlOrders: ['getFuturesStopOrders'],
        fillsAndTradeHistory: ['getFuturesOrderDeals', 'getFuturesOrderHistory'],
      },
    },
    recommendationFlow: [
      'For a generic MEXC trading review, start with getMexcTradingReviewSnapshot.',
      'If more detail is needed, continue with getWalletBalance, getMyTrades, getOrderHistory, getFuturesOpenPositions, getFuturesOrderDeals, getFuturesOrderHistory, getFuturesOpenOrders, getFuturesTriggerOrders, and getFuturesStopOrders as relevant.',
      'If the user mentions trigger orders, plan orders, TP, SL, or positions, prioritize the Futures tools.',
      'If the user mentions BTC/USDT price or market quote only, use Spot getTickers/getOrderbook unless they explicitly ask about futures.',
    ],
  }),
};
