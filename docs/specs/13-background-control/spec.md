# S-13 — Background control (release 2.2)

HLD rows: §9.1 S-13, §2.1b, §3.11 (`FR-BG-01…10`), `BR-02`, `FR-ACT-09`, `NFR-PERF-01`,
`NFR-SIZE-01` (2.2), §4.1, §4.10, §4.12, §6.1, §6.2, §6.4, §6.5 `C-11`, §6.6, decisions
`D-37` … `D-45`, `OPEN-05`. Depends on S-11 and on #107 (export schema 2, `D-36`). Source of
truth: [`../../design/HLD.md`](../../design/HLD.md). When this spec and the HLD disagree, the
HLD wins.

## Goal

Owner decisions of 2026-10-26: the tool can be driven from the keyboard **while the panel is
closed**. An activation chord switches it on silently and remembers it on the browser (beside
the `?debug=1` URL flag, which stays — `D-45`); chords turn capture off and on and add a
pre-defined note, also while capture is off; the download chord plus a Chrome policy saves into
a fixed folder; Settings gets an About part that lists every shortcut in use. S-13 comes before
S-12 (`D-44`).

Three code PRs after this docs PR, in order: **S-13a core + activation**, **S-13b panel**,
**S-13c app**.

## Default chords

All `Ctrl+Alt+Shift+<key>`, matched on `KeyboardEvent.code`, every one configurable in code.

| Key | Action | Option | New |
|---|---|---|---|
| `A` | switch on (remembered) / off for good | `installDebugActivation({ shortcut })` | 2.2 |
| `P` | open / close the panel | `installDebugPanel(…, { shortcut })` | 2.0 |
| `D` | download the JSON | `shortcuts.download` | v1 |
| `C` | copy the JSON to the clipboard | `shortcuts.copy` | v1 |
| `X` | clear the session | `shortcuts.clear` | v1 |
| `S` | capture on / off | `shortcuts.record` | 2.2 |
| `M` | add the pre-defined note | `shortcuts.note`, text in `note` | 2.2 |

No clash: the panel's in-panel keys (§4.12) never use three modifiers; v1 uses `D` `C` `X`.
`R` and `N` were rejected (`D-37`: a missed Alt hard-reloads or opens an incognito window).

## Requirements — S-13a (core, activation, seams)

| ID | Requirement | HLD |
|---|---|---|
| S13-01 | `ShortcutConfig` gains `record` and `note`; `DEFAULT_SHORTCUTS` adds `ctrl+alt+shift+s` and `ctrl+alt+shift+m`. `DebugCaptureOptions.note?: { title?, text? }`; `DEFAULT_NOTE` = `{ title: 'Mark', text: 'Added with the keyboard shortcut.' }`. | C-11, D-37, D-38 |
| S13-02 | The controller binds its chords (download, copy, clear, record, note) once, when created, on `env.keyboard`, and keeps them across `stop()` / `start()`. Download, copy and clear work while capture is off. Another capture already on (the controller stays off) still binds them. | FR-BG-06, C-11 |
| S13-03 | The record chord calls `stop()` when on and `start()` when off; `onChange` listeners (the panel) follow. | FR-BG-05 |
| S13-04 | The note chord calls `session.addNote(title, text)` with the `note` option (a missing or non-string field takes the default), also while capture is off. | FR-BG-07, FR-NOTE-04 |
| S13-05 | `controller.dispose()`: stops capture and unbinds the chords; idempotent; `start()` afterwards does nothing. `controller.shortcuts` = the resolved config, `null` with `shortcuts: false`. `installDebugCapture()`'s `session.dispose()` is a full dispose (v1: chords off too); a controller's `session.dispose()` stays `stop()` (`C-2`). | C-11, FR-BG-06 |
| S13-06 | `DEBUG_CAPTURE_VERSION` is exported from the core and equals `package.json` `version`; `npm run build` fails when they differ. `isDebugRequested()` is unchanged (`D-45`). | D-42, D-45 |
| S13-07 | New entry `debug-capture/activate` (`src/activate/`, `dist/activate.mjs`, `package.json` `exports` and `typesVersions`): `installDebugActivation(options?)`, `DEBUG_STORAGE_KEY`, the types of HLD §6.4. Layer rule: it imports the L5 barrel and the panel entry only by `import type` or dynamic `import()` (`npm run lint:layers`, with self-test cases). The built `activate.mjs` has no static import. | FR-BG-01, §6.2, D-43 |
| S13-08 | At install: one `keydown` listener (in the root zone when zone.js is there), and the flags read once — `?debug=1` / `?debug=true` and `localStorage[storageKey] === '1'`. Either one activates at once; the URL flag never writes storage. `ready` resolves after that start-time load (or failure), at once when there is none; never rejects. Never throws (a throwing `localStorage` counts as "not set"). | FR-BG-01, FR-BG-02, D-45, ISO-09, ISO-12 |
| S13-09 | Activating (chord or `activate()`): writes `'1'` (unless `storageKey: false`), loads core and loader by `import()`, `createCaptureController(capture)`, `installDebugPanel(controller, panel)` (none with `panel: false`, and `activation` set to the chord for About). `active` is true from the press; `session`, `controller`, `panel` are set when loaded. | FR-BG-01, FR-BG-02 |
| S13-10 | Off (chord again or `deactivate()`): removes the stored flag, `panel.dispose()`, `controller.dispose()`; `session` back to `null`. Also for a page switched on by `?debug=1`. A press while loading wins (turned off when the load lands). A failed load: `active` false, `loadError` set, flag kept. `dispose()` removes the listener and turns off, keeping the flag. | FR-BG-03, D-45 |
| S13-11 | `provideDebugCaptureSession()` and `createReactRootErrorOptions()` also take `() => CaptureSession | null`, read on each error. | FR-BG-10 |
| S13-12 | Budgets (`D-43`): core ≤ 13,904 B (v1 + 3.5 kB); a new `activate` budget in `scripts/size-budgets.json`, set from the measurement (~2.5 × as `D-34`); `npm run size` measures it alone (nothing external, static imports only). Loader and UI chunk unchanged. | NFR-SIZE-01, D-43 |
| S13-13 | Test hosts (`test/hosts/`) use §6.6 as written (activation); the `?debug=1` e2e paths stay and pass. New e2e `test/e2e/background.spec.mjs`: nothing but `activate.mjs` loads before switch-on; the chord switches on with nothing visible; a reload starts with the page (startup request captured); the chord again turns it off (globals native, flag gone), also on a `?debug=1` page; record, note, download, copy and clear chords with the panel closed and capture off; an Angular error after a chord switch-on is recorded (seam getter). | FR-BG-01…08, FR-BG-10, BR-02, BR-07 |
| S13-14 | Version `2.2.0-alpha.0`; the user README documents activation, the new chords and options, `controller.dispose()`, the seam getter, and the Chrome download-folder policy. | BR-05, D-39 |

