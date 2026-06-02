import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getExchangeInfo = {
  name: 'getExchangeInfo',
  description:
    'Get MEXC Spot exchange metadata including symbols, trading rules, and filters. No authentication required.',
  inputSchema: z.object({
    symbol: z.string().optional(),
    symbols: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
    showPermissionSets: z.boolean().optional(),
    symbolStatus: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const normalized = { ...input };
    if (Array.isArray(normalized.symbols)) {
      normalized.symbols = JSON.stringify(normalized.symbols);
    }

    if (Array.isArray(normalized.permissions)) {
      normalized.permissions = JSON.stringify(normalized.permissions);
    }

    return mexcSpotRestClient.get('/api/v3/exchangeInfo', normalized);
  },
};
