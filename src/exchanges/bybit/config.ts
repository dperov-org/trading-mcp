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

export type BybitCredentialSource = 'direct' | 'rw' | 'ro' | 'none';

export interface BybitCredentialSelection {
  source: BybitCredentialSource;
  useRwKeys: boolean;
}

export function selectBybitCredentialAliases(): BybitCredentialSelection {
  const useRwKeys = toBoolean(process.env.BYBIT_USE_RW_KEYS, true);

  if (process.env.BYBIT_API_KEY) {
    return { source: 'direct', useRwKeys };
  }

  if (useRwKeys && process.env.BYBIT_RW_API_KEY) {
    process.env.BYBIT_API_KEY = process.env.BYBIT_RW_API_KEY;
    if (!process.env.BYBIT_API_SECRET && process.env.BYBIT_RW_API_SECRET) {
      process.env.BYBIT_API_SECRET = process.env.BYBIT_RW_API_SECRET;
    }
    return { source: 'rw', useRwKeys };
  }

  if (process.env.BYBIT_RO_API_KEY) {
    process.env.BYBIT_API_KEY = process.env.BYBIT_RO_API_KEY;
    if (!process.env.BYBIT_API_SECRET && process.env.BYBIT_RO_API_SECRET) {
      process.env.BYBIT_API_SECRET = process.env.BYBIT_RO_API_SECRET;
    }
    return { source: 'ro', useRwKeys };
  }

  return { source: 'none', useRwKeys };
}

export function getBybitCredentialSourceLabel(selection: BybitCredentialSelection): string {
  switch (selection.source) {
    case 'direct':
      return 'BYBIT_API_* direct';
    case 'rw':
      return 'BYBIT_RW_* alias';
    case 'ro':
      return 'BYBIT_RO_* alias';
    default:
      return 'none';
  }
}
