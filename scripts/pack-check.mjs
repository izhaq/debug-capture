#!/usr/bin/env node
/**
 * `npm run pack:check` — does the package work for someone who installs it?
 * The other checks run against src/; this one runs against what `npm pack`
 * ships (needs a fresh `npm run build`):
 *
 *   1. The tarball holds only package.json, README.md, the bundles
 *      (dist/*.mjs, dist/chunks/*.mjs), their maps and the .d.ts files. Every
 *      map carries its sources (`sourcesContent`): src/ is not shipped.
 *   2. The tarball is installed into a throw-away consumer, which type-checks
 *      an import of every entry point with TypeScript `moduleResolution`
 *      node (node10 — the Angular 16 host), bundler, node16 and nodenext,
 *      with `skipLibCheck: false` so the shipped .d.ts are checked too.
 *   3. Plain Node ESM imports every entry point, `debug-capture/package.json`
 *      resolves, and internals (`dist/core/…`, maps) are not exported.
 *
 * The consumer lives in node_modules/.cache/ so it finds `@angular/core` (an
 * optional peer) and `typescript` in this package's own install, as an app
 * would find them in its own.
 *
 * Usage: node scripts/pack-check.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistFresh } from './dist-fresh.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const work = path.join(root, 'node_modules', '.cache', 'debug-capture-pack-check');
const consumer = path.join(work, 'consumer');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const failures = [];

assertDistFresh(root);
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(consumer, { recursive: true });

// 1. Pack and look inside.
const [packed] = JSON.parse(
  execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], {
    cwd: root,
    encoding: 'utf8',
  }),
);
const tarball = path.join(work, packed.filename);
const SHIPPED = [
  /^package\.json$/,
  /^README\.md$/,
  /^dist\/[\w-]+\.mjs(\.map)?$/,
  /^dist\/chunks\/[\w-]+\.mjs(\.map)?$/,
  /^dist\/([\w.-]+\/)*[\w.-]+\.d\.ts$/,
];
for (const { path: file } of packed.files) {
  if (!SHIPPED.some((re) => re.test(file))) failures.push(`tarball: ${file} should not ship`);
  if (/\.spec\.d\.ts$/.test(file)) failures.push(`tarball: ${file} is a spec`);
}
console.log(`packed ${packed.filename}: ${packed.files.length} files, ${packed.size} B`);

// 2. Install into a consumer.
writeJson(path.join(consumer, 'package.json'), { name: 'consumer', private: true, type: 'module' });
execFileSync(
  npm,
  [
    'install',
    tarball,
    '--offline',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    '--no-package-lock',
    '--loglevel=error',
  ],
  { cwd: consumer, stdio: 'inherit' },
);
const installed = path.join(consumer, 'node_modules', 'debug-capture');

for (const file of walk(installed).filter((f) => f.endsWith('.map'))) {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(installed, file);
  const content = map.sourcesContent ?? [];
  map.sources.forEach((source, i) => {
    if (typeof content[i] !== 'string') failures.push(`${rel}: no sourcesContent for ${source}`);
  });
}

fs.writeFileSync(
  path.join(consumer, 'main.ts'),
  `import { getActiveCaptureSession, installDebugCapture, MAX_PENDING_REQUESTS, type CaptureEntry } from 'debug-capture';
import { provideDebugCapture } from 'debug-capture/angular';
import { createReactRootErrorOptions } from 'debug-capture/react';
import { PANEL_ELEMENT_NAME, type InstallDebugPanel } from 'debug-capture/panel';

export const install: typeof installDebugCapture = installDebugCapture;
export const entries: readonly CaptureEntry[] | undefined = getActiveCaptureSession()?.recorder.snapshot();
export const limit: number = MAX_PENDING_REQUESTS;
export const providers = provideDebugCapture;
export const react = createReactRootErrorOptions;
export const panelName: string = PANEL_ELEMENT_NAME;
export type Panel = InstallDebugPanel;
`,
);
const MODES = {
  node: { module: 'es2020', moduleResolution: 'node' },
  bundler: { module: 'esnext', moduleResolution: 'bundler' },
  node16: { module: 'node16', moduleResolution: 'node16' },
  nodenext: { module: 'nodenext', moduleResolution: 'nodenext' },
};
const tsc = require.resolve('typescript/bin/tsc');
for (const [mode, options] of Object.entries(MODES)) {
  const config = `tsconfig.${mode}.json`;
  writeJson(path.join(consumer, config), {
    compilerOptions: {
      ...options,
      target: 'es2020',
      lib: ['es2020', 'dom'],
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    },
    files: ['main.ts'],
  });
  try {
    execFileSync(process.execPath, [tsc, '-p', config], { cwd: consumer, encoding: 'utf8', stdio: 'pipe' });
    console.log(`tsc moduleResolution ${mode}: ok`);
  } catch (error) {
    failures.push(`tsc moduleResolution ${mode}:\n${indent(error.stdout || error.message)}`);
  }
}

// 3. Plain Node ESM.
fs.writeFileSync(
  path.join(consumer, 'main.mjs'),
  `import { createRequire } from 'node:module';
const problems = [];
const expectExport = async (specifier, name) => {
  try {
    const m = await import(specifier);
    if (!(name in m)) problems.push(\`\${specifier}: no export \${name}\`);
  } catch (error) {
    problems.push(\`\${specifier}: \${error.code ?? ''} \${error.message}\`);
  }
};
await expectExport('debug-capture', 'installDebugCapture');
await expectExport('debug-capture/angular', 'provideDebugCapture');
await expectExport('debug-capture/react', 'createReactRootErrorOptions');
await expectExport('debug-capture/panel', 'PANEL_ELEMENT_NAME');
await expectExport('debug-capture/dist/index.mjs', 'installDebugCapture');
try {
  createRequire(import.meta.url).resolve('debug-capture/package.json');
} catch (error) {
  problems.push(\`debug-capture/package.json: \${error.code}\`);
}
for (const internal of ['debug-capture/dist/core/index.js', 'debug-capture/dist/index.mjs.map', 'debug-capture/dist/index.d.ts']) {
  try {
    await import(internal);
    problems.push(\`\${internal}: is exported, should not be\`);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') problems.push(\`\${internal}: \${error.code} \${error.message}\`);
  }
}
console.log(JSON.stringify(problems));
`,
);
const nodeProblems = JSON.parse(execFileSync(process.execPath, ['main.mjs'], { cwd: consumer, encoding: 'utf8' }));
nodeProblems.forEach((p) => failures.push(`node ESM: ${p}`));
if (nodeProblems.length === 0) console.log('node ESM import of every entry point: ok');

if (failures.length > 0) {
  failures.forEach((f) => console.error(`FAIL ${f}`));
  console.error(`\npack check: ${failures.length} problem(s).`);
  process.exit(1);
}
fs.rmSync(work, { recursive: true, force: true });
console.log('pack check: ok');

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function indent(text) {
  return text
    .trim()
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}
