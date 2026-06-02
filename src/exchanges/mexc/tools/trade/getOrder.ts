import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

const getOrderSchema = z.object({
  symbol: z.string().min(1),
  orderId: z.union([z.string(), z.number()]).optional(),
  origClientOrderId: z.string().optional(),
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

export const getOrder = {
  name: 'getOrder',
  description:
    'Get the current status of one authenticated MEXC Spot order by orderId or origClientOrderId.',
  inputSchema: getOrderSchema,
  handler: async (input: Record<string, unknown>) => {
    return mexcSpotRestClient.getAuth('/api/v3/order', input);
  },
};
