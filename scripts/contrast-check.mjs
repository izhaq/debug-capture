#!/usr/bin/env node
// Contrast check for the panel's colour tokens (HLD §5.4, NFR-A11Y-01).
//
// Reads the token table in docs/design/HLD.md (both themes) and checks every
// text, border, match and badge pair against its WCAG floor. It also checks
// that the "Measured minimum ratios" paragraph still matches the numbers, so
// the HLD can never drift from its own tokens.
//
// Usage (from packages/debug-capture/):
//   node scripts/contrast-check.mjs               check docs/design/HLD.md
//   node scripts/contrast-check.mjs --hld <path>  check another copy
//   node scripts/contrast-check.mjs --self-test   check this script
//
// No dependencies. S-04 reuses the exported functions to check the real
// theme stylesheet.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEXT_FLOOR = 4.5;
export const NON_TEXT_FLOOR = 3;
export const ROW_TINT = 0.08;
export const BADGE_TINT = 0.12;

export const BASES = ['bg', 'bg-elevated', 'bg-row-alt', 'bg-hover', 'bg-selected'];
export const TEXT_TOKENS = [
  'text',
  'text-muted',
  'text-faint',
  'accent',
  'success',
  'info',
  'warning',
  'error',
  'json-key',
  'json-string',
  'json-number',
  'json-literal',
];
export const TINTS = ['error', 'warning'];
export const BADGES = [
  { name: 'redacted', token: 'text-muted' },
  { name: 'pending', token: 'text-muted' },
  { name: 'truncated', token: 'warning' },
];

/** Names used by the "Measured minimum ratios" paragraph → tokens. */
const MEASURED_NAMES = {
  text: ['text'],
  muted: ['text-muted'],
  faint: ['text-faint'],
  accent: ['accent'],
  success: ['success'],
  info: ['info'],
  warning: ['warning'],
  error: ['error'],
  JSON: ['json-key', 'json-string', 'json-number', 'json-literal'],
  'control border': ['border-control'],
  match: ['text on match-bg'],
};

/** '#abc' or '#aabbcc' → [r, g, b] (0–255). Throws on anything else. */
export function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** [r, g, b] → '#rrggbb'. */
export function toHex(rgb) {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.x relative luminance of a hex colour. */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours, 1–21 (order does not matter). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `top` at `alpha` (0–1) over the opaque `bottom`, per channel, rounded to
 * whole RGB values — the HLD's numbers use this rounding.
 */
export function blend(top, bottom, alpha) {
  const t = parseHex(top);
  const b = parseHex(bottom);
  return toHex(t.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha))));
}

function sectionText(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`Heading not found: ${heading}`);
  const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/**
 * Reads the colour token table: rows like
 * `| \`--dcp-bg\` | use | \`#1e1f22\` | \`#ffffff\` |`.
 * Pass the whole HLD (the §5.4 section is found by its heading) or just a
 * table. Returns `{ dark: { bg: '#1e1f22', … }, light: { … } }` with the
 * `--dcp-` prefix removed.
 */
export function parseTokenTable(markdown) {
  const text = /^### 5\.4 /m.test(markdown) ? sectionText(markdown, '### 5.4 ') : markdown;
  const dark = {};
  const light = {};
  const row =
    /^\|\s*`--dcp-([a-z0-9-]+)`\s*\|[^|\n]*\|\s*`?(#[0-9a-fA-F]{3,6})`?\s*\|\s*`?(#[0-9a-fA-F]{3,6})`?\s*\|/gm;
  for (const m of text.matchAll(row)) {
    dark[m[1]] = m[2].toLowerCase();
    light[m[1]] = m[3].toLowerCase();
  }
  if (Object.keys(dark).length === 0) {
    throw new Error('No --dcp- token rows found in the token table');
  }
  return { dark, light };
}

/**
 * Reads the "Measured minimum ratios" paragraph. Returns
 * `{ dark: { text: '9.06', JSON: '5.34–7.51', … }, light: { … } }`
 * (values as written, so 7.00 stays '7.00').
 */
export function parseMeasuredMinimums(markdown) {
  const m = /Measured minimum ratios[^:]*:([\s\S]*?)(?:\n\s*\n|$)/.exec(markdown);
  if (!m) throw new Error('"Measured minimum ratios" paragraph not found');
  const body = m[1].replace(/\s+/g, ' ');
  const parts = /dark\s*[—-]+\s*(.*?);\s*light\s*[—-]+\s*(.*?)\.?\s*$/.exec(body);
  if (!parts) throw new Error('Cannot split the measured ratios into dark/light');
  const read = (list) => {
    const out = {};
    for (const item of list.split(',')) {
      const im = /^\s*(.+?)\s+([\d.]+(?:\s*[–-]\s*[\d.]+)?)\s*$/.exec(item);
      if (!im) throw new Error(`Cannot read measured ratio: "${item.trim()}"`);
      // A range is kept with the en dash the HLD uses.
      out[im[1]] = im[2].replace(/\s*[–-]\s*/, '–');
    }
    return out;
  };
  return { dark: read(parts[1]), light: read(parts[2]) };
}

