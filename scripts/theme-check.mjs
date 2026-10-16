#!/usr/bin/env node
// Theme parity check (HLD §5.4, S04-02).
//
// `npm run contrast` proves the HLD's token table meets WCAG. This script
// proves the code ships that same table: it reads the `TOKENS` object in
// src/panel/ui/theme/tokens.ts and fails on any missing, extra or different
// token. If src/panel/launcher-tokens.ts exists (the loader's few colours),
// each token it names must also equal the HLD value.
//
// Usage (from packages/debug-capture/):
//   node scripts/theme-check.mjs               check the files above
//   node scripts/theme-check.mjs --self-test   check this script
//
// No dependencies. The files are read as text (no TypeScript compile), so
// they must keep the plain shape `dark: { name: '#rrggbb', … }, light: { … }`;
// anything this parser cannot read fails loudly instead of passing.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokenTable } from './contrast-check.mjs';

const THEMES = ['dark', 'light'];

/**
 * Reads `dark: { … }` and `light: { … }` object literals from a source file.
 * Keys may be quoted or not and may carry the `--dcp-` prefix; values are
 * quoted hex colours. Returns `{ dark: { bg: '#1e1f22', … }, light: { … } }`
 * (lower-case values). Throws when a theme block is missing, appears twice,
 * or holds an entry that is not a `name: '#hex'` pair.
 */
