import protobuf from 'protobufjs';
import WebSocket from 'ws';

const SPOT_WS_URL = 'wss://wbs-api.mexc.com/ws';

const MEXC_SPOT_WS_PROTO = `
syntax = "proto3";

message PublicAggreBookTickerV3Api {
  string bidPrice = 1;
  string bidQuantity = 2;
  string askPrice = 3;
  string askQuantity = 4;
}

message PublicAggreDealsV3ApiItem {
  string price = 1;
  string quantity = 2;
  int32 tradeType = 3;
  int64 time = 4;
}

message PublicAggreDealsV3Api {
  repeated PublicAggreDealsV3ApiItem deals = 1;
  string eventType = 2;
}

message PublicLimitDepthV3ApiItem {
  string price = 1;
  string quantity = 2;
}

message PublicLimitDepthsV3Api {
  repeated PublicLimitDepthV3ApiItem asks = 1;
  repeated PublicLimitDepthV3ApiItem bids = 2;
  string eventType = 3;
  string version = 4;
}

message PushDataV3ApiWrapper {
  string channel = 1;

  oneof body {
    PublicLimitDepthsV3Api publicLimitDepths = 303;
    PublicAggreDealsV3Api publicAggreDeals = 314;
    PublicAggreBookTickerV3Api publicAggreBookTicker = 315;
  }

  string symbol = 3;
  string symbolId = 4;
  int64 createTime = 5;
  int64 sendTime = 6;
}
`;

const mexcSpotWsRoot = protobuf.parse(MEXC_SPOT_WS_PROTO).root;
const PushDataV3ApiWrapper = mexcSpotWsRoot.lookupType('PushDataV3ApiWrapper');

export interface MexcSpotSnapshotOptions {
  channel: string;
  bodyField: 'publicAggreBookTicker' | 'publicAggreDeals' | 'publicLimitDepths';
  messageCount?: number;
  timeoutMs?: number;
}

type MexcSpotDecodedFrame = {
  channel: string;
  symbol?: string;
  symbolId?: string;
  createTime?: string;
  sendTime?: string;
  data: unknown;
};

function decodeFrame(frame: Buffer, bodyField: MexcSpotSnapshotOptions['bodyField']): MexcSpotDecodedFrame {
  const decoded = PushDataV3ApiWrapper.decode(frame);
  const payload = PushDataV3ApiWrapper.toObject(decoded, {
    longs: String,
    enums: String,
    defaults: false,
  }) as Record<string, unknown>;

  return {
    channel: String(payload.channel ?? ''),
    symbol: typeof payload.symbol === 'string' ? payload.symbol : undefined,
    symbolId: typeof payload.symbolId === 'string' ? payload.symbolId : undefined,
    createTime: typeof payload.createTime === 'string' ? payload.createTime : undefined,
    sendTime: typeof payload.sendTime === 'string' ? payload.sendTime : undefined,
    data: payload[bodyField] ?? null,
  };
}

function toBuffer(raw: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw.map((chunk) => Buffer.from(chunk)));
  }

  return Buffer.from(raw);
}

export class MexcSpotWsClient {
  snapshot(opts: MexcSpotSnapshotOptions): Promise<MexcSpotDecodedFrame[]> {
    const { channel, bodyField, messageCount = 1, timeoutMs = 5000 } = opts;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(SPOT_WS_URL);
      const messages: MexcSpotDecodedFrame[] = [];
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      let subscriptionConfirmed = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        ws.close();
        resolve(messages);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        ws.close();
        reject(error);
      };

      ws.on('open', () => {
        timer = setTimeout(() => {
          if (!subscriptionConfirmed) {
            fail(new Error(`MEXC WS subscription timed out for channel ${channel}`));
            return;
          }
          finish();
        }, timeoutMs);

        ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [channel] }));
      });

      ws.on('message', (raw, isBinary) => {
        if (!isBinary) {
          const text = raw.toString();
          let ack: Record<string, unknown> | undefined;
          try {
            ack = JSON.parse(text) as Record<string, unknown>;
          } catch {
            return;
          }

          if (ack.code !== 0) {
            fail(new Error(`MEXC WS subscription failed for ${channel}: ${text}`));
            return;
          }

          if (typeof ack.msg === 'string' && ack.msg.includes('Not Subscribed successfully')) {
            fail(new Error(`MEXC WS subscription rejected for ${channel}: ${ack.msg}`));
            return;
          }

          subscriptionConfirmed = true;
          return;
        }

        subscriptionConfirmed = true;
        try {
          messages.push(decodeFrame(toBuffer(raw), bodyField));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        if (messages.length >= messageCount) {
          finish();
        }
      });

      ws.on('error', (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });

      ws.on('close', () => {
        if (!settled && messages.length > 0) {
          finish();
        }
      });
    });
  }
}

export const mexcSpotWsClient = new MexcSpotWsClient();
