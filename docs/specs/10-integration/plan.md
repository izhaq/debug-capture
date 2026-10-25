# S-10 Integration and verification — plan

Spec: [`spec.md`](spec.md) (S10-01 … S10-15). Source of truth: `docs/design/HLD.md`.

## Branches

```
claude/air-gapped-debug-logging-zkn1nr     integration branch
├── claude/dc-v2-s10a-hosts                S-10a — hosts, packaging, README (one PR)
└── claude/dc-v2-s10b-verify               S-10b — verification (one PR, after S-10a is merged)
```

Each PR goes into the integration branch. Only the owner merges them.

## Tracks

| PR | Brief | Spec rows | Order |
|---|---|---|---|
| S-10a | [`prs/10a-hosts.md`](prs/10a-hosts.md) | S10-01 … S10-09 | first |
| S-10b | [`prs/10b-verify.md`](prs/10b-verify.md) | S10-10 … S10-15 | after S-10a is merged |

S-10a, in commits:

1. This spec folder.
2. The host build (`test/hosts/build.mjs`) and the Angular host.
3. The React host (React 19 as a dev dependency).
4. The plain page on the §6.6 snippet, and the shared e2e on all three hosts.
5. The user README.
6. Floors, this plan's status, HANDOFF §0.

## Owned paths

All paths are under `packages/debug-capture/`.

| Path | PR | Why |
|---|---|---|
| `docs/specs/10-integration/**` | both | this spec, plan and briefs |
| `docs/specs/README.md`, `docs/specs/HANDOFF.md` | both | the S-10 row and link; the handoff status (deleted in S-10b) |
| `test/hosts/**` | S-10a | the Angular, React and plain hosts and their build |
| `test/static-server.mjs` | S-10a | serves the hosts, the built host bundles and `vendor/debug-capture/` |
| `test/e2e/hosts.spec.mjs`, `test/e2e/plain-host.spec.mjs` | S-10a | the shared host scenario; the S-00 smoke follows the new plain page |
| `playwright.config.mjs` | S-10a | builds the hosts before the static server starts |
| `package.json`, `package-lock.json` | S-10a | React 19 (`react`, `react-dom`) as dev dependencies |
| `README.md` | S-10a | the user README |
| `test/unit/spec-floor.json`, `test/e2e-floor.json` | both | the new counts |
| `test/perf/**`, `test/e2e/panel-security.spec.mjs`, `test/e2e/panel-screen.spec.mjs`, `playwright.config.mjs` | S-10b | measurements (a `perf` project after e2e), the final security pass, the 1280 × 720 check |
| `docs/specs/10-integration/must-walk.md`, `scripts/pack-check.mjs` (comment), `src/panel/ui/virtual-list/virtual-list.spec.ts` (comment) | S-10b | the walk; BR-05 named; the isolated timing |

Nothing in `src/`. Nothing outside the package.

## Status

S-10a — merged in #96. S-10b — done, in review (one PR into the integration branch; the owner
merges it). With S-10b, v2.0 is complete; next is S-11 (HLD `D-27`).

S-10b numbers:

- Performance (`test/perf/panel-perf.spec.mjs`, Chromium 153, 3 runs; and once on Chrome 146):
  open warm 49–60 ms (limit 100), cold 77–102 ms (reported); 100 entries/s: no long task;
  nodes with the detail open at 1,080 px — HTTP 795, WebSocket 972, Console 1,263 (limit 2,000);
  scrolling 5,000 entries: no long task; memory added 1.46–1.66 MB (limit 10 MB). The
  virtual-list frame-budget spec alone: median 1.0–1.4 ms (5,000), 1.9–2.7 ms (100,000).
- Security (`test/e2e/panel-security.spec.mjs`): HTML and `javascript:` in captured data stay
  text in every view and detail; no request while the panel is open and used; copy / download
  only on a click. Each test was shown red once.
- Chrome 146 (NFR-COMP-01): `npm run check` passed on Chrome for Testing 146.0.7680.72, both
  Karma (1126 specs) and Playwright (e2e + perf).
- Every-MUST walk: [`must-walk.md`](must-walk.md) — 82 MUST rows, 0 gaps after S10-16 closed the
  one it found (`NFR-COMP-02`, `test/e2e/panel-screen.spec.mjs`).
- Sizes unchanged from #98: loader 4,084 / 4,096; UI chunk 39,001 / 40,960; core 11,743 / 12,368.
- `docs/specs/HANDOFF.md` deleted (its rule 11).

S-10a numbers:

- Unit specs: 1122 ran, floor 1122 (no unit specs added; S-10a adds no `src/` code).
- e2e: 39 ran, floor 39 (was 33): `hosts.spec.mjs` adds 6 — the shared scenario and the
  flag-off test on each of Angular, React and plain.
- Proved red once each: the React host without `installDebugPanel` (no launcher); the Angular
  host with the controller always created (flag-off test); the Angular host without
  `provideDebugCapture()` and the React host without `createReactRootErrorOptions` (no
  framework error in Console).
- Sizes, min+gzip, unchanged: loader 4,084 / 4,096; UI chunk 38,926 / 40,960; core 11,743 / 12,368.
- `npm run pack:check`: ok; `debug-capture-2.0.0-alpha.0.tgz`, 126 files, 329,217 B.
- Nothing outside `packages/debug-capture/` changed.

Deviations from the brief:

- `plain-host.spec.mjs` now opens `/plain/?debug=1` and imports the vendored copy; the plain page
  is the §6.6 snippet plus the page's own script (test hooks: `__hostReady`, `__hostSession`).
- Each host sets `window.__hostSession` (null when the flag is off) for the flag-off test:
  zone.js makes its own patches of `fetch` / XHR / `WebSocket` read as native, so the "globals
  stay native" check alone says little on the Angular host.
- The Angular host calls `enableProdMode()` (a production build, BR-02).
