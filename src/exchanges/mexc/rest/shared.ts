const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function withTimeout(ms: number = REQUEST_TIMEOUT_MS): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function parseJsonSafely(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }

  try {
    // Preserve unsafe 16+ digit integer identifiers as strings before parsing.
    const normalized = text.replace(/(:\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
    return JSON.parse(normalized) as unknown;
  } catch {
    return text;
  }
}

export function extractMexcError(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }

  const code = data.code;
  const msg = data.msg ?? data.message;

  if (typeof code === 'number' && code !== 0) {
    return `MEXC API error ${code}: ${typeof msg === 'string' ? msg : 'unknown'}`;
  }

  if (typeof code === 'string' && code !== '0' && code !== '200') {
    return `MEXC API error ${code}: ${typeof msg === 'string' ? msg : 'unknown'}`;
  }

  if (typeof data.success === 'boolean' && data.success === false) {
    return `MEXC API error: ${typeof msg === 'string' ? msg : 'request failed'}`;
  }

  return null;
}

export async function handleMexcResponse(res: Response): Promise<unknown> {
  const parsed = await parseJsonSafely(res);
  if (!res.ok) {
    const message =
      typeof parsed === 'string'
        ? parsed.slice(0, 300)
        : extractMexcError(parsed) || JSON.stringify(parsed).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${message}`);
  }

  const apiError = extractMexcError(parsed);
  if (apiError) {
    throw new Error(apiError);
  }

  return parsed;
}
