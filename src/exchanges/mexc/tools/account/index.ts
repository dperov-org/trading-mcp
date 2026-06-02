import { getAccountInfo } from './getAccountInfo.js';
import { extendedAccountTools } from './extended.js';
import { getMyTrades } from './getMyTrades.js';
import { getOpenOrders } from './getOpenOrders.js';
import { getOrderHistory } from './getOrderHistory.js';
import { getWalletBalance } from './getWalletBalance.js';
import { queryApiPermissions } from './queryApiPermissions.js';

export const accountTools = [
  getAccountInfo,
  getWalletBalance,
  getOpenOrders,
  getOrderHistory,
  getMyTrades,
  queryApiPermissions,
  ...extendedAccountTools,
];