function need(theme, name) {
  const v = theme[name];
  if (!v) throw new Error(`Token missing: --dcp-${name}`);
  return v;
}

/** Every background a text token can sit on: the bases, plain and tinted. */
export function textBackgrounds(theme) {
  const out = [];
  for (const base of BASES) {
    out.push({ label: base, hex: need(theme, base) });
    for (const tint of TINTS) {
      out.push({
        label: `${base} + 8% ${tint}`,
        hex: blend(need(theme, tint), need(theme, base), ROW_TINT),
      });
    }
  }
  return out;
}

/**
 * Checks one theme. Returns `{ results, failures, minimums }` where each
 * result is `{ fg, worstOn, ratio, floor, ok }` (worst background per
 * foreground) and `minimums` maps a foreground label to its worst ratio.
 */
export function checkTheme(theme) {
  const results = [];
  const pairs = (fg, fgHex, backgrounds, floor) => {
    let worst = null;
    for (const bg of backgrounds) {
      const ratio = contrastRatio(fgHex, bg.hex);
      if (!worst || ratio < worst.ratio) worst = { on: bg.label, ratio };
    }
    const ok = worst.ratio >= floor;
    results.push({ fg, worstOn: worst.on, ratio: worst.ratio, floor, ok });
  };

  const textBgs = textBackgrounds(theme);
  for (const t of TEXT_TOKENS) pairs(t, need(theme, t), textBgs, TEXT_FLOOR);

  const plainBgs = BASES.map((b) => ({ label: b, hex: need(theme, b) }));
  pairs('border-control', need(theme, 'border-control'), plainBgs, NON_TEXT_FLOOR);

  pairs('text on match-bg', need(theme, 'text'), [{ label: 'match-bg', hex: need(theme, 'match-bg') }], TEXT_FLOOR);

  for (const b of BADGES) {
    const fg = need(theme, b.token);
    const bg = blend(fg, need(theme, 'bg'), BADGE_TINT);
    const on = [{ label: `12% ${b.token} over bg`, hex: bg }];
    pairs(`badge ${b.name} (${b.token})`, fg, on, TEXT_FLOOR);
  }

  const minimums = {};
  for (const r of results) minimums[r.fg] = r.ratio;
  return { results, failures: results.filter((r) => !r.ok), minimums };
}

/** Two decimals, the way the HLD writes ratios. */
export function fmt(ratio) {
  return ratio.toFixed(2);
}

/**
 * Compares the written minimums with the computed ones. Returns a list of
 * messages (empty = they match). A JSON range is "lowest–highest" of the four
 * JSON tokens' minimums.
 */
export function compareMeasured(written, computed) {
  const problems = [];
  for (const [name, tokens] of Object.entries(MEASURED_NAMES)) {
    const values = tokens.map((t) => computed[t]);
    if (values.some((v) => v === undefined)) {
      problems.push(`no computed value for "${name}"`);
      continue;
    }
    const want = values.length === 1 ? fmt(values[0]) : `${fmt(Math.min(...values))}–${fmt(Math.max(...values))}`;
    const have = written[name];
    if (have === undefined) problems.push(`"${name}" is missing (computed ${want})`);
    else if (have !== want) problems.push(`"${name}" says ${have}, computed ${want}`);
  }
  for (const name of Object.keys(written)) {
    if (!(name in MEASURED_NAMES)) problems.push(`unknown name "${name}"`);
  }
  return problems;
}

/** Reads the badge claim "measured ≥ 5.40 in both themes" (as written). */
export function parseBadgeMinimum(markdown) {
  const m = /\*\*Badges\*\*[\s\S]*?measured\s*≥\s*([\d.]+)/.exec(markdown);
  if (!m) throw new Error('Badge "measured ≥ …" claim not found');
  return m[1];
}

/** Runs every check on an HLD text. Returns `{ lines, ok }`. */
export function checkHld(markdown) {
  const tokens = parseTokenTable(markdown);
  const measured = parseMeasuredMinimums(markdown);
  const badgeClaim = parseBadgeMinimum(markdown);
  const badgeRatios = [];
  const lines = [];
  let ok = true;
  for (const name of ['dark', 'light']) {
    const { results, minimums } = checkTheme(tokens[name]);
    for (const r of results) if (r.fg.startsWith('badge ')) badgeRatios.push(r.ratio);
    lines.push('', `${name} theme`, row('foreground', 'worst background', 'ratio', 'floor', ''));
    for (const r of results) {
      if (!r.ok) ok = false;
      lines.push(row(r.fg, r.worstOn, fmt(r.ratio), fmt(r.floor), r.ok ? 'ok' : 'FAIL'));
    }
    const drift = compareMeasured(measured[name], minimums);
    if (drift.length) {
      ok = false;
      lines.push(`FAIL: HLD §5.4 "Measured minimum ratios" (${name}) does not match the tokens:`);
      for (const d of drift) lines.push(`  - ${d}`);
    } else {
      lines.push(`ok: "Measured minimum ratios" (${name}) matches the tokens`);
    }
  }
  const badgeMin = fmt(Math.min(...badgeRatios));
  if (badgeMin !== badgeClaim) {
    ok = false;
    lines.push('', `FAIL: HLD §5.4 badges say "measured ≥ ${badgeClaim}", computed ${badgeMin}`);
  } else {
    lines.push('', `ok: badge claim "measured ≥ ${badgeClaim}" matches the tokens`);
  }
  return { lines, ok };
}

