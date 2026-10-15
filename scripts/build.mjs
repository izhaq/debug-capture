#!/usr/bin/env node
/**
 * `npm run build`:
 *   1. `tsc -p tsconfig.build.json` → dist/**\/*.js + .d.ts (ESM, per source
 *      file; what package.json `exports` points to).
 *   2. esbuild → dist/<entry>.mjs, prebuilt ES2020 bundles a plain page can
 *      load with no bundler (NFR-PORT-01). All entries are built together with
 *      code splitting: shared code (the core) lands in one chunk that every
 *      entry imports, so a page that loads index.mjs and panel.mjs runs one
 *      copy of the core; the panel UI behind its dynamic import() gets its own
 *      chunk. `@angular/*` and `rxjs` stay external.
 * An entry whose source file does not exist yet is skipped.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { EXTERNAL_PACKAGES, existingEntries, packageRoot } from './entries.mjs';

const root = packageRoot();
const dist = path.join(root, 'dist');
const require = createRequire(import.meta.url);

fs.rmSync(dist, { recursive: true, force: true });

console.log('tsc -p tsconfig.build.json');
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.build.json')], {
  stdio: 'inherit',
});

const { present, missing } = existingEntries(root);
for (const e of missing) console.log(`skip dist/${e.name}.mjs — ${e.source} does not exist yet`);

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: present.map((e) => ({ in: e.source, out: e.name })),
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  external: EXTERNAL_PACKAGES,
  tsconfig: 'tsconfig.build.json',
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.entries(result.metafile.outputs).filter(([file]) => file.endsWith('.mjs'));
for (const [file, info] of outputs) console.log(`${file.padEnd(40)} ${String(info.bytes).padStart(7)} B`);
