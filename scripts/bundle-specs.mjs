#!/usr/bin/env node
/**
 * Bundles every `src/**\/*.spec.ts` (after `test/unit/setup.ts`) into one
 * browser script, `.test-out/specs.js`, for Karma (`karma.conf.cjs`).
 *
 * Coverage: each non-spec file under `src/` is compiled by esbuild and then
 * instrumented by istanbul (with the TS source map, so the report and the
 * thresholds in `karma.conf.cjs` are per .ts line). `--no-coverage` skips it.
 *
 * Usage: node scripts/bundle-specs.mjs [--no-coverage]
 */
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { readCompilerOptions } from './tsconfig-options.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const outFile = path.join(root, '.test-out', 'specs.js');
const coverage = !process.argv.includes('--no-coverage');

const specs = (await walk(srcDir)).filter((f) => f.endsWith('.spec.ts')).sort();
const entry = ['./test/unit/setup.ts', ...specs.map((f) => `./${toPosix(path.relative(root, f))}`)]
  .map((f) => `import ${JSON.stringify(f)};`)
  .join('\n');

await mkdir(path.dirname(outFile), { recursive: true });
await esbuild.build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'specs-entry.ts', loader: 'ts' },
  bundle: true,
  outfile: outFile,
  format: 'iife',
  target: 'es2020',
  sourcemap: 'inline',
  // The spec files are side-effect imports; package.json's `sideEffects: false`
  // (meant for consumers' bundlers) would otherwise drop them.
  ignoreAnnotations: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  plugins: coverage ? [istanbulPlugin()] : [],
  logLevel: 'warning',
});
console.log(
  `bundled ${specs.length} spec files${coverage ? ' (with coverage)' : ''} → ${toPosix(path.relative(root, outFile))}`,
);

/** Instruments `src/**\/*.ts` except specs. */
function istanbulPlugin() {
  const instrumenter = createInstrumenter({ esModules: true, compact: true, produceSourceMap: false });
  const tsconfigRaw = { compilerOptions: readCompilerOptions(path.join(root, 'tsconfig.json')) };
  return {
    name: 'istanbul',
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        const rel = toPosix(path.relative(srcDir, args.path));
        if (rel.startsWith('../') || rel.endsWith('.spec.ts') || rel.endsWith('.d.ts')) return undefined;
        const source = await readFile(args.path, 'utf8');
        const { code, map } = await esbuild.transform(source, {
          loader: 'ts',
          format: 'esm',
          target: 'es2020',
          sourcefile: args.path,
          sourcemap: 'external',
          tsconfigRaw,
        });
        return { contents: instrumenter.instrumentSync(code, args.path, JSON.parse(map)), loader: 'js' };
      });
    },
  };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs)));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}
