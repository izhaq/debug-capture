#!/usr/bin/env node
/**
 * Builds the Angular and React test hosts (S-10a, NFR-PORT-01) into
 * .test-out/hosts/<name>/, the way an app's bundler would: esbuild bundles
 * test/hosts/<name>/main.mjs with its framework from node_modules. The
 * package's own specifiers (`debug-capture`, `debug-capture/panel`, …)
 * resolve through package.json `exports` (the `import` condition) to the
 * built dist/*.mjs — the files `npm pack` ships, never src/. Splitting stays
 * on, so the panel UI stays a lazy chunk in the host's own output.
 * `playwright.config.mjs` runs this before the static server starts.
 *
 * Usage: node test/hosts/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { assertDistFresh } from '../../scripts/dist-fresh.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const HOSTS = ['angular', 'react'];

assertDistFresh(root);

/** `debug-capture[/<entry>]` → the dist file its `exports` entry names; anything else is left to esbuild. */
const packageExports = {
  name: 'debug-capture-exports',
  setup(build) {
    build.onResolve({ filter: new RegExp(`^${pkg.name}(/.*)?$`) }, ({ path: specifier }) => {
      const key = `.${specifier.slice(pkg.name.length)}`;
      const target = pkg.exports[key];
      const file = typeof target === 'object' && target !== null ? target.import : undefined;
      if (typeof file !== 'string') return { errors: [{ text: `${specifier} is not exported by package.json` }] };
      return { path: path.join(root, file) };
    });
  },
};

for (const name of HOSTS) {
  const outdir = path.join(root, '.test-out', 'hosts', name);
  fs.rmSync(outdir, { recursive: true, force: true });
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [`test/hosts/${name}/main.mjs`],
    outdir,
    outExtension: { '.js': '.mjs' },
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    sourcemap: true,
    // React picks its development build otherwise; an app ships production.
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [packageExports],
    logLevel: 'warning',
  });
  console.log(`host ${name}: .test-out/hosts/${name}/main.mjs`);
}
