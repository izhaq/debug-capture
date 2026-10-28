# 01b — Sinks with a root, and the problem rule

**Branch:** `claude/dc-v2-w2-01b-sinks` → PR into `claude/dc-v2-wave2`
**Covers:** S01-08, S01-09 (`../spec.md`).
**Read first:** `../spec.md`, `../../wave-2.md`, HLD `FR-ACT-04`, §6.5 C-5 and
C-8, `src/adapters/sinks/`, the contract's `SinkOptions` and `IsProblemEntry`.

## Owned paths

`src/adapters/sinks/**`, `src/core/problem-rule.ts`,
`src/core/problem-rule.spec.ts`, and **one line appended at the end** of
`src/core/index.ts`: `export { isProblemEntry } from './problem-rule';`
(track 01a owns the rest of that file).

## How

1. `isProblemEntry: IsProblemEntry` in `core/problem-rule.ts` — pure, exact
   rule of S01-08. Specs: one per entry kind and edge (status 499 / 500 / 599,
   `status null` + `error 'abort'`, WS `close` with an abnormal code is **not**
   a problem, log `error` level is **not**).
2. `copyText(text, host?, options?: SinkOptions)` and
   `downloadText(text, filename, mimeType?, host?, options?: SinkOptions)`:
   with `options.root`, append the temporary node there instead of
   `document.body`; remove it afterwards exactly as today. Keep every v1 spec
   green.
3. Prove it in a real browser (Karma runs in Chromium): a host element with an
   open shadow root; `copyText(..., { root: shadowRoot })` with
   `navigator.clipboard` unavailable or rejecting → the fallback textarea is
   created inside the shadow root, `document.body` never gets a child (watch
   with a `MutationObserver` on `body`), focus returns. Same for
   `downloadText` (stub `URL.createObjectURL` and the anchor's `click` through
   the host object if the real click would download). Record in the PR whether
   `execCommand('copy')` really succeeds from inside a shadow root in headless
   Chromium (this answers HLD `OPEN-04` for Chromium 141; the station browser
   is still open).

## Verification

```bash
npm ci
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check
```

Report the new spec count (do not edit `test/unit/spec-floor.json`).

## Out of scope

Recorder, probes, install (01a). `src/panel/**`.
