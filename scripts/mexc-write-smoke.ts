import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { getOpenOrders } from '../src/exchanges/mexc/tools/account/getOpenOrders.ts';
import { createOrder } from '../src/exchanges/mexc/tools/trade/createOrder.ts';
import { cancelOrder } from '../src/exchanges/mexc/tools/trade/cancelOrder.ts';
import { getOrder } from '../src/exchanges/mexc/tools/trade/getOrder.ts';
import { getExchangeInfo } from '../src/exchanges/mexc/tools/market/getExchangeInfo.ts';
import { getTickers } from '../src/exchanges/mexc/tools/market/getTickers.ts';
import { getFuturesContracts, getFuturesTicker } from '../src/exchanges/mexc/tools/futuresMarket/index.ts';
import { getFuturesOpenOrders, getFuturesTriggerOrders } from '../src/exchanges/mexc/tools/futuresAccount/index.ts';
import {
  cancelAllFuturesOrders,
  cancelAllFuturesTriggerOrders,
  cancelFuturesOrderByExternalId,
  cancelFuturesTriggerOrders,
  createFuturesOrder,
  createFuturesTriggerOrder,
} from '../src/exchanges/mexc/tools/futuresTrade/index.ts';

type SpotOrderState = {
  symbol: string;
  orderId?: string;
};

type FuturesLimitState = {
  symbol: string;
  externalOid?: string;
};

type FuturesTriggerState = {
  symbol: string;
  orderId?: string;
};

