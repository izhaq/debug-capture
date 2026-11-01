# S-16 — Replay and mock (release 2.5, for developers)

HLD rows: §9.1 S-16, §2.1e, §3.14 (`FR-RPL-01…12`), §6.1, §6.5 `C-13`, `NFR-SEC-03` (its scoped
exception), decisions `D-51` … `D-55`. Depends on S-15. Source of truth:
[`../../design/HLD.md`](../../design/HLD.md).

## Goal

A developer right-clicks a request or a WebSocket message in the panel, edits it, and sends it
again to the real server, or mocks it so the app gets the developer's response. It is a separate,
development-only entry; production builds (the stations) do not contain it. Everyone also gets
**Copy as JSON** on a request, the hand-off to the AI assistant. Owner decisions 2026-11-01.

```ts
// main.ts — development builds only
const debug = installDebugActivation();
if (!environment.production) {
  import('debug-capture/replay').then(({ installReplay }) => installReplay(debug, { allow: true }));
}
```

Three code PRs after this docs PR: **S-16a core hooks**, **S-16b replay entry**, **S-16c panel**.

## Shape

```
debug-capture (core)           C-13: mockFor() in the fetch / XHR probes; sockets.send / deliver;
                               http.send(draft); origin on entries; controller.replay slot
debug-capture/replay (L6, new) installReplay(handle, { allow }): the ReplayApi —
                               send, sockets, mock rules (stored), registered on the controller
debug-capture/panel            row menu (Copy as cURL, Copy as JSON; replay items when
                               controller.replay is set); mock banner, status, DBG mark;
                               editors and the mock list in a new lazy chunk "replay-ui"
```

`ReplayApi` and the rule / draft types live in the contract (L1), so the panel codes against the
contract and never imports the replay entry (layers, `AGENTS.md`).

## Requirements — S-16a (core hooks, `C-13`)

| ID | Requirement | HLD |
|---|---|---|
| S16-01 | Contract: `HttpDraftRequest` (method, url, headers, body), `MockRule` (id, on, method, url pattern, status, headers, body), `MockResponse`, `ReplayApi` (below), `EntryOrigin = 'replay' \| 'mock'`; optional `origin` on `HttpEntry` and `WsEntry`; `CaptureController.replay: ReplayApi \| null`. | C-13 |
| S16-02 | Fetch probe: with a `mockFor` set and a hit, the original is not called; the app gets `new Response(body, { status, headers })` after a microtask; the entry is recorded with `origin: 'mock'`. No `mockFor`, or a miss: exactly as 2.4 (every existing spec unchanged). | FR-RPL-07, D-54 |
| S16-03 | XHR probe: a hit answers the request without the network: `readyState` 1 → 2 → 3 → 4 with `readystatechange`, `status`, `statusText`, `getResponseHeader` / `getAllResponseHeaders`, `responseText` / `response` for `responseType` `''`, `'text'` and `'json'`, then `load` and `loadend` (and `onload` / `onreadystatechange`), asynchronously; Angular's `HttpClient` gets the mock. Recorded with `origin: 'mock'`. | FR-RPL-07, D-54 |
| S16-04 | WebSocket probe: live sockets by `socketId`, removed on `close`; `sockets.send(id, data)` calls the socket's `send` (recorded as a sent frame, `origin: 'replay'`); `sockets.deliver(id, data)` dispatches a `MessageEvent('message', { data })` on it (the app's handlers run; recorded as received, `origin: 'mock'`); both return `false` for a closed or unknown socket. | FR-RPL-05, 06 |
| S16-05 | `http.send(draft)`: the original `fetch` with `credentials: 'same-origin'`, recorded as an HTTP entry with `origin: 'replay'` (pending row first, like any request); resolves to the entry, never rejects. | FR-RPL-03 |
| S16-06 | All of it inert until the replay entry installs (no `mockFor`, nothing called). Core ≤ 13,904 B; a raise goes to the owner. Version `2.5.0-alpha.0`. | FR-RPL-01, 12 |

## Requirements — S-16b (the `debug-capture/replay` entry)

