# S-17 Headless — plan

Spec: [`spec.md`](spec.md) (S17-01 … S17-09). Source of truth: `docs/design/HLD.md`.

## Branches

```
main
└── docs/s17-headless        HLD rows + this folder (docs PR)
    └── feat/s17a-headless   S-17a — the debug-capture/activate-headless entry
```

One PR each into `main`, in order; only the owner merges. The code branch takes the merged docs
in by a merge, no rebase.

## Tracks

| PR | Brief | Spec rows |
|---|---|---|
| docs | this folder; HLD status, §0, §2.1f, §3.15, `NFR-SIZE-01`, §6.1, §6.2, §6.4, §6.6, §9, `D-56` | — |
| S-17a | [`prs/17a-headless.md`](prs/17a-headless.md) | S17-01 … S17-09 |

## Risks

- **The shared chunk.** Splitting puts the activation code in a chunk both entries import; the
  `D-43` build check changes from "no static import" to "only `src/activate/` chunks". The size
  script already measures an entry with its static imports, so the budget still counts it.
- **Panel types in the headless `.d.ts`.** `DebugActivationOptions` / `DebugActivationHandle`
  name `DebugPanelOptions` / `DebugPanelHandle` by `import type`. Types are erased and never
  reach a host bundle, so `FR-HL-02` holds; `headless.ts` itself may not import `../panel` at all
  (S17-04). If a host's type check should not see panel types either, the brief says how to move
  them.
- **Version.** Main is `2.5.0-alpha.1`; S-17a bumps to `2.5.0-alpha.2` (owner: release 2.5).

## Status

Docs PR #14 — merged. Owner answers (2026-11-15): fail closed, not followed live, one tarball,
release 2.5 (next alpha on `main`).
