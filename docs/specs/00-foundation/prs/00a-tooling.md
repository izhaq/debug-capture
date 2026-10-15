# 00a — Tooling

**Branch:** `claude/dc-v2-s00a-tooling` → PR into `claude/dc-v2-s00-foundation`
**Covers:** S00-01 … S00-07 (`../spec.md`). HLD §7.2, §6.1, §6.2, `NFR-SIZE-01`, `NFR-PORT-01`.
**Read first:** `../spec.md`, `../plan.md`, HLD §6.1–§6.2 and §7.2, the v1
layer checker `scripts/check-debug-capture-layers.js` at the **repo root** (port it).

## Goal

`cd packages/debug-capture && npm ci && npm run check` works on its own, with
no help from the host app.

## Owned paths (relative to `packages/debug-capture/`)

`package.json`, `package-lock.json`, `tsconfig*.json`, `.gitignore`,
`.prettierrc*`, `.prettierignore`, `eslint.config.*`, `karma.conf.*`,
`playwright.config.*`, `scripts/**` (except `scripts/contrast-check*`), `test/**`.

Do **not** edit `src/**` except to fix a real lint error in a file no other
track owns (`src/contract/**`, `src/panel/**`, `src/angular/**` are owned by
others — if they fail lint, report it in the PR instead). Do not reformat
existing files: the orchestrator does one format sweep after all merges.

## What to build

1. **`package.json`**
   - Exact-pinned `devDependencies` only (versions published at least two weeks
     ago); **no runtime `dependencies`**. `peerDependencies`: `@angular/core`
     `>=16 <21`, marked optional in `peerDependenciesMeta`.
   - `engines.node` (`>=18`), `type: "module"` only if every config works with
     it, `sideEffects: false`, `files: ["dist", "README.md"]`.
   - `exports`: `.`, `./angular`, `./react`, `./panel`, each with `types` and
     `import` (tsc output) — plus `./dist/*` for the prebuilt bundles.
   - Scripts with exactly these names: `typecheck`, `lint`, `lint:layers`,
     `format`, `format:check`, `test`, `build`, `size`, `e2e`,
     `contrast` (= `node scripts/contrast-check.mjs`; track 00d writes that
     file), `check` (all except `format`; order: typecheck, lint, lint:layers,
     format:check, contrast, test, build, size, e2e).
   - `.gitignore`: `node_modules/`, `dist/`, test output.
2. **TypeScript.** Keep TS `5.1.6` (same as v1 — AGENTS rule 7) and every strict
   flag in today's `tsconfig.json`. Leave `experimentalDecorators` as it is (the
   orchestrator removes it after track 00c). Add `tsconfig.build.json`: no
   specs, `declaration`, `target: ES2020`, `lib: es2020, dom`, output to `dist/`.
