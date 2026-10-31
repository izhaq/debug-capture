# S-15 — Text size − / + (release 2.4)

HLD rows: §9.1 S-15, §2.1d, §3.13 (`FR-TXT-01…06`), §4.10, §5.3, §5.5, decisions `D-49`,
`D-50`. Depends on S-14. Source of truth: [`../../design/HLD.md`](../../design/HLD.md).

## Goal

Users at the stations find the panel's 12 px text too small. Settings › Text size becomes a
stepper: **−**, the size, **+**, **Reset**. Each click changes the text by 1 px, from 10 to 20 px,
at once. Rows, bars, buttons and icons grow with it, so nothing is clipped. Owner decisions
2026-10-29 (`D-49`, `D-50`).

```
Text size   [ − ]  12 px  [ + ]   Reset
```

One code PR after this docs PR: **S-15a panel**.

## Sizes (HLD §5.3, §5.5)

*n* = the text size, a whole number of px, 10 ≤ *n* ≤ 20, default 12.

| Part | Size | 10 | 12 | 14 | 20 |
|---|---|---|---|---|---|
| UI and data text | *n* | 10 | 12 | 14 | 20 |
| Meta text | *n* − 1 | 9 | 11 | 13 | 19 |
| List row | 2*n* − 2 | 18 | 22 | 26 | 38 |
| Controls (buttons, chips, inputs) | max(24, 2*n* − 4) | 24 | 24 | 24 | 36 |
| Title bar, filter bar, detail header, subbar | control + 8 | 32 | 32 | 32 | 44 |
| Menu item | control + 4 | 28 | 28 | 28 | 40 |
| Status bar | max(22, *n* + 8) | 22 | 22 | 22 | 28 |
| Icons | max(14, *n*) | 14 | 14 | 14 | 20 |
| Badges | max(16, *n* + 2) | 16 | 16 | 16 | 22 |

At *n* ≤ 14 every size equals 2.3's (Small 11, Normal 12, Large 14).

## Requirements — S-15a (panel)

| ID | Requirement | HLD |
|---|---|---|
| S15-01 | P2 theme: one function gives the CSS custom properties for a size *n* (the table above); the base sheet's defaults are the *n* = 12 values; every fixed px the table names reads its property. `ROW_HEIGHTS` and `data-text-size` go. | FR-TXT-03, D-50 |
| S15-02 | View contract: `ViewSettings.rowHeight` is any whole number of px (was `20 \| 22 \| 26`). The views and the virtual list already take any positive height. | FR-TXT-03, D-50 |
| S15-03 | Settings model: `textSize` is a number 10…20. `parseSettings` maps `'small'` / `'normal'` / `'large'` to 11 / 12 / 14 and anything else to 12; `serializeSettings` stores the number. | FR-TXT-04 |
| S15-04 | Settings form: the Text size group is a stepper — native buttons **−** ("Smaller text"), **+** ("Larger text"), **Reset** ("Reset text size"), and the value (`12 px`) in an `<output>` that is announced politely. **−** disabled at 10, **+** at 20, Reset at 12. A click calls `onChange('textSize', '<n>')`. | FR-TXT-01, 02, 05 |
| S15-05 | Frame: a text size change sets the properties on the panel root, passes the row height to the views, saves, and keeps the form in step. The lists keep their place (the virtual list's `setRowHeight`). | FR-TXT-01, 03, 04, 05 |
| S15-06 | e2e on the hostile host: + up to 20 (+ then disabled), the text, a row, a bar and a button really grow; − down to 10; Reset back to 12; the size is kept after a reload; at 1280 × 720 and 20 px every toolbar control is on screen, docked bottom and right; a 2.3 stored `'large'` opens at 14 px. | FR-TXT-01…05 |
| S15-07 | Budgets: UI chunk ≤ 45,056 B, loader ≤ 5,632 B; core and activation unchanged. Version `2.4.0-alpha.0`; README › Using the panel › Settings. | FR-TXT-06 |

## Out of scope

Browser-zoom chords (Ctrl + / −) inside the panel (`D-49`: they belong to the browser). A size
per tab. Line height and spacing (fixed). The launcher (DBG button) — it lives in the loader and
keeps its size.

## Traceability

| MUST (2.4) | Proved by | PR |
|---|---|---|
| FR-TXT-01, 02 | `settings-form.spec.ts`, `frame` spec, e2e | S-15a |
| FR-TXT-03 | `theme-sheet.spec.ts` (the table), e2e (computed sizes) | S-15a |
| FR-TXT-04 | `settings.spec.ts`, e2e (reload, 2.3 value) | S-15a |
| FR-TXT-05 | form spec (names, disabled, output), e2e (1280 × 720 at 20 px, both docks) | S-15a |
| FR-TXT-06 | `npm run size` | S-15a |
