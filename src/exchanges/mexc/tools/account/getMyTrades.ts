import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getMyTrades = {
  name: 'getMyTrades',
  description:
    'Get authenticated MEXC Spot trade fills for a symbol, optionally filtered by orderId and time range.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    orderId: z.union([z.string(), z.number()]).optional(),
    startTime: z.number().int().optional(),
    endTime: z.number().int().optional(),
    limit: z.number().int().positive().max(100).optional(),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.getAuth('/api/v3/myTrades', input);
  },
};
