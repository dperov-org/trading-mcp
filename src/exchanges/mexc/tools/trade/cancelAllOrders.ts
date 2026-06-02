import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const cancelAllOrders = {
  name: 'cancelAllOrders',
  description:
    'Cancel all authenticated MEXC Spot open orders for one symbol or a comma-separated list of up to five symbols.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.deleteAuth('/api/v3/openOrders', input);
  },
};
