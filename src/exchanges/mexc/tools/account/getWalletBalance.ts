import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

function normalizeCoins(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export const getWalletBalance = {
  name: 'getWalletBalance',
  description:
    'Get MEXC Spot wallet balances, optionally filtered to specific assets and optionally hiding zero balances.',
  inputSchema: z.object({
    coins: z.union([z.string(), z.array(z.string())]).optional(),
    omitZeroBalances: z.boolean().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const account = await mexcSpotRestClient.getAuth('/api/v3/account');
    if (!account || typeof account !== 'object' || !('balances' in account)) {
      return account;
    }

    const coins = new Set(normalizeCoins(input.coins).map((coin) => coin.toUpperCase()));
    const omitZeroBalances = input.omitZeroBalances === true;
    const balances = Array.isArray((account as { balances?: unknown }).balances)
      ? (account as { balances: Array<Record<string, unknown>> }).balances.filter((balance) => {
          const asset = String(balance.asset ?? '').toUpperCase();
          if (coins.size > 0 && !coins.has(asset)) {
            return false;
          }

          if (!omitZeroBalances) {
            return true;
          }

          const free = Number.parseFloat(String(balance.free ?? '0'));
          const locked = Number.parseFloat(String(balance.locked ?? '0'));
          return free !== 0 || locked !== 0;
        })
      : [];

    return {
      balances,
      updateTime: (account as { updateTime?: unknown }).updateTime ?? null,
      accountType: 'SPOT',
    };
  },
};