export function parseTokenModule(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const out = {};
  for (const theme of THEMES) {
    const blocks = [...source.matchAll(new RegExp(`(?:^|[\\s,{])['"]?${theme}['"]?\\s*:\\s*\\{([^{}]*)\\}`, 'g'))];
    if (blocks.length !== 1) {
      throw new Error(`expected one "${theme}: { … }" block, found ${blocks.length}`);
    }
    const tokens = {};
    for (const raw of blocks[0][1].split(',')) {
      const entry = raw.trim();
      if (entry === '') continue;
      const m = /^['"]?(?:--dcp-)?([a-z][a-z0-9-]*)['"]?\s*:\s*['"](#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})['"]$/.exec(entry);
      if (!m) throw new Error(`${theme}: cannot read token entry "${entry}"`);
      if (m[1] in tokens) throw new Error(`${theme}: token "${m[1]}" appears twice`);
      tokens[m[1]] = m[2].toLowerCase();
    }
    out[theme] = tokens;
  }
  return out;
}

/**
 * Compares parsed tokens with the HLD table. `exact` also fails on HLD tokens
 * the file lacks (the theme must have all of them; the launcher only some).
 * Returns a list of problems (empty = they match).
 */
export function compareTokens(hld, actual, { exact }) {
  const problems = [];
  for (const theme of THEMES) {
    const want = hld[theme];
    const have = actual[theme];
    for (const [name, value] of Object.entries(have)) {
      if (!(name in want)) problems.push(`${theme}: "${name}" is not an HLD §5.4 token`);
      else if (want[name] !== value) problems.push(`${theme}: "${name}" is ${value}, the HLD says ${want[name]}`);
    }
    if (exact) {
      for (const name of Object.keys(want)) {
        if (!(name in have)) problems.push(`${theme}: "${name}" is missing`);
      }
    }
  }
  return problems;
}

function selfTest() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    const a = JSON.stringify(actual);
    const w = JSON.stringify(wanted);
    if (a !== w) failures.push(`${label}: got ${a}, want ${w}`);
  };
  const throws = (label, fn, pattern) => {
    try {
      fn();
      failures.push(`${label}: did not throw`);
    } catch (e) {
      if (!pattern.test(String(e instanceof Error ? e.message : e))) failures.push(`${label}: wrong error ${e}`);
    }
  };

  const hld = parseTokenTable(
    [
      '| Token | Use | Dark | Light |',
      '|---|---|---|---|',
      '| `--dcp-bg` | x | `#1E1F22` | `#ffffff` |',
      '| `--dcp-bg-hover` | x | `#2d3036` | `#eceef1` |',
    ].join('\n'),
  );
  const good = `
    /** dark: { fake: '#000000' } in a comment is ignored */
    export const TOKENS = {
      dark: {
        bg: '#1e1f22', // a trailing comment
        'bg-hover': '#2d3036',
      },
      light: { "--dcp-bg": "#FFFFFF", 'bg-hover': '#eceef1' },
    };`;
  const parsed = parseTokenModule(good);
  expect('parse: dark', parsed.dark, { bg: '#1e1f22', 'bg-hover': '#2d3036' });
  expect('parse: light (prefix, double quotes, upper case)', parsed.light, { bg: '#ffffff', 'bg-hover': '#eceef1' });
  expect('compare: equal', compareTokens(hld, parsed, { exact: true }), []);

  const changed = parseTokenModule(good.replace("'#2d3036'", "'#2d3037'"));
  expect('compare: changed value', compareTokens(hld, changed, { exact: true }), [
    'dark: "bg-hover" is #2d3037, the HLD says #2d3036',
  ]);
  const extra = parseTokenModule(good.replace("bg: '#1e1f22',", "bg: '#1e1f22', bogus: '#123456',"));
  expect('compare: unknown name', compareTokens(hld, extra, { exact: true }), [
    'dark: "bogus" is not an HLD §5.4 token',
  ]);
  const partial = parseTokenModule(good.replace("'bg-hover': '#2d3036',", ''));
  expect('compare: missing (exact)', compareTokens(hld, partial, { exact: true }), ['dark: "bg-hover" is missing']);
  expect('compare: missing is fine for a subset', compareTokens(hld, partial, { exact: false }), []);

  throws('no light block', () => parseTokenModule("dark: { bg: '#000000' }"), /one "light: \{ … \}" block, found 0/);
  throws(
    'two dark blocks',
    () => parseTokenModule("dark: { bg: '#000000' }, light: {}, x: { dark: { bg: '#000000' } }"),
    /found 2/,
  );
  throws(
    'non-hex value',
    () => parseTokenModule("dark: { bg: 'red' }, light: {}"),
    /cannot read token entry "bg: 'red'"/,
  );
  throws('computed value', () => parseTokenModule('dark: { bg: BG }, light: {}'), /cannot read/);
  throws('duplicate', () => parseTokenModule("dark: { bg: '#000000', bg: '#000001' }, light: {}"), /appears twice/);

  if (failures.length) {
    process.stdout.write(`theme self-test: ${failures.length} FAILED\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    return false;
  }
  process.stdout.write('theme self-test: all passed\n');
  return true;
}

function checkFile(hld, root, file, exact) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    return exact
      ? { ok: false, lines: [`FAIL: ${file} is missing`] }
      : { ok: true, lines: [`skip: ${file} (not present)`] };
  }
  let problems;
  try {
    problems = compareTokens(hld, parseTokenModule(readFileSync(path, 'utf8')), { exact });
  } catch (e) {
    problems = [`cannot read: ${e instanceof Error ? e.message : String(e)}`];
  }
  if (problems.length === 0) return { ok: true, lines: [`ok: ${file} matches HLD §5.4`] };
  return { ok: false, lines: [`FAIL: ${file}`, ...problems.map((p) => `  - ${p}`)] };
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest() ? 0 : 1;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let hld;
  try {
    hld = parseTokenTable(readFileSync(resolve(root, 'docs/design/HLD.md'), 'utf8'));
  } catch (e) {
    process.stderr.write(`theme check: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const results = [
    checkFile(hld, root, 'src/panel/ui/theme/tokens.ts', true),
    checkFile(hld, root, 'src/panel/launcher-tokens.ts', false),
  ];
  for (const r of results) process.stdout.write(`${r.lines.join('\n')}\n`);
  const ok = results.every((r) => r.ok);
  process.stdout.write(ok ? 'theme: tokens match the HLD\n' : 'theme: FAILED\n');
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
