#!/usr/bin/env node
/**
 * Checks on the dist/ bundles that `npm run build` runs on esbuild's metafile
 * (`outputs`: file → { imports: [{ path, kind, external? }], inputs: { path → … } }).
 *
 *   D-43    dist/activate.mjs and dist/activate-headless.mjs are all a station
 *           loads before switch-on: they may import statically only chunks made
 *           of src/activate/ code — in practice none, build.mjs makes each one
 *           file — never the core.
 *   FR-HL-02 nothing dist/activate-headless.mjs reaches — statically or by
 *           import(), through any chunk — holds src/panel/ code, so a host that
 *           imports it bundles no panel (D-56).
 *
 * Usage: node scripts/bundle-checks.mjs --self-test   (build.mjs imports the check)
 */
import { fileURLToPath } from 'node:url';

const ACTIVATION_ENTRIES = ['dist/activate.mjs', 'dist/activate-headless.mjs'];
const HEADLESS_ENTRY = 'dist/activate-headless.mjs';

/** Every problem with `outputs`, one line each; empty when the bundles are right. */
export function checkActivationOutputs(outputs) {
  const problems = [];
  for (const entry of ACTIVATION_ENTRIES) {
    const output = outputs[entry];
    if (!output) continue;
    for (const i of output.imports) {
      if (i.kind !== 'import-statement') continue;
      const chunk = outputs[i.path];
      const foreign = chunk ? Object.keys(chunk.inputs).filter((p) => !p.startsWith('src/activate/')) : [i.path];
      if (chunk && Object.keys(chunk.inputs).length === 0) foreign.push('(no inputs)');
      if (foreign.length > 0) {
        problems.push(`${entry} imports ${i.path} statically, which holds ${foreign.join(', ')} (D-43, rule 9)`);
      }
    }
  }
  if (outputs[HEADLESS_ENTRY]) {
    const seen = new Set();
    const stack = [HEADLESS_ENTRY];
    while (stack.length > 0) {
      const file = stack.pop();
      if (seen.has(file) || !outputs[file]) continue;
      seen.add(file);
      const panel = Object.keys(outputs[file].inputs).filter((p) => p.startsWith('src/panel/'));
      if (panel.length > 0) {
        problems.push(
          `${HEADLESS_ENTRY} reaches ${file}, which holds panel code: ${panel.join(', ')} (FR-HL-02, D-56)`,
        );
      }
      for (const i of outputs[file].imports) if (!i.external) stack.push(i.path);
    }
  }
  return problems;
}

function selfTest() {
  const chunk = (inputs, imports = []) => ({
    imports,
    inputs: Object.fromEntries(inputs.map((p) => [p, { bytesInOutput: 1 }])),
  });
  const imp = (path, kind = 'import-statement') => ({ path, kind });
  const good = {
    'dist/activate.mjs': chunk(
      ['src/activate/index.ts'],
      [imp('dist/chunks/a.mjs'), imp('dist/index.mjs', 'dynamic-import'), imp('dist/panel.mjs', 'dynamic-import')],
    ),
    'dist/activate-headless.mjs': chunk(
      ['src/activate/headless.ts'],
      [imp('dist/chunks/a.mjs'), imp('dist/index.mjs', 'dynamic-import')],
    ),
    'dist/chunks/a.mjs': chunk(['src/activate/activate.ts']),
    'dist/index.mjs': chunk(['src/index.ts'], [imp('dist/chunks/core.mjs')]),
    'dist/chunks/core.mjs': chunk(['src/install/install-debug-capture.ts']),
    'dist/panel.mjs': chunk(
      ['src/panel/index.ts'],
      [imp('dist/chunks/core.mjs'), imp('dist/chunks/app.mjs', 'dynamic-import')],
    ),
    'dist/chunks/app.mjs': chunk(['src/panel/app/frame.ts']),
  };
  const cases = [
    ['the real shape', good, 0],
    [
      'activate imports the core statically',
      { ...good, 'dist/activate.mjs': chunk(['src/activate/index.ts'], [imp('dist/chunks/core.mjs')]) },
      1,
    ],
    [
      'the shared chunk also holds core code',
      { ...good, 'dist/chunks/a.mjs': chunk(['src/activate/activate.ts', 'src/core/clock.ts']) },
      2,
    ],
    [
      'headless reaches the panel by import()',
      {
        ...good,
        'dist/activate-headless.mjs': chunk(
          ['src/activate/headless.ts'],
          [imp('dist/chunks/a.mjs'), imp('dist/panel.mjs', 'dynamic-import')],
        ),
      },
      2,
    ],
    [
      'headless reaches the panel through the core',
      { ...good, 'dist/chunks/core.mjs': chunk(['src/install/install-debug-capture.ts', 'src/panel/api.ts']) },
      1,
    ],
  ];
  let failed = 0;
  for (const [name, outputs, expected] of cases) {
    const got = checkActivationOutputs(outputs).length;
    if (got !== expected) {
      failed += 1;
      console.error(`bundle-checks self-test: "${name}" gave ${got} problem(s), expected ${expected}`);
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`bundle-checks self-test: ${cases.length} cases ok`);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) selfTest();
