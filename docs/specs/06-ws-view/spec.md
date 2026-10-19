# S-06 — Network › WebSocket view

HLD rows: §9.1 S-06. Wave 3 plan: [`../wave-3.md`](../wave-3.md).

## Goal

The WebSocket view (P3): the connections list, the messages of the selected
connection (or of all of them), filters, and the message detail with sub-tabs
Message and Info. It renders the P1 model with P2 blocks.

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S06-01 | Connections list (`selectWsConnections`): URL, state, ↑ sent and ↓ received counts, opened time. State is **error** if the socket had any `error` event, else **closed** if it had a `close`, else **open** — shown by icon **and** word. Opened time `—` when the `open` entry has left the buffer. | FR-WS-01, §4.7 |
| S06-02 | Last item **All connections**: every socket's messages together, with a socket-id column. | FR-WS-05 |
| S06-03 | Messages list (`selectWsMessages`): direction (↑ sent / ↓ received, icon **and** label), time, size, preview. Lifecycle rows in the same list, marked per §5.6: `● opened`, `■ closed code reason`, `✕ error`. | FR-WS-02, §5.6 |
| S06-04 | Filter bar: search in message data (highlighted), chips **Direction** (All / Sent / Received) and **Type** (Text / Binary). OR inside a group, AND across. | FR-WS-03, §4.5 |
| S06-05 | Empty: "No WebSocket connections yet." No match: "No entries match the filter." + **Clear filters**. | FR-COM-04, §4.11 |
| S06-06 | Message detail, sub-tab **Message**: JSON → JSON viewer + **Raw**; text as-is; binary as base64 with a hex view; a truncated base64 tail that does not decode shows `…` and the note *cut*. | FR-WS-04 |
| S06-07 | Message detail, sub-tab **Info**: connection URL, socket id, state, opened / closed time, close code and reason, counts. | FR-WS-04 |
| S06-08 | Detail placement, `↑` `↓`, `✕` and `handleEscape()` as in S05-07; a removed entry keeps its detail with "This entry was removed from the buffer." | §4.4, §4.6, §4.11 |
| S06-09 | Safe, quiet and cheap as S05-13 and S05-14 (text only, no `console`, guarded callbacks, < 2,000 nodes, long frames "Show all"). Data cells bidi-safe. | NFR-SEC-01, NFR-REL-01, NFR-PERF-04, NFR-I18N-01, FR-COM-02 |

## Out of scope

The frame and toolbar (S-08). Sending messages, replay, or anything that
touches a live socket. Copy of a message (not in the HLD). The keyboard map
beyond the lists and detail (S-09).

## Acceptance

- `npm run check` green; both floors raised.
- Every MUST below has a test, each seen failing once (rule 18).
- Hostile-host e2e `panel-ws`: a real socket to a small echo in the fixture
  server (no new dependency) opens, sends text and binary, closes with a code
  and reason; the view shows it all; filters work — under the strict CSP.

## Traceability

| HLD ID | Rows | Proved by |
|---|---|---|
| FR-WS-01 | S06-01 | unit `views/ws/ws-view.spec.ts`: state rule (error > closed > open), counts, `—` opened time |
| FR-WS-02 | S06-03 | unit: direction icon + label, lifecycle rows; e2e `panel-ws` |
| FR-WS-03 | S06-04 | unit: search, direction and type chips |
| FR-WS-04 | S06-06, S06-07 | unit: JSON / Raw, base64 + hex, *cut* tail, Info fields |
| FR-WS-05 | S06-02 | unit: all connections + socket-id column |
| FR-COM-04 | S06-05 | unit: empty and no-match texts |
| NFR-SEC-01, NFR-REL-01, NFR-PERF-04 | S06-09 | lint; unit: hostile frames render as text; node count |

