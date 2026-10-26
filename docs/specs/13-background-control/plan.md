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

Docs PR open. Code not started.
