import { commonHeaders } from '../../../version.js';
import { getMexcConfig } from '../config.js';
import { buildSpotSignedQuery, toQueryString } from '../auth/spot-signing.js';
import { handleMexcResponse, withTimeout } from './shared.js';

class MexcSpotRestClient {
  async get(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const config = getMexcConfig();
    const qs = toQueryString(params);
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
    const signed = buildSpotSignedQuery(params);
    const url = `${config.baseUrl}${path}?${signed.queryString}`;
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

  async postAuth(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const config = getMexcConfig();
    const signed = buildSpotSignedQuery(params);
    const url = `${config.baseUrl}${path}?${signed.queryString}`;
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(url, {
        method: 'POST',
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

  async deleteAuth(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const config = getMexcConfig();
    const signed = buildSpotSignedQuery(params);
    const url = `${config.baseUrl}${path}?${signed.queryString}`;
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(url, {
        method: 'DELETE',
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
}

export const mexcSpotRestClient = new MexcSpotRestClient();
