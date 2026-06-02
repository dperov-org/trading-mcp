import { z } from 'zod';
import { mexcSpotWsClient } from '../../ws/spot-client.js';

export const subscribeOrderbook = {
  name: 'subscribeOrderbook',
  description:
    'Subscribe to MEXC Spot protobuf partial orderbook depth for one symbol and return a short snapshot of streamed messages.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    limit: z.enum(['5', '10', '20']).default('5').optional(),
    messageCount: z.number().int().positive().max(10).optional(),
    timeoutMs: z.number().int().positive().max(15000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const symbol = String(input.symbol).toUpperCase();
    const limit = input.limit ? String(input.limit) : '5';

    return mexcSpotWsClient.snapshot({
      channel: `spot@public.limit.depth.v3.api.pb@${symbol}@${limit}`,
      bodyField: 'publicLimitDepths',
      messageCount: typeof input.messageCount === 'number' ? input.messageCount : 1,
      timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : 5000,
    });
  },
};
