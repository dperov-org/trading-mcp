import { checkIntegrityAtStartup } from './version-check.js';
import { startMexcServer } from './exchanges/mexc/runtime.js';

await checkIntegrityAtStartup();

startMexcServer().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
