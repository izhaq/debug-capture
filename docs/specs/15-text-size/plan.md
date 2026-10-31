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

Docs PR #6 open.

S-15a — done, in review. Unit specs 1267 → **1279** (+12: theme 3 replacing the
Small / Normal / Large one, settings 1, settings form 5 in the new `settings-form.spec.ts`,
frame 2, popover 2). e2e 66 → **69** (`panel-v24.spec.mjs`). Every new spec failed once:
against stubs, then for the legend order, the focus hand-off and the 2.3 `'large'` e2e by
mutation. Changed existing specs on purpose: S08-10 clicks + / Reset instead of the radios;
settings specs use numbers (`textSize: 12` was a "foreign value" and is now valid, so that
spec uses 12.5). Version 2.4.0-alpha.0. UI chunk 41,474 → 42,251 B (≤ 45,056).

Deviations from the brief, all found by the 20 px e2e and screenshots:

- The size is in a `<span role="status">`: the safe DOM builder has no `<output>`; `status`
  is announced politely all the same.
- A focused − / + / Reset that becomes disabled hands focus to the opposite button first,
  else focus fell out and closed Settings.
- The title bar wraps the toolbar onto a second bar-high line when it does not fit (docked
  right at 20 px it needed 638 of 519 px and the frame scrolled sideways).
- Popovers stay inside the panel: `max-width: calc(100cqw − 8px)` and, on open, a max width
  and height to the panel's left and bottom edges, scrolling inside (P2 `popover.ts`).
- Setting labels are `6em` wide (72 px at 12 px), so long labels do not run into the choices.
- Two more size properties than the spec table: `--dcp-badge-h`, `--dcp-icon-sm` (badge and
  status-bar icons, 12 px up to 14 px text), `--dcp-menu-item-h`.

Follow-ups: none required. Known limit unchanged: docked right, the HTTP filter bar cuts off
its last chips (more of them at large text).
