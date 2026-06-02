import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const queryApiPermissions = {
  name: 'queryApiPermissions',
  description:
    'Get the authenticated MEXC Spot account permission flags inferred from the account information endpoint.',
  inputSchema: z.object({}),
  handler: async () => {
    const account = await mexcSpotRestClient.getAuth('/api/v3/account');
    if (!account || typeof account !== 'object') {
      return account;
    }

    const typed = account as Record<string, unknown>;
    return {
      canTrade: typed.canTrade ?? null,
      canWithdraw: typed.canWithdraw ?? null,
      canDeposit: typed.canDeposit ?? null,
      accountType: 'SPOT',
      raw: account,
    };
  },
};
