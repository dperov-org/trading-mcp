import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getTickers = {
  name: 'getTickers',
  description:
    'Get 24-hour ticker price change statistics for one symbol or all MEXC Spot symbols. No authentication required.',
  inputSchema: z.object({
    symbol: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.get('/api/v3/ticker/24hr', input);
  },
};
