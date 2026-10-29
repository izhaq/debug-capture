# 15a — Panel: the text size stepper

Spec rows S15-01 … S15-07. Branch `feat/s15a-text-size` → one PR into `main` (after the docs PR).

## Goal

Settings › Text size is − / `n px` / + / Reset, 10–20 px, live and remembered; the sizes of
the spec's table follow *n*.

## Owned paths

See [`../plan.md`](../plan.md) › Owned paths.

## Public API

No change to the package's exports. Inside the panel:

- P2 `src/panel/ui/theme/`: `TEXT_SIZE_MIN = 10`, `TEXT_SIZE_MAX = 20`, `TEXT_SIZE_DEFAULT = 12`,
  `textSizeVars(n: number): Readonly<Record<string, string>>` (custom property → value),
  `rowHeightFor(n: number): number`. `TextSize` becomes `number`; `ROW_HEIGHTS` is removed.
- P2 `view-contract.ts`: `ViewSettings.rowHeight: number`.
- P4 `settings.ts`: `PanelSettings.textSize: number`.
- P4 `settings-form.ts`: `SettingsValues.textSize: number`; the form's `onChange('textSize', '<n>')`.

## Behaviour

- The panel root gets the properties by `style.setProperty` (CSSOM, allowed under the strict
  CSP; `ISO-04` needs no HTML strings). Removing the panel removes them.
- A click on − / + / Reset changes the size by one step (or to 12), applies it, saves it and
  updates the form; the `<output>` text changes (`aria-live="polite"`), and focus stays on the
  button. A disabled button keeps focus out (native `disabled`).
- Fixed sizes that the table names read `--dcp-control-h`, `--dcp-bar-h`, `--dcp-status-h`,
  `--dcp-icon`, `--dcp-badge-h`, `--dcp-menu-item-h`, `--dcp-row-h`.

## Required specs (red first)

- theme: `textSizeVars` gives the table's values for 10, 12, 14, 20; the defaults in the sheet
  equal `textSizeVars(12)`; out-of-range or not-whole input is clamped and rounded.
- settings: `'small'`, `'normal'`, `'large'` → 11, 12, 14; 9, 21, 12.5, `'x'`, `null` → 12; a
  number round-trips.
- form: three named buttons and an output; disabled at the ends and Reset at 12; clicks call
  `onChange`; `set()` updates the output and the disabled states without calling `onChange`.
- frame: a click on + sets the root's properties and the views' row height, and saves.
- e2e `panel-v24.spec.mjs`: S15-06.

## Verification

`npm run check` on the pinned Chromium and on Chrome 146.0.7680.72; the floors raised; sizes in
the PR; version `2.4.0-alpha.0`.

## Out of scope

As the spec.
