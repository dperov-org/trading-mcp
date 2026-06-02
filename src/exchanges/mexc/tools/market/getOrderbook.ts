import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getOrderbook = {
  name: 'getOrderbook',
  description:
    'Get the current MEXC Spot orderbook depth snapshot for a symbol. No authentication required.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    limit: z.number().int().positive().max(5000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.get('/api/v3/depth', input);
  },
};
