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

Docs PR open (#102).

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
