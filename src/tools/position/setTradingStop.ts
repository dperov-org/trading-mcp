// setTradingStop.ts — auto-generated, do not edit
import { z } from 'zod';
import { restClient } from '../../client/rest-client.js';

export const setTradingStop = {
  name: 'setTradingStop',
  description: "Configure trading stop parameters including take profit, stop loss, and trailing stop.\nSupports both full position and partial position TP/SL modes.\nOptions support full-position market TP/SL only.\n\nAgent hint: Use this to set TP/SL/trailing stop on an open position. Set tpslMode to Full for entire position or Partial for partial.\nIn Partial mode, tpSize and slSize must be equal. For options, use tpslMode=Full and market TP/SL only. Set any value to \"0\" to cancel it.\npositionIdx is required: 0 for one-way mode, 1 for buy hedge, 2 for sell hedge.",
  inputSchema: z.object({
    category: z.enum(["linear", "inverse", "option"]),
    symbol: z.string(),
    takeProfit: z.string().optional(),
    stopLoss: z.string().optional(),
    trailingStop: z.string().optional(),
    tpTriggerBy: z.enum(["MarkPrice", "IndexPrice", "LastPrice"]).optional(),
    slTriggerBy: z.enum(["MarkPrice", "IndexPrice", "LastPrice"]).optional(),
    activePrice: z.string().optional(),
    tpslMode: z.enum(["Full", "Partial"]),
    tpSize: z.string().optional(),
    slSize: z.string().optional(),
    tpLimitPrice: z.string().optional(),
    slLimitPrice: z.string().optional(),
    tpOrderType: z.enum(["Market", "Limit"]).optional(),
    slOrderType: z.enum(["Market", "Limit"]).optional(),
    positionIdx: z.enum(["0", "1", "2"]),
  }).superRefine((input, ctx) => {
    if (input.category !== "option") {
      return;
    }

    if (input.tpslMode !== "Full") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tpslMode"],
        message: "Options support tpslMode=Full only.",
      });
    }

    if (input.tpOrderType === "Limit") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tpOrderType"],
        message: "Options support market take-profit orders only.",
      });
    }

    if (input.slOrderType === "Limit") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slOrderType"],
        message: "Options support market stop-loss orders only.",
      });
    }
  }),
  handler: async (input: Record<string, unknown>) => {
    return restClient.postAuth("/v5/position/trading-stop", input);
  },
};
