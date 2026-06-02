import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

const testOrderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['LIMIT', 'MARKET', 'LIMIT_MAKER', 'IMMEDIATE_OR_CANCEL', 'FILL_OR_KILL']),
  quantity: z.union([z.string(), z.number()]).optional(),
  quoteOrderQty: z.union([z.string(), z.number()]).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  newClientOrderId: z.string().optional(),
  recvWindow: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  const requiresPrice =
    value.type === 'LIMIT' ||
    value.type === 'LIMIT_MAKER' ||
    value.type === 'IMMEDIATE_OR_CANCEL' ||
    value.type === 'FILL_OR_KILL';

  if (!value.quantity && !value.quoteOrderQty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either quantity or quoteOrderQty must be provided',
      path: ['quantity'],
    });
  }

  if (requiresPrice && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `price is required for order type ${value.type}`,
      path: ['price'],
    });
  }
});

export const createTestOrder = {
  name: 'createTestOrder',
  description:
    'Validate a MEXC Spot order without sending it to the matching engine. Safe for smoke tests.',
  inputSchema: testOrderSchema,
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.postAuth('/api/v3/order/test', input);
  },
};
