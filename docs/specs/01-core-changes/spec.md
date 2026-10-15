# S-01 Core changes — spec

**Source of truth:** HLD §6.4–§6.5 (C-1 … C-3, C-5 … C-8), §4.1, `FR-ACT-04`,
`FR-ACT-09`, `FR-HTTP-02`, `FR-BAR-03`, `FR-BAR-06`. Contract: S-00's
`src/contract/capture-contract.ts` (types already fixed — implement them).
Plan: [`../wave-2.md`](../wave-2.md).

## Goal

The capture layer gives the panel everything it needs: in-flight requests, a
controller that turns capture off and on without losing anything, the policy,
change events, a capped-body flag, the shared problem rule, and copy/download
that never touch the host's `<body>`.

## Requirements

| ID | Requirement | HLD | Track |
|---|---|---|---|
| S01-01 | `createRecorder(policy)` returns `LiveRecorder & ProbeRecorder`. v1 behaviour of `record`, `snapshot`, `clear`, `stats`, `onEntry` is unchanged (every v1 spec still passes). | C-1, C-6 | 01a |
| S01-02 | **Pending:** `startPending(draft)` polices like an `HttpEntry` (same `ignoreUrls` check, same URL and header redaction code path), returns an id or `null`; `pending()` oldest first, ≤ `MAX_PENDING_REQUESTS` (the oldest drops, with an `end` event); `record()` of a draft carrying `requestId` ends that pending request whatever happens to the draft (stored, sampled out, failed); `endPending(id)` idempotent; `clear()` empties the list, emitting one `end` per removed id before `cleared`. A secret never appears in `pending()` that would not appear in the stored entry. | C-1 | 01a |
| S01-03 | **Probes:** XHR and fetch call `startPending` when a request starts and put the id on the finished draft as `requestId`; on `dispose()` every request still in flight is ended with `endPending`. The WebSocket probe takes ids from `nextSocketId()`. The fetch probe sets `resBodyCapped: true` when it stopped reading at its 1 MB cap, and the recorder keeps it on the `HttpEntry`. | C-1, C-2, C-7 | 01a |
| S01-04 | **Change events:** `onChange` fires `cleared` after `clear()` (also from the v1 `X` shortcut) and `stats` when only `dropped` or `failed` changed. A throwing listener is isolated. | C-6 | 01a |
| S01-05 | **Controller:** `createCaptureController(options?)` installs capture at once and returns a `CaptureController`. One recorder for the controller's life; `stop()` removes probes and shortcuts and keeps the buffer; `start()` reinstalls them on the same recorder; both are no-ops in the matching state; `onChange` fires on real changes only. `seq`, request ids and socket ids never restart across stop/start. | C-2, D-17 | 01a |
| S01-06 | **Session:** `controller.session` is one stable `ControlledCaptureSession`: `active` follows `on`; `dispose()` acts as `stop()`; `policy` is the resolved, frozen policy; `toJson`, `download`, `copy`, `clear` work while off. `getActiveCaptureSession()` returns it while on, `null` while off. The Angular and React seams (which check `session.active`) record again after stop → start — proven by a spec for each. | C-2, C-3 | 01a |
| S01-07 | `installDebugCapture(options)` accepts `options.recorder` and installs on it; without it, v1 behaviour exactly. `DebugCaptureOptions.recorder` is added to the contract. | C-2 | 01a |
| S01-08 | `isProblemEntry(entry)` implements `FR-ACT-04`: `ErrorEntry`; HTTP with `status ≥ 500` or `error ≠ null`; WebSocket `event === 'error'`. Not 4xx, not log entries of any level. Exported from L5. | C-8 | 01b |
| S01-09 | `copyText` and `downloadText` take a last optional `SinkOptions`; with `root`, the temporary textarea / link is appended to `root`, never to `document.body`; focus handling unchanged; everything else as v1. A spec proves it with a real shadow root in Chromium (copy fallback with `execCommand`, and the download click). | C-5, `ISO-04` | 01b |
| S01-10 | Hot path: the per-request cost of pending tracking is measured (timing spec with honest margins, AGENTS rule 20); v1's timing specs still pass. | NFR-PERF-03 | 01a |
| S01-11 | The `WebSocketEntry.socketId` doc comment says the counter lives in the recorder. | C-2 | 01a |

## Out of scope

Anything in `src/panel/**`. The v1 copy in the host app. Export format changes
beyond the optional `pending` and `requestId` fields (`CaptureFile.pending`
is filled by the serializer only if 01a chooses to — say so; not required).

## Acceptance

Both tracks merged into the wave branch; `npm run check` exits 0; a
fresh-context review of S-01 (redaction of pending data, hot path, dispose
races) found no open blocker.
