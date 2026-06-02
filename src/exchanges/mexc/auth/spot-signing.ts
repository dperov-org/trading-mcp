import { createHmac } from 'node:crypto';
import { getMexcConfig } from '../config.js';

export interface MexcSignedParamsResult {
  queryString: string;
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

export function toQueryString(params: Record<string, unknown>): string {
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

export function buildSpotSignedQuery(
  params: Record<string, unknown>,
): MexcSignedParamsResult {
  const config = getMexcConfig();
  if (!config.apiKey) {
    throw new Error('MEXC_API_KEY or MEXC_SPOT_API_KEY must be set for authenticated requests.');
  }

  if (!config.apiSecret) {
    throw new Error('MEXC_SECRET_KEY, MEXC_API_SECRET, or MEXC_SPOT_API_SECRET must be set for authenticated requests.');
  }

  const timestamp = Date.now().toString();
  const completeParams = {
    ...params,
    recvWindow: params.recvWindow ?? config.recvWindow,
    timestamp,
  };
  const payload = toQueryString(completeParams);
  const signature = createHmac('sha256', config.apiSecret)
    .update(payload)
    .digest('hex');

  return {
    queryString: `${payload}&signature=${signature}`,
    headers: {
      'X-MEXC-APIKEY': config.apiKey,
    },
  };
}
