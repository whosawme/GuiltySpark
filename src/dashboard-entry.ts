/**
 * Entry point: HTTP proxy + Dashboard server running together.
 *
 * Start with:   npm run dev:dashboard
 * Production:   npm run start:dashboard
 */

import { startProxy } from './proxy.js';
import { startDashboard } from './dashboard.js';
import { loadConfig } from './config.js';

const appConfig = loadConfig();

await startProxy();

if (appConfig.dashboard.enabled) {
  await startDashboard(appConfig.dashboard.port);
}
