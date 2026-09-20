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

const mexcWriteToolNames = new Set([
  'createTestOrder',
  'createOrder',
  'cancelOrder',
  'cancelAllOrders',
  'createFuturesOrder',
  'cancelFuturesOrderByExternalId',
  'cancelAllFuturesOrders',
  'cancelFuturesOrders',
  'createFuturesTriggerOrder',
  'cancelFuturesTriggerOrders',
  'cancelAllFuturesTriggerOrders',
  'updateFuturesOrderTpSl',
  'cancelFuturesStopOrders',
  'cancelAllFuturesStopOrders',
  'updateFuturesTriggerOrderTpSl',
]);

function classifyMexcTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => ({
    ...tool,
    operation: mexcWriteToolNames.has(tool.name) ? 'write' : 'read',
  }));
}

export const mexcSpotTools: ToolDefinition[] = classifyMexcTools([
  getMexcTradingReviewSnapshot,
  getMexcCapabilityGuide,
  ...marketTools,
  ...accountTools,
  ...capitalTools,
  ...subAccountTools,
  ...rebateTools,
  ...tradeTools,
  ...websocketTools,
]);

export const mexcFuturesTools: ToolDefinition[] = classifyMexcTools([
  ...futuresMarketTools,
  ...futuresAccountTools,
  ...futuresTradeTools,
]);

export const mexcTools: ToolDefinition[] = [
  ...mexcSpotTools,
  ...mexcFuturesTools,
];
