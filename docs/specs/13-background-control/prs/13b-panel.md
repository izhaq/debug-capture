# 13b — Panel: hidden DBG button, About

Spec: [`../spec.md`](../spec.md) (S13-15 … S13-18). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s13b-panel` → one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

After activation nothing shows (`D-41`), and Settings › About lists the version and every
shortcut in use (`D-42`).

## Public API (exact names)

```ts
// src/panel/api.ts
interface DebugPanelOptions { launcher?: boolean | 'hidden'; activation?: string | false; /* + existing */ }
// src/panel/app/mount-panel-ui.ts
interface MountPanelUiOptions { readonly shortcuts: { readonly toggle: string | false; readonly activation: string | false }; /* + existing */ }
```

## Behaviour

- Loader: `showLauncher = options.launcher === 'hidden' ? saved.launcher === true : saved.launcher !== false`.
  Settings stores `launcher: true` for Show (today it stores the value either way; check).
- About: a section at the end of the Settings popover, heading "About", the line
  `debug-capture <DEBUG_CAPTURE_VERSION>`, a two-column list (keys, action). Chord text:
  each `+` part capitalised (`ctrl` → `Ctrl`, letters upper case), joined with `+`.
- `installDebugActivation` sets `launcher: 'hidden'` unless `panel.launcher` is given, and
  `activation` to its chord.

## Required specs

`loader.spec.ts` (`'hidden'` with and without a stored Show), settings / About specs (rows,
custom chords, `off`, version), `activate.spec.ts` (passes `'hidden'` and `activation`),
e2e in `background.spec.mjs`. Each red once.

## Verification

`npm run check`; sizes against loader 5,632 B and UI 45,056 B; perf green.

## Out of scope

A shortcut editor (`D-32`). The app — S-13c.
