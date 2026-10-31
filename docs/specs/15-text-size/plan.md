# S-15 Text size − / + — plan

Spec: [`spec.md`](spec.md) (S15-01 … S15-07). Source of truth: `docs/design/HLD.md`.

## Branches

```
main
└── docs/s15-text-size          HLD rows + this folder (docs PR)
    └── feat/s15a-text-size     S-15a — panel (one PR)
```

Only the owner merges into `main`. If the docs PR changes after S-15a is cut, S-15a takes it in
by a merge, no rebase.

## Tracks

| PR | Brief | Spec rows |
|---|---|---|
| docs | this folder; HLD §0 status, §2.1d, §3.13, §4.10, §5.3, §5.5, §9, §10 | — |
| S-15a | [`prs/15a-panel.md`](prs/15a-panel.md) | S15-01 … S15-07 |

## Owned paths (S-15a)

`src/panel/ui/theme/**`, `src/panel/ui/view-contract.ts`, `src/panel/app/settings*.ts`,
`src/panel/app/frame*.ts`, the views' CSS that names a fixed size from the table
(`src/panel/views/**/*-css.ts`, `src/panel/views/view.ts`), `test/e2e/` (a new
`panel-v24.spec.mjs`), `README.md`, the floors, the three version places.

## Status

Docs PR open.
