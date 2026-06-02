import type { ToolDefinition } from '../../../core/tool-runtime/types.js';
import { accountTools } from './account/index.js';
import { capitalTools } from './capital/index.js';
import { futuresAccountTools } from './futuresAccount/index.js';
import { futuresMarketTools } from './futuresMarket/index.js';
import { futuresTradeTools } from './futuresTrade/index.js';
import { getMexcCapabilityGuide, getMexcTradingReviewSnapshot } from './guide.js';
import { marketTools } from './market/index.js';
import { rebateTools } from './rebate/index.js';
import { subAccountTools } from './subAccount/index.js';
import { tradeTools } from './trade/index.js';
import { websocketTools } from './websocket/index.js';

export const mexcSpotTools: ToolDefinition[] = [
  getMexcTradingReviewSnapshot,
  getMexcCapabilityGuide,
  ...marketTools,
  ...accountTools,
  ...capitalTools,
  ...subAccountTools,
  ...rebateTools,
  ...tradeTools,
  ...websocketTools,
];

export const mexcFuturesTools: ToolDefinition[] = [
  ...futuresMarketTools,
  ...futuresAccountTools,
  ...futuresTradeTools,
];

export const mexcTools: ToolDefinition[] = [
  ...mexcSpotTools,
  ...mexcFuturesTools,
];
