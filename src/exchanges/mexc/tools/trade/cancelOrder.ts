import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

const cancelOrderSchema = z.object({
  symbol: z.string().min(1),
  orderId: z.union([z.string(), z.number()]).optional(),
  origClientOrderId: z.string().optional(),
  newClientOrderId: z.string().optional(),
  recvWindow: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (!value.orderId && !value.origClientOrderId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either orderId or origClientOrderId must be provided',
      path: ['orderId'],
    });
  }
});

export const cancelOrder = {
  name: 'cancelOrder',
  description:
    'Cancel a single authenticated MEXC Spot order by orderId or origClientOrderId.',
  inputSchema: cancelOrderSchema,
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.deleteAuth('/api/v3/order', input);
  },
};
