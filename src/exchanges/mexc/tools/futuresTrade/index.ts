import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mexcFuturesRestClient } from '../../rest/futures-client.js';

const decimalSchema = z.union([z.string(), z.number()]);
const idSchema = z.union([z.string(), z.number()]);
const sideSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const openTypeSchema = z.union([z.literal(1), z.literal(2)]);
const orderTypeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const triggerOrderTypeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const trendSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSymbol(value: unknown): string {
  return String(value).trim().toUpperCase();
}

function ensureExternalOid(input: Record<string, unknown>): string {
  const provided = typeof input.externalOid === 'string' ? input.externalOid.trim() : '';
  return provided || `cf${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function appendRequestMetadata(result: unknown, metadata: Record<string, unknown>): unknown {
  if (!isRecord(result)) {
    return result;
  }

  return {
    ...result,
    request: {
      ...(isRecord(result.request) ? result.request : {}),
      ...metadata,
    },
  };
}

const futuresLimitStyleTypes = new Set([1, 2, 3, 4]);

const createFuturesOrderSchema = z.object({
  symbol: z.string().min(1),
  price: decimalSchema.optional(),
  vol: decimalSchema,
  leverage: z.number().int().positive().optional(),
  side: sideSchema,
  type: orderTypeSchema,
  openType: openTypeSchema,
  positionId: idSchema.optional(),
  externalOid: z.string().max(32).optional(),
  stopLossPrice: decimalSchema.optional(),
  takeProfitPrice: decimalSchema.optional(),
  positionMode: z.union([z.literal(1), z.literal(2)]).optional(),
  reduceOnly: z.boolean().optional(),
  recvWindow: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (futuresLimitStyleTypes.has(value.type) && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: `price is required for futures order type ${value.type}`,
    });
  }
});

export const createFuturesOrder = {
  name: 'createFuturesOrder',
  description:
    'Create a real authenticated MEXC Futures order. An externalOid is auto-generated when omitted so the order can be cancelled later by external id.',
  inputSchema: createFuturesOrderSchema,
  handler: async (input: Record<string, unknown>) => {
    const externalOid = ensureExternalOid(input);
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    const { recvWindow: _recvWindow, ...rest } = input;
    const payload = {
      ...rest,
      symbol: normalizeSymbol(input.symbol),
      externalOid,
    };

    const result = await mexcFuturesRestClient.postAuth('/api/v1/private/order/create', payload, recvWindow);
    return appendRequestMetadata(result, { externalOid });
  },
};

export const cancelFuturesOrderByExternalId = {
  name: 'cancelFuturesOrderByExternalId',
  description:
    'Cancel one authenticated MEXC Futures order by symbol and externalOid. This is the most reliable targeted futures cancel path.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    externalOid: z.string().min(1).max(32),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    return mexcFuturesRestClient.postAuth(
      '/api/v1/private/order/cancel_with_external',
      {
        symbol: normalizeSymbol(input.symbol),
        externalOid: input.externalOid,
      },
      recvWindow,
    );
  },
};

export const cancelAllFuturesOrders = {
  name: 'cancelAllFuturesOrders',
  description:
    'Cancel all authenticated MEXC Futures active orders. If symbol is set, cancellation is limited to one contract.',
  inputSchema: z.object({
    symbol: z.string().min(1).optional(),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    const payload = input.symbol ? { symbol: normalizeSymbol(input.symbol) } : {};
    return mexcFuturesRestClient.postAuth('/api/v1/private/order/cancel_all', payload, recvWindow);
  },
};

export const cancelFuturesOrders = {
  name: 'cancelFuturesOrders',
  description:
    'Attempt to cancel specific authenticated MEXC Futures orders by orderId list. MEXC may reject documented payloads on some accounts; prefer cancelFuturesOrderByExternalId when possible.',
  inputSchema: z.object({
    orderIds: z.array(idSchema).min(1).max(50),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    const orderIds = Array.isArray(input.orderIds) ? input.orderIds.map((value) => String(value)) : [];
    return mexcFuturesRestClient.postAuth('/api/v1/private/order/cancel', orderIds, recvWindow);
  },
};

const createFuturesTriggerOrderSchema = z.object({
  symbol: z.string().min(1),
  price: decimalSchema.optional(),
  vol: decimalSchema,
  leverage: z.number().int().positive().optional(),
  side: sideSchema,
  openType: openTypeSchema,
  triggerPrice: decimalSchema,
  triggerType: z.union([z.literal(1), z.literal(2)]),
  executeCycle: z.union([z.literal(1), z.literal(2)]),
  orderType: triggerOrderTypeSchema,
  trend: trendSchema,
  stopLossPrice: decimalSchema.optional(),
  takeProfitPrice: decimalSchema.optional(),
  positionMode: z.union([z.literal(1), z.literal(2)]).optional(),
  reduceOnly: z.boolean().optional(),
  recvWindow: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (futuresLimitStyleTypes.has(value.orderType) && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: `price is required for trigger order type ${value.orderType}`,
    });
  }
});

export const createFuturesTriggerOrder = {
  name: 'createFuturesTriggerOrder',
  description:
    'Create a real authenticated MEXC Futures trigger/plan order. Optional stopLossPrice and takeProfitPrice attach TP/SL to the triggered order.',
  inputSchema: createFuturesTriggerOrderSchema,
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    const { recvWindow: _recvWindow, ...rest } = input;
    return mexcFuturesRestClient.postAuth(
      '/api/v1/private/planorder/place',
      {
        ...rest,
        symbol: normalizeSymbol(input.symbol),
      },
      recvWindow,
    );
  },
};

export const cancelFuturesTriggerOrders = {
  name: 'cancelFuturesTriggerOrders',
  description:
    'Cancel specific authenticated MEXC Futures trigger/plan orders by symbol and orderId.',
  inputSchema: z.object({
    orders: z.array(z.object({
      symbol: z.string().min(1),
      orderId: idSchema,
    })).min(1).max(50),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    const orders = Array.isArray(input.orders)
      ? input.orders.map((order) => ({
          symbol: normalizeSymbol(order.symbol),
          orderId: String(order.orderId),
        }))
      : [];
    return mexcFuturesRestClient.postAuth('/api/v1/private/planorder/cancel', orders, recvWindow);
  },
};

export const cancelAllFuturesTriggerOrders = {
  name: 'cancelAllFuturesTriggerOrders',
  description:
    'Cancel all authenticated MEXC Futures trigger/plan orders. If symbol is set, cancellation is limited to one contract.',
  inputSchema: z.object({
    symbol: z.string().min(1).optional(),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    const payload = input.symbol ? { symbol: normalizeSymbol(input.symbol) } : {};
    return mexcFuturesRestClient.postAuth('/api/v1/private/planorder/cancel_all', payload, recvWindow);
  },
};

export const updateFuturesOrderTpSl = {
  name: 'updateFuturesOrderTpSl',
  description:
    'Update or clear take-profit and stop-loss prices on an existing authenticated MEXC Futures limit order.',
  inputSchema: z.object({
    orderId: idSchema,
    stopLossPrice: decimalSchema.optional(),
    takeProfitPrice: decimalSchema.optional(),
    recvWindow: z.number().int().positive().optional(),
  }).superRefine((value, ctx) => {
    if (value.stopLossPrice === undefined && value.takeProfitPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of stopLossPrice or takeProfitPrice must be provided',
      });
    }
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    return mexcFuturesRestClient.postAuth(
      '/api/v1/private/stoporder/change_price',
      {
        orderId: String(input.orderId),
        stopLossPrice: input.stopLossPrice,
        takeProfitPrice: input.takeProfitPrice,
      },
      recvWindow,
    );
  },
};

export const cancelFuturesStopOrders = {
  name: 'cancelFuturesStopOrders',
  description:
    'Cancel specific authenticated MEXC Futures stop-loss/take-profit orders by stopPlanOrderId.',
  inputSchema: z.object({
    stopPlanOrderIds: z.array(idSchema).min(1).max(50),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    const payload = Array.isArray(input.stopPlanOrderIds)
      ? input.stopPlanOrderIds.map((stopPlanOrderId) => ({ stopPlanOrderId: String(stopPlanOrderId) }))
      : [];
    return mexcFuturesRestClient.postAuth('/api/v1/private/stoporder/cancel', payload, recvWindow);
  },
};

export const cancelAllFuturesStopOrders = {
  name: 'cancelAllFuturesStopOrders',
  description:
    'Cancel all authenticated MEXC Futures stop-loss/take-profit orders. If positionId or symbol is set, cancellation is scoped accordingly.',
  inputSchema: z.object({
    positionId: idSchema.optional(),
    symbol: z.string().min(1).optional(),
    recvWindow: z.number().int().positive().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    return mexcFuturesRestClient.postAuth(
      '/api/v1/private/stoporder/cancel_all',
      {
        positionId: input.positionId !== undefined ? String(input.positionId) : undefined,
        symbol: input.symbol ? normalizeSymbol(input.symbol) : undefined,
      },
      recvWindow,
    );
  },
};

export const updateFuturesTriggerOrderTpSl = {
  name: 'updateFuturesTriggerOrderTpSl',
  description:
    'Update stopLossPrice and/or takeProfitPrice on an authenticated MEXC Futures stop-loss/take-profit plan order.',
  inputSchema: z.object({
    stopPlanOrderId: idSchema,
    stopLossPrice: decimalSchema.optional(),
    takeProfitPrice: decimalSchema.optional(),
    recvWindow: z.number().int().positive().optional(),
  }).superRefine((value, ctx) => {
    if (value.stopLossPrice === undefined && value.takeProfitPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of stopLossPrice or takeProfitPrice must be provided',
      });
    }
  }),
  handler: async (input: Record<string, unknown>) => {
    const recvWindow = typeof input.recvWindow === 'number' ? input.recvWindow : undefined;
    return mexcFuturesRestClient.postAuth(
      '/api/v1/private/stoporder/change_plan_price',
      {
        stopPlanOrderId: String(input.stopPlanOrderId),
        stopLossPrice: input.stopLossPrice,
        takeProfitPrice: input.takeProfitPrice,
      },
      recvWindow,
    );
  },
};

export const futuresTradeTools = [
  createFuturesOrder,
  cancelFuturesOrderByExternalId,
  cancelAllFuturesOrders,
  cancelFuturesOrders,
  createFuturesTriggerOrder,
  cancelFuturesTriggerOrders,
  cancelAllFuturesTriggerOrders,
  updateFuturesOrderTpSl,
  cancelFuturesStopOrders,
  cancelAllFuturesStopOrders,
  updateFuturesTriggerOrderTpSl,
];
