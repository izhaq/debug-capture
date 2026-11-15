# 17a — The `debug-capture/activate-headless` entry

Spec rows S17-01 … S17-13. Branch `feat/s17a-headless` (from `main` after the docs PR) → one PR
into `main`.

## Owned paths

`src/activate/**` (new `headless.ts`, its spec; `activate.ts` gets an optional panel loader),
`scripts/entries.mjs`, `scripts/build.mjs` (the `D-43` / `FR-HL-02` checks and their self-test),
`scripts/size.mjs`, `scripts/size-budgets.json`, `scripts/check-layers.mjs` (rule 9b and
self-test rows), `scripts/pack-check.mjs`, `package.json` (`exports`, `typesVersions`, version),
`src/contract/capture-contract.ts` (`DEBUG_CAPTURE_VERSION` only), `test/e2e/headless.spec.mjs`
and its host under `test/hosts/headless/`, `playwright.config.mjs` (if the host needs a server),
the floors, `AGENTS.md` (layer table row), `docs/host-setup.md`, `README.md`,
`docs/specs/HANDOFF.md`, this spec's `plan.md`.

## Public API

```ts
// debug-capture/activate-headless
export type DebugHeadlessActivationOptions = Omit<DebugActivationOptions, 'panel'>;
export type { DebugActivationHandle, DebugActivationOptions } from './activate';
export { DEBUG_STORAGE_KEY } from './activate';
export function installDebugActivation(options?: DebugHeadlessActivationOptions): DebugActivationHandle;
```

```ts
// debug-capture/activate (D-57)
export type DebugPanelChoice = DebugPanelOptions | false;
// DebugActivationOptions.panel?: DebugPanelChoice | (() => DebugPanelChoice | Promise<DebugPanelChoice>)
// DebugActivationHandle.panelError: unknown   // why the panel was not installed this switch-on; null otherwise
```

With a function, `createActivation` loads the core alone first, starts capture, resolves `ready`,
then asks the function and, on an object, loads the panel entry. A static value keeps today's
single load (core and panel together) so nothing changes for 2.4 hosts.

`DebugActivationOptions` and `DebugActivationHandle` keep their `DebugPanelOptions` /
`DebugPanelHandle` types (they come from `activate.ts`, which only `import type`s the panel);
if that drags panel types into `dist/activate/headless.d.ts`, move the two option/handle types so
the headless declaration has a panel-free `panel: null`-typed handle instead, and say so in the
PR. `ActivationModules.installDebugPanel` becomes optional.

## Behaviour

As spec rows S17-01 … S17-07. Read esbuild 0.28.2's metafile shape (`outputs[f].imports[].kind`,
`inputs`) from the installed package, not from memory.

## Required specs (red first)

- Unit (`src/activate/headless.spec.ts`, injected scope and loader as `activate.spec.ts`): no
  panel installed and `panel` null; `?debug=1` and the stored flag switch on with core only; the
  chord on / off and the flag; a press while loading; `message()`, `onChange()`; a `panel` key
  ignored; the loader asks for the core only.
- `activate.spec.ts`: a loader without `installDebugPanel` gives `panel: null`.
- `activate.spec.ts`, the function form: `false` never asks for the panel module; an object
  installs it; `ready` resolves before the function's promise does; off before the answer
  installs nothing; throw, rejection and a bad value give no panel, `panelError` set, capture on;
  called again at the next switch-on; a static value unchanged.
- Layer self-test: `headless.ts` → `../panel` as value, type and `import()` each fail.
- Build check self-test: a fixture headless entry that reaches `src/panel/` fails the build.
- E2E `test/e2e/headless.spec.mjs`: S17-08 (a)–(e) and S17-13.

## Verification

`npm run check` on both browsers; `npm run size` with the new row; the floors raised to the new
counts; the PR body lists the sizes before / after.

## Out of scope

Core, panel and seam changes; a panel-free tarball; other bundlers.
