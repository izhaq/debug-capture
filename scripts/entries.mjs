/**
 * The package's entry points, shared by `build.mjs` and `size.mjs`.
 * An entry whose source file does not exist yet is skipped by both (the
 * panel arrives with S-00 track 00b).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `name` is the dist file (`dist/<name>.mjs`) and the size-budget key. */
export const ENTRIES = [
  { name: 'index', source: 'src/index.ts' },
  { name: 'angular', source: 'src/angular/index.ts' },
  { name: 'react', source: 'src/react/index.ts' },
  { name: 'panel', source: 'src/panel/index.ts' },
];

/** Packages the prebuilt bundles leave to the host (peer dependencies). */
export const EXTERNAL_PACKAGES = ['@angular/*', 'rxjs', 'rxjs/*'];

/** The package root, or `--root <dir>` from the command line (used to try the scripts on a fixture). */
export function packageRoot(argv = process.argv) {
  const at = argv.indexOf('--root');
  if (at >= 0 && argv[at + 1]) return path.resolve(argv[at + 1]);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** Splits ENTRIES into those whose source exists under `root` and those that do not. */
export function existingEntries(root) {
  const present = ENTRIES.filter((e) => fs.existsSync(path.join(root, e.source)));
  const missing = ENTRIES.filter((e) => !present.includes(e));
  return { present, missing };
}
