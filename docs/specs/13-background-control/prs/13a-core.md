# 13a — Core chords, the activation entry, seams

Spec: [`../spec.md`](../spec.md) (S13-01 … S13-14). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s13a-core` → one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

Chords that work while capture is off (record, note, and v1's download / copy / clear), a
controller that can be disposed for good, the version constant, and the new entry
`debug-capture/activate`: one key listener plus the flags, everything else by `import()`.

## Owned paths

See the plan (S-13a rows).

## Public API (exact names)

```ts
// src/contract/capture-contract.ts
export interface ShortcutConfig { readonly download: string; readonly copy: string; readonly clear: string; readonly record: string; readonly note: string }
export const DEFAULT_SHORTCUTS: ShortcutConfig;           // + record 'ctrl+alt+shift+s', note 'ctrl+alt+shift+m'
export interface NoteTemplate { readonly title?: string; readonly text?: string }
export const DEFAULT_NOTE: Required<NoteTemplate>;        // 'Mark' / 'Added with the keyboard shortcut.'
export interface DebugCaptureOptions { policy?; shortcuts?: Partial<ShortcutConfig> | false; readonly note?: NoteTemplate }
interface CaptureController { readonly shortcuts: ShortcutConfig | null; dispose(): void; /* + existing */ }
export const DEBUG_CAPTURE_VERSION: string;               // = package.json version

// src/activate/index.ts — entry "debug-capture/activate"
export const DEBUG_STORAGE_KEY = 'debug-capture';
export interface DebugActivationOptions { shortcut?: string | false; storageKey?: string | false; capture?: DebugCaptureOptions; panel?: DebugPanelOptions | false }
export interface DebugActivationHandle { active; session; controller; panel; loadError; ready: Promise<void>; activate(); deactivate(); dispose() }
export function installDebugActivation(options?: DebugActivationOptions): DebugActivationHandle;

// src/angular, src/react
provideDebugCaptureSession(session: CaptureSession | null | (() => CaptureSession | null))
createReactRootErrorOptions(session: CaptureSession | null | (() => CaptureSession | null), next?, defaults?)
```

`DEBUG_STORAGE_KEY` stays exported by the core too (same value), beside `isDebugRequested()`.

## Behaviour

- Chords: one `bindShortcuts` call in `createCaptureController`, before `start()`; the
  install no longer binds any. `dispose()` = `stop()` + unbind; a `disposed` flag makes
  `start()` a no-op.
- `installDebugCapture()` builds its controller so that `session.dispose()` is `dispose()`.
- Activation reads the flags itself (a small copy of `isDebugRequested`'s rules: the loader
  precedent, `src/panel/loader.ts` `parseChord`), because it may not import the core statically.
- Load: `Promise.all([import('..'), import('../panel')])`, injectable for specs
  (`installDebugActivation(options, deps)` with `deps.load`, `deps.scope`).
- A generation counter makes a press during a load win.
- The listener and the start work run in `Zone.root` when zone.js is present (`ISO-09`).
- Version check: `scripts/build.mjs` compares the constant with `package.json`.

## Required specs

`install-debug-capture.spec.ts` (chords across stop/start; record; note with defaults and
custom text, while off; dispose; shortcuts property; v1 dispose), `activate.spec.ts` (new),
seam specs (getter), `check-layers` self-test cases, `public-api.spec.ts` (new exports).
`test/e2e/background.spec.mjs` (new). Each red once.

## Verification

`npm run check`; report unit/e2e counts and `npm run size` old → new.

## Out of scope

The panel (`'hidden'`, About) — S-13b. The app — S-13c.
