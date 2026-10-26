# S-13 Background control — plan

Spec: [`spec.md`](spec.md) (S13-01 … S13-19). Source of truth: `docs/design/HLD.md`.

## Branches

```
claude/air-gapped-debug-logging-zkn1nr     integration branch
└── claude/dc-v2-export-sequence-time      #107 (export schema 2) — S-13 builds on it
    └── claude/dc-v2-s13-docs              HLD rows + this folder (docs PR)
        └── claude/dc-v2-s13a-core         S-13a — core chords, activation entry, seams
            └── claude/dc-v2-s13b-panel    S-13b — hidden DBG button, About
                └── claude/dc-v2-s13c-app  S-13c — the playground app takes the tarball
```

Each PR goes into the integration branch; only the owner merges. When an earlier PR is
merged, the later branches take the integration branch in by a merge (no rebase).

## Tracks

| PR | Brief | Spec rows | Order |
|---|---|---|---|
| docs | this folder; HLD §0, §1, §2.1b, §3, §3.11, §4, §6, §9, §10, §11; specs README; handoff | — | first |
| S-13a | [`prs/13a-core.md`](prs/13a-core.md) | S13-01 … S13-14 | after docs (stacked) |
| S-13b | [`prs/13b-panel.md`](prs/13b-panel.md) | S13-15 … S13-18 | after S-13a (stacked) |
| S-13c | [`prs/13c-app.md`](prs/13c-app.md) | S13-19 | after S-13b (stacked) |

## Owned paths

All paths are under `packages/debug-capture/` unless they start with `/`.

| Path | PR | Why |
|---|---|---|
| `docs/design/HLD.md`, `docs/specs/13-background-control/**`, `docs/specs/README.md`, `docs/specs/HANDOFF.md` | docs (status later) | rows, spec, handoff |
| `src/contract/capture-contract.ts`, `src/install/**`, `src/index.ts` specs | S-13a | `C-11`, version |
| `src/activate/**` (new), `scripts/entries.mjs`, `scripts/check-layers.mjs`, `scripts/build.mjs`, `scripts/size.mjs`, `scripts/size-budgets.json`, `package.json`, `AGENTS.md` (layer row) | S-13a | the new entry |
| `src/angular/**`, `src/react/**` | S-13a | seam getter |
| `test/hosts/**`, `test/e2e/hosts.spec.mjs`, `test/e2e/plain-host.spec.mjs`, `test/e2e/background.spec.mjs` (new) | S-13a | hosts on §6.6, e2e |
| `src/panel/**` | S-13b | `'hidden'`, About |
| `README.md` | S-13a, S-13b | user docs |
| `test/unit/spec-floor.json`, `test/e2e-floor.json` | S-13a, S-13b | new counts |
| `/vendor/`, `/package.json`, `/package-lock.json`, `/src/main.ts`, `/src/app/features/debug-panel/**`, `/docs/debug-panel.md` | S-13c | the app |

## Status

PRs, in merge order: #107 (export schema 2) → #108 docs → #109 S-13a → #110 S-13b → S-13c.

S-13a — done, in review. Numbers:

- Unit specs: 1235 ran, floor 1235 (was 1202): +33 — `activate.spec.ts` 18 (new),
  `install-debug-capture.spec.ts` +10, Angular seam +3, React seam +2. Layer self-test: 119
  cases (+12, rule 9).
- e2e: 61 ran, floor 61 (was 55): `background.spec.mjs` +6 (new).
- Every new spec failed once: unit against the old controller and seams, then in mutation
  rounds (activation stub; storage key, start-time switch-on, never-throws; getter called
  outside the guard); e2e in three mutation rounds (no turn-off + old chord unbinding + seam
  ignores getters; switch-on at start always; flag never written).
- Sizes, min+gzip: core 12,294 → **12,481** (budget 12,368 → **13,904**, v1 + 3.5 kB);
  activate **1,130** (new budget **1,536**); loader 4,717 / 5,632 and UI chunk 40,581 / 45,056
  unchanged.
- Perf: warm open 64 ms (limit 100), cold 82 ms.

Deviations and notes:

- Changed existing specs, on purpose: `stop()` now keeps the chords (`D-37`), so the
  controller spec expects a download while off; `DEFAULT_SHORTCUTS` and the
  `DebugCaptureOptions` keys have the 2.2 additions; fake controllers gain `shortcuts` and
  `dispose`; the plain-host e2e waits for the page (its code now waits for `ready`).
- The S-10 hosts use the §6.6 snippet (activation); `?debug=1` paths are unchanged and pass.
- A host bundled by esbuild with splitting that imports `debug-capture/angular` statically
  still loads the core chunk at start (it holds esbuild's shared helpers; the Angular entry
  re-exports the core). The shipped `dist/activate.mjs` has no static import (checked by the
  build). The real app (webpack) is measured in S-13c.

S-13b — done, in review. Numbers:

- Unit specs: 1249 ran, floor 1249 (was 1235): +14 — `about.spec.ts` 6 (new), `frame-v22.spec.ts`
  4 (new), `loader.spec.ts` +3, `activate.spec.ts` +1.
- e2e: 63 ran, floor 63 (was 61): `background.spec.mjs` +2 (hidden DBG button across a reload;
  About with custom chords on the hostile host).
- Every new spec failed once (three unit mutation rounds: loader, frame and About, the "off"
  rows; one e2e round: `'hidden'` acting as shown and a fixed toggle chord in About).
- Sizes, min+gzip: loader 4,717 → **4,761** / 5,632; UI chunk 40,581 → **41,327** / 45,056;
  activate 1,130 → **1,156** / 1,536; core 12,481 / 13,904. No budget changes.
- Perf: warm open 61 ms (limit 100), cold 69 ms.

Deviations and notes:

- Changed existing specs, on purpose: the host e2e expects the DBG button **hidden** after a
  `?debug=1` start (the activation piece always starts it hidden, `D-41`); the hostile host's
  controller key list has `shortcuts` and `dispose`; fake mount options gain `shortcuts`.
- Found while building: any settings save stored `launcher: true` (the default) and would
  have shown a hidden button after a reload. The frame now stores the loader's live DBG
  choice on every save (spec in `frame-v22.spec.ts`).
- About is a scroll box (160 px) at the end of the Settings popover, focusable for keyboard
  scrolling.

S-13c — done, in review. The app takes `vendor/debug-capture-2.2.0-alpha.1.tgz`:

- `startDebugPanel()` returns `{ providers, ready, activation }`; `main.ts` bootstraps after
  `ready`. The app spec was rewritten for the new shape (shown red once by a mutation).
- `tsc`, `lint:layers`, `ng build` and `ng test` (603 specs) pass.
- Start bundle (webpack, production): main 769.94 → **728.53 kB** raw, 177.03 → **163.74 kB**
  transfer. The core is a lazy chunk (`index-mjs`, 32.98 kB raw / 11.08 kB), with the loader
  (`panel-mjs`, 9.22 / 3.85 kB) and the UI (`chunks-app`, 117.07 / 34.75 kB).
- In the real app, driven by Playwright: off → the download chord makes no file; after the
  activation chord and a reload, the file holds the startup request
  (`/api/system-experiments/get`) and the note chord's note; capture off (`S`) still exports
  and takes notes; the activation chord again → no file, flag gone. About lists the chords.
- Chrome 146 (`NFR-COMP-01`): `npm run check` passed on Chrome for Testing 146.0.7680.72 —
  Karma 1249 specs, Playwright 63 (warm open 60 ms).
