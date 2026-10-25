# S-11 — v2.1 panel features

HLD rows: §9.1 S-11, §2.1a, §3.10 (`FR-BUF-01…05`, `FR-STAT-01`, `FR-ACT-10`,
`FR-NOTE-01…04`), §6.5 `C-9`, `C-10`, decisions `D-28` … `D-34`. Depends on S-10 (v2.0
closed by S-10b). Source of truth: [`../../design/HLD.md`](../../design/HLD.md). When this
spec and the HLD disagree, the HLD wins.

## Goal

Six owner decisions (2026-10-25) as release 2.1: the buffer size in Settings (up to No
limit), a near-full banner, a repeating memory warning, a status observer for the host, a
"Show DBG button" setting, and user notes. Plus the size budgets they need (`D-34`).
S-12 (the AI add-on, `D-35`) is out of scope.

Three code PRs after this docs PR, in order: **S-11a core**, **S-11b panel**, **S-11c app**
(the playground app takes the new tarball).

## Requirements — S-11a (core)

| ID | Requirement | HLD |
|---|---|---|
| S11-01 | `recorder.setCapacity(n)`: an integer ≥ 1 or `Infinity`; anything else is ignored. Smaller → the oldest entries leave at once, `stats().evicted` counts them; larger → nothing leaves. Then `onChange` fires `{ type: 'capacity' }` (only on a real change). `seq`, request ids and socket ids keep counting. | C-9, FR-BUF-02, C-2 |
| S11-02 | `RingBuffer` holds any capacity, `Infinity` included, with O(1) amortised push, and changes capacity in place (`setCapacity` returns what left). | C-9, FR-BUF-03, NFR-PERF-03 |
| S11-03 | `recorder.usage()` → `{ entries, capacity, bytes, problems }`, a fresh object, kept in O(1) per entry: `problems` by `isProblemEntry`; `bytes` = Σ per entry (160 + 2 × characters of every string and object key, any depth). Eviction, `setCapacity` and `clear()` keep both right. | C-9, FR-BUF-05, FR-STAT-01, D-30 |
| S11-04 | New entry kind `note` (`NoteEntry`: `title`, `text`), in `CaptureEntry` and `EntryDraft`. The recorder polices both strings like an error message (`redactFreeText`: redacted, truncated to `maxBodyLength`). `isProblemEntry(note)` is `false`. | C-10, FR-NOTE-03, FR-NOTE-04 |
| S11-05 | `ControlledCaptureSession.addNote(title, text = '')` records a note with the session clock's time, also while capture is off. Never throws. Exported files hold notes in `entries`; `schemaVersion` stays 1. | C-10, FR-NOTE-03, FR-NOTE-04 |
| S11-06 | The panel keeps compiling and behaving as in 2.0 with the new kind: until S-11b, the panel model leaves `note` entries out of every list (no row, no count). The core stays within ± 2 kB of v1 (`NFR-SIZE-01`). | NFR-SIZE-01 |

## Requirements — S-11b (panel)

| ID | Requirement | HLD |
|---|---|---|
| S11-07 | `PanelDataSource` gains `defaultCapacity()`, `setCapacity()`, `addNote()`; `capacity()` reads the recorder's live capacity; a `capacity` recorder change becomes `{ type: 'capacity', capacity }`. The store drops its oldest entries beyond a smaller capacity at once (selection keeps the "removed" note; paused view loses them too) and uses the new capacity for `Paused · N new`. | FR-BUF-02, C-9, §6.4 |
| S11-08 | Settings has **Buffer**: 1,000 · 5,000 · 10,000 · 50,000 · No limit, plus the policy default and the live capacity when they are not in the list; the radio shows the live capacity. Choosing one calls `setCapacity` and stores `buffer` (a number or `'none'`). With No limit chosen, the FR-BUF-03 warning shows under the group. The status bar reads `buffer N / no limit` when unlimited. | FR-BUF-01, 02, 03, FR-BAR-06 |
| S11-09 | The loader reads `localStorage[storageKey]` once at install (best effort, `try/catch`; `storageKey: false` reads nothing): a valid `buffer` is applied with `setCapacity` before the first open; `launcher: false` hides the launcher. | FR-BUF-01, FR-ACT-10, D-32 |
| S11-10 | Settings has **DBG button**: Show · Hide. It hides / shows the launcher live (it shows again on close when Show) and is stored as `launcher`. With code `launcher: false` the group is not shown and nothing can bring the launcher back. | FR-ACT-10, D-32 |
| S11-11 | **Near-full banner** with Download all, Raise the limit (opens Settings and focuses the checked Buffer radio) and Dismiss, per FR-BUF-04. The loader keeps the dismissed state (it lives while the panel is closed): a `cleared` or `capacity` change re-arms it. `nearFullAt` option, default 0.9; a value outside (0, 1] gives the default. | FR-BUF-04, D-29 |
| S11-12 | **Memory banner** with Download all and Dismiss, per FR-BUF-05: shown when `floor(bytes / memoryStep)` passes the dismissed step; dropping below re-arms. `memoryStep` option in bytes, default 26,214,400; a value that is not a positive finite number gives the default. The text rounds to whole MB (1 MB = 1,048,576 B). | FR-BUF-05, D-30 |
| S11-13 | `handle.onStatus(listener)` → unsubscribe, per FR-STAT-01 and `DebugPanelStatus` (HLD §6.4): one call at subscribe, then at most one per frame (`requestAnimationFrame`, root zone) and only when a field changed; triggers: entries, recorder changes, capture on/off, open/close. A throwing listener is isolated and the others still run. No frame is asked for while nobody listens. Disposing stops it. The inert handle returns a no-op unsubscribe. | FR-STAT-01, D-31, ISO-09, ISO-12, NFR-PERF-01 |
| S11-14 | **Add note**: a toolbar button (icon + "Note") before Settings opens a popover with Title, Text and **Add note**; adding calls `addNote`, empties the form and closes it; both empty → nothing (focus stays in Title). Enter in Title / Ctrl+Enter in Text add; Escape closes it (innermost first, §4.12). | FR-NOTE-01 |
| S11-15 | **Console** shows notes: icon and word `note`, the title then the text as the message; level chips never hide notes; search covers title and text; repeat grouping treats notes like any row; the detail shows title, time and the whole text. | FR-NOTE-02 |
| S11-16 | Budgets (`D-34`): the loader and UI chunk budgets are raised from the measured S-11 growth with the margin rule; `scripts/size-budgets.json` and HLD `NFR-SIZE-01` carry the numbers; the PR reports old → new. The perf tests stay green (warm open < 100 ms). | NFR-SIZE-01, D-34, NFR-PERF-02 |
| S11-17 | Version `2.1.0-alpha.0`; the user README documents Buffer, DBG button, notes (`addNote`), `nearFullAt`, `memoryStep` and `onStatus`. | BR-05 |