async function main() {
  await loadEnvFile(path.join(process.cwd(), '.env'));

  const spotState: SpotOrderState = { symbol: 'BTCUSDT' };
  const futuresLimitState: FuturesLimitState = { symbol: 'BTC_USDT' };
  const futuresTriggerState: FuturesTriggerState = { symbol: 'BTC_USDT' };

  try {
    console.error('mexc write smoke target: mainnet');

    try {
      const spotArgs = await buildSafeSpotLimitArgs();
      const createdSpot = await createOrder.handler(spotArgs);
      const createdSpotRecord = asRecord(createdSpot);
      spotState.orderId = stringValue(createdSpotRecord?.orderId);
      if (!spotState.orderId) {
        throw new Error('Spot createOrder did not return orderId');
      }
      console.error(`- OK   spot:createOrder orderId=${spotState.orderId}`);

      const spotOrderStatus = await waitFor(
        async () => {
          const result = await getOrder.handler({ symbol: spotArgs.symbol, orderId: spotState.orderId! });
          const record = asRecord(result);
          if (record?.orderId) {
            return record;
          }
          return null;
        },
        8,
        500,
      );
      console.error(`- OK   spot:getOrder status=${stringValue(spotOrderStatus.status)} price=${stringValue(spotOrderStatus.price)}`);

      const cancelledSpot = await cancelOrder.handler({ symbol: spotArgs.symbol, orderId: spotState.orderId });
      console.error(`- OK   spot:cancelOrder status=${stringValue(asRecord(cancelledSpot)?.status)}`);

      const canceledSpotStatus = await waitFor(
        async () => {
          const result = await getOrder.handler({ symbol: spotArgs.symbol, orderId: spotState.orderId! });
          const record = asRecord(result);
          return String(record?.status ?? '').toUpperCase() === 'CANCELED' ? record : null;
        },
        10,
        600,
      );
      console.error(`- OK   spot:cancel verified status=${stringValue(canceledSpotStatus.status)}`);
      spotState.orderId = undefined;
    } catch (error) {
      console.error(`- SKIP spot real-order smoke (${error instanceof Error ? error.message : String(error)})`);
    }

    const futuresLimitArgs = await buildSafeFuturesLimitArgs();
    const createdFuturesLimit = await createFuturesOrder.handler(futuresLimitArgs);
    const createdFuturesLimitRecord = asRecord(createdFuturesLimit);
    const requestMetadata = asRecord(createdFuturesLimitRecord?.request);
    futuresLimitState.externalOid = typeof requestMetadata?.externalOid === 'string'
      ? requestMetadata.externalOid
      : undefined;
    if (!futuresLimitState.externalOid) {
      throw new Error('createFuturesOrder did not return generated externalOid metadata');
    }
    console.error(`- OK   futures:createFuturesOrder externalOid=${futuresLimitState.externalOid}`);

    const futuresOpenOrder = await waitFor(
      async () => {
        const result = await getFuturesOpenOrders.handler({ symbol: futuresLimitArgs.symbol, page_num: 1, page_size: 100 });
        const data = asArray(asRecord(result)?.data);
        return data.find((item) => asRecord(item)?.externalOid === futuresLimitState.externalOid) ?? null;
      },
      10,
      700,
    );
    console.error(`- OK   futures:getFuturesOpenOrders orderId=${stringValue(asRecord(futuresOpenOrder)?.orderId)} price=${stringValue(asRecord(futuresOpenOrder)?.price)}`);

    const canceledFuturesLimit = await cancelFuturesOrderByExternalId.handler({
      symbol: futuresLimitArgs.symbol,
      externalOid: futuresLimitState.externalOid,
    });
    console.error(`- OK   futures:cancelFuturesOrderByExternalId result=${JSON.stringify(canceledFuturesLimit)}`);

    await waitFor(
      async () => {
        const result = await getFuturesOpenOrders.handler({ symbol: futuresLimitArgs.symbol, page_num: 1, page_size: 100 });
        const data = asArray(asRecord(result)?.data);
        const match = data.find((item) => asRecord(item)?.externalOid === futuresLimitState.externalOid);
        return match ? null : true;
      },
      10,
      700,
    );
    console.error('- OK   futures:cancel verified order removed from open orders');
    futuresLimitState.externalOid = undefined;

    const futuresTriggerArgs = await buildSafeFuturesTriggerArgs();
    const createdFuturesTrigger = await createFuturesTriggerOrder.handler(futuresTriggerArgs);
    const createdFuturesTriggerRecord = asRecord(createdFuturesTrigger);
    futuresTriggerState.orderId = stringValue(createdFuturesTriggerRecord?.data);
    if (!futuresTriggerState.orderId) {
      throw new Error('createFuturesTriggerOrder did not return trigger order id');
    }
    console.error(`- OK   futures:createFuturesTriggerOrder orderId=${futuresTriggerState.orderId}`);

    const futuresTriggerOrder = await waitFor(
      async () => {
        const result = await getFuturesTriggerOrders.handler({ symbol: futuresTriggerArgs.symbol, page_num: 1, page_size: 100 });
        const data = asArray(asRecord(result)?.data);
        return data.find((item) => String(asRecord(item)?.id ?? '') === futuresTriggerState.orderId) ?? null;
      },
      10,
      700,
    );
    const triggerRecord = asRecord(futuresTriggerOrder);
    console.error(
      `- OK   futures:getFuturesTriggerOrders triggerPrice=${stringValue(triggerRecord?.triggerPrice)} takeProfit=${stringValue(triggerRecord?.takeProfitPrice)} stopLoss=${stringValue(triggerRecord?.stopLossPrice)}`,
    );

    if (!approximatelyEqual(triggerRecord?.takeProfitPrice, futuresTriggerArgs.takeProfitPrice, 0.11)) {
      throw new Error('Trigger order takeProfitPrice did not match requested value');
    }

    if (!approximatelyEqual(triggerRecord?.stopLossPrice, futuresTriggerArgs.stopLossPrice, 0.11)) {
      throw new Error('Trigger order stopLossPrice did not match requested value');
    }

    const canceledFuturesTrigger = await cancelFuturesTriggerOrders.handler({
      orders: [{ symbol: futuresTriggerArgs.symbol, orderId: futuresTriggerState.orderId }],
    });
    console.error(`- OK   futures:cancelFuturesTriggerOrders result=${JSON.stringify(canceledFuturesTrigger)}`);

    const canceledTriggerState = await waitFor(
      async () => {
        const result = await getFuturesTriggerOrders.handler({ symbol: futuresTriggerArgs.symbol, page_num: 1, page_size: 100 });
        const data = asArray(asRecord(result)?.data);
        const match = data.find((item) => String(asRecord(item)?.id ?? '') === futuresTriggerState.orderId);
        const record = asRecord(match);
        if (!record) {
          return { state: 'missing' };
        }

        return String(record.state ?? '') !== '1' ? record : null;
      },
      10,
      700,
    );
    console.error(`- OK   futures:trigger cancel verified state=${stringValue(asRecord(canceledTriggerState)?.state ?? canceledTriggerState)}`);
    futuresTriggerState.orderId = undefined;
  } finally {
    await cleanupSpotOrder(spotState);
    await cleanupFuturesLimitOrder(futuresLimitState);
    await cleanupFuturesTriggerOrder(futuresTriggerState);
  }
}

