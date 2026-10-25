# 11b — Panel: settings, banners, notes, status observer

Spec: [`../spec.md`](../spec.md) (S11-07 … S11-17). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s11b-panel` (from S-11a) → one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

Everything the user and the host see in 2.1: Buffer and DBG button settings, the near-full
and memory banners, Add note and notes in Console, `handle.onStatus()`. Then the budgets,
the version and the README.

## Owned paths

See the plan (S-11b rows).

## Public API (exact names)

```ts
// src/panel/api.ts
interface DebugPanelOptions { nearFullAt?: number; memoryStep?: number; /* + existing */ }
interface DebugPanelHandle { onStatus(listener: (status: DebugPanelStatus) => void): Unsubscribe; /* + existing */ }
export interface DebugPanelStatus { open; capture; entries; capacity; problems; nearFull; bytes; memoryStep }  // HLD §6.4
export const DEFAULT_NEAR_FULL_AT = 0.9;
export const DEFAULT_MEMORY_STEP = 26_214_400;

// src/panel/app/mount-panel-ui.ts — MountPanelUiOptions gains
readonly launcher: boolean | null;          // null: code said launcher: false (switch hidden)
setLauncher(show: boolean): void;
warnings(): PanelWarnings;                  // { nearFull: boolean; memoryBytes: number } — 0 = no memory banner
dismissWarning(kind: 'nearFull' | 'memory'): void;

// src/panel/model/panel-data-source.ts
defaultCapacity(): number; setCapacity(capacity: number): void; addNote(title: string, text: string): void;
PanelDataEvent | { type: 'capacity'; capacity: number }
```

## Behaviour

- **Loader** (`src/panel/loader.ts`): reads storage once (S11-09); keeps `showLauncher`,
  the near-full "dismissed" flag and the dismissed memory step; computes status from
  `recorder.usage()`, `controller.on` and its own open state; `onStatus` batches to one rAF
  and compares with the last status sent. It subscribes to `onEntry` once (badge and status).
- **Frame**: two banners after the capture banner, each rebuilt only when its text changes;
  `warnings()` is read every frame; Dismiss calls `dismissWarning` then invalidates.
  Raise the limit opens Settings and focuses the checked Buffer radio.
- **Settings**: `PanelSettings` gains `buffer: number | 'none' | null` and `launcher: boolean`;
  both are stored. The form groups are built from the options (buffer list; DBG group only
  when `launcher !== null`).
- **Note form**: a popover (`createPopover`) with an `input` and a `textarea`; no `<form>`
  element (no submit navigation in a host page).
- **Console**: `ConsoleRow` includes `NoteEntry`; level chips skip notes; label `note` with
  a `note` icon (SVG, `currentColor`).

## Required specs

Unit: data source and store (capacity event, defaultCapacity, addNote), settings parse /
serialize (buffer, launcher), settings form (buffer list, No limit warning, DBG group shown
or not), status bar (`no limit`), loader (stored buffer and launcher at install, setLauncher,
warnings and dismiss, re-arm on clear / capacity, onStatus once + batched + isolated +
dispose, inert handle), frame (banners and their buttons, note button and form, Escape),
console (note row, chips skip notes, search, detail). e2e `test/e2e/panel-v21.spec.mjs`.
Each red once.

## Verification

`npm run check` (3× for the perf project), and once on Chrome 146.0.7680.72. Report unit and
e2e counts and the size table old → new.

## Out of scope

S-12. The playground app (S-11c).
