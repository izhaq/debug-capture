#!/usr/bin/env node
/**
 * `npm run build`:
 *   1. `tsc -p tsconfig.build.json` → dist/**\/*.d.ts, one per source file
 *      (declarations only; the JavaScript that ships is the bundles below).
 *      Then every relative specifier in them gets its real file name
 *      (`'./install'` → `'./install/index.js'`): TypeScript's node16/nodenext
 *      resolution reads a .d.ts in this `type: module` package as ESM and
 *      resolves no extensionless path. node10 and bundler accept both.
 *   2. esbuild → dist/<entry>.mjs, ES2020 bundles. They are what package.json
 *      `exports` points to, and a plain page can load them with no bundler
 *      (NFR-PORT-01). All entries are built together with code splitting:
 *      shared code (the core) lands in one chunk that every entry imports, so
 *      an app that imports `debug-capture` and `debug-capture/panel` runs one
 *      copy of the core; the panel UI behind its dynamic import() gets its own
 *      chunk. `@angular/*` and `rxjs` stay external. The source maps embed
 *      their sources (`sourcesContent`): src/ is not shipped.
 * An entry whose source file does not exist yet is skipped.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { EXTERNAL_PACKAGES, existingEntries, packageRoot } from './entries.mjs';

const root = packageRoot();
const dist = path.join(root, 'dist');
const require = createRequire(import.meta.url);

fs.rmSync(dist, { recursive: true, force: true });

console.log('tsc -p tsconfig.build.json');
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.build.json')], {
  stdio: 'inherit',
});

const rewritten = addExtensionsToDeclarations(dist);
console.log(`.d.ts: ${rewritten} relative specifiers given a file name`);

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
  sourcesContent: true,
  external: EXTERNAL_PACKAGES,
  tsconfig: 'tsconfig.build.json',
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.entries(result.metafile.outputs).filter(([file]) => file.endsWith('.mjs'));
for (const [file, info] of outputs) console.log(`${file.padEnd(40)} ${String(info.bytes).padStart(7)} B`);

/**
 * Rewrites each relative module specifier in dist/**\/*.d.ts to the `.js`
 * name of the file it means (`x.d.ts` → `x.js`, `x/index.d.ts` →
 * `x/index.js`). Fails the build on a specifier that matches no file.
 */
function addExtensionsToDeclarations(dir) {
  let count = 0;
  for (const file of walk(dir).filter((f) => f.endsWith('.d.ts'))) {
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const edits = [];
    const visit = (node) => {
      let literal = null;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        literal = node.moduleSpecifier;
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        literal = node.argument.literal;
      }
      if (literal && ts.isStringLiteral(literal) && /^\.\.?(\/|$)/.test(literal.text)) {
        edits.push({
          start: literal.getStart(source) + 1,
          end: literal.getEnd() - 1,
          text: withFileName(file, literal.text),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (edits.length === 0) continue;
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    fs.writeFileSync(file, out);
    count += edits.length;
  }
  return count;
}

function withFileName(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (fs.existsSync(`${base}.d.ts`)) return `${specifier}.js`;
  if (fs.existsSync(path.join(base, 'index.d.ts'))) return `${specifier.replace(/\/$/, '')}/index.js`;
  throw new Error(`${path.relative(root, fromFile)}: '${specifier}' matches no .d.ts file`);
}

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
