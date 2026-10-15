# S-03 Panel model — spec

**Source of truth:** HLD §4.4–§4.11, §5.6, §6.2 (P1), §6.3, §6.4,
`FR-HTTP-01` … `07`, `FR-WS-01` … `05`, `FR-CON-01` … `05`, `FR-BAR-01` … `06`,
`FR-COM-03`, `FR-ACT-04`, `NFR-PERF-03`, `D-18`, `D-19`, `D-21`.
Plan: [`../wave-2.md`](../wave-2.md).

## Goal

All of the panel's logic, with **no DOM, no timers, no globals** (P1): where
the data comes from, how it is held, filtered, counted, formatted and
copied. Wave-3 views only render what this layer computes, so they stay thin
and the logic is unit-tested here.

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S03-01 | `createLocalDataSource(controller, deps?)` → `PanelDataSource` (S-00 type), built only on the contract: `snapshot`, `pending`, `stats`, `capacity` (= `policy.maxEntries`), `redactedValue`, `subscribe` (maps `onEntry` → `entry`, `onPending` → `pending-start`/`pending-end`, `onChange` → `cleared`/`stats`, controller `onChange` → `capture`), `clear`, `exportJson`, `download(root)` and `copyText(text, root)` via the L5 sinks with `{ root }` (injectable in `deps` for specs), `capture.on/start/stop`. Unsubscribe removes every underlying listener. Listener errors are isolated. | §6.4, C-1 … C-6 |
| S03-02 | `createPanelStore(options)` holds the panel state for all three lists; `apply(events)` applies a batch of `PanelDataEvent`s in O(batch); `getState()` returns an immutable snapshot; `subscribe` notifies once per `apply` / action. Initial state from `snapshot()` + `pending()`. | §6.3 |
| S03-03 | Buffer mirror: the store keeps at most `capacity` entries, evicting the oldest exactly like the recorder; `cleared` empties everything (incl. pending); the evicted count is tracked for the status bar. A selected entry that is evicted keeps its detail data with a `removed` flag. | §4.4 |
| S03-04 | HTTP list: completion order (`seq`); pending rows below, in start order; `pending-end` removes the pending row; a finished entry with a `requestId` replaces nothing else. | FR-HTTP-01, 02, D-18 |
| S03-05 | WebSocket: connections derived from entries by `socketId` — URL, state (**error** if any `error`, else **closed** if any `close`, else **open**), sent / received counts, opened time (`null` if the `open` entry was evicted); messages per connection and "all connections". | FR-WS-01, 02, 05, §4.7 |
| S03-06 | Console: log entries and error entries together in `seq` order, with level (errors are level `error`), source tag for errors. | FR-CON-01 … 03 |
| S03-07 | Filters per list: case-insensitive "contains" text search over the fields of §4.5; chip groups (OR inside a group, AND across groups and with the text); HTTP status groups 2xx/3xx/4xx/5xx/Failed/Pending, type XHR/Fetch; WS direction and Text/Binary; Console levels. "All" resets a group. A helper returns the match ranges in a string for highlighting. | FR-HTTP-03, FR-WS-03, FR-CON-04, §4.5 |
| S03-08 | Selection per list (by `seq`, or pending id), with next/previous/first/last moves for the keyboard map. | §4.12 |
| S03-09 | Pause: `pause()` / `resume()`; paused, the visible lists stay frozen **except** that cleared and evicted rows disappear; `newSincePause` = min(arrived, capacity); resume applies everything. | FR-BAR-01, D-19 |
| S03-10 | Counts: shown / total per list (after / before filters), problems over the buffer using an injected `IsProblemEntry`, buffer use, dropped, evicted, capture on/off. | FR-BAR-06, D-21 |
| S03-11 | Formatting (pure, deterministic — time zone offset injected): clock `14:03:27.412`, relative `+12.345 s`, size `0 B` / `412 B` / `3.2 kB` / `48.6 kB` / `1.2 MB` (1000-based, one decimal from 1 kB), duration `143 ms` / `2.04 s`, HTTP status label + kind per §5.6 (`200`, `Failed`, `Aborted`, `Timeout`, `Pending`, full text `500 Internal Server Error` for the detail), WS event label (`↑ sent`, `closed 1000 "done"`), console level label. | FR-COM-03, §5.6 |
| S03-12 | Body helpers: detect JSON / form-encoded / other text / descriptor (`[FormData: …]`, `[Blob …]`), detect v1 truncation markers (`…[truncated N chars]`, `…[capture stopped at N chars]`) and `resBodyCapped`, return the original length when known. Redaction marks: exact `redactedValue` leaves and the ranges of `redactedValue` inside text. | FR-HTTP-05, 07, §4.6 |
| S03-13 | `toCurl(entry)`: bash, every value POSIX single-quoted (`'` → `'\''`), newlines kept inside quotes, method, headers (redacted values as `[redacted]`), body; tested with hostile values (`$(…)`, backticks, quotes, newlines, `-` at start). | FR-HTTP-06, §6.8 |
| S03-14 | Performance: applying 1,000 events and recomputing the visible HTTP list with a text filter over 5,000 entries stays within a measured budget (timing spec, honest margins — AGENTS rule 20); selectors are memoised (same input → same array instance). | NFR-PERF-03 |

## Out of scope

Rendering, rAF scheduling and slicing batches by time (S-08), settings
storage (S-08), DOM of any kind.

## Acceptance

Merged into the wave branch; `npm run check` exits 0; every requirement has a
spec; the public API is documented in the P1 barrel's doc comment so wave 3
can code against it.
