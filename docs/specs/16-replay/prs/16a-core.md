# 16a — Core hooks for replay and mock (C-13)

Spec rows S16-01 … S16-06. Branch `feat/s16a-core` → one PR into `main`.

## Owned paths

`src/contract/**`, `src/core/**`, `src/adapters/probes/http/**`,
`src/adapters/probes/websocket/**`, `src/install/**`, `src/index.ts`, the floors, the version.

## Public API (exact names)

- Contract: `HttpDraftRequest`, `MockRule`, `MockResponse`, `EntryOrigin`, `ReplayApi`;
  `HttpEntry.origin?`, `WsEntry.origin?`; `CaptureController.replay: ReplayApi | null`.
- Controller: `http.send(draft): Promise<HttpEntry>`, `sockets.send(id, data): boolean`,
  `sockets.deliver(id, data): boolean`, `setMockResolver(fn | null)`.

## Behaviour

As spec rows S16-02 … S16-05. Without a resolver every probe path is the 2.4 path; no existing
spec changes.

## Required specs (red first)

Fetch hit / miss / no resolver; XHR hit for `''`, `'text'`, `'json'` with the event order and
the header getters, and a real Angular `HttpClient` call through a mock; socket send / deliver /
closed / unknown; `http.send` recorded with `origin`, never rejects; the export keeps `origin`.

## Verification

`npm run check` on the pinned Chromium and Chrome 146.0.7680.72; core size in the PR.

## Out of scope

The replay entry and any UI.
