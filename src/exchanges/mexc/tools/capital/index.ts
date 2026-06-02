import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

const paginationSchema = z.object({
  page: z.number().int().positive().optional(),
  pageNum: z.number().int().positive().optional(),
  size: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  startTime: z.number().int().optional(),
  endTime: z.number().int().optional(),
  recvWindow: z.number().int().positive().optional(),
}).passthrough();

export const getCapitalConfig = {
  name: 'getCapitalConfig',
  description: 'Get the authenticated MEXC capital config including deposit and withdraw network metadata.',
  inputSchema: z.object({}),
  handler: async () => mexcSpotRestClient.getAuth('/api/v3/capital/config/getall'),
};

export const getDepositAddress = {
  name: 'getDepositAddress',
  description: 'Get deposit addresses for one MEXC Spot coin and optional network.',
  inputSchema: z.object({
    coin: z.string().min(1),
    network: z.string().optional(),
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/deposit/address', input),
};

export const getDepositHistory = {
  name: 'getDepositHistory',
  description: 'Get authenticated MEXC Spot deposit history.',
  inputSchema: paginationSchema.extend({
    coin: z.string().optional(),
    status: z.number().int().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/deposit/hisrec', input),
};

export const getWithdrawAddress = {
  name: 'getWithdrawAddress',
  description: 'Get saved withdrawal addresses for one MEXC Spot coin.',
  inputSchema: z.object({
    coin: z.string().min(1),
    network: z.string().optional(),
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/withdraw/address', input),
};

export const getWithdrawHistory = {
  name: 'getWithdrawHistory',
  description: 'Get authenticated MEXC Spot withdrawal history.',
  inputSchema: paginationSchema.extend({
    coin: z.string().optional(),
    withdrawOrderId: z.string().optional(),
    status: z.number().int().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/withdraw/history', input),
};

export const getTransferHistory = {
  name: 'getTransferHistory',
  description: 'Get MEXC account transfer history between wallet/account types.',
  inputSchema: paginationSchema.extend({
    fromAccountType: z.string().min(1),
    toAccountType: z.string().min(1),
    asset: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/transfer', input),
};

export const getTransferById = {
  name: 'getTransferById',
  description: 'Get one authenticated MEXC transfer record by tranId.',
  inputSchema: z.object({
    tranId: z.string().min(1),
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/transfer/tranId', input),
};

export const getConvertibleAssets = {
  name: 'getConvertibleAssets',
  description: 'Get authenticated MEXC Spot assets that can be converted.',
  inputSchema: z.object({
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/convert/list', input),
};

export const getConvertHistory = {
  name: 'getConvertHistory',
  description: 'Get authenticated MEXC Spot convert history.',
  inputSchema: paginationSchema,
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/convert', input),
};

export const getInternalTransferHistory = {
  name: 'getInternalTransferHistory',
  description: 'Get authenticated MEXC internal transfer history.',
  inputSchema: paginationSchema.extend({
    asset: z.string().optional(),
    fromAccount: z.string().optional(),
    toAccount: z.string().optional(),
  }),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/capital/transfer/internal', input),
};

export const capitalTools = [
  getCapitalConfig,
  getDepositAddress,
  getDepositHistory,
  getWithdrawAddress,
  getWithdrawHistory,
  getTransferHistory,
  getTransferById,
  getConvertibleAssets,
  getConvertHistory,
  getInternalTransferHistory,
];
