# 00b — Contracts and panel skeleton

**Branch:** `claude/dc-v2-s00b-contracts` → PR into `claude/dc-v2-s00-foundation`
**Covers:** S00-08, S00-09 (`../spec.md`). HLD §6.2, §6.4, §6.5 (C-1, C-2, C-3, C-6, C-7, C-8).
**Read first:** `../spec.md`, `../plan.md`, HLD §6.2–§6.5, `src/contract/capture-contract.ts`.

## Goal

Write down, as **types only**, every shape the wave-2 specs share, so S-01
(core), S-02 (shell), S-03 (model) and S-04 (UI) can work in parallel. Nothing
existing may break: today's code must compile and its 312 specs pass unchanged.

## Owned paths (relative to `packages/debug-capture/`)

`src/contract/**`, `src/panel/**`.

## Contract additions (`src/contract/capture-contract.ts`, append; additive only)

Use these names exactly. Doc comments say *why* and cite the HLD IDs.

```ts
// C-1 — in-flight requests
export interface PendingRequest {
  readonly id: number;                 // equals HttpEntry.requestId of the finished entry
  readonly t: number;                  // start, epoch ms
  readonly transport: 'xhr' | 'fetch';
  readonly method: string;
  readonly url: string;                // already policed: ignoreUrls applied, URL redacted
  readonly reqHeaders: HeaderMap;      // already redacted
}
export type PendingEvent =
  | { readonly type: 'start'; readonly request: PendingRequest }
  | { readonly type: 'end'; readonly id: number };   // completed, sampled out, failed, capped, stopped
export type PendingListener = (event: PendingEvent) => void;

// C-6 — changes that are not a new entry
export type RecorderChange = { readonly type: 'cleared' } | { readonly type: 'stats' };
export type RecorderChangeListener = (change: RecorderChange) => void;

/** The v2 recorder. S-01 makes createRecorder() return it. */
export interface LiveRecorder extends Recorder {
  onChange(listener: RecorderChangeListener): Unsubscribe;   // C-6
  pending(): readonly PendingRequest[];                      // C-1, oldest first, ≤ 200
  onPending(listener: PendingListener): Unsubscribe;         // C-1
}

/** C-2 + C-3: the session a controller hands out; one object for the page's life. */
export interface ControlledCaptureSession extends CaptureSession {
  readonly recorder: LiveRecorder;
  readonly policy: Readonly<CapturePolicy>;                  // C-3
}

/** C-2 */
export interface CaptureController {
  readonly session: ControlledCaptureSession;
  readonly on: boolean;
  start(): void;
  stop(): void;
  onChange(listener: (on: boolean) => void): Unsubscribe;
}
export type CreateCaptureController = (options?: DebugCaptureOptions) => CaptureController;

/** C-8: the problem rule (FR-ACT-04) — S-01 implements it in core. */
export type IsProblemEntry = (entry: CaptureEntry) => boolean;
```

`HttpEntry` gains two **optional** fields: `readonly requestId?: number` (C-1)
and `readonly resBodyCapped?: true` (C-7). Check that `EntryDraft` still
derives correctly for HTTP drafts (they may carry both fields too).

## Panel skeleton (`src/panel/`)

| File | Layer | Content |
|---|---|---|
| `panel/model/index.ts` | P1 barrel | `export * from '../..';` then the model's own exports |
| `panel/model/panel-data-source.ts` | P1 | `PanelDataSource`, `PanelDataEvent` exactly as HLD §6.4 (`pending-start`, `pending-end`, `cleared`, `stats`, `capture`, `entry`; `download(root: ShadowRoot)`, `copyText(text, root): Promise<boolean>`, `capacity()`, `redactedValue()`) |
| `panel/ui/index.ts` | P2 barrel | `export * from '../model';` |
| `panel/views/index.ts` | P3 barrel | `export * from '../ui';` |
| `panel/app/index.ts` | P4 barrel | `export * from '../views';` + `mount-panel-ui.ts` exports |
| `panel/app/mount-panel-ui.ts` | P4 | `MountPanelUiOptions` (`document: Document`, `storageKey: string \| false`, `defaultDock: 'bottom' \| 'right'`, `onRequestClose(): void`), `PanelUiHandle` (`unmount(): void`), `type MountPanelUi = (root: ShadowRoot, controller: CaptureController, options: MountPanelUiOptions) => PanelUiHandle` |
| `panel/index.ts` | P5 (entry `debug-capture/panel`) | `DebugPanelOptions`, `DebugPanelHandle` (HLD §6.4), `type InstallDebugPanel = (controller: CaptureController \| null, options?: DebugPanelOptions) => DebugPanelHandle`, `export const PANEL_ELEMENT_NAME = 'debug-capture-panel-v2'` (D-11). **No** value import of `./app` — `import type` only. |

Rules: no DOM, timers or globals in P1; no packages anywhere in `panel/`; P5
never `export *` from P4. Each barrel's doc comment states its layer and what it
may import (copy the v1 barrel comment style).

## Required specs (write them first; show each one failing once)

- `src/contract/capture-contract-v2.spec.ts`: a fake object satisfying each new
  interface compiles (type-level checks via assignments) and, at runtime,
  `DEFAULT_CAPTURE_POLICY` and `CAPTURE_SCHEMA_VERSION` are unchanged (still 1).
- `src/panel/public-api.spec.ts`: the P5 barrel's runtime exports are exactly
  `['PANEL_ELEMENT_NAME']` today (types erase); its value is
  `'debug-capture-panel-v2'`.
- A spec proving the L5 barrel (`src/index.ts`) still exposes what it did
  (compare runtime export names before/after — no value export may disappear).

## Verification

There is no package runner yet (track 00a builds it). Use the orchestrator's
scratch harness `<pkg-test.cjs>` (its path is in your task prompt; it uses the host repo's `node_modules`):

```bash
# from the repo root of your worktree
npx tsc -p packages/debug-capture/tsconfig.json
node <pkg-test.cjs> . 
# expect 312 + your new specs, all SUCCESS
npx tsc -p tsconfig.app.json --noEmit && npm run lint:layers   # host app unaffected
```

Never commit a link to `/tmp` (AGENTS rule 26).

## Out of scope

Any implementation (no `createCaptureController`, no `isProblemEntry` body, no
recorder change) — that is S-01. Tooling (00a), Angular (00c), docs (00d).
