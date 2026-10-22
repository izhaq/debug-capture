# 08 — Frame, toolbar and status

Spec: [`../spec.md`](../spec.md) (S08-01 … S08-17). Plan: [`../../wave-3.md`](../../wave-3.md).
Branch `claude/dc-v2-w3-08-frame` → PR into `claude/dc-v2-wave3`. Starts after
the contract PR is merged. Fresh-context review before merge.

## Goal

Replace the placeholder P4 with the real frame and mount the three views
through `CreateView`.

## Owned paths

`src/panel/app/**`; `src/panel/loader.ts` and `src/panel/loader-styles.ts`
(the `fullscreenchange` re-raise only, S08-13); `test/hostile-host/**` except
`server.mjs`; `test/e2e/panel-frame.spec.mjs` (new);
`test/e2e/panel-hostile-host.spec.mjs` and `test/e2e/panel-zone.spec.mjs`
(switch to the real controller); S02-07's text in
`docs/specs/02-panel-loader/spec.md`.

## Public API

Unchanged entry: `mountPanelUi(root, controller, options): PanelUiHandle`
with `MountPanelUiOptions` as fixed by the contract PR (adds `panelRoot`).
New, inside P4 only: `FRAME_CSS: string`. Nothing new in the public
`debug-capture/panel` exports.

## Behaviour

The spec rows. Uses (P1/P2/P3 barrels, through `../views`):
`createLocalDataSource`, `createPanelStore`, `selectListCounts`,
`isProblemEntry`, `createTabs`, `createButton`, `createMenu`,
`createPopover`, `createChipGroup`, `createDom`, `createIcon`,
`createThemeSheet`, the virtual list follow API (C3-5), and
`createHttpView` / `createWsView` / `createConsoleView` with their CSS.

Outside APIs (check the real behaviour, AGENTS rule 5): Chrome 146 top layer
(`popover`, `showPopover` / `hidePopover`), `Element.requestFullscreen` and
`fullscreenchange`, `setPointerCapture`, `:modal`, `localStorage`;
Playwright 1.56.1.

Loader bytes: the loader has ~55 B left (R2). Write the re-raise as small as
possible and report the size; if it does not fit, stop and tell the
orchestrator (the owner decides the budget).

## Required specs

- `app/*.spec.ts`: one apply per frame and the 8 ms budget; tabs, `Alt+1/2`,
  last tab; dock / resize limits; maximize; pause / capture / clear / export;
  status counts; settings → `applySettings`; storage (round trip, blocked,
  corrupt, `storageKey: false`, no search text, capture not remembered);
  banners; Escape order; a throwing view → `panel error 1`; `unmount()` leaves
  nothing behind.
- e2e `panel-frame`: resize with pointer capture (no host listener fires);
  dock right; maximize; settings kept across a reload; **fullscreen**: after
  `requestFullscreen()` the launcher and the panel are drawn on top, the
  banner says the panel cannot be used (Chrome blocks clicks outside the
  fullscreen element, `D-15`), and it is clickable again after fullscreen;
  a modal `<dialog>` shows the banner (R4).
- e2e `panel-zone`: the closed cost gains only the `fullscreenchange` listener.

## Verification

`npm run check` (report spec count, e2e count, sizes). Prove each new spec
failing once. PR body: What · Review notes · Checks.

## Out of scope

View contents (05–07). Model and P2 changes (ask the orchestrator).
Keyboard map beyond S08-03 / S08-14, forced colours, reduced motion (S-09).


