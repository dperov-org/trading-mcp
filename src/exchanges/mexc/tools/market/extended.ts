import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

const symbolSchema = z.string().min(1);

export const getPing = {
  name: 'getPing',
  description: 'Test MEXC Spot REST connectivity. No authentication required.',
  inputSchema: z.object({}),
  handler: async () => mexcSpotRestClient.get('/api/v3/ping'),
};

export const getDefaultSymbols = {
  name: 'getDefaultSymbols',
  description: 'Get the default MEXC Spot symbols list. No authentication required.',
  inputSchema: z.object({}),
  handler: async () => mexcSpotRestClient.get('/api/v3/defaultSymbols'),
};

export const getHistoricalTrades = {
  name: 'getHistoricalTrades',
  description: 'Get older MEXC Spot market trades for a symbol. No authentication required.',
  inputSchema: z.object({
    symbol: symbolSchema,
    limit: z.number().int().positive().max(1000).optional(),
    fromId: z.union([z.string(), z.number()]).optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.get('/api/v3/historicalTrades', input),
};

export const getAggregateTrades = {
  name: 'getAggregateTrades',
  description: 'Get compressed aggregate MEXC Spot trades for a symbol. No authentication required.',
  inputSchema: z.object({
    symbol: symbolSchema,
    fromId: z.union([z.string(), z.number()]).optional(),
    startTime: z.number().int().optional(),
    endTime: z.number().int().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.get('/api/v3/aggTrades', input),
};

export const getAveragePrice = {
  name: 'getAveragePrice',
  description: 'Get the current rolling average MEXC Spot price for one symbol. No authentication required.',
  inputSchema: z.object({
    symbol: symbolSchema,
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.get('/api/v3/avgPrice', input),
};

export const getPriceTicker = {
  name: 'getPriceTicker',
  description: 'Get the last traded MEXC Spot price for one symbol or all symbols. No authentication required.',
  inputSchema: z.object({
    symbol: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.get('/api/v3/ticker/price', input),
};

export const getBookTicker = {
  name: 'getBookTicker',
  description: 'Get the best bid/ask for one MEXC Spot symbol or for all symbols. No authentication required.',
  inputSchema: z.object({
    symbol: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.get('/api/v3/ticker/bookTicker', input),
};

export const extendedMarketTools = [
  getPing,
  getDefaultSymbols,
  getHistoricalTrades,
  getAggregateTrades,
  getAveragePrice,
  getPriceTicker,
  getBookTicker,
];
