# 01a — Recorder, probes, controller

**Branch:** `claude/dc-v2-w2-01a-core` → PR into `claude/dc-v2-wave2`
**Covers:** S01-01 … S01-07, S01-10, S01-11 (`../spec.md`).
**Read first:** `../spec.md`, `../../wave-2.md`, HLD §6.4–§6.5 and §4.1,
`src/contract/capture-contract.ts` (the v2 section at the end), then
`src/core/recorder.ts`, the HTTP and WebSocket probes, `src/install/`.

## Owned paths

`src/contract/**`, `src/core/**` except `problem-rule*` (track 01b adds
`problem-rule.ts` and one export line at the **end** of `src/core/index.ts` —
do not edit the last line of that file), `src/adapters/probes/**`,
`src/install/**`.

## How

1. **Contract:** add `readonly recorder?: LiveRecorder & ProbeRecorder` to
   `DebugCaptureOptions` (why: C-2); update the `socketId` comment (S01-11).
   No other contract change without listing it under Deviations.
2. **Recorder** (`core/recorder.ts`): implement S01-01, S01-02, S01-04 inside
   the existing policy pipeline. The pending URL and headers must go through
   **the same functions** as the stored entry's (`ignoreUrls` via
   `matchesAny`, URL truncation + parameter redaction, `redactHeaders`) —
   refactor into one helper rather than copying. `nextSocketId()` counts from 1
   for the recorder's life. Listener errors never escape and never feed the
   recorder.
3. **Probes:** XHR — `startPending` at `send()` (method, absolute URL, request
   headers as set so far); reused XHR objects get a new id per `send()`. Fetch —
   at call time. Both put `requestId` on the finished draft; both remember
   their in-flight ids and `endPending` them on `dispose()`. A probe that
   receives a plain v1 `Recorder` (no `startPending`) must keep working as v1
   (type the parameter as `Recorder & Partial<ProbeRecorder>` only if needed —
   prefer `ProbeRecorder` and adapt the specs' fakes). C-7 flag on fetch.
   WebSocket ids from `nextSocketId()`.
4. **Install / controller** (`install/`): `createCaptureController(options?)`
   keeps one recorder, built from the resolved policy (there is no
   `options.recorder`, S01-07), one stable session wrapper (S01-06), and
   installs the probes on that recorder on each `start()`. `getActiveCaptureSession()` per S01-06.
   Export `createCaptureController` from the install barrel (L4 → L5).
5. **Specs first** (show each failing once). Include at least: pending
   redaction parity with the stored entry (headers, URL params, ignored URL);
   cap overflow emits `end`; requestId ends pending on stored / sampled-out /
   failed; dispose ends in-flight ids (XHR and fetch); reused XHR; clear order
   (`end`s then `cleared`); stats event on drop and on failure; socket ids
   continue across stop/start; controller no-op transitions; session stable
   identity; Angular seam (`DebugCaptureErrorHandler` with
   `provideDebugCaptureSession(controller.session)`) and React seam
   (`recordReactError(controller.session, …)`) record after stop → start; v1
   `installDebugCapture()` without options behaves as before.
6. **Timing spec** (S01-10): e.g. 10,000 `startPending` + `record` pairs; set
   the limit several × above the measured worst and below a regression; the
   comment states both numbers.

## Verification

```bash
npm ci
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check
# run the full suite 3× (timing specs) and report the numbers
```

Report the new spec count (do not edit `test/unit/spec-floor.json`; tell the
orchestrator the number) and the core size from `npm run size`.

## Out of scope

Sinks and `isProblemEntry` (01b). Anything in `src/panel/**`.
