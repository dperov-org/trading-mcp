import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getRecentTrades = {
  name: 'getRecentTrades',
  description:
    'Get recent public MEXC Spot trades for a symbol. No authentication required.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.get('/api/v3/trades', input);
  },
};
