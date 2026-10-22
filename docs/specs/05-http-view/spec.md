# S-05 — Network › HTTP view

HLD rows: §9.1 S-05. Wave 3 plan: [`../wave-3.md`](../wave-3.md).

## Goal

The HTTP view (P3): the request list in **start order** with column sorting
(`D-18`), pending rows, filters, the detail with sub-tabs Headers / Payload /
Response / Timing, and the copy actions. It renders the P1 model with P2
blocks; order, filters and selection live in the store, not in the view.

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S05-01 | List (P2 virtual list) with columns Time, Method, Status, Name, Type, Size, Duration (widths §5.6), rows from `selectHttpRows(state)`: start order; a pending row keeps its place and is updated in place when it finishes (`requestId`). | FR-HTTP-01, FR-HTTP-02, D-18 |
| S05-02 | Column sorting: a header click (or Enter / Space) calls `store.setHttpSort(key)` — ascending → descending → start order — and the header shows it with `aria-sort`. Filters apply on top; the selection stays on its row. | FR-HTTP-01, D-18 |
| S05-03 | Status cell: code **and** icon **and** colour per §5.6 (`200`, `304`, `404`, `500`, `Failed`, `Aborted`, `Timeout`, `Pending` with the `pending` badge) — never colour alone. | FR-HTTP-01, NFR-A11Y-01 |
| S05-04 | Name cell: last path segment + query; the full URL in `title`. Data cells are bidi-safe (`dir="auto"`). | §5.6, NFR-I18N-01, ISO-18 |
| S05-05 | Filter bar: search (URL, method, status; `SEARCH_DEBOUNCE_MS`; matches highlighted with `dcp-match`), chips **Type** (All / XHR / Fetch) and **Status** (2xx / 3xx / 4xx / 5xx / Failed / Pending). OR inside a group, AND across groups and search; "All" resets its group. | FR-HTTP-03, §4.5 |
| S05-06 | Empty: "No requests yet." No match: "No entries match the filter." + **Clear filters**. | FR-COM-04, §4.11 |
| S05-07 | Detail beside the list (P2 split pane; bottom dock: on the right, 45%; right dock: below), sub-tabs Headers / Payload / Response / Timing. `↑` `↓` move the selection and the detail; `✕` closes it; `handleEscape()` closes it. | FR-HTTP-04, §4.6, §4.12 |
| S05-08 | **Headers:** General (full URL, method, status label as in the list, transport, start, duration, size); request and response header tables, names as captured; a redacted value shows the `redacted` badge. | FR-HTTP-04, FR-HTTP-07 |
| S05-09 | **Payload / Response** (`describeBody`): JSON → JSON viewer tree + **Raw** toggle; form → name/value table + Raw; other text as-is; a descriptor as-is; empty → "No request body" / "No response body"; truncated → `truncated` badge with the original length; `resBodyCapped` → "over 1 MB — full length unknown"; not read → "Body not captured (reason)". `[redacted]` inside text is highlighted (`redactedRanges`). | FR-HTTP-05, FR-HTTP-07, C-7 |
| S05-10 | **Timing:** start, end, duration, and a bar of the duration against the slowest request in view (`--dcp-accent` on `--dcp-divider`, 6 px). | §4.6, §5.7 |
| S05-11 | **Copy ▾** (P2 menu): URL, request body, response body, **Copy as cURL** (`toCurl`, redacted values as `[redacted]`), each through `source.copyText(text, root)` — only on a user action. | FR-HTTP-06, NFR-SEC-04, C-5 |
| S05-12 | A selected entry that leaves the buffer keeps its detail with "This entry was removed from the buffer." (the store keeps the selection with `removed: true`; the view reads that, not the virtual list's `onSelectionLost`). | §4.4, §4.11 |
| S05-13 | Safe and quiet: DOM only through `createDom` / text nodes; no `href` / `src` from captured data; no `console`; every callback in `try/catch`, failures to `deps.report`. | NFR-SEC-01, NFR-REL-01, ISO-04, ISO-12 |
| S05-14 | Cost: renders only in `update(state)`; under 2,000 DOM nodes including the detail (`D-22`); a long body renders its first part with "Show all (N chars)". | NFR-PERF-04, FR-COM-02, ISO-10 |
| S05-15 | Follow (C3-5): the list is built with `follow: true` and its `followButton` placed next to `element` in a `dcp-list-pane`. While the user is scrolled up, the view counts rows of this list that arrived since (by `seq`) and calls `setNewCount(n)`; back at the end (`onScrollChange(true)`) it resets to 0. | FR-BAR-02, §4.4 |

## Out of scope

The frame, toolbar, status bar and export (S-08). The order and sort logic in
the model (contract PR C3-4) and the header sorting in the virtual list (C3-5).
The keyboard map beyond the list and detail, forced colours (S-09).

## Acceptance

- `npm run check` green; both floors raised.
- Every MUST below has a test, each seen failing once (rule 18).
- Hostile-host e2e `panel-http`: a real fetch and XHR show as pending, then
  finish in place; sort by a header; filter; open the detail; Copy as cURL from
  inside the shadow root — under the strict CSP and Trusted Types, and no host
  listener sees the panel's events (AGENTS rule 29).

## Traceability

| HLD ID | Rows | Proved by |
|---|---|---|
| FR-HTTP-01 | S05-01…04 | unit `views/http/http-view.spec.ts`: columns, start order, sort cycle + `aria-sort`, status cells; e2e `panel-http` |
| FR-HTTP-02 | S05-01 | unit: pending row updated in place; e2e: slow request pending then done |
| FR-HTTP-03 | S05-05 | unit: chips OR / AND, search, highlight, "All" |
| FR-HTTP-04 | S05-07, S05-08 | unit: sub-tabs, `↑` `↓`, close, Escape |
| FR-HTTP-05 | S05-09 | unit: JSON / Raw, form table, text, descriptor, empty |
| FR-HTTP-06 | S05-11 | unit: each copy item calls `copyText(text, root)`; cURL with hostile values; e2e: real copy from the shadow root |
| FR-HTTP-07 | S05-08, S05-09 | unit: redacted badge, redacted ranges, truncated badge, capped note |
| FR-COM-04 | S05-06 | unit: empty and no-match texts, Clear filters |
| NFR-SEC-01, NFR-REL-01 | S05-13 | lint; unit: hostile strings render as text; a throwing renderer → `report` |
| NFR-PERF-04 | S05-14 | unit: node count with 5,000 rows and an open detail |
| FR-BAR-02 | S05-15 | unit: scroll up → new rows counted on "↓ N new"; click → end, count 0 |

