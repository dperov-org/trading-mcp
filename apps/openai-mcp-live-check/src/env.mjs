import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const appRoot = path.resolve(__dirname, '..');
export const repoRoot = path.resolve(appRoot, '..', '..');
export const repoEnvPath = path.join(repoRoot, '.env');

dotenv.config({ path: repoEnvPath, quiet: true });

export const defaultToolAllowlist = [
  'getServerTime',
  'getTickers',
  'getOrderbook',
  'queryAPIKey',
  'getAccountInfo',
  'getWalletBalance',
  'getOpenOrders',
];

export function getToolAllowlist() {
  if (process.env.EXPOSE_ALL_TOOLS === '1') {
    return null;
  }

  const raw = process.env.ALLOWED_TOOL_NAMES?.trim();
  if (!raw) {
    return defaultToolAllowlist;
  }

  return raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function getChildMcpEnv() {
  const childEnv = { ...process.env };

  if (!childEnv.BYBIT_API_KEY && childEnv.BYBIT_RO_API_KEY) {
    childEnv.BYBIT_API_KEY = childEnv.BYBIT_RO_API_KEY;
  }

  if (!childEnv.BYBIT_API_SECRET && childEnv.BYBIT_RO_API_SECRET) {
    childEnv.BYBIT_API_SECRET = childEnv.BYBIT_RO_API_SECRET;
  }

  return childEnv;
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
