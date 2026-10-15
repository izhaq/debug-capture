#!/usr/bin/env node
/**
 * debug-capture layer checker (HLD §6.2). Ported from v1's
 * `scripts/check-debug-capture-layers.js` in the host app and re-rooted at
 * this package's `src/`.
 *
 * The capture layer stays portable and auditable only while every layer
 * reaches the rest of the code through exactly one barrel. A deep import
 * compiles fine, so nothing but this script would notice one.
 *
 *   L1 contract     src/contract/          imports nothing
 *   L2 core         src/core/              → L1 barrel
 *   L3 adapters     src/adapters/**        → L2 barrel
 *   L4 install      src/install/           → L3 barrel
 *   L5 public       src/*.ts               → L4 barrel
 *   L6 angular      src/angular/           → L5 barrel + @angular/*, rxjs
 *   L6 react        src/react/             → L5 barrel (no packages, not even React)
 *   L6 panel:
 *     P1 model      src/panel/model/       → L5 barrel
 *     P2 ui         src/panel/ui/          → P1 barrel
 *     P3 views      src/panel/views/       → P2 barrel
 *     P4 app        src/panel/app/         → P3 barrel
 *     P5 loader     src/panel/*.ts         → L5 barrel, and the P4 barrel ONLY by
 *                                            `import type` / `export type` or one
 *                                            dynamic `import()` (rule 8)
 *
 * The L6 seams are siblings: none may import another, and the L5 barrel
 * re-exports none of them. Only src/angular/ imports packages.
 *
 * Inside a layer a path import is allowed only when it is (a) in the importing
 * file's own directory, (b) from an `index.ts`, the `index.ts` of an immediate
 * child directory of the same layer, or (c) the barrel of the layer directly
 * above.
 *
 * Rules cited in messages:
 *   rule 2  only an index.ts may import a child directory, and only its index.ts
 *   rule 3  a layer may import only the barrel of the layer above, not a file behind it
 *   rule 4  own directory, a child barrel or the barrel above — nothing else
 *   rule 5  no package imports (everything except src/angular/)
 *   rule 6  src/angular/ may import only @angular/*, rxjs and rxjs/*
 *   rule 8  P5 → P4 only as types or through one dynamic import(), so the UI
 *           chunk stays lazy (a static value import would pull it into the loader)
 *   (v1's rule 7 was about the host app's other code; a package has none.)
 *
 * Usage:
 *   node scripts/check-layers.mjs                 # check src/ of this package
 *   node scripts/check-layers.mjs --root <dir>    # check <dir>/src instead
 *   node scripts/check-layers.mjs --self-test     # run the rule table
 *
 * Notes:
 *   - Specifiers come from `ts.preProcessFile` (as in v1), so `export … from`,
 *     dynamic `import()` and `require` count and imports inside comments or
 *     strings do not. `preProcessFile` cannot tell `import type` from a value
 *     import, so the kind of each import comes from the TS AST.
 *   - `import { type A } from './x'` counts as a value import: whether it is
 *     erased depends on compiler flags. Write `import type { A }` instead.
 *   - Non-relative specifiers that resolve against the package root (tsconfig
 *     `baseUrl: './'`, e.g. `src/core`) are path imports, so they cannot get
 *     around the rules.
 *   - `checkImport` and `checkTree` are pure: files are passed in, so
 *     `--self-test` never touches the file system.
 *   - Exit code 1 on any violation, 0 on a clean run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const SRC = 'src';
const ANGULAR_PACKAGES = [/^@angular\//, /^rxjs$/, /^rxjs\//];

/**
 * `above` is the only other layer a layer may import (through its barrel).
 * `lazy` is a layer the loader may reach only by types or a dynamic import().
 */