function row(a, b, c, d, e) {
  return `  ${a.padEnd(30)} ${b.padEnd(28)} ${c.padStart(6)} ${d.padStart(6)}  ${e}`;
}

function selfTest() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`${label}: got ${actual}, want ${wanted}`);
  };

  expect('#000 on #fff', fmt(contrastRatio('#000', '#fff')), '21.00');
  expect('#fff on #000 (order)', fmt(contrastRatio('#fff', '#000')), '21.00');
  expect('#777 on #fff', fmt(contrastRatio('#777777', '#ffffff')), '4.48');
  expect('same colour', fmt(contrastRatio('#123456', '#123456')), '1.00');
  expect('blend 50% black/white', blend('#000000', '#ffffff', 0.5), '#808080');
  expect('blend 8% #b0141f over #fff', blend('#b0141f', '#ffffff', 0.08), '#f9eced');
  expect('blend 0%', blend('#ff0000', '#00ff00', 0), '#00ff00');
  let threw = false;
  try {
    parseHex('red');
  } catch {
    threw = true;
  }
  expect('parseHex rejects "red"', threw, true);

  // A tiny table: #777 text fails 4.5:1 on white; everything else passes.
  const table = [
    '| Token | Use | Dark | Light |',
    '|---|---|---|---|',
    '| `--dcp-bg` | x | `#000000` | `#ffffff` |',
    '| `--dcp-bg-elevated` | x | `#000000` | `#ffffff` |',
    '| `--dcp-bg-row-alt` | x | `#000000` | `#ffffff` |',
    '| `--dcp-bg-hover` | x | `#000000` | `#ffffff` |',
    '| `--dcp-bg-selected` | x | `#000000` | `#ffffff` |',
    '| `--dcp-border-control` | x | `#888888` | `#777777` |',
    '| `--dcp-match-bg` | x | `#333333` | `#ffff00` |',
    ...TEXT_TOKENS.map(
      (t) => `| \`--dcp-${t}\` | x | \`#ffffff\` | \`${t === 'text-faint' ? '#777777' : '#000000'}\` |`,
    ),
  ].join('\n');
  const parsed = parseTokenTable(table);
  expect('parse: dark bg', parsed.dark['bg'], '#000000');
  expect('parse: light text-faint', parsed.light['text-faint'], '#777777');
  expect('parse: token count', Object.keys(parsed.light).length, 7 + TEXT_TOKENS.length);
  const dark = checkTheme(parsed.dark);
  expect('tiny dark: no failures', dark.failures.length, 0);
  const light = checkTheme(parsed.light);
  expect('tiny light: one failure', light.failures.map((f) => f.fg).join(','), 'text-faint');
  expect('tiny light: border 4.48 ≥ 3 passes', light.results.find((r) => r.fg === 'border-control')?.ok, true);

  // The drift check reads the paragraph and spots a changed number.
  const para =
    'Measured minimum ratios (worst background): dark —\ntext 9.06, JSON 5.34–7.51; light — text 1.00.\n\nnext';
  const m = parseMeasuredMinimums(para);
  expect('measured: dark text', m.dark['text'], '9.06');
  expect('measured: dark JSON range', m.dark['JSON'], '5.34–7.51');
  expect('measured: light text', m.light['text'], '1.00');
  const textOnly = (problems) => problems.filter((p) => p.startsWith('"text"'));
  const same = textOnly(compareMeasured({ text: '9.06' }, { text: 9.0612 }));
  expect('compare: equal at 2 decimals', same.length, 0);
  const drift = textOnly(compareMeasured({ text: '9.05' }, { text: 9.0612 }));
  expect('compare: drift found', drift[0], '"text" says 9.05, computed 9.06');
  const badges = '**Badges** (x): text … (measured\n≥ 5.40 in both themes)';
  expect('badge claim', parseBadgeMinimum(badges), '5.40');

  if (failures.length) {
    process.stdout.write(`contrast self-test: ${failures.length} FAILED\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    return false;
  }
  process.stdout.write('contrast self-test: all passed\n');
  return true;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest() ? 0 : 1;
  const i = argv.indexOf('--hld');
  const here = dirname(fileURLToPath(import.meta.url));
  const path = i >= 0 ? resolve(argv[i + 1] ?? '') : resolve(here, '../docs/design/HLD.md');
  if (i >= 0 && !argv[i + 1]) {
    process.stderr.write('--hld needs a path\n');
    return 2;
  }
  let result;
  try {
    result = checkHld(readFileSync(path, 'utf8'));
  } catch (e) {
    process.stderr.write(`contrast check: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  process.stdout.write(`Contrast check: ${path}\n${result.lines.join('\n')}\n\n`);
  process.stdout.write(result.ok ? 'contrast: all pairs pass\n' : 'contrast: FAILED\n');
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
