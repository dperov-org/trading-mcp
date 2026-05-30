import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const appRoot = path.resolve(__dirname, '..', '..');
export const repoRoot = path.resolve(appRoot, '..', '..');
export const repoEnvPath = path.join(repoRoot, '.env');

dotenv.config({ path: repoEnvPath, quiet: true });

export const defaultSafeToolNames = [
  'getServerTime',
  'getTickers',
  'getOrderbook',
  'queryAPIKey',
  'getAccountInfo',
  'getWalletBalance',
  'getOpenOrders',
];

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getToolExecutionEnv() {
  const env = { ...process.env };

  if (!env.BYBIT_API_KEY && env.BYBIT_RO_API_KEY) {
    env.BYBIT_API_KEY = env.BYBIT_RO_API_KEY;
  }

  if (!env.BYBIT_API_SECRET && env.BYBIT_RO_API_SECRET) {
    env.BYBIT_API_SECRET = env.BYBIT_RO_API_SECRET;
  }

  return env;
}

export function applyToolExecutionEnv() {
  const env = getToolExecutionEnv();
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }
}
