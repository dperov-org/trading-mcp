import { z } from 'zod';
import { mexcFuturesRestClient } from '../../rest/futures-client.js';

const futuresSymbolSchema = z.string().min(1);
const futuresIntervalSchema = z.enum([
  'Min1',
  'Min5',
  'Min15',
  'Min30',
  'Min60',
  'Hour4',
  'Hour8',
  'Day1',
  'Week1',
  'Month1',
]);

export const getFuturesContracts = {
  name: 'getFuturesContracts',
  description: 'Get MEXC Futures contract metadata for all contracts or one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: futuresSymbolSchema.optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const result = await mexcFuturesRestClient.get('/api/v1/contract/detail');
    if (!input.symbol) {
      return result;
    }

    const symbol = String(input.symbol).toUpperCase();
    const payload = result as { data?: Array<Record<string, unknown>> };
    return {
      ...payload,
      data: Array.isArray(payload.data)
        ? payload.data.filter((item) => String(item.symbol ?? '').toUpperCase() === symbol)
        : payload.data,
    };
  },
};

export const getFuturesTicker = {
  name: 'getFuturesTicker',
  description: 'Get MEXC Futures ticker data for all contracts or one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: futuresSymbolSchema.optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcFuturesRestClient.get('/api/v1/contract/ticker', input),
};

export const getFuturesOrderbook = {
  name: 'getFuturesOrderbook',
  description: 'Get MEXC Futures orderbook depth for one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: futuresSymbolSchema,
    limit: z.number().int().positive().max(2000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const symbol = String(input.symbol).toUpperCase();
    const result = await mexcFuturesRestClient.get(`/api/v1/contract/depth/${symbol}`);
    const limit = typeof input.limit === 'number' ? input.limit : undefined;
    if (!limit) {
      return result;
    }

    const payload = result as { data?: { asks?: unknown[]; bids?: unknown[] } };
    if (!payload.data) {
      return result;
    }

    return {
      ...payload,
      data: {
        ...payload.data,
        asks: Array.isArray(payload.data.asks) ? payload.data.asks.slice(0, limit) : payload.data.asks,
        bids: Array.isArray(payload.data.bids) ? payload.data.bids.slice(0, limit) : payload.data.bids,
      },
    };
  },
};

export const getFuturesKlines = {
  name: 'getFuturesKlines',
  description: 'Get MEXC Futures kline data for one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: futuresSymbolSchema,
    interval: futuresIntervalSchema,
    start: z.number().int().optional(),
    end: z.number().int().optional(),
    limit: z.number().int().positive().max(2000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const symbol = String(input.symbol).toUpperCase();
    const params = {
      interval: input.interval,
      start: input.start,
      end: input.end,
      limit: input.limit,
    };
    return mexcFuturesRestClient.get(`/api/v1/contract/kline/${symbol}`, params);
  },
};

export const getFuturesIndexPrice = {
  name: 'getFuturesIndexPrice',
  description: 'Get the current MEXC Futures index price for one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: futuresSymbolSchema,
  }),
  handler: async (input: Record<string, unknown>) => {
    const symbol = String(input.symbol).toUpperCase();
    return mexcFuturesRestClient.get(`/api/v1/contract/index_price/${symbol}`);
  },
};

export const getFuturesFairPrice = {
  name: 'getFuturesFairPrice',
  description: 'Get the current MEXC Futures fair price for one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: futuresSymbolSchema,
  }),
  handler: async (input: Record<string, unknown>) => {
    const symbol = String(input.symbol).toUpperCase();
    return mexcFuturesRestClient.get(`/api/v1/contract/fair_price/${symbol}`);
  },
};

export const getFuturesFundingRate = {
  name: 'getFuturesFundingRate',
  description: 'Get the current MEXC Futures funding rate for one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: futuresSymbolSchema,
  }),
  handler: async (input: Record<string, unknown>) => {
    const symbol = String(input.symbol).toUpperCase();
    return mexcFuturesRestClient.get(`/api/v1/contract/funding_rate/${symbol}`);
  },
};

export const futuresMarketTools = [
  getFuturesContracts,
  getFuturesTicker,
  getFuturesOrderbook,
  getFuturesKlines,
  getFuturesIndexPrice,
  getFuturesFairPrice,
  getFuturesFundingRate,
];
