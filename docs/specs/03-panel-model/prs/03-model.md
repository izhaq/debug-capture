# 03 — Panel model

**Branch:** `claude/dc-v2-w2-03-model` → PR into `claude/dc-v2-wave2`
**Covers:** S03-01 … S03-14 (`../spec.md`).
**Read first:** `../spec.md`, `../../wave-2.md`, HLD §4.4–§4.12, §5.6, §6.2–§6.4,
the S-00 contract (`src/contract/capture-contract.ts`, v2 section) and the P1
types in `src/panel/model/panel-data-source.ts`.

## Owned paths

`src/panel/model/**` only.

## Rules for this layer

- P1 imports only the L5 barrel (`'../..'`). No DOM, no `document`, no
  timers, no `Date.now()` (time comes in as data or an injected clock), no
  globals. The layer checker and lint enforce most of this.
- `isProblemEntry` (track 01b) may not be merged yet: take it as an injected
  `IsProblemEntry` in `createPanelStore(options)` — that is also the final
  design, so no TODO is needed. `copyText` / `downloadText` with
  `SinkOptions` (01b): inject them through `deps` in `createLocalDataSource`
  with the default taken from L5 once 01b is in; until then a local default
  marked `// TODO(wave-2 merge)` that the orchestrator will ask you to remove.
- Immutable state: frozen arrays/objects out of `getState()`; no mutation of
  entries (they are already frozen by the recorder).

## API to design (exact names are yours — document them in the barrel)

Keep it small and obvious; wave 3 (views + frame, in parallel) codes against
it. Must include at least: `createLocalDataSource`, `createPanelStore`
(`apply`, `getState`, `subscribe`, and actions: `setFilter`, `select`,
`moveSelection`, `pause`, `resume`, `clearSelection`), selectors for each
list and the counts, the formatters, the body helpers, `toCurl`. Export the
state types. Put a 10-line usage example in the barrel's doc comment.

## Tests

Spec per requirement (show each failing once). Use fake controllers/recorders
built on the contract types (never `ProbeRecorder`). Timing spec for S03-14
with both numbers in its comment; run the suite 3×.

## Verification

```bash
npm ci
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check
```

Report: spec count (do not edit `test/unit/spec-floor.json`), the public API
list, timing numbers, coverage of `src/panel/model/**`.

## Out of scope

DOM, scheduling, storage (S-08), anything outside `src/panel/model/`.
