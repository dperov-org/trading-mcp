import { createHmac } from 'node:crypto';
import { getMexcConfig } from '../config.js';

export interface MexcFuturesSignedParamsResult {
  queryString: string;
  headers: Record<string, string>;
}

export interface MexcFuturesSignedBodyResult {
  bodyText: string;
  headers: Record<string, string>;
}

function sortEntries(params: Record<string, string>): Array<[string, string]> {
  return Object.entries(params).sort(([left], [right]) => left.localeCompare(right));
}

function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '%20')
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function toFuturesQueryString(params: Record<string, unknown>): string {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    normalized[key] = String(value);
  }

  return sortEntries(normalized)
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}

export function buildFuturesSignedQuery(
  params: Record<string, unknown>,
): MexcFuturesSignedParamsResult {
  const config = getMexcConfig();
  if (!config.futuresApiKey) {
    throw new Error('MEXC_FUTURES_API_KEY or MEXC_API_KEY must be set for authenticated futures requests.');
  }

  if (!config.futuresApiSecret) {
    throw new Error('MEXC_FUTURES_API_SECRET, MEXC_SECRET_KEY, or MEXC_API_SECRET must be set for authenticated futures requests.');
  }

  const timestamp = Date.now().toString();
  const completeParams = {
    ...params,
  };
  const parameterString = toFuturesQueryString(completeParams);
  const signaturePayload = `${config.futuresApiKey}${timestamp}${parameterString}`;
  const signature = createHmac('sha256', config.futuresApiSecret)
    .update(signaturePayload)
    .digest('hex');

  return {
    queryString: parameterString,
    headers: {
      ApiKey: config.futuresApiKey,
      'Request-Time': timestamp,
      Signature: signature,
      'Recv-Window': String(params.recvWindow ?? config.recvWindow),
    },
  };
}

export function buildFuturesSignedBody(
  body: Record<string, unknown> | Array<unknown>,
  recvWindow?: number,
): MexcFuturesSignedBodyResult {
  const config = getMexcConfig();
  if (!config.futuresApiKey) {
    throw new Error('MEXC_FUTURES_API_KEY or MEXC_API_KEY must be set for authenticated futures requests.');
  }

  if (!config.futuresApiSecret) {
    throw new Error('MEXC_FUTURES_API_SECRET, MEXC_SECRET_KEY, or MEXC_API_SECRET must be set for authenticated futures requests.');
  }

  const timestamp = Date.now().toString();
  const bodyText = JSON.stringify(body);
  const signaturePayload = `${config.futuresApiKey}${timestamp}${bodyText}`;
  const signature = createHmac('sha256', config.futuresApiSecret)
    .update(signaturePayload)
    .digest('hex');

  return {
    bodyText,
    headers: {
      ApiKey: config.futuresApiKey,
      'Request-Time': timestamp,
      Signature: signature,
      'Recv-Window': String(recvWindow ?? config.recvWindow),
      'Content-Type': 'application/json',
    },
  };
}
