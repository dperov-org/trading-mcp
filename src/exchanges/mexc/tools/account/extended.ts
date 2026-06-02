import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getAllOrders = {
  name: 'getAllOrders',
  description: 'Get authenticated MEXC Spot order history for one symbol using the allOrders endpoint.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    orderId: z.union([z.string(), z.number()]).optional(),
    startTime: z.number().int().optional(),
    endTime: z.number().int().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }).passthrough(),
  handler: async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth('/api/v3/allOrders', input),
};

export const getSelfSymbols = {
  name: 'getSelfSymbols',
  description: 'Get the authenticated MEXC Spot self-selected symbols list.',
  inputSchema: z.object({}),
  handler: async () => mexcSpotRestClient.getAuth('/api/v3/selfSymbols'),
};

export const getKycStatus = {
  name: 'getKycStatus',
  description: 'Get the authenticated MEXC account KYC status.',
  inputSchema: z.object({}),
  handler: async () => mexcSpotRestClient.getAuth('/api/v3/kyc/status'),
};

export const extendedAccountTools = [
  getAllOrders,
  getSelfSymbols,
  getKycStatus,
];
