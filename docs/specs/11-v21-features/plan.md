# S-11 v2.1 panel features — plan

Spec: [`spec.md`](spec.md) (S11-01 … S11-18). Source of truth: `docs/design/HLD.md`.

## Branches

```
claude/air-gapped-debug-logging-zkn1nr     integration branch
├── claude/dc-v2-s11-docs                  HLD rows + this folder (docs PR)
├── claude/dc-v2-s11a-core                 S-11a — core (cut from the docs branch)
├── claude/dc-v2-s11b-panel                S-11b — panel (cut from S-11a)
└── claude/dc-v2-s11c-app                  S-11c — the playground app takes the tarball
```

Each PR goes into the integration branch; only the owner merges. Code branches start from
the docs branch and take the integration branch in (a merge) once the earlier PR is merged.

## Tracks

| PR | Brief | Spec rows | Order |
|---|---|---|---|
| docs | this folder, HLD §2.1a, §3.10, §4, §6.4, §6.5, §9.3, §10 | — | first |
| S-11a | [`prs/11a-core.md`](prs/11a-core.md) | S11-01 … S11-06 | after docs (stacked) |
| S-11b | [`prs/11b-panel.md`](prs/11b-panel.md) | S11-07 … S11-17 | after S-11a (stacked) |
| S-11c | [`prs/11c-app.md`](prs/11c-app.md) | S11-18 | after S-11b |

## Owned paths

All paths are under `packages/debug-capture/` unless they start with `/`.

| Path | PR | Why |
|---|---|---|
| `docs/design/HLD.md`, `docs/specs/11-v21-features/**`, `docs/specs/README.md`, `docs/specs/HANDOFF.md` | docs (and status updates later) | rows, spec, handoff |
| `src/contract/capture-contract.ts`, `src/core/recorder.ts`, `src/core/ring-buffer.ts`, `src/core/problem-rule.ts`, `src/install/install-debug-capture.ts`, their specs | S-11a | C-9, C-10 |
| `src/panel/model/selectors.ts`, `src/panel/model/state.ts` (and specs) | S-11a | keep notes out of the lists until S-11b |
| `src/panel/**` | S-11b | everything in the panel |
| `scripts/size-budgets.json`, `package.json` (version), `README.md` | S-11b | budgets, version, user docs |
| `test/e2e/panel-v21.spec.mjs`, `test/hostile-host/**` | S-11b | the e2e |
| `test/unit/spec-floor.json`, `test/e2e-floor.json` | S-11a, S-11b | new counts |
| `/vendor/`, `/package.json`, `/package-lock.json`, `/docs/debug-panel.md` | S-11c | the app's tarball |

## Status

**Merged** (2026-10-26): docs #102, S-11a #103, S-11b #104, S-11c #105. Follow-up after an
owner check in the real app: the No limit warning ran past the Settings popover (the toolbar's
`nowrap` reached it); fixed with an e2e and a CSS unit lock, package **2.1.0-alpha.1**, the app
takes the new tarball in the same PR.

S-11a — done, in review. Numbers:

- Unit specs: 1148 ran, floor 1148 (was 1126): +22 — `ring-buffer.spec.ts` +5, `recorder-v21.spec.ts`
  +13 (new), `problem-rule.spec.ts` +1, `install-debug-capture.spec.ts` +3, `selectors.spec.ts` +1.
  e2e: 48, floor 48 (no e2e change).
- Every new spec failed once under a mutation (three rounds: no shrink / no eviction count / no
  bytes or problems / no note policing / no note kind / addNote skipped / note as a problem /
  compaction off by one / no validation / a cached usage object).
- Sizes, min+gzip: core 11,743 → **12,071** / 12,368 (+328 B; still within v1 + 2 kB);
  loader 4,084 / 4,096 and UI chunk 39,006 / 40,960 (the selectors' note line), budgets unchanged.

Deviations:

- `ring-buffer.spec.ts` "rejects a capacity…" no longer expects `Infinity` to throw: No limit
  (`D-28`) needs it. `-Infinity` still throws.
- `RingBuffer` is now an array with a moving head (amortised O(1)) instead of fixed slots, so it
  can grow to No limit.

S-11b — done, in review. Numbers:

- Unit specs: 1197 ran, floor 1197 (was 1148): +49 — `model/v21.spec.ts` 13 (new),
  `console-note.spec.ts` 3 (new), `settings.spec.ts` +2, `frame-v21.spec.ts` 17 (new), `loader.spec.ts`
  +17; S-11a's "a note shows in no list yet" spec removed (S-11b gives notes their row).
- e2e: 54 ran, floor 54 (was 48): `panel-v21.spec.mjs` +6.
- Every new spec failed once: unit in seven mutation rounds (model, console, settings, frame, form,
  note form, loader storage / launcher / warnings, onStatus), e2e in one round (6 of 6 red).
- Sizes, min+gzip: loader 4,084 → **4,717** (budget 4,096 → **5,632**, 5.5 kB); UI chunk 39,006 →
  **40,577** (budget 40,960 → **45,056**, 44 kB); core 12,071 / 12,368 (unchanged). Each budget raise is
  about 2.5 × the S-11 growth (`D-34`, HLD `NFR-SIZE-01`).
- Perf, 3 runs (Chromium 153): warm open 52–67 ms (limit 100), cold 62–72 ms; 100 entries/s: no long
  task; nodes at 1,080 px — HTTP 831, WebSocket 1,012, Console 1,299 (limit 2,000); memory added
  1.58–1.60 MB (limit 10 MB).
- Chrome 146 (NFR-COMP-01): `npm run check` passed on Chrome for Testing 146.0.7680.72 — Karma
  1197 specs, Playwright 54 (warm open 43 ms).
- Version 2.1.0-alpha.0; `npm run pack:check`: `debug-capture-2.1.0-alpha.0.tgz`, 127 files, 345,470 B.

Deviations and notes:

- Changed existing specs, on purpose: the toolbar order now has **Note**; the stored-keys list has
  `buffer` and `launcher`; with `launcher: false` the loader keeps one change listener (a clear or
  size change re-arms the near-full banner) and still nothing per entry; the Escape spec names the
  Settings popover (there are two dialogs now).
- The HLD budget numbers (`NFR-SIZE-01`, `D-34`, §0, §1.6, §6.1, §6.6) are written in this PR, as
  the docs PR said they would be.
- Notes are stamped when **Add note** is clicked (`FR-NOTE-01`).

S-11c — done, in review (#105): the app takes `vendor/debug-capture-2.1.0-alpha.0.tgz`; `tsc`,
`lint:layers`, `ng build` and `ng test` (603 specs) pass.
