import { getExchangeInfo } from './getExchangeInfo.js';
import { getKlines } from './getKlines.js';
import { getOrderbook } from './getOrderbook.js';
import { getRecentTrades } from './getRecentTrades.js';
import { getServerTime } from './getServerTime.js';
import { getTickers } from './getTickers.js';
import { extendedMarketTools } from './extended.js';

export const marketTools = [
  getServerTime,
  getExchangeInfo,
  getTickers,
  getOrderbook,
  getRecentTrades,
  getKlines,
  ...extendedMarketTools,
];
