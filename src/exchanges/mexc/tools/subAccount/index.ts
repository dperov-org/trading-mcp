import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

const historySchema = z.object({
  startTime: z.number().int().optional(),
  endTime: z.number().int().optional(),
  page: z.number().int().positive().optional(),
  pageNum: z.number().int().positive().optional(),
  size: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  recvWindow: z.number().int().positive().optional(),
}).passthrough();

export const getSubAccounts = {
  name: 'getSubAccounts',
  description: 'Get the authenticated MEXC sub-account list for a master account.',
  inputSchema: z.object({}).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/sub-account/list', input),
};

export const getSubAccountApiKeys = {
  name: 'getSubAccountApiKeys',
  description: 'Get API keys for one authenticated MEXC sub-account.',
  inputSchema: z.object({
    subAccount: z.string().min(1),
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/sub-account/apiKey', input),
};

export const getUniversalTransferHistory = {
  name: 'getUniversalTransferHistory',
  description: 'Get MEXC sub-account universal transfer history.',
  inputSchema: historySchema.extend({
    fromAccount: z.string().optional(),
    toAccount: z.string().optional(),
    fromAccountType: z.string().optional(),
    toAccountType: z.string().optional(),
    asset: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/sub-account/universalTransfer', input),
};

export const getSubAccountAsset = {
  name: 'getSubAccountAsset',
  description: 'Get authenticated MEXC asset balances for one sub-account.',
  inputSchema: z.object({
    subAccount: z.string().min(1),
    accountType: z.enum(['SPOT', 'FUTURES']).default('SPOT').optional(),
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/sub-account/asset', input),
};

export const subAccountTools = [
  getSubAccounts,
  getSubAccountApiKeys,
  getUniversalTransferHistory,
  getSubAccountAsset,
];
