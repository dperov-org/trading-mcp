import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getOrderHistory = {
  name: 'getOrderHistory',
  description:
    'Get authenticated MEXC Spot order history for a symbol, with optional time range and pagination controls.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    orderId: z.number().int().optional(),
    startTime: z.number().int().optional(),
    endTime: z.number().int().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.getAuth('/api/v3/allOrders', input);
  },
};
