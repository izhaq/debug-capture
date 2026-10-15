/**
 * ESLint for debug-capture (HLD §7.2, AGENTS.md). `npm run lint` runs
 * `scripts/eslint-self-test.mjs` first: it proves each rule below still fires.
 *
 * src/**: typescript-eslint recommended, plus the package rules:
 *   - no `any`, no `console.*` (the console probe and the React adapter reach
 *     the console through the injected scope, which this rule does not flag);
 *   - NFR-SEC-01: no HTML sinks (innerHTML, outerHTML, insertAdjacentHTML,
 *     setHTMLUnsafe, parseHTMLUnsafe, createContextualFragment, srcdoc,
 *     document.write), no eval / new Function / string timers, no inline on*
 *     handlers;
 *   - no `Date.now()` outside src/core/clock.ts (inject the clock);
 *   - no decorators (HLD C-4 / D-09: the package builds with plain tsc).
 * Specs and test/**: no focused or skipped specs (AGENTS rule 19).
 * scripts/, test/ and the config files: eslint recommended for Node.
 *
 * What lint does NOT catch, on purpose (a lint rule cannot follow values):
 *   - `Reflect.set(el, 'innerHTML', s)`, `Object.assign(el, { innerHTML: s })`;
 *   - computed keys: `el['inner' + 'HTML'] = s`, `window[name](s)`;
 *   - aliases: `const w = window; w.eval(s)`, `const d = document; d.write(s)`,
 *     `const t = setTimeout; t('…')`.
 * Review catches those; the backstop is the Trusted Types end-to-end test
 * (NFR-SEC-02, a later spec): with `require-trusted-types-for 'script'` the
 * browser itself rejects every string sent to an HTML or script sink.
 */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SEC = 'NFR-SEC-01: captured data enters the DOM only as text.';
const SAFE_BUILDER = `Use textContent or the safe element builder. ${SEC}`;

/** HTML sinks: banned in every src file, clock.ts included. */
const HTML_SINKS = [
  ...[
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'setHTMLUnsafe',
    'parseHTMLUnsafe',
    'createContextualFragment',
  ].map((property) => ({ property, message: SAFE_BUILDER })),
  { property: 'srcdoc', message: `No srcdoc: it parses HTML. ${SEC}` },
  { object: 'document', property: 'write', message: SEC },
  { object: 'document', property: 'writeln', message: SEC },
];
const DATE_NOW = {
  object: 'Date',
  property: 'now',
  message: 'Use the injected Clock; only src/core/clock.ts reads Date.now().',
};

/** Jasmine's focus and skip functions: a focused spec hides the rest, a skipped one hides itself. */
const NO_FOCUS_OR_SKIP = [
  'error',
  ...['fit', 'fdescribe'].map((name) => ({ name, message: 'Focused spec: the other specs would not run.' })),
  ...['xit', 'xdescribe', 'pending'].map((name) => ({
    name,
    message: 'Skipped spec: fix or delete the test instead (AGENTS rule 19).',
  })),
];

const TS_RULES = {
  '@typescript-eslint/no-explicit-any': 'error',
  // A leading underscore marks a parameter a fake must declare but does not use (v1 convention).
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
};

export default defineConfig(
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '.test-out/', 'test-results/', 'playwright-report/', 'docs/'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    // Declared so the global-aware rules (no-implied-eval, no-eval, no-console)
    // see `setTimeout`, `window.eval`… as the real globals.
    languageOptions: { globals: globals.browser },
    rules: {
      ...TS_RULES,
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': ['error', ...HTML_SINKS, DATE_NOW],
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
        {
          selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^srcdoc$/i]",
          message: `No srcdoc: it parses HTML. ${SEC}`,
        },
      ],
    },
  },
  {
    // The one place that reads the wall clock (the rest get a Clock injected).
    // Lifts only the Date.now() ban: the HTML sinks stay banned here too.
    files: ['src/core/clock.ts'],
    rules: { 'no-restricted-properties': ['error', ...HTML_SINKS] },
  },
  {
    // Specs spy on console methods and assert on them; spec code never ships.
    files: ['src/**/*.spec.ts'],
    rules: { 'no-console': 'off', 'no-restricted-globals': NO_FOCUS_OR_SKIP },
  },
  {
    files: ['test/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: { ...TS_RULES, 'no-restricted-globals': NO_FOCUS_OR_SKIP },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ignores: ['src/**'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // Code inside Playwright's page.evaluate() runs in the page.
    files: ['test/**/*.{js,mjs}'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-properties': [
        'error',
        ...['only', 'skip', 'fixme'].map((property) => ({
          object: 'test',
          property,
          message: 'Every end-to-end test runs (AGENTS rule 19).',
        })),
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.commonjs },
  },
);
