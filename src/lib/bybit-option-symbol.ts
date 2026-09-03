const MONTH_CODES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

const MONTH_INDEX = new Map(MONTH_CODES.map((month, index) => [month, index]));
const OPTION_SYMBOL_PATTERN = /^([A-Z0-9]+)-([1-9]|[12]\d|3[01])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})-([1-9]\d*(?:\.\d+)?)-(C|P)-([A-Z0-9]+)$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type BybitOptionType = 'Call' | 'Put';

export interface ParsedBybitOptionSymbol {
  symbol: string;
  baseCoin: string;
  expiry: string;
  expiryCode: string;
  strike: string;
  optionType: BybitOptionType;
  optionTypeCode: 'C' | 'P';
  settleCoin: string;
}

export interface BuildBybitOptionSymbolInput {
  baseCoin: string;
  expiry: string;
  strike: string;
  optionType: 'C' | 'P' | 'Call' | 'Put';
  settleCoin: string;
}

/**
 * Parse only Bybit's canonical option format: BASE-DMMMYY-STRIKE-C|P-SETTLE.
 * In particular, the expiry day has one or two digits and no leading zero.
 */
export function parseBybitOptionSymbolValue(symbol: string): ParsedBybitOptionSymbol {
  const normalized = symbol.trim().toUpperCase();
  const match = OPTION_SYMBOL_PATTERN.exec(normalized);

  if (!match) {
    throw new Error(
      'Invalid Bybit option symbol. Expected BASE-DMMMYY-STRIKE-C|P-SETTLE, for example BTC-3SEP26-73000-P-USDT. The expiry day is one or two digits without a leading zero.',
    );
  }

  const [, baseCoin, dayText, monthCode, yearText, strike, optionTypeCode, settleCoin] = match;
  const year = 2000 + Number(yearText);
  const monthIndex = MONTH_INDEX.get(monthCode as (typeof MONTH_CODES)[number]);
  const day = Number(dayText);
  if (monthIndex === undefined || !isValidUtcDate(year, monthIndex, day)) {
    throw new Error(`Invalid calendar expiry in Bybit option symbol: ${normalized}`);
  }

  const expiry = toIsoDate(year, monthIndex, day);
  const expiryCode = `${day}${monthCode}${yearText}`;
  const optionType = optionTypeCode === 'C' ? 'Call' : 'Put';

  return {
    symbol: normalized,
    baseCoin,
    expiry,
    expiryCode,
    strike,
    optionType,
    optionTypeCode: optionTypeCode as 'C' | 'P',
    settleCoin,
  };
}

export function buildBybitOptionSymbolValue(input: BuildBybitOptionSymbolInput): ParsedBybitOptionSymbol {
  const baseCoin = normalizeCoin(input.baseCoin, 'baseCoin');
  const settleCoin = normalizeCoin(input.settleCoin, 'settleCoin');
  const strike = normalizeStrike(input.strike);
  const optionTypeCode = normalizeOptionType(input.optionType);
  const { year, monthIndex, day } = parseIsoDate(input.expiry);
  const yearText = String(year).slice(-2);
  const expiryCode = `${day}${MONTH_CODES[monthIndex]}${yearText}`;

  return parseBybitOptionSymbolValue(
    `${baseCoin}-${expiryCode}-${strike}-${optionTypeCode}-${settleCoin}`,
  );
}

function normalizeCoin(value: string, fieldName: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    throw new Error(`${fieldName} must contain only letters and digits.`);
  }
  return normalized;
}

function normalizeStrike(value: string): string {
  const normalized = value.trim();
  if (!/^[1-9]\d*(?:\.\d+)?$/.test(normalized)) {
    throw new Error('strike must be a positive decimal written without a leading zero.');
  }
  return normalized;
}

function normalizeOptionType(value: BuildBybitOptionSymbolInput['optionType']): 'C' | 'P' {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'C' || normalized === 'CALL') {
    return 'C';
  }
  if (normalized === 'P' || normalized === 'PUT') {
    return 'P';
  }
  throw new Error('optionType must be C, P, Call, or Put.');
}

function parseIsoDate(value: string): { year: number; monthIndex: number; day: number } {
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error('expiry must be an ISO date in YYYY-MM-DD format.');
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  if (year < 2000 || year > 2099 || !isValidUtcDate(year, monthIndex, day)) {
    throw new Error(`expiry is not a valid calendar date: ${value}`);
  }

  return { year, monthIndex, day };
}

function isValidUtcDate(year: number, monthIndex: number, day: number): boolean {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === monthIndex
    && date.getUTCDate() === day;
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