| ID | Requirement | HLD |
|---|---|---|
| S16-07 | `installReplay(target, { allow })`: `target` is the activation handle (waits for its session) or a controller. Without `allow: true` it does nothing and logs one line to the Console saying why. Returns the `ReplayApi`; also sets `controller.replay`. Idempotent. | FR-RPL-01, 11 |
| S16-08 | `ReplayApi`: `send(draft)` (refuses a draft that still has a redacted value, `FR-RPL-04`); `resend(socketId, data)`; `deliver(socketId, data)`; `mocks.list()`, `add(rule)`, `update(id, change)`, `remove(id)`, `clear()`, `onChange(listener)`. | FR-RPL-03…07 |
| S16-09 | Mock matching: method equal (or `*`), URL equal after normalising to absolute, or a pattern with `*` in path or query. First matching rule that is on wins. | FR-RPL-07 |
| S16-10 | Rules are stored in `localStorage` `debug-capture:mocks` (best effort, `try/catch`, as the panel's settings) and read at install, so they apply from the first request after a reload. A corrupt value gives no rules. | FR-RPL-08, D-53 |
| S16-11 | Its own size budget in `scripts/size-budgets.json`, set from a measurement (`D-34` rule). Not imported by `activate`, `panel` or core (layer check). | FR-RPL-12 |

## Requirements — S-16c (panel)

| ID | Requirement | HLD |
|---|---|---|
| S16-12 | Row menu on HTTP rows and WebSocket messages: right-click, Shift+F10 and the ContextMenu key; native `menu` / `menuitem` as the Export menu (§4.12). Items: Copy as cURL, **Copy as JSON** (HTTP); with `controller.replay`: Edit and resend (HTTP, sent WS), Edit and deliver (received WS), Mock this response (HTTP). The host page's own context menu never opens over the panel. | FR-RPL-02 |
| S16-13 | Copy as JSON: the `FR-RPL-10` shape, from the stored entry; `redacted` lists each field whose value is the policy's redacted value; `truncated` from the entry's flags. | FR-RPL-10, D-55 |
| S16-14 | Editors (lazy chunk `replay-ui`, loaded on first use; the panel UI chunk does not grow by them): HTTP request (method, URL, header rows, body), WS message (text, or "same binary"), mock rule (method, URL pattern, status, header rows, body). Redacted values empty and marked; Send / Save disabled until filled (`FR-RPL-04`). Safe DOM only (`ISO-04`). | FR-RPL-03…07 |
| S16-15 | Rows with `origin` show a **replayed** / **mocked** badge (text, not colour alone), in the list and the detail; the export keeps `origin`. | FR-RPL-03, 05…07 |
| S16-16 | Mocks visible: banner `N mocks on` (**Show mocks**, **Turn all off**), status bar `mocks N`, an `M` on the DBG button while closed; the mock list (on / off, edit, delete). | FR-RPL-09 |
| S16-17 | e2e on the hostile host (strict CSP): resend a POST with an edited body (the server sees it; the app does not); a redacted header must be filled; a fetch mock and an XHR mock answer the app and survive a reload; turn all off; WS resend and fake receive on an echo socket; Copy as JSON; without the add-on no replay item and no request. Budgets; version `2.5.0-alpha.1`; README. | FR-RPL-01…12 |

## Out of scope

Replay on a new WebSocket connection; sequences of requests; mocking images, scripts,
`sendBeacon`, service workers, `EventSource` (`D-54`); delays and errors in mocks (a later
option); editing a mock's match by regular expression.

## Traceability

| MUST (2.5) | Proved by | PR |
|---|---|---|
| FR-RPL-01, 11 | `replay.spec.ts` (allow, inert), layer check, e2e without the add-on | S-16b, S-16c |
| FR-RPL-02 | row-menu specs, e2e | S-16c |
| FR-RPL-03, 04 | `http-send.spec.ts` (core), `replay.spec.ts`, editor specs, e2e | S-16a…c |
| FR-RPL-05, 06 | `websocket.probe.spec.ts`, e2e (echo socket) | S-16a, S-16c |
| FR-RPL-07, 08 | fetch / XHR probe specs, `mocks.spec.ts`, e2e (reload) | S-16a…c |
| FR-RPL-09 | frame / loader specs, e2e | S-16c |
| FR-RPL-10 | `copy-json.spec.ts`, e2e | S-16c |
| FR-RPL-12 | `npm run size` | all |
