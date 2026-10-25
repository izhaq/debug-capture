# S-10 — every-MUST walk and the BR table

S10-10 and S10-15 (S-10b, 2026-10-25). Source: every `MUST` row in HLD §3 (BR, FR, NFR) plus
the 22 isolation rules `ISO-01…22` (`NFR-ISO-01`). `FR-WIN-02` counts (bottom dock is MUST;
right dock SHOULD). SHOULD and COULD rows are not in this walk.

**How it was made:** a script read each spec's `spec.md` (S-00…S-10) and every test file
(`src/**/*.spec.ts`, `test/**/*.mjs`, `scripts/*.mjs`), expanded ID ranges (`FR-ACT-01…07`,
`ISO-01/02/06`), and followed spec rows (`S05-07` → the HLD IDs that row cites → the tests that
cite the row). A row needs at least one spec and at least one test.

**Result:** 82 MUST rows; **0 gaps**. The walk found one gap, `NFR-COMP-02` (1280 × 720): no spec
cited it and no test checked it. S-10b closed it with S10-16 (`test/e2e/panel-screen.spec.mjs`).
`BR-05` had no test that named it; `scripts/pack-check.mjs` now does.

## BR table (S10-10)

| BR | What | Proved by |
|---|---|---|
| BR-01 | HTTP, WebSocket, console and errors live, with no DevTools | `test/e2e/hosts.spec.mjs` (live rows on Angular, React and plain hosts); `panel-http`, `panel-ws`, `panel-console` e2e on the hostile host |
| BR-02 | Works in production builds; off by default; a flag turns it on | `hosts.spec.mjs` flag-off test on each host; the Angular host calls `enableProdMode()`; `src/install/debug-requested.spec.ts` (`?debug=1`, storage flag) |
| BR-03 | The same package in Angular, React and plain HTML | `hosts.spec.mjs` — one scenario on all three (S10-05) |
| BR-04 | No third-party runtime code | `package.json` has no `dependencies`; the shipped bundles import only their own chunks and `@angular/core` (the host's own, a peer of `debug-capture/angular`) — checked on the S-10b build; `npm run pack:check` |
| BR-05 | One versioned file to carry in (`npm pack`) | `npm run pack:check` (installs the tarball offline and type-checks it); the playground app installs it from `vendor/*.tgz` (#97, #100) |
| BR-06 | A session exports as one file, readable without the panel | `hosts.spec.mjs` saves Download all (JSON) and parses it; `src/core/serializer.spec.ts` (v1 format, `schemaVersion` 1) |
| BR-07 | No visible change while closed, except the launcher (which can be turned off) | `panel-hostile-host.spec.mjs` ("the host page looks the same with the panel installed", computed styles unchanged on install / open / close); `launcher: false` in `loader.spec.ts` and the hostile host `?launcher=0` |

## Every MUST (S10-15)

| MUST | Specs that cite it | Test files (first 4) |
|---|---|---|
| BR-01 | S-10 | `hosts.spec.mjs` |
| BR-02 | S-10 | `hosts.spec.mjs`, `main.mjs` |
| BR-03 | S-10 | `hosts.spec.mjs`, `main.mjs` |
| BR-04 | S-10 | `main.mjs` |
| BR-05 | S-10 | `pack-check.mjs` |
| BR-06 | S-10 | `hosts.spec.mjs` |
| BR-07 | S-10 | `hosts.spec.mjs` |
| FR-ACT-01 | S-02, S-10 | `hosts.spec.mjs`, `loader.spec.ts`, `main.mjs` |
| FR-ACT-02 | S-02, S-10 | `hosts.spec.mjs`, `loader.spec.ts`, `mount-panel-ui.spec.ts`, `panel-hostile-host.spec.mjs` |
| FR-ACT-03 | S-02 | `hosts.spec.mjs`, `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| FR-ACT-05 | S-02, S-10 | `hosts.spec.mjs`, `loader.spec.ts` |
| FR-ACT-06 | S-02 | `loader.spec.ts` |
| FR-ACT-07 | S-02, S-10 | `hosts.spec.mjs`, `loader.spec.ts`, `mount-panel-ui.spec.ts`, `panel-hostile-host.spec.mjs` |
| FR-ACT-09 | S-01, S-08 | `frame.spec.ts`, `panel-frame.spec.mjs` |
| FR-WIN-01 | S-02, S-08 | `layout.spec.ts`, `panel-frame.spec.mjs` |
| FR-WIN-02 | S-08 | `layout.spec.ts`, `panel-frame.spec.mjs` |
| FR-WIN-03 | S-08 | `layout.spec.ts`, `panel-frame.spec.mjs` |
| FR-WIN-05 | S-02, S-08 | `frame.spec.ts`, `hosts.spec.mjs`, `panel-a11y.spec.mjs` |
| FR-WIN-06 | S-08 | `frame.spec.ts` |
| FR-HTTP-01 | S-03, S-05 | `http-list.spec.ts`, `http-order.spec.ts`, `panel-http.spec.mjs`, `store.spec.ts` |
| FR-HTTP-03 | S-03, S-05 | `http-filter.spec.ts`, `panel-http.spec.mjs`, `selectors.spec.ts` |
| FR-HTTP-04 | S-05 | `http-detail.spec.ts`, `panel-http.spec.mjs` |
| FR-HTTP-05 | S-03, S-05 | `body.spec.ts`, `http-detail.spec.ts`, `panel-http.spec.mjs` |
| FR-HTTP-07 | S-03, S-05 | `body.spec.ts`, `http-detail.spec.ts` |
| FR-WS-01 | S-03, S-06 | `panel-ws.spec.mjs`, `selectors.spec.ts`, `ws-list.spec.ts` |
| FR-WS-02 | S-03, S-06 | `panel-ws.spec.mjs`, `selectors.spec.ts`, `ws-list.spec.ts` |
| FR-WS-03 | S-03, S-06 | `panel-ws.spec.mjs`, `selectors.spec.ts`, `ws-filter.spec.ts` |
| FR-WS-04 | S-06 | `panel-ws.spec.mjs`, `ws-detail.spec.ts` |
| FR-CON-01 | S-03, S-07 | `console-list.spec.ts`, `panel-console.spec.mjs`, `selectors.spec.ts` |
| FR-CON-02 | S-03, S-07 | `console-detail.spec.ts`, `console-list.spec.ts`, `panel-console.spec.mjs`, `selectors.spec.ts` |
| FR-CON-03 | S-03, S-07 | `console-detail.spec.ts`, `console-list.spec.ts`, `panel-console.spec.mjs`, `selectors.spec.ts` |
| FR-CON-04 | S-03, S-07 | `console-filter.spec.ts`, `panel-console.spec.mjs`, `selectors.spec.ts` |
| FR-BAR-01 | S-03, S-08 | `frame.spec.ts`, `store.spec.ts` |
| FR-BAR-02 | S-05, S-06, S-07, S-08 | `console-list.spec.ts`, `http-list.spec.ts`, `virtual-list.spec.ts`, `ws-list.spec.ts` |
| FR-BAR-03 | S-01, S-08 | `console-detail.spec.ts`, `frame.spec.ts`, `http-detail.spec.ts`, `panel-http.spec.mjs` +1 |
| FR-BAR-04 | S-08 | `frame.spec.ts` |
| FR-BAR-06 | S-01, S-03, S-08 | `frame.spec.ts`, `selectors.spec.ts`, `store.spec.ts` |
| FR-BAR-07 | S-08 | `frame.spec.ts` |
| FR-COM-01 | S-04 | `console-detail.spec.ts` |
| FR-COM-02 | S-04, S-05, S-06 | `console-detail.spec.ts`, `http-detail.spec.ts`, `ws-detail.spec.ts`, `ws-list.spec.ts` |
| FR-COM-03 | S-03 | `format.spec.ts` |
| FR-COM-04 | S-04, S-05, S-06, S-07 | `console-filter.spec.ts`, `http-filter.spec.ts`, `ws-filter.spec.ts`, `ws-list.spec.ts` |
| FR-COM-05 | S-04, S-09 | `panel-a11y.spec.mjs`, `virtual-list.spec.ts` |
| NFR-ISO-01 | S-02, S-08 | `controller.mjs`, `panel-hostile-host.spec.mjs` |
| NFR-PERF-01 | S-02, S-08 | `loader.spec.ts`, `panel-zone.spec.mjs` |
| NFR-PERF-02 | S-10 | `panel-perf.spec.mjs` |
| NFR-PERF-03 | S-01, S-03, S-08, S-10 | `frame.spec.ts`, `panel-perf.spec.mjs`, `perf.spec.ts`, `recorder-live.spec.ts` +4 |
| NFR-PERF-04 | S-04, S-05, S-06, S-07, S-10 | `console-detail.spec.ts`, `console-list.spec.ts`, `http-detail.spec.ts`, `panel-perf.spec.mjs` +3 |
| NFR-PERF-05 | S-02 | `loader.spec.ts`, `panel-zone.spec.mjs` |
| NFR-SIZE-01 | S-00, S-02, S-10 | `public-api.spec.ts`, `size.mjs` |
| NFR-SEC-01 | S-04, S-05, S-06, S-07, S-10 | `console-detail.spec.ts`, `console-list.spec.ts`, `dom.spec.ts`, `eslint-self-test.mjs` +5 |
| NFR-SEC-02 | S-10 | `panel-hostile-host.spec.mjs`, `panel-security.spec.mjs`, `server.mjs` |
| NFR-SEC-03 | S-10 | `panel-hostile-host.spec.mjs`, `panel-security.spec.mjs` |
| NFR-SEC-04 | S-05, S-06, S-10 | `http-detail.spec.ts`, `panel-security.spec.mjs`, `ws-detail.spec.ts` |
| NFR-REL-01 | S-02, S-05, S-06, S-07, S-08 | `console-detail.spec.ts`, `console-list.spec.ts`, `frame.spec.ts`, `http-detail.spec.ts` +5 |
| NFR-A11Y-01 | S-04, S-05, S-09 | `console-filter.spec.ts`, `console-list.spec.ts`, `contrast-check.mjs`, `frame.spec.ts` +4 |
| NFR-I18N-01 | S-04, S-05, S-06, S-07 | `console-detail.spec.ts`, `console-list.spec.ts`, `http-list.spec.ts`, `virtual-list.spec.ts` +2 |
| NFR-COMP-01 | S-02, S-10 | `loader.spec.ts` |
| NFR-COMP-02 | S-10 | `panel-screen.spec.mjs` |
| NFR-PORT-01 | S-10 | `build.mjs`, `hosts.spec.mjs`, `main.mjs`, `plain-host.spec.mjs` |
| ISO-01 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| ISO-02 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| ISO-03 | S-02, S-04, S-08 | `frame.spec.ts`, `loader.spec.ts`, `panel-hostile-host.spec.mjs`, `theme-check.mjs` +2 |
| ISO-04 | S-01, S-02, S-04, S-05, S-08 | `console-detail.spec.ts`, `console-list.spec.ts`, `dom.spec.ts`, `frame.spec.ts` +7 |
| ISO-05 | S-02, S-04, S-08 | `frame.spec.ts`, `loader.spec.ts`, `panel-hostile-host.spec.mjs`, `theme-check.mjs` +2 |
| ISO-06 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| ISO-07 | S-02, S-09 | `hostile.mjs`, `loader.spec.ts`, `panel-a11y.spec.mjs`, `panel-hostile-host.spec.mjs` +2 |
| ISO-08 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| ISO-09 | S-02 | `frame.spec.ts`, `loader.spec.ts`, `panel-zone.spec.mjs`, `scheduler.spec.ts` +1 |
| ISO-10 | S-04, S-05, S-08 | `frame.spec.ts`, `http-detail.spec.ts`, `virtual-list.spec.ts` |
| ISO-11 | S-02 | `public-api.spec.ts` |
| ISO-12 | S-02, S-04, S-05, S-07, S-08 | `console-detail.spec.ts`, `console-list.spec.ts`, `dom.spec.ts`, `frame.spec.ts` +9 |
| ISO-13 | S-02, S-08 | `layout.spec.ts`, `loader.spec.ts`, `panel-frame.spec.mjs`, `panel-hostile-host.spec.mjs` |
| ISO-14 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs`, `public-api.spec.ts` |
| ISO-15 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| ISO-16 | S-02, S-09 | `loader.spec.ts`, `mount-panel-ui.spec.ts`, `panel-a11y.spec.mjs`, `panel-hostile-host.spec.mjs` |
| ISO-17 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| ISO-18 | S-04, S-05 | `http-list.spec.ts`, `virtual-list.spec.ts`, `ws-list.spec.ts` |
| ISO-19 | S-04, S-08 | `destroy.spec.ts`, `layout.spec.ts`, `panel-frame.spec.mjs`, `popover.spec.ts` +1 |
| ISO-20 | S-02 | `loader.spec.ts`, `panel-hostile-host.spec.mjs` |
| ISO-21 | S-08, S-10 | `frame.spec.ts`, `panel-frame.spec.mjs` |
| ISO-22 | S-02, S-08 | `controller.mjs`, `panel-hostile-host.spec.mjs`, `popover.spec.ts` |
