# S-00 Foundation — spec

**Source of truth:** `docs/design/HLD.md` (Draft 0.4). This spec cuts §9.1
row **S-00** into work. Where they disagree, the HLD wins.

## Goal

Make `packages/debug-capture/` a package that stands on its own, so the four
wave-2 specs (S-01 … S-04) can start **in parallel** against fixed contracts:

1. **Tooling** (HLD §7.2): one install, one command per check, all green.
2. **Contracts** for the parallel wave: every type S-01, S-02, S-03 and S-04
   share is written down once, before any of them starts.
3. **C-4**: the Angular seam builds with plain `tsc` (no decorators).
4. **Standards**: `AGENTS.md`, the contrast check, the specs index.

## Decisions this spec builds on

Confirmed by the owner for S-00: `D-08` (Karma + Jasmine + esbuild), `D-09`
(plain `tsc` build), `D-10` (loader + lazy UI chunk), `D-17` (one recorder for
the page's life). The other Proposed decisions are not needed here.

## Requirements

| ID | Requirement | Track |
|---|---|---|
| S00-01 | `cd packages/debug-capture && npm ci` installs everything; no use of the host app's `node_modules`. Exact versions, a lockfile, `engines.node`. | 00a |
| S00-02 | `npm test` runs every `src/**/*.spec.ts` (framework-free and Angular) once, headless, and exits with the result. Baseline today: **312 specs, all green** — none lost. | 00a |
| S00-03 | `npm run typecheck`, `npm run lint`, `npm run lint:layers`, `npm run format:check`, `npm run build`, `npm run size`, `npm run pack:check`, `npm run e2e`, `npm run contrast`, and `npm run check` (all of them, in that spirit) exist and pass. | 00a (+ 00d for `contrast`) |
| S00-04 | `npm run build` emits `.d.ts` per entry point (plain `tsc`) **and** prebuilt ESM bundles `dist/*.mjs` (esbuild) — what ships, usable from a bundler, Node or a plain page with no bundler. `package.json` `exports` maps `.`, `./angular`, `./react`, `./panel` (and `./package.json`). *(Changed in the review round: tsc first emitted `.js` too, which only worked with bundler resolution.)* | 00a, 00e |
| S00-05 | `npm run lint:layers` enforces L1–L6 and the panel's P1–P5 (HLD §6.2), including "P5 imports P4 only by `import type` and one dynamic `import()`". It has a self-test. | 00a |
| S00-06 | `npm run size` checks the budgets of `NFR-SIZE-01`; the core baseline is measured and recorded. | 00a |
| S00-07 | `npm run e2e` runs a Playwright smoke test: a **plain HTML** page loads `dist/index.mjs`, installs capture, makes a request, and the request is in the buffer. | 00a |
| S00-08 | The contract holds, **additive only** (types, plus the constant `MAX_PENDING_REQUESTS`) (nothing existing breaks): `PendingRequest`, `PendingEvent`, `RecorderChange`, `LiveRecorder`, `ControlledCaptureSession`, `CaptureController`, `CreateCaptureController`, `IsProblemEntry`; `HttpEntry` gains optional `requestId` and `resBodyCapped`. Review round added `ProbeRecorder`, `PendingDraft`, `SinkOptions`, `MAX_PENDING_REQUESTS`. | 00b (+ orchestrator) |
| S00-09 | The panel skeleton exists with its five barrels and its types: `PanelDataSource`, `PanelDataEvent` (P1); `MountPanelUi`, `MountPanelUiOptions`, `PanelUiHandle` (P4); `DebugPanelOptions`, `DebugPanelHandle`, `InstallDebugPanel`, `PANEL_ELEMENT_NAME` (P5). | 00b |
| S00-10 | `DebugCaptureErrorHandler` has no decorator; `provideDebugCapture()` uses a factory. Behaviour is unchanged (all Angular specs still pass). The package type-checks with `experimentalDecorators` off. | 00c |
| S00-11 | `AGENTS.md` at the package root holds the v2 rule set (research `practices-baseline.md` §3), adapted to this package; `CLAUDE.md` points to it. | 00d |
| S00-12 | `npm run contrast` reads the HLD §5.4 token table and fails if any pair is under its WCAG floor or if the "Measured minimum ratios" text no longer matches the numbers. It has a self-test. | 00d |
| S00-13 | `docs/specs/README.md` lists S-00 … S-10 and how a spec folder is laid out. | 00d |

## Out of scope

Any behaviour change in capture (that is S-01). Any panel code beyond types
and barrels (S-02 … S-04). CI (waits for `OPEN-06`). The v1 copy in the host
app (`src/debug-capture/`) — untouched.

## Acceptance

On the foundation branch, from `packages/debug-capture/`: `npm ci && npm run
check` exits 0, with the test count ≥ 312 and the numbers (tests, sizes) in the
PR body. A fresh-context review found no open blocker.
