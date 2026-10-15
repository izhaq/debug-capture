/**
 * Karma for debug-capture: Jasmine in headless Chromium, one run.
 * `npm test` first bundles every spec with esbuild (`scripts/bundle-specs.mjs`)
 * into `.test-out/specs.js`; this file only runs that bundle.
 *
 * Browser: `CHROME_BIN` if set; otherwise the Chromium that the pinned
 * `@playwright/test` uses (found in `PLAYWRIGHT_BROWSERS_PATH`).
 */
if (!process.env.CHROME_BIN) {
  try {
    process.env.CHROME_BIN = require('playwright-core').chromium.executablePath();
  } catch {
    // karma-chrome-launcher then looks for an installed Chrome itself.
  }
}

module.exports = (config) => {
  config.set({
    basePath: __dirname,
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher'), require('karma-coverage')],
    files: ['.test-out/specs.js'],
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          // No calls home: the tests need no network beyond Karma's own server.
          '--disable-background-networking',
          '--disable-component-update',
        ],
      },
    },
    reporters: ['progress', 'coverage'],
    coverageReporter: {
      dir: 'coverage',
      reporters: [{ type: 'text-summary' }, { type: 'html', subdir: 'html' }],
      // The v1 seed measured 96.4 / 92.1 / 95.5 / 96.6 % (statements, branches,
      // functions, lines). The floors sit about 1-2 points below; a drop fails `npm test`.
      check: { global: { statements: 95, branches: 90, functions: 94, lines: 95 } },
    },
    browserNoActivityTimeout: 120000,
    captureTimeout: 120000,
    failOnEmptyTestSuite: true,
    singleRun: true,
    autoWatch: false,
    logLevel: config.LOG_WARN,
  });
};
