import { startProxy } from './proxy.js';

startProxy().catch((err) => {
  console.error('[guiltyspark-proxy] Fatal error:', err);
  process.exit(1);
});