## Requirements — S-13b (panel)

| ID | Requirement | HLD |
|---|---|---|
| S13-15 | `DebugPanelOptions.launcher` takes `'hidden'`: the launcher exists but is hidden unless the stored setting says Show (`launcher: true` stored); Settings › DBG button shows with Hide checked. `installDebugActivation` passes `launcher: 'hidden'` unless the `panel` option sets `launcher`. | FR-BG-04, D-41 |
| S13-16 | Settings ends with **About**: `debug-capture <version>`, then a table of shortcuts — activation (only when given), panel toggle, download, copy, clear, capture on / off, note — each with its configured chord shown as `Ctrl+Alt+Shift+P` (a disabled one: `off`), then the in-panel keys of §4.12. Built with the safe DOM builder only. | FR-BG-09, D-42, NFR-SEC-01 |
| S13-17 | The loader hands the UI `shortcuts: { toggle, activation }` (strings or `false`) in `MountPanelUiOptions`; core chords come from `controller.shortcuts`. Loader ≤ 5,632 B and UI chunk ≤ 45,056 B (unchanged); the perf test stays green. | FR-BG-09, NFR-SIZE-01, NFR-PERF-02 |
| S13-18 | e2e in `background.spec.mjs`: after activation the DBG button is hidden, Settings › Show brings it back (and it stays across a reload); About lists the configured chords, custom ones included. Version `2.2.0-alpha.1`. | FR-BG-04, FR-BG-09 |

## Requirements — S-13c (playground app)

| ID | Requirement | HLD |
|---|---|---|
| S13-19 | The app takes `vendor/debug-capture-2.2.0-alpha.1.tgz`. `startDebugPanel()` uses `installDebugActivation()`; `main.ts` waits for `ready`, then bootstraps with `provideDebugCaptureSession(() => debug.session)`. `docs/debug-panel.md` and the package README: both ways on (`?debug=1` and the chord), every shortcut, and the station setup for the Chrome download folder. `tsc`, `lint:layers`, `ng build`, `ng test` pass; v1 code untouched. | BR-02, BR-05, D-39, D-40 |

## Out of scope

S-12 (AI add-on). A PIN or station allow-list (`OPEN-05` stays open). Writing files to a
folder from code (`D-39`: Chrome policy instead). A shortcut editor in Settings (chords are
code only, `D-32`).

## Acceptance

- Every new spec shown red once (revert or mutate, run, restore); floors raised.
- `npm run check` green, also on Chrome for Testing 146.0.7680.72 before the last PR.
- Each PR reports unit and e2e counts and the size table old → new.

## Traceability

| MUST (2.2) | Proved by | PR |
|---|---|---|
| FR-BG-01 | `activate.spec.ts` (listener, start-time flags, lazy load); `check-layers` self-test; e2e "nothing loads before switch-on" | S-13a |
| FR-BG-02 | `activate.spec.ts` (flag written, URL never writes, `ready`); e2e "reload starts with the page" | S-13a |
| FR-BG-03 | `activate.spec.ts` (off, press while loading, failed load); e2e "chord again turns it off", also on `?debug=1` | S-13a |
| FR-BG-04 | `loader.spec.ts` (`'hidden'`); `activate.spec.ts` (passes it); e2e "no visible sign" | S-13b |
| FR-BG-05 | `install-debug-capture.spec.ts`; e2e "record chord, panel closed" | S-13a |
| FR-BG-06 | `install-debug-capture.spec.ts` (chords across stop/start, dispose); e2e "chords while capture is off" | S-13a |
| FR-BG-07 | `install-debug-capture.spec.ts` (note chord, defaults, while off); e2e "note chord" | S-13a |
| FR-BG-08 | e2e "download and copy chords, panel closed"; README and guide (policy) | S-13a, S-13c |
| FR-BG-09 | `about.spec.ts` / `settings` specs; e2e "About lists the chords" | S-13b |
| FR-BG-10 | `debug-capture.providers.spec.ts`, `react-error-handlers.spec.ts`; e2e Angular error after switch-on | S-13a |
| BR-02 (2.2) | hosts e2e (`?debug=1`) and `background.spec.mjs` (chord) | S-13a |
| NFR-SIZE-01 (2.2) | `npm run size`; PR tables | S-13a, S-13b |