3. **`npm test`** — Karma + Jasmine + esbuild, headless Chromium, single run.
   - Bundle every `src/**/*.spec.ts` with esbuild (a small script or a karma
     preprocessor, your choice; keep it simple and committed). A test setup
     file inits Angular `TestBed` (`zone.js`, `zone.js/testing`,
     `@angular/compiler`, `BrowserDynamicTestingModule`) — Angular 16.2.x as
     devDependencies.
   - Chrome from `CHROME_BIN`; a custom launcher with `--no-sandbox`. Document
     the variable in the PR (here: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
   - Must run the **312** existing specs, all green. Coverage thresholds are
     wanted (practices T10) — if esbuild instrumentation is not cheap, leave a
     follow-up note instead.
4. **`npm run build`** — `tsc -p tsconfig.build.json` (ESM + `.d.ts`), then
   esbuild bundles `dist/index.mjs`, `dist/angular.mjs` (`@angular/*`
   external), `dist/react.mjs`, `dist/panel.mjs` (code-split so the future UI
   chunk lands in its own file). Build an entry only if its source file exists
   (the panel entry arrives with track 00b). Target ES2020, minified, with
   source maps.
5. **`npm run lint`** — ESLint flat config + typescript-eslint:
   `no-explicit-any: error`; `no-console: error` with overrides for the
   console probe and the React adapter (they call console on purpose);
   `no-restricted-properties`/`-syntax` for `innerHTML`, `outerHTML`,
   `insertAdjacentHTML`, `document.write`, `eval`, `new Function`
   (`NFR-SEC-01`); `Date.now()` banned in `src/**` except `src/core/clock.ts`.
   Existing code must pass (config overrides with a comment beat code changes).
6. **`npm run format` / `format:check`** — Prettier 3, single quotes, 2 spaces.
   Pick `printWidth` (and other options) that **minimise churn** on today's
   code — measure a couple of values and say which you chose and how many
   files change. `format:check` may fail until the orchestrator's sweep; say
   so in the PR.
7. **`npm run lint:layers`** — port the v1 checker to `scripts/check-layers.mjs`
   (or `.cjs`), re-rooted at `packages/debug-capture/src`, with a `--self-test`
   rule table. Layers:
   - L1 `contract/` → nothing; L2 `core/` → L1 barrel; L3 `adapters/**` → L2
     barrel; L4 `install/` → L3 barrel; L5 `src/index.ts` → L4 barrel.
   - L6 `angular/` → L5 + `@angular/*`, `rxjs`; L6 `react/` → L5 only (no
     packages, not even React); L6 `panel/` → see below. L6 seams never import
     each other.
   - Panel: P1 `panel/model/` → L5 only; P2 `panel/ui/` → P1 barrel; P3
     `panel/views/` → P2 barrel; P4 `panel/app/` → P3 barrel; P5
     `panel/index.ts` (and files directly in `panel/`) → L5 barrel, and the P4
     barrel **only** as `import type` / `export type` or a dynamic `import()`;
     a static value import of P4 is an error (it would pull the UI chunk into
     the loader). No packages anywhere in `panel/`.
   - Keep v1's path rules (own dir, child `index.ts` within the same layer,
     barrel above) and `ts.preProcessFile` for specifiers — but note
     `preProcessFile` does not tell `import type` from a value import; use the
     TS AST for the P5 rule. Self-test cases for every rule above, including
     both P5 cases.
8. **`npm run size`** — esbuild-bundle each entry (minified), gzip, compare to
   `scripts/size-budgets.json`: core = measured baseline + 2 kB (record the
   measured number in the PR and in the JSON), panel loader ≤ 4 kB, panel UI
   chunk ≤ 25 kB (skip an entry that does not exist yet, and say so in the
   output), angular and react recorded. Print a table.
9. **`npm run e2e`** — `@playwright/test` pinned to **1.56.1** (the Chromium in
   `/opt/pw-browsers` belongs to it; never run `playwright install`). One smoke
   test: a tiny static server (Node `http`, in the Playwright `webServer` or
   the test) serves `test/hosts/plain/index.html` and `dist/`; the page loads
   `dist/index.mjs` with `<script type="module">`, calls `installDebugCapture()`
   and `fetch`es a local URL; the test reads the buffer through
   `getActiveCaptureSession()` and finds the HTTP entry. Also assert no page
   errors. This proves `NFR-PORT-01`'s plain-page path.

## Verification (paste the numbers in the PR body)

```bash
cd packages/debug-capture
rm -rf node_modules && npm ci
npm run typecheck && npm run lint && npm run lint:layers && node scripts/check-layers.mjs --self-test
npm test            # expect 312 SUCCESS
npm run build && ls dist
npm run size        # table + core baseline
npm run e2e
npm run format:check   # report the count of files it would change
```

Also check the host app is unaffected, from the repo root: `npx tsc -p
tsconfig.app.json --noEmit` and `npm run lint:layers`.

## Out of scope

Contrast script (00d), contracts and panel files (00b), Angular seam (00c),
CI, pre-commit hooks, commitlint.