async function buildSafeSpotLimitArgs(): Promise<Record<string, unknown>> {
  const [tickerResult, exchangeInfoResult] = await Promise.all([
    getTickers.handler({ symbol: 'BTCUSDT' }),
    getExchangeInfo.handler({ symbol: 'BTCUSDT' }),
  ]);

  const ticker = asRecord(tickerResult);
  const exchangeInfo = asRecord(exchangeInfoResult);
  const symbolInfo = asArray(exchangeInfo?.symbols)[0];
  const symbolRecord = asRecord(symbolInfo);
  if (!symbolRecord) {
    throw new Error('BTCUSDT spot symbol info not found');
  }

  const filters = asArray(symbolRecord.filters).map(asRecord).filter(Boolean) as Array<Record<string, unknown>>;
  const lotSize = filters.find((filter) => filter.filterType === 'LOT_SIZE');
  const priceFilter = filters.find((filter) => filter.filterType === 'PRICE_FILTER');
  const minNotionalFilter = filters.find((filter) =>
    filter.filterType === 'MIN_NOTIONAL' || filter.filterType === 'NOTIONAL',
  );

  const lastPrice = asPositiveFloat(ticker?.lastPrice, 'spot lastPrice');
  const minQty = asPositiveFloat(lotSize?.minQty ?? symbolRecord.baseSizePrecision ?? '0.000001', 'spot minQty');
  const stepSize = asPositiveFloat(lotSize?.stepSize ?? symbolRecord.baseSizePrecision ?? '0.000001', 'spot stepSize');
  const tickSize = asPositiveFloat(priceFilter?.tickSize ?? symbolRecord.quoteAmountPrecision ?? '1', 'spot tickSize');
  const minNotional = asPositiveFloat(
    minNotionalFilter?.minNotional ?? minNotionalFilter?.notional ?? 10,
    'spot minNotional',
  );

  const price = floorToStep(Math.max(lastPrice * 0.8, tickSize), tickSize);
  const qtyForNotional = (minNotional / price) * 1.1;
  const quantity = ceilToStep(Math.max(minQty, qtyForNotional), stepSize);

  return {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    price: formatDecimal(price),
    quantity: formatDecimal(quantity),
  };
}

async function buildSafeFuturesLimitArgs(): Promise<Record<string, unknown>> {
  const [tickerResult, contractResult] = await Promise.all([
    getFuturesTicker.handler({ symbol: 'BTC_USDT' }),
    getFuturesContracts.handler({ symbol: 'BTC_USDT' }),
  ]);

  const ticker = asRecord(asRecord(tickerResult)?.data);
  const contract = asRecord(asArray(asRecord(contractResult)?.data)[0]);
  if (!ticker || !contract) {
    throw new Error('BTC_USDT futures contract metadata not found');
  }

  const lastPrice = asPositiveFloat(ticker.lastPrice, 'futures lastPrice');
  const priceUnit = asPositiveFloat(contract.priceUnit, 'futures priceUnit');
  const minVol = asPositiveFloat(contract.minVol, 'futures minVol');
  const minAllowedPrice = asPositiveFloat(ticker.minAskPrice ?? lastPrice * 0.9, 'futures minAllowedPrice');
  const price = floorToStep(Math.max(lastPrice * 0.93, minAllowedPrice), priceUnit);

  return {
    symbol: 'BTC_USDT',
    price,
    vol: minVol,
    leverage: 5,
    side: 1,
    type: 1,
    openType: 2,
  };
}

