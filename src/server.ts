import { startBybitServer } from './exchanges/bybit/runtime.js';

export async function startServer(): Promise<void> {
  await startBybitServer();
}