export const LAYERS = {
  contract: { id: 'L1', barrel: `${SRC}/contract/index.ts`, above: null },
  core: { id: 'L2', barrel: `${SRC}/core/index.ts`, above: 'contract' },
  adapters: { id: 'L3', barrel: `${SRC}/adapters/index.ts`, above: 'core' },
  install: { id: 'L4', barrel: `${SRC}/install/index.ts`, above: 'adapters' },
  public: { id: 'L5', barrel: `${SRC}/index.ts`, above: 'install' },
  angular: { id: 'L6', barrel: `${SRC}/angular/index.ts`, above: 'public', packages: ANGULAR_PACKAGES },
  react: { id: 'L6', barrel: `${SRC}/react/index.ts`, above: 'public' },
  'panel/model': { id: 'P1', barrel: `${SRC}/panel/model/index.ts`, above: 'public', panel: true },
  'panel/ui': { id: 'P2', barrel: `${SRC}/panel/ui/index.ts`, above: 'panel/model', panel: true },
  'panel/views': { id: 'P3', barrel: `${SRC}/panel/views/index.ts`, above: 'panel/ui', panel: true },
  'panel/app': { id: 'P4', barrel: `${SRC}/panel/app/index.ts`, above: 'panel/views', panel: true },
  panel: { id: 'P5', barrel: `${SRC}/panel/index.ts`, above: 'public', lazy: 'panel/app', panel: true },
};

const TOP_LAYERS = ['contract', 'core', 'adapters', 'install', 'angular', 'react'];
const PANEL_LAYERS = ['model', 'ui', 'views', 'app'];
const UNCLASSIFIED = 'unclassified';
const OUTSIDE = 'outside';

/** Package-relative POSIX path → layer key, `UNCLASSIFIED`, or `OUTSIDE` (not under src/). */
export function classify(file) {
  if (!isInside(file, SRC)) return OUTSIDE;
  const parts = file.slice(SRC.length + 1).split('/');
  if (parts.length === 1) return 'public';
  if (TOP_LAYERS.includes(parts[0])) return parts[0];
  if (parts[0] === 'panel') {
    if (parts.length === 2) return 'panel';
    if (PANEL_LAYERS.includes(parts[1])) return `panel/${parts[1]}`;
  }
  return UNCLASSIFIED;
}