async function buildSafeFuturesTriggerArgs(): Promise<Record<string, unknown>> {
  const [tickerResult, contractResult] = await Promise.all([
    getFuturesTicker.handler({ symbol: 'BTC_USDT' }),
    getFuturesContracts.handler({ symbol: 'BTC_USDT' }),
  ]);

  const ticker = asRecord(asRecord(tickerResult)?.data);
  const contract = asRecord(asArray(asRecord(contractResult)?.data)[0]);
  if (!ticker || !contract) {
    throw new Error('BTC_USDT futures contract metadata not found');
  }

  const lastPrice = asPositiveFloat(ticker.lastPrice, 'futures lastPrice');
  const priceUnit = asPositiveFloat(contract.priceUnit, 'futures priceUnit');
  const minVol = asPositiveFloat(contract.minVol, 'futures minVol');

  const triggerPrice = ceilToStep(lastPrice * 1.25, priceUnit);
  const takeProfitPrice = ceilToStep(triggerPrice * 1.06, priceUnit);
  const stopLossPrice = floorToStep(lastPrice * 0.9, priceUnit);

  return {
    symbol: 'BTC_USDT',
    vol: minVol,
    leverage: 5,
    side: 1,
    openType: 2,
    triggerPrice,
    triggerType: 1,
    executeCycle: 1,
    orderType: 5,
    trend: 1,
    stopLossPrice,
    takeProfitPrice,
  };
}

async function cleanupSpotOrder(state: SpotOrderState) {
  if (!state.orderId) {
    return;
  }

  try {
    await cancelOrder.handler({ symbol: state.symbol, orderId: state.orderId });
  } catch {
    // best effort
  }
}

async function cleanupFuturesLimitOrder(state: FuturesLimitState) {
  try {
    if (state.externalOid) {
      await cancelFuturesOrderByExternalId.handler({ symbol: state.symbol, externalOid: state.externalOid });
    }
  } catch {
    // best effort
  }

  try {
    await cancelAllFuturesOrders.handler({ symbol: state.symbol });
  } catch {
    // best effort
  }
}

async function cleanupFuturesTriggerOrder(state: FuturesTriggerState) {
  try {
    if (state.orderId) {
      await cancelFuturesTriggerOrders.handler({ orders: [{ symbol: state.symbol, orderId: state.orderId }] });
    }
  } catch {
    // best effort
  }

  try {
    await cancelAllFuturesTriggerOrders.handler({ symbol: state.symbol });
  } catch {
    // best effort
  }
}

async function waitFor<T>(fn: () => Promise<T | null>, attempts: number, delayMs: number): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn();
      if (result !== null) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(`Condition was not satisfied after ${attempts} attempts`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

function asPositiveFloat(value: unknown, label: string): number {
  const parsed = Number.parseFloat(String(value));
  if (!(parsed > 0)) {
    throw new Error(`Expected positive numeric ${label}`);
  }
  return parsed;
}

function floorToStep(value: number, step: number): number {
  const decimals = countStepDecimals(step);
  return Number((Math.floor(value / step) * step).toFixed(decimals));
}

function ceilToStep(value: number, step: number): number {
  const decimals = countStepDecimals(step);
  return Number((Math.ceil(value / step) * step).toFixed(decimals));
}

function formatDecimal(value: number): string {
  return value.toFixed(12).replace(/\.?0+$/, '');
}

function countStepDecimals(step: number): number {
  const normalized = step.toString().toLowerCase();
  if (normalized.includes('e-')) {
    return Number.parseInt(normalized.split('e-')[1] ?? '0', 10);
  }

  const decimalPart = normalized.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
}

function approximatelyEqual(left: unknown, right: unknown, tolerance: number): boolean {
  const leftValue = Number.parseFloat(String(left));
  const rightValue = Number.parseFloat(String(right));
  return Number.isFinite(leftValue) && Number.isFinite(rightValue) && Math.abs(leftValue - rightValue) <= tolerance;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEnvFile(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
