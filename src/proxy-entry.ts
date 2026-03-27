import { startProxy } from './proxy.js';
import { startDashboard } from './dashboard.js';
import { loadConfig } from './config.js';

const appConfig = loadConfig();

startProxy()
  .then(async () => {
    if (appConfig.dashboard.enabled) {
      await startDashboard(appConfig.dashboard.port);
    }
  })
  .catch((err) => {
    console.error('[guiltyspark-proxy] Fatal error:', err);
    process.exit(1);
  });
