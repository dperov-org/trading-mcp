import { subscribeOrderbook } from './subscribeOrderbook.js';
import { subscribeTickers } from './subscribeTickers.js';
import { subscribeTrades } from './subscribeTrades.js';

export const websocketTools = [
  subscribeTickers,
  subscribeOrderbook,
  subscribeTrades,
];
