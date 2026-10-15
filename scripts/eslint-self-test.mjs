#!/usr/bin/env node
/**
 * Self-test for `eslint.config.js` (`npm run lint` runs it first).
 *
 * `eslint .` only proves today's code is clean. It cannot tell that a rule
 * silently stopped firing — e.g. `no-implied-eval` does nothing until the
 * browser globals are declared, and a per-file override can switch off more
 * than it means to. So this lints small snippets under made-up file names and
 * checks that exactly the expected rules fire.
 *
 * Usage: node scripts/eslint-self-test.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SINK = 'no-restricted-properties';
const SYNTAX = 'no-restricted-syntax';
const FOCUS = 'no-restricted-globals';

/** [file name, code, rule ids that must fire (exactly; [] = clean)]. */
const CASES = [
  // A clean file stays clean.
  ['src/core/zz.ts', `export const ok = 1;`, []],
  // NFR-SEC-01: no string evaluation, including through the global object.
  ['src/core/zz.ts', `setTimeout('run()', 0);`, ['no-implied-eval']],
  ['src/core/zz.ts', `setInterval('run()', 10);`, ['no-implied-eval']],
  ['src/core/zz.ts', `window.setTimeout('run()', 0);`, ['no-implied-eval']],
  ['src/core/zz.ts', `globalThis.setTimeout('run()', 0);`, ['no-implied-eval']],
  ['src/core/zz.ts', `export const f = (s: string): unknown => window.eval(s);`, ['no-eval']],
  ['src/core/zz.ts', `export const f = (s: string): unknown => eval(s);`, ['no-eval']],
  ['src/core/zz.ts', `export const f = new Function('return 1');`, ['no-new-func']],
  ['src/core/zz.ts', `setTimeout(() => undefined, 0);`, []],
  // NFR-SEC-01: no HTML sinks.
  ['src/core/zz.ts', `export const f = (e: Element, s: string) => { e.innerHTML = s; };`, [SINK]],
  ['src/core/zz.ts', `export const f = (e: Element, s: string) => { e.outerHTML = s; };`, [SINK]],
  ['src/core/zz.ts', `export const f = (e: Element, s: string) => e.insertAdjacentHTML('beforeend', s);`, [SINK]],
  ['src/core/zz.ts', `export const f = (s: string) => document.write(s);`, [SINK]],
  ['src/core/zz.ts', `export const f = (s: string) => document.writeln(s);`, [SINK]],
  [
    'src/core/zz.ts',
    `export const f = (e: Element & { setHTMLUnsafe(s: string): void }, s: string) => e.setHTMLUnsafe(s);`,
    [SINK],
  ],
  ['src/core/zz.ts', `export const f = (r: Range, s: string) => r.createContextualFragment(s);`, [SINK]],
  ['src/core/zz.ts', `export const f = (i: HTMLIFrameElement, s: string) => { i.srcdoc = s; };`, [SINK]],
  [
    'src/core/zz.ts',
    `export const f = (d: { parseHTMLUnsafe(s: string): Document }, s: string) => d.parseHTMLUnsafe(s);`,
    [SINK],
  ],
  ['src/core/zz.ts', `export const f = (e: Element) => e.setAttribute('onclick', 'x()');`, [SYNTAX]],
  ['src/core/zz.ts', `export const f = (e: Element, s: string) => e.setAttribute('srcdoc', s);`, [SYNTAX]],
  ['src/core/zz.ts', `export const f = (e: Element) => e.setAttribute('title', 'x');`, []],
  // Time comes from the injected Clock; only clock.ts reads Date.now() — and
  // its override lifts that one ban, not the HTML sinks.
  ['src/core/zz.ts', `export const t = Date.now();`, [SINK]],
  ['src/core/clock.ts', `export const t = Date.now();`, []],
  ['src/core/clock.ts', `export const f = (e: Element, s: string) => { e.innerHTML = s; };`, [SINK]],
  ['src/core/clock.ts', `export const f = (i: HTMLIFrameElement, s: string) => { i.srcdoc = s; };`, [SINK]],
  // No `any`, no console, no decorators.
  ['src/core/zz.ts', `export let x: any;`, ['@typescript-eslint/no-explicit-any']],
  ['src/core/zz.ts', `console.log('x');`, ['no-console']],
  ['src/react/zz.ts', `console.error('x');`, ['no-console']],
  ['src/adapters/probes/console/zz.ts', `console.log('x');`, ['no-console']],
  ['src/core/zz.ts', `declare const d: () => ClassDecorator;\n@d() export class A {}`, [SYNTAX]],
  // Specs: console spies are fine; focused or skipped specs are not (AGENTS rule 19).
  ['src/core/zz.spec.ts', `console.log('x');`, []],
  ['src/core/zz.spec.ts', `fit('a', () => undefined);`, [FOCUS]],
  ['src/core/zz.spec.ts', `fdescribe('a', () => undefined);`, [FOCUS]],
  ['src/core/zz.spec.ts', `xit('a', () => undefined);`, [FOCUS]],
  ['src/core/zz.spec.ts', `xdescribe('a', () => undefined);`, [FOCUS]],
  ['src/core/zz.spec.ts', `it('a', () => { pending('later'); });`, [FOCUS]],
  ['src/core/zz.spec.ts', `describe('a', () => { it('b', () => expect(1).toBe(1)); });`, []],
  // test/**/*.ts is TypeScript: parsed by the TS parser, with the same spec bans.
  ['test/unit/zz.ts', `const n: number = 1;\nexport { n };`, []],
  ['test/unit/zz.ts', `export let x: any;`, ['@typescript-eslint/no-explicit-any']],
  ['test/unit/zz.ts', `fdescribe('a', () => undefined);`, [FOCUS]],
  // Playwright: forbidOnly catches test.only at run time; skip and fixme only lint does.
  ['test/e2e/zz.spec.mjs', `import { test } from '@playwright/test';\ntest.skip('a', () => {});`, [SINK]],
  ['test/e2e/zz.spec.mjs', `import { test } from '@playwright/test';\ntest('a', () => {});`, []],
];

const eslint = new ESLint({ cwd: root });
const failures = [];
for (const [file, code, expected] of CASES) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  const got = [...new Set(result.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`))].sort();
  const want = [...expected].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`${file}: ${JSON.stringify(code)}\n    expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}
if (failures.length > 0) {
  failures.forEach((f) => console.error(`FAIL ${f}`));
  console.error(`\neslint self-test: ${failures.length} of ${CASES.length} cases failed.`);
  process.exit(1);
}
console.log(`eslint self-test: ${CASES.length} cases ok`);
