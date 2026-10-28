# S-10 — Integration and verification

HLD rows: §9.1 S-10, §9.3 (S-10 owns BR-01…07, NFR-PORT-01; measures NFR-PERF-02/03/04/06;
final NFR-SIZE-01, NFR-SEC-01…04, NFR-COMP-01). Depends on every earlier spec (S-00 … S-09).
Source of truth: [`../../design/HLD.md`](../../design/HLD.md). When this spec and
the HLD disagree, the HLD wins.

## Goal

Prove the package works where it will be used, as it ships, and that every `MUST`
in the HLD has a test. Two PRs, one after the other (owner, 2026-10-25):

- **S-10a — hosts, packaging, README.** Three real hosts — Angular 16, React 19 and a
  plain HTML page — install capture and the panel exactly as HLD §6.6 shows, from the
  built `dist/` and the package's own `exports`. One shared end-to-end scenario runs on
  all three. `npm pack` is the deliverable (BR-05). The README is rewritten for users.
- **S-10b — verification.** BR-01…07 end to end, the performance numbers measured, the
  final size and security pass, an old-Chromium run if one exists, and the every-MUST
  walk.

No panel code changes in either PR. Budgets stay as they are (loader 4 kB, UI chunk 40 kB);
raising one needs the owner.

## Requirements — S-10a

