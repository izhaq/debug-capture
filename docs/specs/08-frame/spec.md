# S-08 — Frame, toolbar and status

HLD rows: §9.1 S-08. Wave 3 plan: [`../wave-3.md`](../wave-3.md).
Security / hot path: gets a fresh-context review (`AGENTS.md` rule 28).

## Goal

Replace S-02's placeholder P4 with the real panel frame: title bar, top tabs
and Network sub-tabs, resize / dock / maximize, the once-per-frame scheduler,
settings and their storage, banners, the toolbar and the status bar. Mount the
three views through the view interface (`views/view.ts`). Raise the panel and
the launcher back on top when the page goes fullscreen (`D-15`).

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S08-01 | `mountPanelUi(root, controller, { document, panelRoot, storageKey, defaultDock, onRequestClose })` builds the frame inside `panelRoot` and returns `{ unmount() }`. `unmount()` removes everything it added: nodes, listeners, the scheduled frame, its stylesheet. | §6.2, S02-09 |
| S08-02 | Data: one `createLocalDataSource(controller)` and one `createPanelStore(…)` per mount; one subscription. Events are queued and applied **at most once per frame** (`requestAnimationFrame`, ≤ 8 ms of work, the rest waits). Only the visible view gets `update(state)`. | NFR-PERF-03, ISO-10, §4.4 |
| S08-03 | Tabs: **Network** (sub-tabs **HTTP**, **WebSocket**) and **Console** (P2 `createTabs`). `Alt+1` / `Alt+2`, `←` `→` in the tab bar. Opens on the last tab used. Views are created on first show and kept. | FR-WIN-06, §4.3, §4.12 |
| S08-04 | Dock **bottom** (default, `defaultDock`) or **right**. Size by inline styles on `panelRoot`; limits §5.3 (bottom: 40% default, min 160 px, max 90%; right: 520 px default, min 360 px, max 90%). The page is never pushed or resized. | FR-WIN-01, FR-WIN-02, ISO-13, §5.3 |
| S08-05 | Resize by dragging the inner edge (6 px hit area, the cursor shows the direction), with **pointer capture on our own element** and no `document` move listeners. | FR-WIN-03, ISO-19 |
| S08-06 | **Maximize** fills the window; the button toggles back. | FR-WIN-04 |
| S08-07 | Toolbar: **Pause / Resume** (`store.pause/resume`; `Paused · N new`, N capped at capacity); **Capture on/off next to Pause** (`source.capture.start/stop`); **Clear** (`source.clear()`, no question, not undoable); **Export ▾** — Download all (`source.download(root)`), Copy all (`source.copyText(source.exportJson(), root)`) — always the whole buffer; settings `⚙`; maximize `⤢`; close `✕`. | FR-BAR-01, FR-BAR-03, FR-BAR-04, FR-ACT-09, D-19, §4.9 |
| S08-08 | ~~Follow~~ — **moved to the views** (S05-15, S06-10, S07-09): each view owns its virtual list, and the view contract gives the frame no handle on it. The frame's part of FR-BAR-02 is Pause's `Paused · N new` (S08-07). | FR-BAR-02, §4.4 |
| S08-09 | Status bar: `N / M shown` for the visible list (`selectListCounts`), problems in the buffer (`isProblemEntry`), `buffer n / capacity`, `dropped`, `evicted`, `capture ● on` / `○ off` (dot **and** word), `panel error N` when N > 0. Updates on every entry, clear and stats change. | FR-BAR-06, §4.9, §4.11, C-6 |
| S08-10 | Settings popover (P2 `createPopover`): Theme Auto / Dark / Light (Auto by a CSS `prefers-color-scheme` query, no JS listener), Dock, Text size Small / Normal / Large (text 11 / 12 / 14 px, meta 10 / 11 / 13 px, rows 20 / 22 / 26 px; the frame sets the text sizes on `panelRoot`), Time Clock / Relative, Capture On / Off. Changes reach the views by `applySettings`. No Launcher setting in 2.0 (`D-24`). | FR-BAR-07, §4.10, D-13, D-24 |
| S08-11 | Storage: `localStorage[storageKey]` keeps settings (not Capture), size, dock, last tab and filter **chips** — never search text, never captured data. Every read and write in `try/catch`; blocked or corrupt storage → defaults; `storageKey: false` → nothing stored. | FR-ACT-08, D-20, §4.10, §6.8 |
| S08-12 | Banners under the title bar (§5.7 look): **Capture off** — "Capture is off — nothing new is recorded." + **Turn on**; **host modal dialog or fullscreen** (`:modal`) — "The page has a dialog open or is fullscreen. The panel can be seen but not used until it closes." The dialog check runs **only while the panel is open** — nothing (no listener, observer or timer) while closed; how it is noticed is the track's choice, proven in the hostile host. | FR-ACT-09, FR-WIN-07, ISO-21, §4.11 |
| S08-13 | **Fullscreen re-raise:** the loader listens for `fullscreenchange` on the document (also while closed — S02-07 is updated: the closed cost gains this one listener) and shows its host element again in the top layer, so the launcher and the panel are drawn over the fullscreen element and stay live. They cannot be clicked or focused while fullscreen (Chrome rule, `D-15`); the shortcut still toggles the panel, and S08-12's banner explains. The re-raise never moves focus: whatever had focus (in the panel or the page) still has it afterwards. | FR-WIN-07, D-15, NFR-PERF-01 |
| S08-14 | Close: `✕`, the toggle shortcut, and `Escape` when nothing inside is open — the visible view's `handleEscape()` first, then open popovers / menus, then `onRequestClose()`. `Ctrl+F` (focus inside the panel) calls the visible view's `focusFilter()`. | FR-WIN-05, §4.12 |
| S08-15 | One UI sheet: `createThemeSheet(doc, [VIRTUAL_LIST_CSS, JSON_VIEWER_CSS, FRAME_CSS, VIEW_CSS, HTTP_VIEW_CSS, WS_VIEW_CSS, CONSOLE_VIEW_CSS])`, **appended** to `root.adoptedStyleSheets`, removed on unmount. px only; tokens from §5.4. | ISO-03, ISO-04, ISO-05 |
| S08-16 | Reliability: every callback (frame, scheduler, view calls) in `try/catch`; failures go to `report()` and the `panel error` count, never to `console` or the recorder. | NFR-REL-01, ISO-12 |
| S08-17 | Hostile host: the fixture and the panel e2e use the real `createCaptureController` instead of `fake-controller.mjs`; the wall listener (`hostile.mjs` `TYPES`) also watches pointermove, mouseover, touch, composition and drag events. | ISO-22, NFR-ISO-01 |

