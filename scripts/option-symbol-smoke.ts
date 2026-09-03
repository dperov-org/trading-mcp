import assert from 'node:assert/strict';
import {
  buildBybitOptionSymbolValue,
  parseBybitOptionSymbolValue,
} from '../src/lib/bybit-option-symbol.js';

const parsed = parseBybitOptionSymbolValue('BTC-3SEP26-73000-P-USDT');
assert.deepEqual(parsed, {
  symbol: 'BTC-3SEP26-73000-P-USDT',
  baseCoin: 'BTC',
  expiry: '2026-09-03',
  expiryCode: '3SEP26',
  strike: '73000',
  optionType: 'Put',
  optionTypeCode: 'P',
  settleCoin: 'USDT',
});

assert.equal(
  buildBybitOptionSymbolValue({
    baseCoin: 'btc',
    expiry: '2026-09-03',
    strike: '73000',
    optionType: 'Put',
    settleCoin: 'usdt',
  }).symbol,
  'BTC-3SEP26-73000-P-USDT',
);
assert.equal(
  parseBybitOptionSymbolValue('ETH-11SEP26-2500-C-USDT').expiry,
  '2026-09-11',
);

for (const invalidSymbol of [
  'BTC-03SEP26-73000-P-USDT',
  'BTC-31FEB26-73000-P-USDT',
  'BTC-3SEP26-73000-X-USDT',
]) {
  assert.throws(() => parseBybitOptionSymbolValue(invalidSymbol));
}

assert.throws(() => buildBybitOptionSymbolValue({
  baseCoin: 'BTC',
  expiry: '2026-02-29',
  strike: '73000',
  optionType: 'P',
  settleCoin: 'USDT',
}));

console.log('option symbol smoke passed');
