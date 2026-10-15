/**
 * Playwright for debug-capture end-to-end tests (`npm run e2e`).
 * Uses the Chromium that belongs to the pinned @playwright/test (1.56.1) from
 * PLAYWRIGHT_BROWSERS_PATH — never `playwright install`. Needs `npm run build`
 * first: the pages load the prebuilt dist/*.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(root, 'dist', 'index.mjs'))) {
  throw new Error('dist/index.mjs is missing — run `npm run build` before `npm run e2e`.');
}
const port = Number(process.env.E2E_PORT ?? 4319);

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: 'test-results',
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node test/static-server.mjs ${port}`,
    url: `http://127.0.0.1:${port}/dist/index.mjs`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
