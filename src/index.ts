import { startServer } from './server.js';

startServer().catch((err) => {
  console.error('[guiltyspark] Fatal error:', err);
  process.exit(1);
});
