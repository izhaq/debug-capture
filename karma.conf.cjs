/**
 * Karma for debug-capture: Jasmine in headless Chromium, one run.
 * `npm test` first bundles every spec with esbuild (`scripts/bundle-specs.mjs`)
 * into `.test-out/specs.js`; this file only runs that bundle.
 *
 * Browser: `CHROME_BIN` if set; otherwise the Chromium that the pinned
 * `@playwright/test` uses (found in `PLAYWRIGHT_BROWSERS_PATH`).
 *
 * Spec count guard (the `spec-count` reporter below): the run fails when
 *   - any declared spec did not run — `fit`/`fdescribe` (the rest are
 *     skipped), `xit`/`xdescribe`/`pending()` (AGENTS rule 19; lint bans them
 *     too, this catches what lint cannot see); or
 *   - fewer specs ran than the floor in `test/unit/spec-floor.json` — specs
 *     that vanish before Jasmine sees them (a spec file left out of the bundle,
 *     an emptied describe) are not "declared", so only a committed floor
 *     notices them.
 */
const fs = require('node:fs');
const path = require('node:path');

const SPEC_FLOOR = JSON.parse(fs.readFileSync(path.join(__dirname, 'test', 'unit', 'spec-floor.json'), 'utf8')).min;

/** Karma reporter: sets the exit code when specs were skipped or too few ran. */
function SpecCountReporter(baseReporterDecorator) {
  baseReporterDecorator(this);
  this.onRunComplete = (browsers, results) => {
    const problems = [];
    browsers.forEach((browser) => {
      const { total, success, failed, skipped } = browser.lastResult;
      const ran = success + failed;
      if (skipped > 0 || ran < total) {
        problems.push(
          `${browser.name}: ${ran} of ${total} declared specs ran (${skipped} skipped: fit/fdescribe/xit/xdescribe/pending).`,
        );
      }
      if (ran < SPEC_FLOOR) {
        problems.push(
          `${browser.name}: ${ran} specs ran, fewer than the floor of ${SPEC_FLOOR} (test/unit/spec-floor.json).`,
        );
      }
      if (problems.length === 0) this.write(`spec count: ${ran} of ${total} declared ran (floor ${SPEC_FLOOR})\n`);
    });
    if (problems.length > 0) {
      problems.forEach((p) => this.write(`SPEC COUNT FAILED — ${p}\n`));
      results.exitCode = 1;
    }
  };
}
SpecCountReporter.$inject = ['baseReporterDecorator'];

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
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-coverage'),
      { 'reporter:spec-count': ['type', SpecCountReporter] },
    ],
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
    reporters: ['progress', 'coverage', 'spec-count'],
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
