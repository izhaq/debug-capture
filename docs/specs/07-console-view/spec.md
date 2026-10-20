# S-07 — Console view

HLD rows: §9.1 S-07. Wave 3 plan: [`../wave-3.md`](../wave-3.md).

## Goal

The Console view (P3): console calls **and** errors in time order, level
filters and search, and a one-page detail with each argument as a JSON tree
(`D-04`) and the stack. It renders the P1 model with P2 blocks.

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S07-01 | List (`selectConsoleRows`, no header row) in `seq` order: level (icon **and** label, colour and row tint per §5.6), time, error source tag, one-line message preview. Rows have a fixed height and never expand; `▸` means "more in the detail". | FR-CON-01, FR-CON-02, §4.8, §5.6 |
| S07-02 | Errors from every source appear, with the source tag as v1 stores it: `window`, `unhandledrejection`, `angular`, `react`, `capture`. | FR-CON-01, FR-CON-03 |
| S07-03 | Detail (one page, no sub-tabs): the full message, each argument as its own JSON viewer tree, and for errors the stack — collapsed, expands on click; React errors show the component stack. | FR-CON-02, FR-CON-03, D-04 |
| S07-04 | Filter bar: level toggles **Errors**, **Warnings**, **Info**, **Log**, **Debug**; search in message text and error source (highlighted). | FR-CON-04, §4.5 |
| S07-05 | Repeated identical messages in a row are grouped with a count — **only if** it fits the size budget; otherwise left for 2.x and noted in the PR. | FR-CON-05 (COULD) |
| S07-06 | Empty: "No console messages yet." No match: "No entries match the filter." + **Clear filters**. | FR-COM-04, §4.11 |
| S07-07 | Detail placement, `↑` `↓`, `✕` and `handleEscape()` as in S05-07; a removed entry keeps its detail with "This entry was removed from the buffer." | §4.4, §4.6, §4.11 |
| S07-08 | Safe, quiet and cheap as S05-13 and S05-14; the view never writes to `console`, so the panel cannot feed the recorder. Data cells bidi-safe. | NFR-SEC-01, NFR-REL-01, NFR-PERF-04, NFR-I18N-01, ISO-12 |
| S07-09 | Follow (C3-5): the list is built with `follow: true` and its `followButton` placed next to `element` in a `dcp-list-pane`. While the user is scrolled up, the view counts rows of this list that arrived since (by `seq`) and calls `setNewCount(n)`; back at the end (`onScrollChange(true)`) it resets to 0. | FR-BAR-02, §4.4 |

## Out of scope

The frame and toolbar (S-08). Running code or a console input line. The
keyboard map beyond the list and detail (S-09).

## Acceptance

- `npm run check` green; both floors raised.
- Every MUST below has a test, each seen failing once (rule 18).
- Hostile-host e2e `panel-console`: the page logs at every level, throws, and
  rejects a promise; all show with the right level and source; level filters
  and search work; opening and using the panel adds **no** console entries.

## Traceability

| HLD ID | Rows | Proved by |
|---|---|---|
| FR-CON-01 | S07-01, S07-02 | unit `views/console/console-view.spec.ts`: order, all sources; e2e `panel-console` |
| FR-CON-02 | S07-01, S07-03 | unit: fixed rows, `▸`, one tree per argument |
| FR-CON-03 | S07-02, S07-03 | unit: source tags, collapsed stack, React component stack |
| FR-CON-04 | S07-04 | unit: level toggles, search, highlight |
| FR-COM-04 | S07-06 | unit: empty and no-match texts |
| NFR-REL-01, ISO-12 | S07-08 | e2e: panel use adds no console entries; unit: a throwing renderer → `report` |
| FR-BAR-02 | S07-09 | unit: as S05-15 |

