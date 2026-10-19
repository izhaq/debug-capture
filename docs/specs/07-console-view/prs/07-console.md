# 07 — Console view

Spec: [`../spec.md`](../spec.md) (S07-01 … S07-08). Plan: [`../../wave-3.md`](../../wave-3.md).
Branch `claude/dc-v2-w3-07-console` → PR into `claude/dc-v2-wave3`. Starts
after the contract PR (best after 08).

## Goal

Fill `src/panel/views/console/` with the Console view.

## Owned paths

`src/panel/views/console/**`; `test/e2e/panel-console.spec.mjs` (new).

## Public API

`createConsoleView: CreateView` and `CONSOLE_VIEW_CSS: string` from
`views/console/index.ts` (names fixed by the contract PR; replace the stubs).

## Behaviour

The spec rows. Uses (through `../ui`): `selectConsoleRows`,
`store.select` / `moveSelection` / `setFilter`, `consoleLevel`,
`consoleLevelLabel`, `consoleText`, `preview`, `formatTime`, `matchRanges`,
`highlightText`, `createVirtualList` (`header: false`, row tints
`dcp-row--error` / `dcp-row--warn`), `createSplitPane`, `createSearchBox`,
`createChipGroup`, `createEmptyState`, `createIcon`, the JSON viewer.

## Required specs

`views/console/*.spec.ts` for every row: `seq` order; level icon + label +
tint; every error source tag; `▸`; one JSON tree per argument; collapsed
stack expands; React component stack; level toggles and search; empty and
no-match; entry removed; hostile messages stay text; node count. S07-05
(grouping) only if it fits — say so in the PR either way.

e2e `panel-console` (hostile host): the page logs at every level, throws and
rejects; all appear with the right level and source; filters work; using the
panel adds **no** console entries.

## Verification

`npm run check` (spec count, e2e count, sizes). Prove each new spec failing
once. PR body: What · Review notes · Checks.

## Out of scope

The frame (08). Model and P2 changes (ask the orchestrator). A console input
line.

