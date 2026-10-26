#!/usr/bin/env node
/**
 * `npm run size` — NFR-SIZE-01. Bundles each entry on its own with esbuild
 * (minified, ES2020), gzips it (level 6 — see GZIP_LEVEL) and compares with
 * `scripts/size-budgets.json`. Sizes are bytes, min+gzip; 1 kB = 1024 B.
 *
 *   core          src/index.ts, everything it pulls in   ≤ baseline + 3.5 kB (D-43)
 *   panel-loader  src/panel/index.ts + its static imports ≤ 5.5 kB (D-34)
 *   panel-ui      what only its dynamic import() loads    ≤ 44 kB (D-25, D-34)
 *   activate      src/activate/index.ts + its static imports, nothing external:
 *                 all a station loads before switch-on (D-43)
 *   angular       src/angular/index.ts                   recorded only
 *   react         src/react/index.ts                     recorded only
 *
 * The seams and the panel are measured with the core (the L5 barrel) and the
 * peer packages left out: a host loads the core anyway, and it has its own line.
 * An entry whose source does not exist yet is skipped and said so.
 *
 * Usage: node scripts/size.mjs [--root <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import { EXTERNAL_PACKAGES, existingEntries, packageRoot } from './entries.mjs';

/** zlib's default level: Apache's default, and the usual nginx setting (nginx's own default is 1). */
const GZIP_LEVEL = 6;

const root = packageRoot();
const budgets = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'size-budgets.json'), 'utf8'));
const { present } = existingEntries(root);
const has = (name) => present.some((e) => e.name === name);

const rows = [];
rows.push(await measure('core', 'src/index.ts', false));
for (const [name, source] of [
  ['angular', 'src/angular/index.ts'],
  ['react', 'src/react/index.ts'],
]) {
  rows.push(has(name) ? await measure(name, source, true) : skipped(name, source));
}
if (has('panel')) rows.push(...(await measurePanel()));
else rows.push(skipped('panel-loader', 'src/panel/index.ts'), skipped('panel-ui', 'src/panel/index.ts'));
rows.push(
  has('activate')
    ? await measureStatic('activate', 'src/activate/index.ts')
    : skipped('activate', 'src/activate/index.ts'),
);

print(rows);
const over = rows.filter((r) => r.status === 'OVER');
if (over.length > 0) {
  console.error(`\n${over.map((r) => r.name).join(', ')} over budget.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

async function measure(name, source, coreExternal) {
  const outputs = await bundle(source, coreExternal, false);
  const entry = outputs.find((o) => o.entryPoint);
  return row(name, entry.raw, entry.gzip);
}

/** An entry plus its static imports, with nothing external: what loads before any import() runs. */
async function measureStatic(name, source) {
  const outputs = await bundle(source, false, true);
  const byPath = new Map(outputs.map((o) => [o.path, o]));
  const seen = new Set();
  const stack = [outputs.find((o) => o.entryPoint).path];
  while (stack.length > 0) {
    const p = stack.pop();
    if (seen.has(p) || !byPath.has(p)) continue;
    seen.add(p);
    for (const i of byPath.get(p).imports) if (i.kind === 'import-statement' && !i.external) stack.push(i.path);
  }
  const sum = (key) => [...seen].reduce((n, p) => n + byPath.get(p)[key], 0);
  return row(name, sum('raw'), sum('gzip'), `${seen.size} file(s)`);
}

/** The loader is the entry plus its static imports; the UI chunk is what only import() reaches. */
async function measurePanel() {
  const outputs = await bundle('src/panel/index.ts', true, true);
  const byPath = new Map(outputs.map((o) => [o.path, o]));
  const closure = (start, kinds) => {
    const seen = new Set();
    const stack = [...start];
    while (stack.length > 0) {
      const p = stack.pop();
      if (seen.has(p) || !byPath.has(p)) continue;
      seen.add(p);
      for (const i of byPath.get(p).imports) if (kinds.includes(i.kind) && !i.external) stack.push(i.path);
    }
    return seen;
  };
  const loader = closure([outputs.find((o) => o.entryPoint).path], ['import-statement']);
  const all = closure([...loader], ['import-statement', 'dynamic-import']);
  const ui = [...all].filter((p) => !loader.has(p));
  const sum = (paths, key) => [...paths].reduce((n, p) => n + byPath.get(p)[key], 0);
  return [
    row('panel-loader', sum(loader, 'raw'), sum(loader, 'gzip'), `${loader.size} file(s)`),
    ui.length === 0
      ? { name: 'panel-ui', raw: '-', gzip: '-', budget: '-', status: 'skip', note: 'no dynamic import() chunk yet' }
      : row('panel-ui', sum(ui, 'raw'), sum(ui, 'gzip'), `${ui.length} chunk(s)`),
  ];
}

async function bundle(source, coreExternal, splitting) {
  const srcDir = path.join(root, 'src');
  const coreIsExternal = {
    name: 'core-external',
    setup(build) {
      build.onResolve({ filter: /^\.\.?(\/|$)/ }, (args) => {
        const abs = path.resolve(args.resolveDir, args.path).replace(/(\/index)?(\.ts)?$/, '');
        return abs === srcDir ? { path: 'debug-capture', external: true } : undefined;
      });
    },
  };
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [source],
    outdir: 'size-out',
    bundle: true,
    splitting,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    write: false,
    metafile: true,
    external: EXTERNAL_PACKAGES,
    plugins: coreExternal ? [coreIsExternal] : [],
    tsconfig: 'tsconfig.build.json',
    logLevel: 'warning',
  });
  return result.outputFiles.map((f) => {
    const rel = path.relative(root, f.path).split(path.sep).join('/');
    const meta = result.metafile.outputs[rel];
    return {
      path: rel,
      entryPoint: Boolean(meta.entryPoint),
      imports: meta.imports,
      raw: f.contents.length,
      gzip: gzipSync(f.contents, { level: GZIP_LEVEL }).length,
    };
  });
}

function row(name, raw, gzip, note = '') {
  const b = budgets[name] ?? {};
  if (typeof b.max === 'number') {
    return {
      name,
      raw,
      gzip,
      budget: b.max,
      status: gzip <= b.max ? 'ok' : 'OVER',
      note: [note, b.note].filter(Boolean).join('; '),
    };
  }
  const recorded = typeof b.recorded === 'number' ? `recorded ${b.recorded}` : 'not recorded';
  return { name, raw, gzip, budget: '-', status: 'info', note: [note, recorded].filter(Boolean).join('; ') };
}

function skipped(name, source) {
  return { name, raw: '-', gzip: '-', budget: '-', status: 'skip', note: `${source} does not exist yet` };
}

function print(table) {
  const head = ['entry', 'min B', 'min+gz B', 'budget B', 'status', 'note'];
  const cells = table.map((r) => [r.name, String(r.raw), String(r.gzip), String(r.budget), r.status, r.note]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) =>
    c
      .map((v, i) => (i >= 1 && i <= 3 ? v.padStart(widths[i]) : v.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  cells.forEach((c) => console.log(line(c)));
}
