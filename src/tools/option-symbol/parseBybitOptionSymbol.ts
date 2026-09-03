import { z } from 'zod';
import { parseBybitOptionSymbolValue } from '../../lib/bybit-option-symbol.js';

export const parseBybitOptionSymbol = {
  name: 'parseBybitOptionSymbol',
  description: `Parse a Bybit option symbol into structured, validated fields. Use this tool — never parse, pad, or normalize an option symbol yourself — whenever a user supplies or refers to a Bybit option symbol. The canonical format is BASE-DMMMYY-STRIKE-C|P-SETTLE: its expiry day has one or two digits with no leading zero, so BTC-3SEP26-73000-P-USDT is valid while a two-digit-only assumption is wrong.

The output is syntax validation only; it does not prove that the contract is currently listed. To verify availability, pass the returned canonical symbol unchanged to getInstrumentsInfo with category=option and symbol=<symbol>, then use deliveryTime and status from Bybit as the authority.

Agent instruction: Do not claim that a symbol or expiry is unavailable based on your own text parsing, an inferred date, or a partial contract list.`,
  inputSchema: z.object({
    symbol: z.string().min(1).describe('Exact Bybit option symbol supplied by the user.'),
  }),
  handler: async (input: Record<string, unknown>) => {
    return parseBybitOptionSymbolValue(input.symbol as string);
  },
};
