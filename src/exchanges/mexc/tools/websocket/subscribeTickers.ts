import { z } from 'zod';
import { mexcSpotWsClient } from '../../ws/spot-client.js';

export const subscribeTickers = {
  name: 'subscribeTickers',
  description:
    'Subscribe to MEXC Spot protobuf aggregated book ticker updates for one symbol and return a short snapshot of streamed messages.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    interval: z.enum(['100ms']).default('100ms').optional(),
    messageCount: z.number().int().positive().max(10).optional(),
    timeoutMs: z.number().int().positive().max(15000).optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const symbol = String(input.symbol).toUpperCase();
    const interval = input.interval ? String(input.interval) : '100ms';

    return mexcSpotWsClient.snapshot({
      channel: `spot@public.aggre.bookTicker.v3.api.pb@${interval}@${symbol}`,
      bodyField: 'publicAggreBookTicker',
      messageCount: typeof input.messageCount === 'number' ? input.messageCount : 1,
      timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : 5000,
    });
  },
};
