# 05 — Network › HTTP view

Spec: [`../spec.md`](../spec.md) (S05-01 … S05-14). Plan: [`../../wave-3.md`](../../wave-3.md).
Branch `claude/dc-v2-w3-05-http` → PR into `claude/dc-v2-wave3`. Starts after
the contract PR (and best after 08, so the view can be seen in the real frame).

## Goal

Fill `src/panel/views/http/` with the HTTP view.

## Owned paths

`src/panel/views/http/**`; `test/e2e/panel-http.spec.mjs` (new).

## Public API

`createHttpView: CreateView` and `HTTP_VIEW_CSS: string` from
`views/http/index.ts` (names fixed by the contract PR; replace the stubs).

## Behaviour

The spec rows. Uses (through `../ui`): `selectHttpRows`, `store.setHttpSort`,
`store.setFilter` / `clearFilters` / `select` / `moveSelection`,
`EMPTY_FILTERS`, `toggleChip`, `matchRanges`, `highlightText`, `formatTime`,
`formatSize`, `formatDuration`, `httpName`, `httpStatusLabel`,
`httpStatusGroup`, `describeBody`, `redactedRanges`, `splitTruncation`,
`isRedacted`, `toCurl`, `createVirtualList` (sortable headers, C3-5),
`createSplitPane`, `createTabs`, `createMenu`, `createSearchBox`,
`createChipGroup`, `createEmptyState`, `createBadge`, `createIcon`, the JSON
viewer. Copy goes through `deps.source.copyText(text, deps.root)`.

## Required specs

`views/http/*.spec.ts` for every row: start order and sort cycle with
`aria-sort`; pending row updated in place; status cells (icon + label);
filters (OR / AND, "All", highlight); empty and no-match; detail sub-tabs and
`↑` `↓`; bodies (JSON / Raw, form, text, descriptor, empty, truncated,
capped, not captured, redacted ranges); timing bar; each copy item, cURL with
hostile values; entry removed; hostile strings stay text; node count with
5,000 rows and an open detail.

e2e `panel-http` (hostile host, strict CSP + Trusted Types): real fetch and
XHR from `page.evaluate`, pending then finished in place; sort; filter;
detail; **Copy as cURL by a real click inside the shadow root** (the copy
test owed since wave 2); no host listener sees the panel's events.

## Verification

`npm run check` (spec count, e2e count, sizes). Prove each new spec failing
once. PR body: What · Review notes · Checks.

## Out of scope

The frame (08). Model order / sort logic and the virtual list (contract PR —
ask the orchestrator if they need a change).

