import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getKlines = {
  name: 'getKlines',
  description:
    'Get MEXC Spot candlestick data for a symbol and interval. No authentication required.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    interval: z.enum([
      '1s',
      '1m',
      '5m',
      '15m',
      '30m',
      '60m',
      '4h',
      '1d',
      '1W',
      '1M',
    ]),
    startTime: z.number().int().optional(),
    endTime: z.number().int().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.get('/api/v3/klines', input);
  },
};
