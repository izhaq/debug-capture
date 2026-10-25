/**
 * Playwright for debug-capture end-to-end tests (`npm run e2e`).
 * Uses the Chromium that belongs to the pinned @playwright/test (1.56.1),
 * found in PLAYWRIGHT_BROWSERS_PATH; it ignores CHROME_BIN. Never run
 * `playwright install`. The pages load the prebuilt dist/*.mjs, so the run
 * stops at once when dist/ is missing or older than src/ (`npm run build`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { assertDistFresh } from './scripts/dist-fresh.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
assertDistFresh(root);
const port = Number(process.env.E2E_PORT ?? 4319);
/** The hostile host (test/hostile-host/, S-02): its own server, because every page there carries a strict CSP header. */
const hostilePort = Number(process.env.E2E_HOSTILE_PORT ?? 4329);
process.env.E2E_HOSTILE_ORIGIN = `http://127.0.0.1:${hostilePort}`;

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: 'test-results',
  forbidOnly: true,
  retries: 0,
  // The guard fails the run on any skipped test or below test/e2e-floor.json.
  reporter: [['list'], ['./test/e2e-guard-reporter.mjs']],
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The Angular and React hosts are bundled from dist/ first (S-10a).
      command: `node test/hosts/build.mjs && node test/static-server.mjs ${port}`,
      url: `http://127.0.0.1:${port}/dist/index.mjs`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `node test/hostile-host/server.mjs ${hostilePort}`,
      url: `http://127.0.0.1:${hostilePort}/dist/panel.mjs`,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
