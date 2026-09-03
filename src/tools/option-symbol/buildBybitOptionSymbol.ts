import { z } from 'zod';
import { buildBybitOptionSymbolValue } from '../../lib/bybit-option-symbol.js';

export const buildBybitOptionSymbol = {
  name: 'buildBybitOptionSymbol',
  description: `Build one canonical Bybit option symbol from structured fields. Use this tool — never assemble an option symbol yourself — before querying or discussing a contract specified by expiry, strike, call/put, and settlement coin. expiry must be YYYY-MM-DD; the output uses Bybit's variable-width day format, for example 2026-09-03 becomes 3SEP26.

Building a symbol does not prove that the contract exists. Immediately verify the returned symbol with getInstrumentsInfo using category=option and symbol=<symbol>; use Bybit's deliveryTime and status as the authority.

Agent instruction: Do not add a leading zero to the day, infer listing availability from the constructed text, or report a missing expiry without a successful exact Bybit lookup.`,
  inputSchema: z.object({
    baseCoin: z.string().min(1).describe('Underlying coin, for example BTC.'),
    expiry: z.string().describe('Expiry date in YYYY-MM-DD format, for example 2026-09-03.'),
    strike: z.string().min(1).describe('Positive decimal strike without a leading zero, for example 73000.'),
    optionType: z.enum(['C', 'P', 'Call', 'Put']).describe('Call or put, as C/P or Call/Put.'),
    settleCoin: z.string().min(1).default('USDT').describe('Settlement coin, normally USDT.'),
  }),
  handler: async (input: Record<string, unknown>) => {
    return buildBybitOptionSymbolValue({
      baseCoin: input.baseCoin as string,
      expiry: input.expiry as string,
      strike: input.strike as string,
      optionType: input.optionType as 'C' | 'P' | 'Call' | 'Put',
      settleCoin: input.settleCoin as string,
    });
  },
};