## Requirements — S-11c (playground app)

| ID | Requirement | HLD |
|---|---|---|
| S11-18 | The app at the repo root takes `vendor/debug-capture-2.1.0-alpha.0.tgz` (`package.json`, `package-lock.json`, `docs/debug-panel.md`); `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint:layers`, `npx ng build` and `ng test` pass. v1 code stays untouched. | BR-05 |

## Out of scope

S-12 (AI add-on, `D-35`, `OPEN-07/08`). A shortcut setting (`D-32`: code only). Export of
the current view, the separate window, a Problems view. Notes inside HTTP or WebSocket lists.
Measuring real memory per entry (the browser cannot, `D-30`).

## Acceptance

- S-11a: recorder, ring-buffer, install and problem-rule specs for S11-01…05, each shown red
  once; the core size within ± 2 kB of v1; floors raised.
- S-11b: unit specs for S11-07…15 and an e2e file `test/e2e/panel-v21.spec.mjs` on the
  hostile host (buffer size and No limit, both banners, Show DBG button across a reload,
  notes in Console and in the export, `onStatus` while closed), each shown red once; the
  size table old → new; `npm run check` green, also on Chrome 146.0.7680.72.
- S-11c: the four app checks pass on the new tarball.

## Traceability

| MUST (2.1) | Proved by | PR |
|---|---|---|
| FR-BUF-01 | `settings.spec.ts`, `settings-form.spec.ts`, `loader.spec.ts` (stored size applied at install); e2e "buffer size" (kept across a reload) | S-11b |
| FR-BUF-02 | `recorder.spec.ts` (setCapacity), `ring-buffer.spec.ts`, `store.spec.ts` (capacity event), `status-bar.spec.ts`; e2e "buffer size" | S-11a, S-11b |
| FR-BUF-03 | `ring-buffer.spec.ts` / `recorder.spec.ts` (Infinity keeps all); `settings-form.spec.ts` (warning); e2e "No limit" | S-11a, S-11b |
| FR-BUF-04 | `loader.spec.ts` (warning state), `frame.spec.ts` (banner, buttons); e2e "near-full banner" | S-11b |
| FR-BUF-05 | `recorder.spec.ts` (estimate), `loader.spec.ts`, `frame.spec.ts`; e2e "memory banner" | S-11a, S-11b |
| FR-STAT-01 | `loader.spec.ts` (onStatus); e2e "onStatus while closed" | S-11b |
| FR-ACT-10 | `loader.spec.ts`, `settings-form.spec.ts`, `frame.spec.ts`; e2e "Show DBG button" | S-11b |
| FR-NOTE-01 | `note-form.spec.ts` / `frame.spec.ts`; e2e "notes" | S-11b |
| FR-NOTE-02 | `selectors.spec.ts`, console view specs; e2e "notes" | S-11b |
| FR-NOTE-03 | `recorder.spec.ts`, `install-debug-capture.spec.ts` (file holds the note); e2e "notes" (download) | S-11a, S-11b |
| FR-NOTE-04 | `install-debug-capture.spec.ts` (addNote, also while off; policed) | S-11a |
| NFR-SIZE-01 (2.1 budgets) | `npm run size`; the S-11b PR table | S-11b |
