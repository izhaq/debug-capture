/**
 * ESLint for debug-capture (HLD §7.2, AGENTS.md). `npm run lint`.
 *
 * src/**: typescript-eslint recommended, plus the package rules:
 *   - no `any`, no `console.*` (the console probe and the React adapter are
 *     exempt: they call console on purpose);
 *   - NFR-SEC-01: no innerHTML / outerHTML / insertAdjacentHTML /
 *     document.write, no eval / new Function, no inline on* handlers;
 *   - no `Date.now()` outside src/core/clock.ts (inject the clock);
 *   - no decorators (HLD C-4 / D-09: the package builds with plain tsc).
 * scripts/, test/ and the config files: eslint recommended for Node.
 */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const NODE_GLOBALS = Object.fromEntries(
  ['process', 'console', 'URL', 'Buffer', 'setTimeout', 'clearTimeout', 'structuredClone'].map((g) => [g, 'readonly']),
);
const COMMONJS_GLOBALS = Object.fromEntries(
  ['require', 'module', '__dirname', '__filename'].map((g) => [g, 'readonly']),
);
// Code inside Playwright's page.evaluate() runs in the page.
const BROWSER_GLOBALS = Object.fromEntries(['window', 'document', 'fetch'].map((g) => [g, 'readonly']));

const SEC = 'NFR-SEC-01: captured data enters the DOM only as text.';

export default defineConfig(
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '.test-out/', 'test-results/', 'playwright-report/', 'docs/'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // A leading underscore marks a parameter a fake must declare but does not use (v1 convention).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: `Use textContent or the safe element builder. ${SEC}` },
        { property: 'outerHTML', message: `Use the safe element builder. ${SEC}` },
        { property: 'insertAdjacentHTML', message: `Use the safe element builder. ${SEC}` },
        { object: 'document', property: 'write', message: SEC },
        { object: 'document', property: 'writeln', message: SEC },
        {
          object: 'Date',
          property: 'now',
          message: 'Use the injected Clock; only src/core/clock.ts reads Date.now().',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Decorator',
          message: 'No decorators: the package builds with plain tsc (HLD C-4, D-09). Use a factory instead.',
        },
        {
          selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^on/i]",
          message: `No inline event handlers; use addEventListener. ${SEC}`,
        },
      ],
    },
  },
  {
    // The one place that reads the wall clock (the rest get a Clock injected).
    files: ['src/core/clock.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // They call console on purpose: the probe wraps it, the React adapter
    // repeats React's own console.error default.
    files: ['src/adapters/probes/console/**/*.ts', 'src/react/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Specs spy on console methods and assert on them; spec code never ships.
    files: ['src/**/*.spec.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}', 'test/**/*.ts'],
    ignores: ['src/**'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: COMMONJS_GLOBALS },
  },
);
