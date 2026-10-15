/**
 * Guards the checks that read `dist/` (`npm run e2e`, `npm run pack:check`):
 * they must never pass against an old build. Throws when `dist/` is missing
 * or older than anything the build reads (src/, the build scripts and
 * tsconfigs). `npm run check` builds just before them, so this only trips
 * when one is run on its own after an edit.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Build inputs, relative to the package root; a directory counts every file under it. */
const BUILD_INPUTS = ['src', 'scripts/build.mjs', 'scripts/entries.mjs', 'tsconfig.json', 'tsconfig.build.json'];

/** Compares the newest build input with the oldest `dist/**\/*.mjs` bundle. */
export function assertDistFresh(root) {
  const dist = path.join(root, 'dist');
  const outputs = fs.existsSync(dist) ? newestAndOldest(dist, (f) => f.endsWith('.mjs')) : null;
  if (outputs === null) throw new Error('dist/ has no .mjs bundles — run `npm run build` first.');
  const inputs = BUILD_INPUTS.map((p) => path.join(root, p))
    .filter((p) => fs.existsSync(p))
    .map((p) => newestAndOldest(p, () => true))
    .filter(Boolean);
  const newestInput = inputs.reduce((a, b) => (b.newest.mtimeMs > a.newest.mtimeMs ? b : a));
  if (newestInput.newest.mtimeMs > outputs.oldest.mtimeMs) {
    throw new Error(
      `dist/ is older than ${path.relative(root, newestInput.newest.file)} — run \`npm run build\` first ` +
        '(or `npm run check`, which builds before it).',
    );
  }
}

function newestAndOldest(start, keep) {
  let newest = null;
  let oldest = null;
  const visit = (p) => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(p)) visit(path.join(p, name));
    } else if (keep(p)) {
      const item = { file: p, mtimeMs: stat.mtimeMs };
      if (newest === null || item.mtimeMs > newest.mtimeMs) newest = item;
      if (oldest === null || item.mtimeMs < oldest.mtimeMs) oldest = item;
    }
  };
  visit(start);
  return newest === null ? null : { newest, oldest };
}