function isInside(file, dir) {
  return file.startsWith(`${dir}/`);
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/**
 * Checks one import. `from` is the importing file (package-relative),
 * `specifier` the module specifier (`null` for a dynamic import() whose
 * argument is not a string literal), `kind` one of `'value' | 'type' |
 * 'dynamic'`, and `exists(p)` reports whether a package-relative file exists.
 * Returns `null` when the import is allowed, otherwise a one-line reason that
 * cites the rule it breaks.
 */
export function checkImport(from, specifier, exists, kind = 'value') {
  const layer = classify(from);
  if (layer === OUTSIDE) return null;
  if (layer === UNCLASSIFIED) {
    return `fits no layer — files under ${SRC}/ belong in contract/, core/, adapters/, install/, angular/, react/, panel/{model,ui,views,app}/, panel/ or directly in ${SRC}/`;
  }
  if (specifier === null) return `import() needs a string literal, or it cannot be checked (rule 4)`;

  const { id, above, lazy, packages } = LAYERS[layer];
  const target = resolveSpecifier(from, specifier, exists);

  if (target === null) {
    if (isRelative(specifier)) return `cannot be resolved to a .ts file, so it cannot be checked (rule 4)`;
    if (packages) {
      return packages.some((re) => re.test(specifier)) ? null : `${id} angular may import only @angular/*, rxjs and rxjs/* packages (rule 6)`;
    }
    return `only ${SRC}/angular/ may import packages (rule 5)`;
  }

  const fromDir = path.posix.dirname(from);
  const targetDir = path.posix.dirname(target);

  if (targetDir === fromDir) return null; // (a) own directory
  // (b) child barrel — of the same layer only: the L5 barrel's children are
  // other layers, and reaching ./core from there would skip install.
  if (isIndex(from) && isIndex(target) && path.posix.dirname(targetDir) === fromDir && classify(target) === layer) {
    return null;
  }
  if (above !== null && target === LAYERS[above].barrel) return null; // (c) layer above

  if (lazy && classify(target) === lazy) {
    const lazyLayer = LAYERS[lazy];
    if (target !== lazyLayer.barrel) return `${id} may reach ${lazyLayer.id} only through its barrel, and only as types or by import() (rule 8)`;
    return kind === 'type' || kind === 'dynamic'
      ? null
      : `${id} may import the ${lazyLayer.id} barrel only by \`import type\`/\`export type\` or a dynamic import() — a value import would pull the UI chunk into the loader (rule 8)`;
  }
  if (above !== null && classify(target) === above) {
    return `${id} may only import the ${LAYERS[above].id} barrel, not a file behind it (rule 3)`;
  }
  if (isInside(target, fromDir) && classify(target) === layer) {
    return `only an index.ts may import a child directory, and only that child's index.ts (rule 2)`;
  }
  return above === null
    ? `${id} may only import files in its own directory (rule 4)`
    : `${id} may only import its own directory, a child barrel or the ${LAYERS[above].id} barrel (rule 4)`;
}

/**
 * Resolves the way tsconfig does: relative to the importing file, or to the
 * package root (`baseUrl: './'`), trying `<p>`, `<p>.ts` then `<p>/index.ts`.
 * Returns `null` for a package, and for a relative path that matches no file.
 */
function resolveSpecifier(from, specifier, exists) {
  const base = isRelative(specifier)
    ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    : path.posix.normalize(specifier);
  const candidates = [`${base}.ts`, `${base}/index.ts`];
  if (base.endsWith('.ts')) candidates.unshift(base);
  return candidates.find((c) => !c.startsWith('../') && exists(c)) ?? null;
}

function isRelative(specifier) {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

function isIndex(file) {
  return path.posix.basename(file) === 'index.ts';
}

// ---------------------------------------------------------------------------
// Reading imports
// ---------------------------------------------------------------------------

/**
 * Every module reference in a file, with its kind:
 *   'type'    — `import type`, `export type … from`, `import('./x').T` in a type
 *   'dynamic' — `import(…)` as an expression (`specifier: null` if not a literal)
 *   'value'   — everything else (`import`, `export … from`, `require`)
 */
export function extractImports(text, fileName = 'file.ts') {
  const found = [];
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const literal = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null);
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      found.push({ specifier: literal(node.moduleSpecifier), kind: node.importClause?.isTypeOnly ? 'type' : 'value' });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      found.push({ specifier: literal(node.moduleSpecifier), kind: node.isTypeOnly ? 'type' : 'value' });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push({ specifier: literal(node.moduleReference.expression), kind: node.isTypeOnly ? 'type' : 'value' });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      found.push({ specifier: literal(node.argument.literal), kind: 'type' });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found.push({ specifier: literal(node.arguments[0]), kind: 'dynamic' });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const specifier = literal(node.arguments[0]);
      if (specifier !== null) found.push({ specifier, kind: 'value' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // v1 took specifiers from preProcessFile. Keep it as the floor: anything it
  // sees that the AST walk did not becomes a value import, never a gap.
  const seen = new Set(found.map((f) => f.specifier));
  for (const { fileName: specifier } of ts.preProcessFile(text, true, true).importedFiles) {
    if (!seen.has(specifier)) found.push({ specifier, kind: 'value' });
  }
  return found;
}

// ---------------------------------------------------------------------------
// The whole tree
// ---------------------------------------------------------------------------

/**
 * Checks every file. `files` maps package-relative paths of every `.ts` file
 * under src/ to their text. Returns the list of violations (empty when clean).
 */
export function checkTree(files) {
  const exists = (p) => files.has(p);
  const hasPanel = [...files.keys()].some((f) => isInside(f, `${SRC}/panel`));
  const violations = [];

  for (const layer of Object.values(LAYERS)) {
    if (layer.panel && !hasPanel) continue; // the panel arrives with S-00 track 00b
    if (!exists(layer.barrel)) violations.push(`${layer.barrel}: missing — the ${layer.id} layer barrel must exist`);
  }

  const lazyLoads = [];
  for (const [file, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const layer = classify(file);
    if (layer === UNCLASSIFIED) {
      violations.push(`${file}: ${checkImport(file, '.', exists)}`);
      continue;
    }
    for (const { specifier, kind } of extractImports(text, file)) {
      const reason = checkImport(file, specifier, exists, kind);
      if (reason !== null) {
        violations.push(`${file}: ${kind === 'value' ? 'imports' : `${kind} import of`} '${specifier}' — ${reason}`);
      } else if (kind === 'dynamic' && LAYERS[layer]?.lazy) {
        const target = resolveSpecifier(file, specifier, exists);
        if (target === LAYERS[LAYERS[layer].lazy].barrel) lazyLoads.push(file);
      }
    }
  }
  if (lazyLoads.length > 1) {
    violations.push(`${lazyLoads.join(', ')}: ${lazyLoads.length} dynamic import()s of the P4 barrel — P5 loads the UI chunk from one place only (rule 8)`);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function main(root) {
  const files = new Map();
  for (const abs of walk(path.join(root, SRC))) {
    files.set(toPosix(path.relative(root, abs)), fs.readFileSync(abs, 'utf8'));
  }
  const violations = checkTree(files);
  if (violations.length > 0) {
    violations.forEach((v) => console.error(v));
    console.error(`\n${violations.length} layer violation${violations.length === 1 ? '' : 's'}.`);
    process.exit(1);
  }
  const panel = [...files.keys()].some((f) => isInside(f, `${SRC}/panel`)) ? '' : ' (no src/panel/ yet — P1–P5 not checked)';
  console.log(`ok — layer rules hold across ${files.size} files in ${SRC}/${panel}`);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Self-test (no file system)
// ---------------------------------------------------------------------------

const VIRTUAL_FILES = new Set([
  'src/index.ts',
  'src/public-api.spec.ts',
  'src/contract/index.ts',
  'src/contract/capture-contract.ts',
  'src/core/index.ts',
  'src/core/recorder.ts',
  'src/adapters/index.ts',
  'src/adapters/probes/index.ts',
  'src/adapters/probes/http/index.ts',
  'src/adapters/probes/http/xhr.probe.ts',
  'src/adapters/probes/http/headers.ts',
  'src/adapters/probes/websocket/index.ts',
  'src/adapters/sinks/index.ts',
  'src/adapters/sinks/download.sink.ts',
  'src/install/index.ts',
  'src/install/install.ts',
  'src/misc/stray.ts',
  'src/angular/index.ts',
  'src/angular/providers.ts',
  'src/react/index.ts',
  'src/react/react-error-handlers.ts',
  'src/panel/index.ts',
  'src/panel/element.ts',
  'src/panel/model/index.ts',
  'src/panel/model/store.ts',
  'src/panel/model/curl/index.ts',
  'src/panel/model/curl/curl.ts',
  'src/panel/ui/index.ts',
  'src/panel/ui/element-builder.ts',
  'src/panel/views/index.ts',
  'src/panel/views/http-list.ts',
  'src/panel/app/index.ts',
  'src/panel/app/frame.ts',
  'src/panel/misc/stray.ts',
]);

/** [importing file, specifier, kind, null when allowed | the rule the violation must cite]. */
const SELF_TEST_CASES = [
  // L1–L5, as in v1.
  ['src/core/recorder.ts', '../contract', 'value', null],
  ['src/core/recorder.ts', '../contract/capture-contract', 'value', 'rule 3'],
  ['src/core/recorder.ts', 'src/contract/capture-contract', 'value', 'rule 3'],
  ['src/contract/capture-contract.ts', '../core', 'value', 'rule 4'],
  ['src/adapters/probes/http/xhr.probe.ts', '../../../core', 'value', null],
  ['src/adapters/probes/http/xhr.probe.ts', '../../../core/recorder', 'value', 'rule 3'],
  ['src/adapters/probes/http/xhr.probe.ts', '../../../contract', 'value', 'rule 4'],
  ['src/adapters/probes/http/xhr.probe.ts', '../websocket', 'value', 'rule 4'],
  ['src/adapters/probes/http/xhr.probe.ts', './headers', 'value', null],
  ['src/adapters/probes/http/xhr.probe.ts', './missing', 'value', 'rule 4'],
  ['src/adapters/probes/index.ts', './http', 'value', null],
  ['src/adapters/sinks/download.sink.ts', '../../core', 'value', null],
  ['src/adapters/index.ts', '../core', 'value', null],
  ['src/adapters/index.ts', './probes', 'value', null],
  ['src/adapters/index.ts', './probes/http', 'value', 'rule 2'],
  ['src/install/install.ts', '../adapters', 'value', null],
  ['src/install/install.ts', '../core', 'value', 'rule 4'],
  ['src/install/index.ts', '../adapters', 'value', null],
  ['src/index.ts', './install', 'value', null],
  ['src/index.ts', './core', 'value', 'rule 4'],
  ['src/public-api.spec.ts', '.', 'value', null],
  ['src/core/recorder.ts', 'rxjs', 'value', 'rule 5'],
  ['src/core/recorder.ts', '@angular/core', 'type', 'rule 5'],
  ['src/misc/stray.ts', '.', 'value', 'fits no layer'],
  // L6 angular.
  ['src/angular/providers.ts', '@angular/core', 'value', null],
  ['src/angular/providers.ts', 'rxjs/operators', 'value', null],
  ['src/angular/providers.ts', 'lodash', 'value', 'rule 6'],
  ['src/angular/providers.ts', '..', 'value', null],
  ['src/angular/providers.ts', '../core', 'value', 'rule 4'],
  ['src/angular/index.ts', './providers', 'value', null],
  // L6 react: no packages, not even React.
  ['src/react/react-error-handlers.ts', '..', 'value', null],
  ['src/react/index.ts', './react-error-handlers', 'value', null],
  ['src/react/react-error-handlers.ts', '../install', 'value', 'rule 4'],
  ['src/react/react-error-handlers.ts', 'react', 'type', 'rule 5'],
  // L6 seams never import each other, and L5 re-exports none of them.
  ['src/angular/providers.ts', '../react', 'value', 'rule 4'],
  ['src/angular/providers.ts', '../panel', 'type', 'rule 4'],
  ['src/react/react-error-handlers.ts', '../angular', 'value', 'rule 4'],
  ['src/react/react-error-handlers.ts', '../panel', 'value', 'rule 4'],
  ['src/panel/element.ts', '../angular', 'value', 'rule 4'],
  ['src/panel/model/store.ts', '../../react', 'value', 'rule 4'],
  ['src/index.ts', './react', 'value', 'rule 4'],
  ['src/index.ts', './angular', 'value', 'rule 4'],
  ['src/index.ts', './panel', 'value', 'rule 4'],
  // P1 model → L5 barrel only.
  ['src/panel/model/store.ts', '../..', 'value', null],
  ['src/panel/model/index.ts', '../..', 'value', null],
  ['src/panel/model/index.ts', './curl', 'value', null],
  ['src/panel/model/curl/curl.ts', '../../..', 'value', null],
  ['src/panel/model/store.ts', '../../core', 'value', 'rule 4'],
  ['src/panel/model/store.ts', '../../install', 'value', 'rule 4'],
  ['src/panel/model/store.ts', '../ui', 'value', 'rule 4'],
  ['src/panel/model/store.ts', './curl', 'value', 'rule 2'],
  ['src/panel/model/store.ts', 'rxjs', 'value', 'rule 5'],
  // P2 ui → P1 barrel only.
  ['src/panel/ui/element-builder.ts', '../model', 'value', null],
  ['src/panel/ui/index.ts', '../model', 'value', null],
  ['src/panel/ui/element-builder.ts', '../model/store', 'value', 'rule 3'],
  ['src/panel/ui/element-builder.ts', '../..', 'value', 'rule 4'],
  ['src/panel/ui/element-builder.ts', '../views', 'value', 'rule 4'],
  // P3 views → P2 barrel only.
  ['src/panel/views/http-list.ts', '../ui', 'value', null],
  ['src/panel/views/http-list.ts', '../ui/element-builder', 'type', 'rule 3'],
  ['src/panel/views/http-list.ts', '../model', 'value', 'rule 4'],
  ['src/panel/views/http-list.ts', '../app', 'value', 'rule 4'],
  // P4 app → P3 barrel only.
  ['src/panel/app/frame.ts', '../views', 'value', null],
  ['src/panel/app/index.ts', '../views', 'value', null],
  ['src/panel/app/frame.ts', '../ui', 'value', 'rule 4'],
  ['src/panel/app/frame.ts', '..', 'value', 'rule 4'],
  ['src/panel/app/frame.ts', '@angular/core', 'value', 'rule 5'],
  // P5 loader → L5 barrel; P4 barrel only as types or a dynamic import().
  ['src/panel/index.ts', '..', 'value', null],
  ['src/panel/element.ts', '..', 'value', null],
  ['src/panel/index.ts', './element', 'value', null],
  ['src/panel/index.ts', './app', 'type', null],
  ['src/panel/element.ts', './app', 'dynamic', null],
  ['src/panel/index.ts', './app', 'value', 'rule 8'],
  ['src/panel/element.ts', './app/index', 'value', 'rule 8'],
  ['src/panel/index.ts', './app/frame', 'type', 'rule 8'],
  ['src/panel/index.ts', './app/frame', 'dynamic', 'rule 8'],
  ['src/panel/index.ts', './model', 'value', 'rule 4'],
  ['src/panel/index.ts', './views', 'type', 'rule 4'],
  ['src/panel/index.ts', '../core', 'value', 'rule 4'],
  ['src/panel/element.ts', 'lit', 'value', 'rule 5'],
  ['src/panel/element.ts', null, 'dynamic', 'string literal'],
  ['src/panel/misc/stray.ts', '.', 'value', 'fits no layer'],
];

const EXTRACT_CASES = [
  [`import type { A } from './a';`, [['./a', 'type']]],
  [`import { A } from './a';\nimport './side-effect';`, [['./a', 'value'], ['./side-effect', 'value']]],
  [`import { type A } from './a';`, [['./a', 'value']]],
  [`export * from '../b';\nexport { c } from './c';`, [['../b', 'value'], ['./c', 'value']]],
  [`export type { A } from './a';\nexport type * from './b';`, [['./a', 'type'], ['./b', 'type']]],
  [`async function f() { await import('./dyn'); }`, [['./dyn', 'dynamic']]],
  [`const f = (p: string) => import(p);`, [[null, 'dynamic']]],
  [`type T = import('./t').T;`, [['./t', 'type']]],
  [`const x = require('./r');`, [['./r', 'value']]],
  [`// import x from './commented';\nconst s = "import y from './in-string'";`, []],
];

const BARRELS = Object.values(LAYERS).map((l) => [l.barrel, '']);
const CORE_ONLY = BARRELS.filter(([f]) => !f.startsWith('src/panel/'));

/** [name, files (path → text), substrings every one of which must appear in the violations; [] = clean]. */
const TREE_CASES = [
  ['no panel yet: panel barrels not required', CORE_ONLY, []],
  ['panel started: every panel barrel required', [...CORE_ONLY, ['src/panel/index.ts', '']], ['src/panel/app/index.ts: missing']],
  [
    'P5 re-exports P4 types and loads it once',
    [
      ...BARRELS.filter(([f]) => f !== 'src/panel/index.ts'),
      [
        'src/panel/index.ts',
        `export * from '..';\nexport type { MountPanelUi } from './app';\nimport type { PanelUiHandle } from './app';\nexport const load = () => import('./app');`,
      ],
    ],
    [],
  ],
  [
    'P5 static value import of P4 (AST, not preProcessFile)',
    [...BARRELS.filter(([f]) => f !== 'src/panel/index.ts'), ['src/panel/index.ts', `import { mountPanelUi } from './app';`]],
    ["src/panel/index.ts: imports './app'", 'rule 8'],
  ],
  [
    'P5 value re-export of P4',
    [...BARRELS.filter(([f]) => f !== 'src/panel/index.ts'), ['src/panel/index.ts', `export * from './app';`]],
    ['rule 8'],
  ],
  [
    'P5 loads P4 from two places',
    [
      ...BARRELS.filter(([f]) => f !== 'src/panel/index.ts'),
      ['src/panel/index.ts', `export const a = () => import('./app');`],
      ['src/panel/launcher.ts', `export const b = () => import('./app');`],
    ],
    ['2 dynamic import()s of the P4 barrel'],
  ],
];

function selfTest() {
  const exists = (p) => VIRTUAL_FILES.has(p);
  const failures = [];

  for (const [from, specifier, kind, expected] of SELF_TEST_CASES) {
    const got = checkImport(from, specifier, exists, kind);
    const pass = expected === null ? got === null : got !== null && got.includes(expected);
    if (!pass) {
      failures.push(`${from} → ${kind} '${specifier}': expected ${expected === null ? 'ok' : `a '${expected}' violation`}, got ${got === null ? 'ok' : `'${got}'`}`);
    }
  }
  for (const [text, expected] of EXTRACT_CASES) {
    const got = extractImports(text).map((i) => [i.specifier, i.kind]);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`extract ${JSON.stringify(text)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
  }
  for (const [name, entries, expected] of TREE_CASES) {
    const got = checkTree(new Map(entries));
    const pass = expected.length === 0 ? got.length === 0 : expected.every((e) => got.some((v) => v.includes(e)));
    if (!pass) failures.push(`tree '${name}': expected ${expected.length === 0 ? 'clean' : JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }

  const total = SELF_TEST_CASES.length + EXTRACT_CASES.length + TREE_CASES.length;
  if (failures.length > 0) {
    failures.forEach((f) => console.error(`FAIL ${f}`));
    console.error(`\nself-test: ${failures.length} of ${total} cases failed.`);
    process.exit(1);
  }
  console.log(`self-test: ${total} cases ok`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
  } else {
    const at = args.indexOf('--root');
    const root = at >= 0 ? path.resolve(args[at + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    main(root);
  }
}