## Out of scope

The views' contents (S-05, S-06, S-07). The keyboard map beyond S08-03 and
S08-14, forced colours, reduced motion (S-09). Export of the current view
only (`FR-BAR-05`, 2.x). The separate window (§6.9).

## Acceptance

- `npm run check` green; both floors raised to the new counts.
- Every MUST below has a spec or e2e test, each seen failing once (rule 18).
- Sizes reported; any budget change agreed with the owner first (R1, R2).
- Fresh-context review done, fixes confirmed.

## Traceability

| HLD ID | Rows | Proved by |
|---|---|---|
| FR-WIN-01, 02, 03, 04 | S08-04…06 | unit: `app/frame.spec.ts`; e2e: `panel-frame` (resize with pointer capture, dock right, maximize; host layout unchanged) |
| FR-WIN-05 | S08-14 | unit: Escape order; e2e: `panel-frame` |
| FR-WIN-06 | S08-03 | unit: tabs, `Alt+1/2`, last tab |
| FR-WIN-07 | S08-12, S08-13 | e2e `panel-frame`: `requestFullscreen()` → launcher drawn on top (fails without the re-raise), shortcut opens the panel, banner; after fullscreen the panel is clickable again; modal `<dialog>` → banner |
| FR-ACT-08 | S08-11 | unit: storage round trip, blocked storage, corrupt value, `storageKey: false`; no search text stored |
| FR-ACT-09 | S08-07, S08-12 | unit: switch and banner; e2e: capture off → no new rows; on → rows again |
| FR-BAR-01, 02, 03, 04, 06, 07 | S08-07…10 | unit: toolbar, status counts, settings (follow: S05-15, S06-10, S07-09); e2e: pause, clear, export |
| NFR-PERF-01 | S08-13 | e2e `panel-zone`: closed cost (one more listener only) |
| NFR-PERF-03 | S08-02 | unit: one apply per frame, budget respected |
| NFR-REL-01 | S08-16 | unit: a throwing view → `panel error 1`, frame keeps working |
| ISO-03, 04, 05, 13, 19, 21, 22 | S08-04, 05, 12, 15, 17 | e2e `panel-hostile-host` + `panel-frame` |

