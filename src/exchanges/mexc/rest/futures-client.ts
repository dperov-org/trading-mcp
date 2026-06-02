import { commonHeaders } from '../../../version.js';
import { getMexcConfig } from '../config.js';
import {
  buildFuturesSignedBody,
  buildFuturesSignedQuery,
  toFuturesQueryString,
} from '../auth/futures-signing.js';
import { handleMexcResponse, withTimeout } from './shared.js';

class MexcFuturesRestClient {
  async get(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const config = getMexcConfig();
    const qs = toFuturesQueryString(params);
    const url = qs ? `${config.baseUrl}${path}?${qs}` : `${config.baseUrl}${path}`;
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(url, {
        headers: commonHeaders(),
        signal,
      });
      return handleMexcResponse(res);
    } finally {
      clear();
    }
  }

  async getAuth(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const config = getMexcConfig();
    const signed = buildFuturesSignedQuery(params);
    const url = signed.queryString
      ? `${config.baseUrl}${path}?${signed.queryString}`
      : `${config.baseUrl}${path}`;
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(url, {
        headers: {
          ...commonHeaders(),
          ...signed.headers,
        },
        signal,
      });
      return handleMexcResponse(res);
    } finally {
      clear();
    }
  }

  async postAuth(
    path: string,
    body: Record<string, unknown> | Array<unknown>,
    recvWindow?: number,
  ): Promise<unknown> {
    const config = getMexcConfig();
    const signed = buildFuturesSignedBody(body, recvWindow);
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          ...commonHeaders(),
          ...signed.headers,
        },
        body: signed.bodyText,
        signal,
      });
      return handleMexcResponse(res);
    } finally {
      clear();
    }
  }
}

export const mexcFuturesRestClient = new MexcFuturesRestClient();
