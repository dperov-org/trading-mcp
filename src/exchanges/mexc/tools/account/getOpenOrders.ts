import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getOpenOrders = {
  name: 'getOpenOrders',
  description:
    'Get current authenticated MEXC Spot open orders for a symbol or for all spot symbols when supported by the API key. This does not include MEXC Futures trigger orders.',
  inputSchema: z.object({
    symbol: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.getAuth('/api/v3/openOrders', input);
  },
};
