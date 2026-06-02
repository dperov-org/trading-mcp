import { z } from 'zod';
import { mexcFuturesRestClient } from '../../rest/futures-client.js';

const pageSchema = z.object({
  page_num: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(100).optional(),
  recvWindow: z.number().int().positive().optional(),
}).passthrough();

export const getFuturesAssets = {
  name: 'getFuturesAssets',
  description: 'Get authenticated MEXC Futures asset balances.',
  inputSchema: z.object({}).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.getAuth('/api/v1/private/account/assets', input),
};

export const getFuturesAsset = {
  name: 'getFuturesAsset',
  description: 'Get one authenticated MEXC Futures asset balance by currency.',
  inputSchema: z.object({
    currency: z.string().min(1),
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => {
    const currency = String(input.currency).toUpperCase();
    const { currency: _currency, ...rest } = input;
    return mexcFuturesRestClient.getAuth(`/api/v1/private/account/asset/${currency}`, rest);
  },
};

export const getFuturesOpenPositions = {
  name: 'getFuturesOpenPositions',
  description: 'Get authenticated MEXC Futures open positions.',
  inputSchema: z.object({
    symbol: z.string().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.getAuth('/api/v1/private/position/open_positions', input),
};

export const getFuturesOpenOrders = {
  name: 'getFuturesOpenOrders',
  description: 'Get authenticated MEXC Futures active open orders. This does not include trigger/plan orders.',
  inputSchema: z.object({
    symbol: z.string().optional(),
    page_num: z.number().int().positive().optional(),
    page_size: z.number().int().positive().max(100).optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.getAuth('/api/v1/private/order/list/open_orders', input),
};

export const getFuturesOrderHistory = {
  name: 'getFuturesOrderHistory',
  description: 'Get authenticated MEXC Futures historical orders.',
  inputSchema: pageSchema.extend({
    symbol: z.string().optional(),
    states: z.string().optional(),
    category: z.number().int().optional(),
    start_time: z.number().int().optional(),
    end_time: z.number().int().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.getAuth('/api/v1/private/order/list/history_orders', input),
};

export const getFuturesOrderDeals = {
  name: 'getFuturesOrderDeals',
  description: 'Get authenticated MEXC Futures fills/deals history.',
  inputSchema: pageSchema.extend({
    symbol: z.string().optional(),
    start_time: z.number().int().optional(),
    end_time: z.number().int().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.getAuth('/api/v1/private/order/list/order_deals', input),
};

export const getFuturesStopOrders = {
  name: 'getFuturesStopOrders',
  description: 'Get authenticated MEXC Futures stop-loss/take-profit trigger orders.',
  inputSchema: pageSchema.extend({
    symbol: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.getAuth('/api/v1/private/stoporder/list/orders', input),
};

export const getFuturesTriggerOrders = {
  name: 'getFuturesTriggerOrders',
  description: 'Get authenticated MEXC Futures trigger/plan orders that are waiting to be triggered.',
  inputSchema: pageSchema.extend({
    symbol: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.getAuth('/api/v1/private/planorder/list/orders', input),
};

export const futuresAccountTools = [
  getFuturesAssets,
  getFuturesAsset,
  getFuturesOpenPositions,
  getFuturesOpenOrders,
  getFuturesOrderHistory,
  getFuturesOrderDeals,
  getFuturesStopOrders,
  getFuturesTriggerOrders,
];
