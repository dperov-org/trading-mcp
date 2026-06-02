function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface MexcConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  spotApiKey: string;
  spotApiSecret: string;
  futuresApiKey: string;
  futuresApiSecret: string;
  recvWindow: number;
  enableSpot: boolean;
  enableFutures: boolean;
}

export function getMexcConfig(): MexcConfig {
  const spotApiKey =
    process.env.MEXC_SPOT_API_KEY ||
    process.env.MEXC_API_KEY ||
    '';
  const spotApiSecret =
    process.env.MEXC_SPOT_API_SECRET ||
    process.env.MEXC_SECRET_KEY ||
    process.env.MEXC_API_SECRET ||
    '';
  const futuresApiKey =
    process.env.MEXC_FUTURES_API_KEY ||
    process.env.MEXC_API_KEY ||
    '';
  const futuresApiSecret =
    process.env.MEXC_FUTURES_API_SECRET ||
    process.env.MEXC_SECRET_KEY ||
    process.env.MEXC_API_SECRET ||
    '';

  return {
    baseUrl: 'https://api.mexc.com',
    apiKey: spotApiKey,
    apiSecret: spotApiSecret,
    spotApiKey,
    spotApiSecret,
    futuresApiKey,
    futuresApiSecret,
    recvWindow: toInt(process.env.MEXC_RECV_WINDOW, 5000),
    enableSpot: toBoolean(process.env.MEXC_ENABLE_SPOT, true),
    enableFutures: toBoolean(process.env.MEXC_ENABLE_FUTURES, true),
  };
}

export function getMexcAuthSummary(): string {
  const config = getMexcConfig();
  if (!config.spotApiKey && !config.futuresApiKey) {
    return `auth: unauthenticated, spot: ${config.enableSpot ? 'enabled' : 'disabled'}, futures: ${config.enableFutures ? 'enabled' : 'disabled'}`;
  }

  if ((config.enableSpot && !config.spotApiSecret) || (config.enableFutures && !config.futuresApiSecret)) {
    return 'auth: config error — MEXC secret key is missing';
  }

  return `auth: HMAC-SHA256, spot: ${config.enableSpot ? 'enabled' : 'disabled'}, futures: ${config.enableFutures ? 'enabled' : 'disabled'}`;
}
