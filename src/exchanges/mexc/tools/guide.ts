import { z } from 'zod';

export const getMexcCapabilityGuide = {
  name: 'getMexcCapabilityGuide',
  description:
    'Return a static guide for the authenticated MEXC MCP server. Use this first when the user explicitly asks about MEXC and you are unsure which MEXC tools to call. The guide maps common MEXC tasks to the exact Spot and Futures tool names available on this server.',
  inputSchema: z.object({}),
  handler: async () => ({
    exchange: 'MEXC',
    server: 'trading_mcp_mexc_local',
    routingRules: [
      'Use only tools from trading_mcp_mexc_local for MEXC requests.',
      'Do not use trading_mcp_bybit_local for MEXC requests.',
      'MEXC Spot and MEXC Futures are separate surfaces; choose futures tools for positions, trigger orders, stop orders, and perpetual contracts.',
      'If the user asks for "open orders" on MEXC without saying spot or futures, check both spot and futures surfaces before concluding that nothing is open.',
    ],
    spot: {
      marketData: [
        'getServerTime',
        'getExchangeInfo',
        'getTickers',
        'getOrderbook',
        'getRecentTrades',
        'getKlines',
        'getHistoricalTrades',
        'getAggregateTrades',
        'getAveragePrice',
        'getPriceTicker',
        'getBookTicker',
      ],
      account: [
        'getAccountInfo',
        'getWalletBalance',
        'getOpenOrders',
        'getAllOrders',
        'getOrderHistory',
        'getMyTrades',
        'queryApiPermissions',
        'getSelfSymbols',
        'getKycStatus',
      ],
      commonTasks: {
        currentBalances: ['getWalletBalance', 'getAccountInfo'],
        recentTradingHistory: ['getMyTrades', 'getOrderHistory', 'getAllOrders'],
        openSpotOrders: ['getOpenOrders'],
      },
    },
    futures: {
      marketData: [
        'getFuturesContracts',
        'getFuturesTicker',
        'getFuturesOrderbook',
        'getFuturesKlines',
        'getFuturesIndexPrice',
        'getFuturesFairPrice',
        'getFuturesFundingRate',
      ],
      account: [
        'getFuturesAssets',
        'getFuturesAsset',
        'getFuturesOpenPositions',
        'getFuturesOpenOrders',
        'getFuturesOrderHistory',
        'getFuturesOrderDeals',
        'getFuturesStopOrders',
        'getFuturesTriggerOrders',
      ],
      commonTasks: {
        openPositions: ['getFuturesOpenPositions'],
        activeFuturesOrders: ['getFuturesOpenOrders'],
        triggerPlanOrders: ['getFuturesTriggerOrders'],
        tpSlOrders: ['getFuturesStopOrders'],
        fillsAndTradeHistory: ['getFuturesOrderDeals', 'getFuturesOrderHistory'],
      },
    },
    recommendationFlow: [
      'For a generic MEXC trading review, start with getWalletBalance, getMyTrades, getOrderHistory, getFuturesOpenPositions, getFuturesOrderDeals, getFuturesOrderHistory, getFuturesOpenOrders, getFuturesTriggerOrders, and getFuturesStopOrders as relevant.',
      'If the user mentions trigger orders, plan orders, TP, SL, or positions, prioritize the Futures tools.',
      'If the user mentions BTC/USDT price or market quote only, use Spot getTickers/getOrderbook unless they explicitly ask about futures.',
    ],
  }),
};
