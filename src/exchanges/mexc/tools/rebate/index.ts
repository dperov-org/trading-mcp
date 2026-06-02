import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

const rebateQuerySchema = z.object({
  startTime: z.number().int().optional(),
  endTime: z.number().int().optional(),
  page: z.number().int().positive().optional(),
  pageNum: z.number().int().positive().optional(),
  size: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  recvWindow: z.number().int().positive().optional(),
}).passthrough();

function authGet(path: string) {
  return async (input: Record<string, unknown>) => mexcSpotRestClient.getAuth(path, input);
}

export const getAffiliateCampaigns = {
  name: 'getAffiliateCampaigns',
  description: 'Get authenticated MEXC affiliate campaign statistics.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/affiliate/campaign'),
};

export const getAffiliateCommission = {
  name: 'getAffiliateCommission',
  description: 'Get authenticated MEXC affiliate commission summary.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/affiliate/commission'),
};

export const getAffiliateCommissionDetails = {
  name: 'getAffiliateCommissionDetails',
  description: 'Get authenticated MEXC affiliate commission details.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/affiliate/commission/detail'),
};

export const getAffiliateReferrals = {
  name: 'getAffiliateReferrals',
  description: 'Get authenticated MEXC affiliate referral records.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/affiliate/referral'),
};

export const getAffiliateSubAffiliates = {
  name: 'getAffiliateSubAffiliates',
  description: 'Get authenticated MEXC affiliate sub-affiliate records.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/affiliate/subaffiliates'),
};

export const getAffiliateWithdrawHistory = {
  name: 'getAffiliateWithdrawHistory',
  description: 'Get authenticated MEXC affiliate withdrawal history.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/affiliate/withdraw'),
};

export const getRebateDetails = {
  name: 'getRebateDetails',
  description: 'Get authenticated MEXC rebate detail records.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/detail'),
};

export const getRebateKickbackDetails = {
  name: 'getRebateKickbackDetails',
  description: 'Get authenticated MEXC kickback rebate detail records.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/detail/kickback'),
};

export const getRebateReferCode = {
  name: 'getRebateReferCode',
  description: 'Get the authenticated MEXC rebate referral code configuration.',
  inputSchema: z.object({
    recvWindow: z.number().int().positive().optional(),
  }).passthrough(),
  handler: authGet('/api/v3/rebate/referCode'),
};

export const getRebateTaxRecords = {
  name: 'getRebateTaxRecords',
  description: 'Get authenticated MEXC rebate tax records.',
  inputSchema: rebateQuerySchema,
  handler: authGet('/api/v3/rebate/taxQuery'),
};

export const rebateTools = [
  getAffiliateCampaigns,
  getAffiliateCommission,
  getAffiliateCommissionDetails,
  getAffiliateReferrals,
  getAffiliateSubAffiliates,
  getAffiliateWithdrawHistory,
  getRebateDetails,
  getRebateKickbackDetails,
  getRebateReferCode,
  getRebateTaxRecords,
];
