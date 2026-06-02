import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getAccountInfo = {
  name: 'getAccountInfo',
  description:
    'Get authenticated MEXC Spot account information, including permissions and balances.',
  inputSchema: z.object({
    omitZeroBalances: z.boolean().optional(),
  }),
  handler: async (input: Record<string, unknown>) => {
    const { omitZeroBalances = false } = input as { omitZeroBalances?: boolean };
    const account = await mexcSpotRestClient.getAuth('/api/v3/account');

    if (!omitZeroBalances || !account || typeof account !== 'object' || !('balances' in account)) {
      return account;
    }

    const balances = Array.isArray((account as { balances?: unknown }).balances)
      ? (account as { balances: Array<Record<string, unknown>> }).balances.filter((balance) => {
          const free = Number.parseFloat(String(balance.free ?? '0'));
          const locked = Number.parseFloat(String(balance.locked ?? '0'));
          return free !== 0 || locked !== 0;
        })
      : [];

    return {
      ...account,
      balances,
    };
  },
};