| ID | Requirement | HLD |
|---|---|---|
| S10-01 | **Angular host** (`test/hosts/angular/`, Angular 16.2 — the playground's version and the bottom of the peer range `>=16 <21`). `main` creates the controller only when `isDebugRequested()`, calls `installDebugPanel(controller)`, and bootstraps a standalone component with `provideDebugCapture()` and `provideDebugCaptureSession(controller?.session ?? null)`. The page's own UI works; an error thrown in a component reaches the recorder through the Angular `ErrorHandler`. | NFR-PORT-01, BR-03, §6.6, FR-ACT-01 |
| S10-02 | **React host** (`test/hosts/react/`, React 19). `main` does the same §6.6 two lines and creates the root with `createRoot(container, createReactRootErrorOptions(controller?.session ?? null))`. A render error caught by an error boundary reaches the recorder through `onCaughtError`. React is a dev dependency for this host only; nothing in `src/` imports it. | NFR-PORT-01, BR-03, BR-04, §6.6 |
| S10-03 | **Plain page** (`test/hosts/plain/`). No bundler: `<script type="module">` imports `index.mjs` and `panel.mjs` from a `vendor/debug-capture/` copy of `dist/`, the §6.6 snippet word for word. | NFR-PORT-01, BR-03, §6.6 |
| S10-04 | The Angular and React hosts are bundled from their sources by esbuild at e2e time. `debug-capture`, `debug-capture/angular`, `debug-capture/react` and `debug-capture/panel` resolve through the package's `exports` to `dist/` — the same files `npm pack` ships. The panel UI stays a lazy chunk in each host bundle. | NFR-PORT-01, FR-ACT-02, §6.1 |
| S10-05 | **Same behaviour** on all three hosts, one shared Playwright scenario: with `?debug=1` the launcher is shown and the UI chunk is not loaded before the first open; `Ctrl+Alt+Shift+P` opens the panel and moves focus in; a request the host makes shows in Network › HTTP with its status; a WebSocket the page opens shows in Network › WebSocket; a host `console.warn` and the host's framework error show in Console; Export › Download all (JSON) saves one file that holds those entries; `Escape` closes the panel and focus returns; no page error. | NFR-PORT-01, BR-01, BR-06, FR-ACT-02/05/07, §8.1 |
| S10-06 | **Flag off** on all three hosts: with no `?debug` and no storage flag there is no controller, no panel element, no launcher, the chord does nothing, and `fetch` / `WebSocket` / `console.log` are the page's own. | BR-02, BR-07, FR-ACT-01 |
| S10-07 | **Packaging.** `npm run pack:check` passes on the final tree: the tarball holds only `package.json`, `README.md`, the bundles, their maps and the `.d.ts` files, and installs and type-checks in a scratch consumer. The PR reports the tarball name, file count and size. | BR-05, BR-04, NFR-PORT-01 |
| S10-08 | **README for users** (package root). Leads with what it is and how to switch it on; install from the tarball; the three host set-ups, copied from the tested hosts; options; keyboard; what it records and what it redacts; sizes; security (CSP, no network, copy / export only on a click); known limits. Developer notes move to a short last section that points to `AGENTS.md`. | BR-05, §6.6, §6.8 |
| S10-09 | The host app at the repo root is unaffected: the PR changes nothing outside `packages/debug-capture/` (the package's folder there then). | §1 (host app stays unaffected) |

## Requirements — S-10b

| ID | Requirement | HLD |
|---|---|---|
| S10-10 | BR-01…07 each map to a test (most from S-10a and earlier specs) or a checklist row with evidence. | BR-01…07, §1.6 |
| S10-11 | Measured, with the numbers in the PR: open time warm (5,000 entries) and cold; per-frame apply time and long tasks at 100 entries/s; DOM nodes per tab with an open detail at 1,080 px; memory added with 5,000 entries; the virtual-list frame-budget spec run **in isolation**. Limits follow the margin rule (§7.1). | NFR-PERF-02, 03, 04, 06 |
| S10-12 | Final size table against the budgets; the core still within ± 2 kB of v1. | NFR-SIZE-01 |
| S10-13 | Final security pass: the panel on a strict CSP + Trusted Types page with no violation; HTML and `javascript:` in captured data render as text; copy / export only on a user action; no `innerHTML`-family and no network request from the panel. | NFR-SEC-01…04 |
| S10-14 | A run on Chrome 146 if one is available; otherwise say so and why. | NFR-COMP-01 |
| S10-15 | The every-MUST walk: each HLD `MUST` row against the specs' traceability tables; gaps listed and either covered or raised with the owner. `docs/specs/HANDOFF.md` is deleted (HANDOFF §5 rule 11). | §8.3, §9.3 |
| S10-16 | Found by the walk (S10-15): on the smallest supported screen, 1280 × 720, every frame control and each view's filter bar is on screen, docked bottom and right (the HTTP chips in a narrow right dock are a known limit). | NFR-COMP-02 |

## Out of scope

Wiring the panel into the playground app at the repo root. Angular versions below 16
(the repo name says 13; the app is 16.2). A separate window, Hebrew UI, the Problems tab,
column picker. New panel features or fixes for the known limits below. Raising any size
budget.

**Known limits** (named in both PRs, not fixed here): fullscreen and a host modal dialog —
the panel is drawn on top and live but not clickable (Chrome rule, `D-15`); a modal dialog
inside a host's shadow root is not seen (ISO-21); in a narrow right dock the HTTP filter
bar clips its last chips; `redactUserinfo` (`src/core/redact.ts`) misses leading-space and
`//host` URLs.

## Acceptance

- S-10a: `test/e2e/hosts.spec.mjs` runs the S10-05 scenario and the S10-06 flag-off check on
  the Angular, React and plain hosts; `npm run pack:check` passes; the README is the user
  README; `git diff --stat` outside the package is empty; the spec and e2e floors rise.
- S-10b: the PR lists every BR and every measured number; [`must-walk.md`](must-walk.md) maps every HLD `MUST` to its spec and tests.

## Traceability

| MUST | Proved by | PR |
|---|---|---|
| NFR-PORT-01 | `test/e2e/hosts.spec.mjs` (Angular, React, plain — the same scenario); `test/hosts/build.mjs` (bundles from `dist/` through `exports`) | S-10a |
| BR-03 | the same e2e, one project per host | S-10a |
| BR-05 | `npm run pack:check`; the PR's tarball line | S-10a |
| BR-02, BR-07 (flag off) | `test/e2e/hosts.spec.mjs` — flag-off test per host | S-10a (S-10b re-checks) |
| BR-01, BR-06 (on a real host) | `test/e2e/hosts.spec.mjs` — live rows and the export file | S-10a (S-10b re-checks) |
| BR-04 | `npm run pack:check` (no runtime dependencies in the tarball); React and Angular only as dev dependencies | S-10a (S-10b re-checks) |
| FR-ACT-01, 02, 05, 07 (on real hosts) | `test/e2e/hosts.spec.mjs` | S-10a |
| BR-01…07 | the BR table in [`must-walk.md`](must-walk.md) (S10-10) | S-10b |
| NFR-PERF-02, 03, 04, 06 | `test/perf/panel-perf.spec.mjs` (the `perf` project, after e2e); the virtual-list frame-budget spec measured alone (its comment) | S-10b |
| NFR-SIZE-01 | `npm run size` (S-00 script), final table in the S-10b PR (S10-12) | S-10b |
| NFR-SEC-01…04 | `test/e2e/panel-security.spec.mjs` (S10-13), on top of each view's specs | S-10b |
| NFR-COMP-01 | `npm run check` run on Chrome for Testing 146.0.7680.72 (Karma and Playwright), S10-14 | S-10b |
| NFR-COMP-02 | `test/e2e/panel-screen.spec.mjs` (S10-16) | S-10b |
| every MUST | [`must-walk.md`](must-walk.md) (S10-15) | S-10b |
