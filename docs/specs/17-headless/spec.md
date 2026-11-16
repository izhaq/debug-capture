# S-17 — Headless: capture and export with no panel in the bundle

HLD rows: §2.1f, §3.15 (`FR-HL-01…10`), `BR-06`, `BR-07`, §6.1, §6.2, §6.4, §6.6, `NFR-SIZE-01`,
decisions `D-56`, `D-57`. Depends on S-16b (merged). Source of truth: [`../../design/HLD.md`](../../design/HLD.md).

## Goal

A host can ship the tool **without the panel**: capture works, export works, and the panel
cannot be seen or opened — its code is not in the host's bundle, not even as a lazy chunk. The
host picks with-panel or headless by the entry it imports.

```ts
// src/debug.ts
import { installDebugActivation } from 'debug-capture/activate-headless'; // or 'debug-capture/activate'
export const debug = installDebugActivation();
```

Or, keeping the panel in the bundle, turn it off at run time from a backend feature flag (`D-57`):

```ts
export const debug = installDebugActivation({
  panel: () => featureFlags.get('debugPanel').then((on) => (on ? {} : false)),
});
```

One code PR after this docs PR: **S-17a**.

## What is there today (research, 2026-11-15)

| Question | Answer |
|---|---|
| Does capture work without the panel? | Yes. The core (`installDebugCapture()`, `createCaptureController()`) records everything and never imports the panel. |
| Does export work without the panel? | Yes. The download / copy / clear / record / note chords are bound by the **core** (`src/install/install-debug-capture.ts`, `bindShortcuts`), not by the panel, and live until `controller.dispose()` (`FR-BG-06`). `session.download()`, `copy()`, `toJson()` are core. |
| What is missing? | A host that wants the activation chord, the stored flag and the lazy start must use `debug-capture/activate`, whose loader does `Promise.all([import('..'), import('../panel')])`. Measured with esbuild 0.28.2 on a host that calls `installDebugActivation({ panel: false })`: the output still holds `panel` (9,487 B raw) and the UI chunk `app` (122,520 B raw). A host that imports only `debug-capture` holds no panel code (one 36 kB file) but has no activation. |
| Why not a runtime flag? | A bundler emits a chunk for every `import()` it sees, whether it runs or not. Only a different import graph keeps the chunk out (`D-56`). |
| Build side effect | With two activation entries in one split build, esbuild moves their shared code into one chunk (2,389 B raw in a trial) that both import statically, so the `D-43` build check ("`dist/activate.mjs` has no static import") must allow a chunk made only of `src/activate/` code. |

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S17-01 | Entry `debug-capture/activate-headless` (`src/activate/headless.ts`, `dist/activate-headless.mjs`): `installDebugActivation(options?: DebugHeadlessActivationOptions): DebugActivationHandle` and `DEBUG_STORAGE_KEY`. `DebugHeadlessActivationOptions = Omit<DebugActivationOptions, 'panel'>`. `package.json` `exports` and `typesVersions`; `pack:check` imports it under all four resolutions. | FR-HL-01 |
| S17-02 | `createActivation` takes a loader whose `installDebugPanel` is optional; without it no panel is installed and `handle.panel` is `null`. The with-panel entry is unchanged in behaviour (every existing spec passes untouched). A headless `panel` key passed anyway (from JavaScript) is ignored. | FR-HL-01, FR-HL-03 |
| S17-03 | The headless loader imports only the core (`import('..')`). Switching on and off, the stored flag, `?debug=1`, `ready`, `loadError`, a press while loading, `message()` and `onChange()` behave as with the panel (the same specs, run against the headless entry). | FR-HL-03 |
| S17-04 | Layer check: `src/activate/headless.ts` may import `./activate` (value) and `..` (by `import()` or as a type); any import of `../panel` (or anything under it) — value, type or `import()` — fails, with self-test rows both ways. | FR-HL-02 |
| S17-05 | Build check: the import graph of `dist/activate-headless.mjs` (static and dynamic, followed through chunks, by the esbuild metafile) has no input under `src/panel/`; `dist/activate.mjs` and `dist/activate-headless.mjs` statically import only chunks whose inputs are all under `src/activate/` (in practice none: S-17a builds them in a pass of their own, each one file, `D-43`). A self-test fixture shows the check fails on a headless entry that reaches the panel. | FR-HL-02, FR-HL-07 |
| S17-06 | Nothing to see: headless, no element is added to the document, also on `?debug=1`; `Ctrl+Alt+Shift+P` is not `preventDefault()`ed. The download and copy chords export. | FR-HL-04, FR-HL-05 |
| S17-07 | Size: `activate-headless` row in `npm run size`, entry plus static imports ≤ 1,536 B; `activate` stays ≤ 1,536 B; core, loader, UI chunk unchanged. | FR-HL-07 |
| S17-08 | End to end (Playwright): a host page bundled **by esbuild from the built package** with `debug-capture/activate-headless` — (a) its output files contain no panel code (no file from `dist/panel.mjs` or the UI chunk in the metafile, and no `debug-capture-panel-v2` string); (b) on `?debug=1` it records fetch, XHR, WebSocket, console and an error; (c) `Ctrl+Alt+Shift+D` downloads one JSON file with those entry kinds and `schemaVersion` 2; `Ctrl+Alt+Shift+C` puts the same JSON on the clipboard; (d) no panel element appears and `Ctrl+Alt+Shift+P` opens nothing; (e) the page fetched no panel file. | FR-HL-02, 04, 05, BR-06 |
| S17-10 | `panel` on `debug-capture/activate` also takes a function returning `DebugPanelOptions \| false` or a promise of one (type `DebugPanelChoice`). Called once per switch-on, after `createCaptureController()` and `onChange` listeners. `false`: `import('../panel')` never runs. An object: installed as a static value would be (launcher default `D-41`, `activation` chord). A static value: exactly as today (every existing spec untouched). | FR-HL-08 |
| S17-11 | With a function, `ready` resolves once capture is on, before the function answers; `handle.panel` is `null` until the panel is installed. Off before the answer (chord, `deactivate()`, `dispose()`): the answer is dropped and no panel is installed; a new switch-on calls the function again. | FR-HL-09 |
| S17-12 | Fails closed: a throw, a rejection, or a value that is neither `false` nor an object gives no panel; capture stays on; `handle.panelError` (new, `unknown`, `null` otherwise) holds the reason. A failed panel import also sets `panelError` and leaves capture on (with a function only; a static value keeps today's "the whole load failed"). No timeout in the package. | FR-HL-10 |
| S17-13 | End to end: the with-panel host with `panel: () => Promise.resolve(false)` on `?debug=1` — capture records and the download chord saves; no panel file is fetched (network log), no panel element, `Ctrl+Alt+Shift+P` opens nothing. With `() => Promise.resolve({})`: the panel opens with `Ctrl+Alt+Shift+P`. | FR-HL-08, BR-06 |
| S17-09 | Docs: `docs/host-setup.md` (headless; picking per build with `fileReplacements`; the backend flag; the station setup for silent saves — Chrome download folder, no "Ask where to save", F11 hides the download icon), README entry list, `docs/specs/HANDOFF.md`. `panel: false` on `debug-capture/activate` documented as "not installed, still bundled". | FR-HL-06 |

## Out of scope

- A second tarball without the panel files. The one tarball (`BR-05`) still holds every entry;
  "no panel" is about the host's bundle (see the PR question).
- Any change to the core, the panel or the seams. An `export` method on the activation handle
  (the host calls `handle.session?.download()`).
- Other bundlers in CI (webpack, Rollup). They treat `import()` the same way; esbuild is the one
  in `devDependencies` and the one the Angular CLI's application builder uses.

## Acceptance

`npm run check` green on the pinned Chromium and Chrome 146; the floors raised; S17-08 passes;
size numbers in the PR.
