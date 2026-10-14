# Debug Capture v2 — High-Level Design (HLD)

**Status:** Draft 0.2 — for owner review. Written 2026-10-14; revised the same day after a
fresh-context review (33 findings, all applied).
**Scope:** the whole of v2: the capture layer it inherits from v1, and the new
on-screen **debug panel**.
**This document is the source of truth.** Every v2 spec and plan is cut from
it and points back to it by ID (for example `FR-NET-04`, `ISO-07`, `D-05`).
When a spec and this document disagree, this document wins — or it is changed
first, in its own PR.

**How to read it.** Sections 1–2 are the *why* and *what*. Section 3 is the
list of requirements, each with an ID. Sections 4–5 say how the panel behaves
and looks. Section 6 is how it is built. Sections 7–8 are how we build and
test it. Section 9 is the delivery plan. Section 10 holds every decision, and
which ones still need the owner. Section 11 is open questions.

Words used here: **MUST** = required for 2.0. **SHOULD** = wanted in 2.0, can
slip. **COULD** = later (2.x) unless cheap. "**Host**" = the app the panel runs
inside. "**Entry**" = one recorded item (a request, a frame, a log line, an
error).

---

## 0. Summary

- **Problem.** Our apps run on air-gapped stations with no browser DevTools.
  v1 records what happens (console, errors, REST, WebSocket) into a file. But
  nobody can **see** it live, on the machine, while it happens.
- **v2 adds an on-screen debug panel** with two tabs:
  **Network** (sub-tabs **HTTP** — fetch and XHR — and **WebSocket**) and
  **Console**. Each list has a detail view with its own sub-tabs.
- **It must not touch the host.** The panel is a framework-free **Web
  Component** in a Shadow DOM, mounted on `<html>`, shown in the browser's top
  layer, outside Angular's zone, CSP- and Trusted-Types-safe. It works the same
  in Angular, React and plain HTML apps. 22 isolation rules come from tested
  research (`docs/research/host-impact-edge-cases.md`).
- **It costs almost nothing until used.** At start the page loads only a
  small **loader** (≤ 4 kB: launcher, toggle shortcut, problems badge). The
  panel UI (≤ 25 kB) loads on first open.
- **It is a package.** v2 lives in `packages/debug-capture/` with entry points
  `core`, `angular`, `react` and `panel`, ready to become its own repository.
- **Delivery.** 11 specs (S-00 … S-10), built in waves by parallel agents,
  each reviewed, tested in a real browser and merged into an integration
  branch — the process that delivered v1.
- **Needs the owner:** the decisions marked *Proposed* in §10, and the open
  questions in §11 (target browser versions, host CSP, `bdi_W` practices).

---

## 1. Context and business

### 1.1 Where it runs

- **Air-gapped stations.** No internet. Internal network only. Browsers are
  locked down: no DevTools, often no extensions.
- **Production builds.** The tool ships inside the real app and is switched
  on per station or per session with a flag (`?debug=1`, or `localStorage`
  key `debug-capture` = `1`). With the flag off, nothing is patched or shown.
- **Hosts.** Angular apps today (this repo: Angular 16). React apps next.
  Possibly plain pages.
- **Browsers.** Chromium-based (Chrome / Edge). Exact versions on the
  stations are not yet known — see `OPEN-01`.
- **Rules of the place.** A security review approves third-party code (slow,
  sometimes no). Data may be sensitive. Files leave the machine only by an
  approved route (for example removable media).

### 1.2 Who uses it

| Persona | Who | What they need from v2 |
|---|---|---|
| **Operator** | Uses the app at the station. Not a developer. | Nothing to change in their day. If asked, reproduce a problem and hand over a file — with as few steps as possible. |
| **Field engineer** | Developer or integrator on site at the station. | See requests, socket frames, logs and errors **live**, on the machine. Filter, find the failing call, read its body. Export a file. |
| **Developer** | Back at the office, gets the file. | Open the file and understand what happened. (v1 already gives this; v2 must keep the file format readable.) |
| **Lab developer** | Works on a dev or lab machine with the real backend. | Same as the field engineer, as a faster loop than shipping logs around. |
| **Security officer** | Approves what runs on stations. | Confidence that the tool cannot leak secrets, cannot run code, does not call out, and is off by default. |

### 1.3 Jobs to be done

1. "A screen shows wrong values. **Show me** the request and the WebSocket
   frames that fed it, as they arrive."
2. "Something failed. **Find** the failed call or the error, fast, among
   thousands of entries."
3. "**Hand over** what happened, as one file, without DevTools."
4. "Do it **without changing** how the app looks, behaves or performs for the
   operator."

### 1.4 Goals

- **G1** — Live, on-machine visibility of HTTP, WebSocket, console and errors.
- **G2** — Zero effect on the host app: styles, layout, events, focus,
  performance, security (measured, not assumed).
- **G3** — One package for every app, any framework, copied or installed into
  an air-gapped network as one versioned file.
- **G4** — No third-party runtime code: nothing extra to get approved.
- **G5** — Safe by default: redacted before stored, no remote calls, no
  code execution, off unless switched on.

### 1.5 Non-goals

- No **DOM / Elements inspector**, no **Sources**, no **Performance** profiler.
- No **JavaScript console input** (REPL). Running typed code is a security
  risk and needs `eval`, which CSP forbids.
- No **editing or replaying** requests.
- No **sending** captured data anywhere. Data leaves only by an explicit
  export or copy.
- No **user accounts or permissions** inside the tool (the flag is the gate;
  see `OPEN-05`).

### 1.6 How we know it worked

| Measure | Target |
|---|---|
| A field engineer finds a failed request among 5,000 entries | under 30 seconds, without help (*goal* — checked in a usability session at the pilot, not by an automated test) |
| Panel effect on host change detection (Angular) | **0** extra cycles |
| Host regressions in the "hostile host" test suite | **0** |
| Panel open with 5,000 entries | first paint under 100 ms (`NFR-PERF-02`) |
| Bundle cost to a host that never opens the panel | ≤ 4 kB loader; **0 bytes** of panel UI code |
| Security review | approved, with no third-party runtime code |

---

## 2. Scope

### 2.1 Release 2.0

- Everything v1 does (capture, redaction, export, shortcuts, Angular and React
  seams), unchanged in behaviour unless a requirement below says so.
- The on-screen panel:
  - **Launcher** and **toggle shortcut**.
  - **Network › HTTP** list + detail (Headers, Payload, Response, Timing).
  - **Network › WebSocket** connections + messages + detail (Message, Info).
  - **Console** list (logs and errors) + detail.
  - **Toolbar:** pause / follow, clear, export / copy, settings, maximize,
    close. **Status bar** with counts and buffer use.
  - **Settings:** theme, dock side, text size, time format, launcher, capture
    on/off.
- Package layout and tooling for v2 (tests, build, lint, layer checks).

### 2.2 Later (2.x)

- **Separate window** mode (the panel in its own browser window, fed over
  `BroadcastChannel`) — the escape hatch for host modals and fullscreen.
- Export of the **current view** only (filtered).
- Column sorting and column choice.
- A **Problems** quick view (all failures across tabs).
- Hebrew UI text (the UI is English in 2.0; data is bidi-safe — `NFR-I18N-01`).

### 2.3 Out

See §1.5.

---

## 3. Requirements

Each requirement has an ID, a priority and the release it belongs to. Specs
must list the IDs they cover. Behaviour details are in §4, visual details in §5.

### 3.1 Business requirements

| ID | Requirement | Pri |
|---|---|---|
| BR-01 | Field engineers can see HTTP, WebSocket, console and error activity live on a station with no DevTools. | MUST |
| BR-02 | The tool works in production builds, off by default, switched on per station or session by a flag. | MUST |
| BR-03 | The same package works in Angular, React and plain HTML apps. | MUST |
| BR-04 | No third-party runtime code. Build and test tools may be third-party (they do not ship). | MUST |
| BR-05 | Everything needed can be carried into an air-gapped network as one versioned file (`npm pack` tarball). | MUST |
| BR-06 | A captured session can still be exported as one file and read without the panel. | MUST |
| BR-07 | The operator's experience does not change: no visible change while the panel is closed, except the launcher (which can be turned off). | MUST |

### 3.2 Functional — activation and lifecycle

| ID | Requirement | Pri |
|---|---|---|
| FR-ACT-01 | The host installs the panel with one call after installing capture: `installDebugPanel(controller, options?)` (§6.6). With capture off (flag off), the call does nothing. | MUST |
| FR-ACT-02 | The panel **UI** is **loaded on first open** (dynamic import), not at app start. Before that only the **loader** exists: launcher, toggle shortcut and badge counter (§6.1). | MUST |
| FR-ACT-03 | A **launcher** — a small button in a screen corner — opens the panel. It can be turned off (`launcher: false` option, or in Settings). | MUST |
| FR-ACT-04 | The launcher shows how many **new problems** happened since the panel was last closed. A **problem** is: an `ErrorEntry`; an HTTP entry with `status ≥ 500` or `error ≠ null`; a WebSocket `error` event. Not counted: 4xx, and `console.error` lines (Angular and React errors already make an `ErrorEntry`; counting both would count twice). Opening the panel and **Clear** reset the badge. | SHOULD |
| FR-ACT-05 | A **toggle shortcut** opens and closes the panel: `Ctrl+Alt+Shift+P` (configurable), matched on `KeyboardEvent.code`, like v1's shortcuts. | MUST |
| FR-ACT-06 | The panel never opens by itself. It opens only on a user click or key. | MUST |
| FR-ACT-07 | Opening from the keyboard or launcher moves focus into the panel. Closing returns focus to where it was. | MUST |
| FR-ACT-08 | Settings and panel size/position are remembered per browser (`localStorage`, best effort — §4.10). | SHOULD |
| FR-ACT-09 | **Capture on/off** from the panel: *off* removes the probes and shortcuts (the page's `fetch`, XHR, WebSocket and console are back to native); *on* installs them again on the **same recorder** (`C-2`), so the buffer, `seq` and socket ids carry on and the Angular and React seams keep working. Capture state is **not remembered**: a reload with the flag on always starts with capture on. | MUST |

### 3.3 Functional — panel window

| ID | Requirement | Pri |
|---|---|---|
| FR-WIN-01 | The panel **overlays** the page. It never pushes, resizes or scrolls the page (`ISO-13`). | MUST |
| FR-WIN-02 | Dock **bottom** (default) or **right**. Bottom: full width, resizable height. Right: full height, resizable width. | MUST / SHOULD (right) |
| FR-WIN-03 | **Resize** by dragging the inner edge. Limits in §5.3. | MUST |
| FR-WIN-04 | **Maximize** to fill the window, and back. | SHOULD |
| FR-WIN-05 | **Close** button, the toggle shortcut, and `Escape` (when no menu, popover or detail view is open — §4.12) close the panel. | MUST |
| FR-WIN-06 | Two top tabs: **Network** and **Console**. Network has two sub-tabs: **HTTP** and **WebSocket**. | MUST |
| FR-WIN-07 | When the page has a modal dialog open or is in fullscreen, the panel says so (it may not be usable then — `ISO-21`). | SHOULD |

### 3.4 Functional — Network › HTTP

| ID | Requirement | Pri |
|---|---|---|
| FR-HTTP-01 | A list of requests (fetch and XHR) in **completion order** (`seq`), oldest at top. The Time column shows the **start** time, so it can be out of order when requests overlap — that is expected. Pending rows (`FR-HTTP-02`) sit below all completed rows, in start order; when a request finishes, its pending row is removed and the completed row is appended. Columns: Time, Method, Status, Name, Type, Size, Duration (§5.6). | MUST |
| FR-HTTP-02 | Requests **in flight** appear at once as *pending*, and update when they finish. | SHOULD (needs core change `C-1`) |
| FR-HTTP-03 | Filters: text search (URL, method, status), type (All / XHR / Fetch), status class (2xx / 3xx / 4xx / 5xx / Failed — *Failed* covers network error, abort and timeout). Filters combine with AND; chips in one group combine with OR. | MUST |
| FR-HTTP-04 | Selecting a row opens the **detail** with sub-tabs **Headers**, **Payload**, **Response**, **Timing** (§4.6). | MUST |
| FR-HTTP-05 | JSON bodies show as a **collapsible tree** with a **Raw** toggle. Form bodies show as a name/value table. Other text shows as-is. Binary shows its descriptor. | MUST |
| FR-HTTP-06 | **Copy** actions: URL, request body, response body, and **Copy as cURL**. cURL output is for **bash**: every value POSIX single-quoted (`'` → `'\''`), newlines kept inside the quotes; redacted values are copied as `[redacted]`. Unit-tested with hostile values (`$(…)`, backticks, quotes, newlines). | SHOULD |
| FR-HTTP-07 | Redacted and truncated values are marked clearly, never shown as if real. **Redacted:** a header value or JSON leaf equal to the policy's `redactedValue` (`C-3`) gets the `redacted` badge; inside other text (`?token=[redacted]`) each occurrence is highlighted. **Truncated:** v1's suffixes `…[truncated N chars]` and `…[capture stopped at N chars]` become the `truncated` badge with the note. | MUST |

### 3.5 Functional — Network › WebSocket

| ID | Requirement | Pri |
|---|---|---|
| FR-WS-01 | A **connections** list: URL, state, messages sent ↑ and received ↓, opened time. State: **error** if the socket had any `error` event; else **closed** if it had a `close`; else **open**. If the socket's `open` entry has left the buffer, opened time shows `—`. | MUST |
| FR-WS-02 | Selecting a connection shows its **messages**: direction (↑ sent / ↓ received, as icon **and** label), time, size, preview. Lifecycle events (open, close with code and reason, error) appear in the same list as marked rows. | MUST |
| FR-WS-03 | Filters: text search in message data, direction (All / Sent / Received), type (Text / Binary). | MUST |
| FR-WS-04 | Selecting a message opens the detail with sub-tabs **Message** (JSON tree / Raw; binary as base64 and hex — a truncated base64 tail that does not decode is shown as `…` with the note *cut*) and **Info** (connection URL, socket id, state, close code/reason, counts). | MUST |
| FR-WS-05 | An "all connections" choice shows every socket's messages together, with the socket id in a column. | SHOULD |

### 3.6 Functional — Console

| ID | Requirement | Pri |
|---|---|---|
| FR-CON-01 | A list of console calls **and** errors (window errors, unhandled rejections, Angular errors, React errors, capture errors), in time order. | MUST |
| FR-CON-02 | Each row: level (icon **and** label), time, message. Objects show a one-line preview and expand into the JSON tree. | MUST |
| FR-CON-03 | Error rows show their source as v1 stores it (`window`, `unhandledrejection`, `angular`, `react`, `capture`) and a collapsed **stack** that expands on click. React errors show the component stack (v1 `stack` section). | MUST |
| FR-CON-04 | Filters: levels (Errors, Warnings, Info, Log, Debug — each a toggle), text search. | MUST |
| FR-CON-05 | Repeated identical messages in a row are grouped with a count. | COULD |

### 3.7 Functional — toolbar, status, export

| ID | Requirement | Pri |
|---|---|---|
| FR-BAR-01 | **Pause / Resume** the view. Pause freezes **rendering only**: capture continues, and Clear and buffer evictions still apply at once (rows that left the buffer disappear even while paused). The toolbar shows `Paused · N new`, N = min(arrived since pause, capacity). | MUST |
| FR-BAR-02 | **Follow**: when scrolled to the bottom, the list follows new entries. Scrolling up stops following; a "↓ N new" button jumps back. | MUST |
| FR-BAR-03 | **Clear** empties the capture buffer (same as v1 `Ctrl+Alt+Shift+X`, all tabs). | MUST |
| FR-BAR-04 | **Export** menu: Download all (JSON file, v1 format), Copy all. Export always takes the **whole buffer** — paused or not, whatever the filters. | MUST |
| FR-BAR-05 | Export the current view only. | COULD (2.x) |
| FR-BAR-06 | **Status bar:** entries shown / total, problems in the buffer (rule in `FR-ACT-04`), buffer use (`4,812 / 5,000`), dropped and evicted counts, capture on/off. Counts update on every entry, clear and stats change (`C-6`). | MUST |
| FR-BAR-07 | **Settings** (§4.10). | MUST |

### 3.8 Functional — common

| ID | Requirement | Pri |
|---|---|---|
| FR-COM-01 | One shared **JSON viewer**: collapsible, keyboard-operable, shows strings, numbers, booleans, null, `[redacted]`, `…[truncated N chars]` and v1's placeholders (`[Circular]`, `[…]`) distinctly. | MUST |
| FR-COM-02 | Long values (bodies, frames, stacks) show the first part with "Show all (N chars)"; the rest renders only when asked. JSON objects and arrays show their **first 100 children**, then "Show 100 more". | MUST |
| FR-COM-03 | Time shows as clock time (`14:03:27.412`, default) or relative to capture start (`+12.345 s`), by setting. | MUST |
| FR-COM-04 | Every list has a clear **empty** state and **no match** state (§4.11). | MUST |
| FR-COM-05 | Keyboard: full use without a mouse (§4.12). | MUST |

### 3.9 Non-functional

| ID | Requirement | Pri |
|---|---|---|
| NFR-ISO-01 | The 22 isolation rules in §6.7 (`ISO-01` … `ISO-22`) hold, and each has a test against the hostile-host fixture. | MUST |
| NFR-PERF-01 | **Closed:** only the loader runs — no rows in the DOM, no timers, no `requestAnimationFrame`, no observers, no `matchMedia` listeners; one `keydown` listener for the toggle. The launcher badge counter costs O(1) per entry and at most one rAF per frame when its number changes. | MUST |
| NFR-PERF-02 | **Open:** first paint under 100 ms with 5,000 entries buffered, measured **warm** (UI chunk already loaded). The cold first open (chunk fetched from the host's server) is measured and reported, not gated. | MUST |
| NFR-PERF-03 | **Live:** new entries are applied at most once per frame, within an 8 ms budget per frame; no long task over 50 ms caused by the panel, while 100 entries/second arrive. | MUST |
| NFR-PERF-04 | **Scroll:** lists are virtualised — under 2,000 DOM nodes per tab **including the detail pane**, whatever the entry count; no long task over 50 ms while scrolling. | MUST |
| NFR-PERF-05 | **Angular host:** the panel causes **0** change-detection cycles (verified with an `NgZone` counter). | MUST |
| NFR-PERF-06 | **Memory:** the panel adds under 10 MB on top of the capture buffer with 5,000 entries. | SHOULD |
| NFR-SIZE-01 | **Loader** (`debug-capture/panel`, loaded at start): ≤ **4 kB** min+gzip. **UI chunk** (loaded on first open): ≤ **25 kB** min+gzip; hosts that never open the panel load **0 bytes** of it. **Core:** within ± 2 kB of v1's size — the baseline is measured and recorded in S-00. | MUST |
| NFR-SEC-01 | No `innerHTML` / `outerHTML` / `insertAdjacentHTML`, no `eval` / `new Function`, no inline handlers. Captured data enters the DOM only as text. No `href` / `src` built from captured data. | MUST |
| NFR-SEC-02 | Works under a strict CSP (`default-src 'self'`, no `'unsafe-inline'`) and Trusted Types (`require-trusted-types-for 'script'`) with no violations. | MUST |
| NFR-SEC-03 | The panel never makes network requests and never reads anything the recorder did not store (it sees only redacted data). | MUST |
| NFR-SEC-04 | Copy and export are explicit user actions only. | MUST |
| NFR-REL-01 | The panel never throws into the host, never logs to `console`, never leaves an unhandled rejection; its own failures cannot reach the recorder (no feedback loop). | MUST |
| NFR-A11Y-01 | Keyboard-complete; visible focus; WCAG 2.1 AA contrast (verified tokens, §5.4); works in forced-colors mode; respects `prefers-reduced-motion`; status never shown by colour alone. | MUST |
| NFR-I18N-01 | UI text is English, left-to-right. Data cells are bidi-safe (`dir="auto"`, `unicode-bidi: plaintext`) so Hebrew or Arabic data cannot reorder the layout. | MUST |
| NFR-COMP-01 | Chromium **114+**: full behaviour (top layer via `popover`). Chromium **102–113**: `position: fixed` fallback with its known limits. Chromium **90–101**: same, and no `inert` — the closed panel root uses `display: none`. Language target ES2020 (§7.2). Other browsers: best effort. | MUST (pending `OPEN-01`) |
| NFR-COMP-02 | Screens from 1280 × 720 up. Pointer and keyboard; touch not required. | MUST |
| NFR-PORT-01 | Same behaviour in an Angular host, a React host and a plain HTML page — each covered by an end-to-end test. The package ships a prebuilt ESM file per entry point (`dist/*.mjs`) so a plain page needs no bundler (§6.6). | MUST |

---

## 4. Behaviour

### 4.1 Lifecycle

```
            flag off ─────────────► nothing installed, nothing shown
                │
            flag on
                ▼
createCaptureController()  ──►  installDebugPanel(controller)   (loader)
                                   │
                                   ▼
                  ┌────────────── CLOSED ◄─────────────────┐
                  │  launcher + 1 keydown listener          │
                  │  (badge counter, O(1) per entry)        │ close / toggle /
     click / key  │                                         │ Escape
                  ▼                                         │
        first open only: load the UI chunk (dynamic import)│
                  ▼                                         │
                OPEN ── read snapshot, subscribe, render ───┘
                  │  ▲
          pause   │  │ resume (apply waiting entries)
                  ▼  │
               PAUSED (view frozen; capture continues; "N new")
```

- **Capture off** (`FR-ACT-09`) is a separate switch. With capture off, the
  panel stays usable on what was recorded, and shows a banner: "Capture is
  off — nothing new is recorded. [Turn on]".
- **`handle.dispose()`** (also while open): closes the panel (focus returns),
  unsubscribes, removes the launcher, the key listener and the host element.
  Capture is not touched — that is the controller's job.
- Hosts stop capture through the controller. A direct `session.dispose()` is
  treated as `controller.stop()` (`C-2`), so the panel's capture state stays
  true.

### 4.2 Launcher

- A 28 px tall pill in the **bottom-right** corner, 12 px from the edges:
  `DBG` plus a problems count when above zero (`DBG 3`, error colour).
- It sits in the top layer like the panel, so ordinary host overlays (any
  `z-index`) do not cover it. Host top-layer items opened **later** — a modal
  `<dialog>`, a popover, fullscreen — still can (`ISO-21`).
- Hidden while the panel is open. The badge resets when the panel opens and on
  **Clear** (problem rule: `FR-ACT-04`).
- It can be dragged to another corner (snaps to the nearest corner;
  remembered) — **COULD**.

### 4.3 Opening, closing, resizing

- **Open:** the panel appears at its remembered size and dock side (default:
  bottom, 40% of the window height). The last active tab is shown.
- **Resize:** drag the inner edge (top edge when docked bottom, left edge when
  docked right). The cursor shows the resize direction. Pointer capture on our
  own element (`ISO-19`).
- **Maximize:** fills the window; the button toggles back.
- **Close:** close button, toggle shortcut, or `Escape` when nothing inside is
  open (`Escape` closes the innermost thing first — §4.12). Focus goes back to
  where it was before opening.

### 4.4 Live data, pause and follow

- New entries are queued and applied **once per frame** (≤ 8 ms of work per
  frame; the rest waits for the next frame). Under heavy load the view lags a
  little rather than the page stuttering.
- **Follow:** if the list is scrolled to the bottom, it stays at the bottom as
  entries arrive. Scrolling up stops following; a floating "↓ 12 new" button
  appears; clicking it jumps to the bottom and follows again.
- **Pause:** freezes **rendering only**. The toolbar shows `Paused · 37 new`
  (the number is capped at the buffer capacity). Capture is not affected.
  **Clear** and **evictions** still apply at once while paused: rows that left
  the buffer disappear from the frozen view. Resume applies everything that
  waited.
- **Buffer limits:** the capture buffer holds `maxEntries` (default 5,000).
  When it is full, the oldest entries drop out of the lists too; the status
  bar shows the evicted count. A selected entry that drops out keeps its
  detail open with the note "This entry was removed from the buffer".
- **Export** always takes the whole buffer — paused or not, whatever the
  filters (`FR-BAR-04`).

### 4.5 Filtering and search

- Each list (HTTP, WebSocket messages, Console) has its own filter bar. Filters
  are kept per tab while the panel is open. **Chip** choices are remembered
  (§4.10); **search text is not** (it may hold a pasted secret — §6.8).
- **Text search:** case-insensitive "contains". Where it looks:
  HTTP = URL, method, status code; WebSocket = message data;
  Console = message text and error source. Matches are highlighted in the
  visible cells (`--dcp-match-bg`, §5.7). Search runs as you type, with a 150 ms pause before applying.
- **Chips:** toggles. Chips in one group combine with OR; groups and the text
  search combine with AND. "All" resets its group.
- A filter that hides everything shows the *no match* state (§4.11).

### 4.6 HTTP detail

Opens beside the list (docked bottom: on the right, 45% of the panel width
by default — §5.3; docked right: below the list). The list stays usable; the
selected row stays highlighted.

| Sub-tab | Content |
|---|---|
| **Headers** | *General*: URL (full), method, status (`200 OK`, `Failed` (network error), `Aborted`, `Timeout`, `Pending` — same labels as the list, §5.6), transport (XHR/Fetch), start time, duration, size. *Request headers* and *Response headers*: name/value tables, names lower-case as captured; redacted values show the `redacted` badge. |
| **Payload** | Request body. JSON → tree (+ Raw toggle). Form-encoded → name/value table (+ Raw). Other text → as-is. Non-text → its descriptor (`[FormData: a, b]`, `[Blob 512 bytes]`). Empty → "No request body". |
| **Response** | Response body, same rules as Payload. Truncated bodies show the `truncated` badge and the original length from v1's `…[truncated N chars]` note. A fetch body cut by the probe (`…[capture stopped at 1048576 chars]`) shows "over 1 MB — full length unknown". Not read (binary, event-stream) → "Body not captured (reason)". |
| **Timing** | Start time, end time, duration, and a simple bar of the duration against the slowest request in view. (v1 records start and duration only; no DNS/TLS phases.) |

Toolbar of the detail: `Copy ▾` (URL, request body, response body, cURL) and
a close `✕`. `↑` / `↓` in the list moves the selection and updates the detail.

### 4.7 WebSocket view

```
┌ Connections ──────────────────┐┌ Messages — ws://host/api/system-experiments/ws ───────┐
│ ● #3 /api/system-…/ws   open  ││ Dir  Time          Size    Data                       │
│     ↑ 2  ↓ 118   14:02:11     ││ ●    14:02:11.020          connection opened          │
│ ○ #2 /api/ws          closed  ││ ↓    14:02:11.034  3.2 kB  {"entities":[{"entityId":… │
│     ↑ 0  ↓ 6     13:58:40     ││ ↑    14:02:15.501  41 B    {"cmd":"apply","id":7}     │
│ ✕ #1 /api/ws           error  ││ ↓    14:02:15.522  3.2 kB  {"entities":[{"entityId":… │
│ ─────────────────────────────  ││ ■    14:05:00.118          closed 1000 "done"         │
│ All connections               ││                                                       │
└───────────────────────────────┘└───────────────────────────────────────────────────────┘
```

- Connection state (browsers fire `error` then `close`): **error** if the
  socket had any `error` event; else **closed** if it had a `close`; else
  **open**. If its `open` entry has left the buffer, opened time shows `—`.
- Message detail sub-tabs: **Message** (JSON tree / Raw; binary: base64 with a
  hex view; a truncated base64 tail that does not decode shows `…` and the
  note *cut*) and **Info** (URL, socket id, state, opened/closed time, close
  code and reason, counts).

### 4.8 Console view

```
┌ [Errors] [Warnings] [Info] [Log] [Debug]   🔍 Filter                         ┐
│ ✕ error  14:02:15.601  angular  TypeError: Cannot read properties of undef…▸ │
│ ⚠ warn   14:02:11.009           Could not find Angular Material core theme…  │
│ ℹ info   14:02:11.004           Angular is running in development mode.      │
│ • log    14:02:16.120           apply ▸ { id: 7, rows: 12 }                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Selecting a row opens the detail: full message, each argument as its own
  JSON tree, and for errors the full stack (React component stack included).
- Errors from all sources appear here, with their source tag.

### 4.9 Toolbar and status bar

```
┌ ◉ Debug   [ Network | Console ]        ⏸ Pause   ⟲ Clear   ⇩ Export ▾   ⚙   ⤢   ✕ ┐
│ …                                                                                   │
├ 1,284 / 1,284 shown · ✕ 3 problems · buffer 1,284 / 5,000 · capture ● on · dropped 0 · evicted 0 ┤
```

- **Clear** asks nothing and is not undoable — like v1's `X` shortcut. It
  clears the capture buffer, so it also empties the next export.
- **Export ▾:** "Download all (JSON)" and "Copy all (JSON)". The whole
  buffer, always. The file is v1's format, `schemaVersion` 1, with two new
  optional fields (`pending`, `requestId` — `C-1`, §6.5).
- **Problems** count: the rule in `FR-ACT-04`, over the buffer.

### 4.10 Settings

A popover under the gear button.

| Setting | Values | Default |
|---|---|---|
| Theme | Auto (follows the OS, by a CSS `prefers-color-scheme` media query — no JS listener) · Dark · Light | Auto |
| Dock | Bottom · Right | Bottom |
| Text size | Small 11 px · Normal 12 px · Large 14 px (meta text 10 / 11 / 13 px) | Normal |
| Time | Clock · Relative | Clock |
| Launcher | Show · Hide | Show |
| Capture | On · Off (`FR-ACT-09`) — **not remembered**; every reload starts On | On |

Remembered in `localStorage` under `debug-capture:panel`: settings (except
Capture), size, dock, last tab and filter **chips** — never search text, never
captured data. Reads and writes are wrapped in `try/catch`; if
storage is blocked the panel uses defaults and works the same.

### 4.11 States

| State | What the list area shows |
|---|---|
| Empty | "No requests yet." / "No WebSocket connections yet." / "No console messages yet." |
| No match | "No entries match the filter." and a **Clear filters** button. |
| Capture off | Banner on top: "Capture is off — nothing new is recorded." **Turn on**. |
| Paused | Toolbar: `Paused · N new` and **Resume**. |
| Entry removed | Detail: "This entry was removed from the buffer." |
| Host modal / fullscreen | Banner: "The page has a dialog open (or is fullscreen). The panel may not respond until it closes." |
| Panel failure | Status bar shows `panel error` with a count; the panel keeps working (`NFR-REL-01`). |

### 4.12 Keyboard

| Keys | Where | Action |
|---|---|---|
| `Ctrl+Alt+Shift+P` | anywhere | Open / close the panel |
| `Ctrl+Alt+Shift+D` / `C` / `X` | anywhere | Download / copy / clear (v1, unchanged) |
| `Escape` | panel | Close the innermost open thing: a menu or popover (Export, Copy, Settings), else the detail, else the panel |
| `↑` `↓` | list | Move selection (and the detail) |
| `Home` `End` `PageUp` `PageDown` | list | Jump |
| `Enter` | list | Open the detail of the selected row |
| `Ctrl+F` | panel | Focus the filter box (only when focus is inside the panel) |
| `Alt+1` / `Alt+2` | panel | Network / Console |
| `←` `→` | tab bar | Move between tabs |
| `←` `→` `Enter` `Space` | JSON tree | Collapse / expand |

Keys pressed inside the panel never reach the host (`ISO-07`), except the
global `Ctrl+Alt+Shift+…` chords.

---

## 5. Visual design

### 5.1 Principles

- **Data first, dense, calm.** Like browser DevTools, so engineers feel at
  home: compact rows, monospace data, few colours.
- **Colour supports, never carries.** Every status also has an icon and a
  word (`NFR-A11Y-01`).
- **Looks the same in every host.** No inherited fonts or sizes; the panel
  sets all of its own (`ISO-03`).
- **Dark by default** when the OS is dark (Auto), matching the dark host apps
  we ship today.

### 5.2 Layout — docked bottom

```
╔═══════════════════════════════════════════ host page ═══════════════════════════════════════╗
║                                                                                              ║
║                                     (page, unchanged)                                        ║
║                                                                                              ║
╟───────────────────────────── resize handle (6 px hit area) ─────────────────────────────────╢
║ ◉ Debug  [ Network | Console ]                 ⏸ Pause  ⟲ Clear  ⇩ Export ▾  ⚙  ⤢  ✕        ║ title bar 32
║ [ HTTP | WebSocket ]  🔍 Filter URL, method, status   [All XHR Fetch] [2xx 3xx 4xx 5xx Failed]║ filter bar 32
╟──────────────────────────────────────────────────┬───────────────────────────────────────────╢
║ Time         Method Status  Name        Type Size│ [Headers|Payload|Response|Timing]  Copy▾ ✕║
║ 14:02:11.004 GET    200     get         xhr  3.2k│ General                                   ║
║ 14:02:15.501 POST   200     default     xhr  2 B │  URL     http://…/api/system-experiments/…║
║▶14:02:18.770 POST   500     primary     xhr  88 B│  Status  ✕ 500 Internal Server Error      ║
║ 14:02:19.002 GET    ◌ …     health      fetch    │ Request headers                           ║
║                         (virtualised rows, 22 px)│  content-type  application/json           ║
║                                                  │  authorization 🔒 redacted                 ║
╟──────────────────────────────────────────────────┴───────────────────────────────────────────╢
║ 4 / 1,284 shown · ✕ 3 problems · buffer 1,284 / 5,000 · capture ● on · dropped 0 · evicted 0 ║ status bar 22
╚══════════════════════════════════════════════════════════════════════════════════════════════╝
```

Docked right: the same parts stacked in a column; the detail opens **below**
the list instead of beside it.

### 5.3 Sizes

| Part | Size |
|---|---|
| Panel height, docked bottom | default 40% of window; min 160 px; max 90% |
| Panel width, docked right | default 520 px; min 360 px; max 90% |
| Title bar / filter bar | 32 px each |
| Status bar | 22 px |
| List row | 22 px (Normal text), 20 px (Small), 26 px (Large) |
| Detail pane | default 45% of the panel (bottom dock: width; right dock: height); min 240 px; draggable splitter |
| Resize handle hit area | 6 px |
| Launcher | 28 px tall, 12 px from the corner |
| Spacing scale | 2 · 4 · 8 · 12 · 16 px |
| Radius | 4 px (controls), 6 px (panel corners when maximized: 0) |
| Borders | 1 px |
| Icons | 14 px, inline SVG, `currentColor` |

All sizes in **px** (never `rem`: the host's root font size must not change
ours — `ISO-03`).

### 5.4 Colour tokens

Tokens are CSS custom properties prefixed `--dcp-`, set on the panel's inner
root (`ISO-05`). Text colours are checked to be **≥ 4.5:1** against **every**
panel background: the five bases (base, elevated, alternate row, hover,
selected) **and** each of them under the 8% error and 8% warning row tints
(§5.6). Control borders are checked **≥ 3:1** against the five bases (controls
never sit on tinted rows) (WCAG 1.4.11). `--dcp-match-bg` is checked against
`--dcp-text`. The check is a script and a test (§8.3).

| Token | Use | Dark | Light |
|---|---|---|---|
| `--dcp-bg` | Panel background | `#1e1f22` | `#ffffff` |
| `--dcp-bg-elevated` | Title bar, filter bar, status bar, popovers | `#26282c` | `#f4f5f7` |
| `--dcp-bg-row-alt` | Every other list row | `#222428` | `#f8f9fa` |
| `--dcp-bg-hover` | Hovered row / control | `#2d3036` | `#eceef1` |
| `--dcp-bg-selected` | Selected row | `#1b3152` | `#e1ecff` |
| `--dcp-divider` | Lines between areas (decorative) | `#3a3d43` | `#d6d9de` |
| `--dcp-border-control` | Inputs, chips, buttons | `#7a8089` | `#7a828b` |
| `--dcp-text` | Main text | `#e6e7ea` | `#1f2328` |
| `--dcp-text-muted` | Secondary text, column headers | `#a9aeb8` | `#57606a` |
| `--dcp-text-faint` | Timestamps, sizes | `#a3a9b3` | `#545d68` |
| `--dcp-accent` | Active tab line, focus ring, links in UI | `#6aaeff` | `#0757b5` |
| `--dcp-success` | 2xx, WS sent ↑, open socket | `#56c98a` | `#146a2c` |
| `--dcp-info` | 3xx, info level, WS received ↓ | `#6cb2ff` | `#0757b5` |
| `--dcp-warning` | 4xx, warn level, `truncated` badge | `#e5b84b` | `#7d5400` |
| `--dcp-error` | 5xx, failed, error level, socket error | `#ff8a80` | `#b0141f` |
| `--dcp-json-key` | JSON keys | `#9cdcfe` | `#0451a5` |
| `--dcp-json-string` | JSON strings | `#e0a77f` | `#a31515` |
| `--dcp-json-number` | JSON numbers | `#b5cea8` | `#08613f` |
| `--dcp-json-literal` | `true` / `false` / `null` | `#79b8ff` | `#0000c4` |
| `--dcp-match-bg` | Search-match highlight (solid; text on it is `--dcp-text`) | `#5a4a16` | `#ffe58a` |

Measured minimum ratios (worst background, tinted rows included): dark —
text 9.06, muted 5.03, faint 4.74, accent 4.86, success 5.40, info 5.04,
warning 6.02, error 4.91, JSON 5.34–7.51, control border 3.28, match 7.00;
light — text 11.61, muted 4.69, faint 4.91, accent 5.08, success 4.93, info
5.08, warning 4.91, error 5.20, JSON 5.53–8.59, control border 3.27,
match 12.66.

**Badges** (`redacted`, `truncated`, `pending`): text in the matching colour
token on a 12% tint of it, with an icon (🔒 redacted, ✂ truncated, ◌ pending
— drawn as SVG, not emoji).

**Forced colours** (Windows high contrast): tokens map to system colours —
`Canvas`, `CanvasText`, `GrayText`, `Highlight` / `HighlightText`
(selection), `ButtonText` / `ButtonFace` (controls), `Mark` (search matches).
Status stays readable by icon and text.

### 5.5 Typography

| Use | Font | Size (Normal) | Weight |
|---|---|---|---|
| UI (tabs, buttons, labels) | `system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | 12 px | 400; 600 for the active tab |
| Data (cells, bodies, JSON, stacks) | `ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", Menlo, monospace` | 12 px | 400 |
| Meta (timestamps, sizes, status bar) | monospace | 11 px | 400 |

Line height 1.4 for text blocks, row height fixed for lists. No web fonts
(`ISO-05`: no `@font-face`). Text size setting scales all three (11 / 12 /
14 px base).

### 5.6 Columns and status mapping

**HTTP list**

| Column | Content | Width |
|---|---|---|
| Time | clock or relative (setting) | 104 px |
| Method | `GET`, `POST`… | 64 px |
| Status | code + icon; `Failed`, `Aborted`, `Timeout`, `Pending` | 72 px |
| Name | last path segment + query; full URL on hover (`title`) | flexible |
| Type | `xhr` / `fetch` | 52 px |
| Size | `3.2 kB` | 64 px |
| Duration | `143 ms` / `2.04 s` | 72 px |

| Status | Colour | Icon | Label |
|---|---|---|---|
| 2xx | success | ✓ | `200` |
| 3xx | info | ↪ | `304` |
| 4xx | warning | ⚠ | `404` |
| 5xx | error | ✕ | `500` |
| network error / abort / timeout | error | ✕ | `Failed` / `Aborted` / `Timeout` |
| in flight | text-muted | ◌ | `Pending` |

**Console levels**

| Level | Colour | Icon | Row tint |
|---|---|---|---|
| error (and error entries) | error | ✕ | 8% error |
| warn | warning | ⚠ | 8% warning |
| info | info | ℹ | none |
| log | text | • | none |
| debug | text-muted | ⋯ | none |

**WebSocket rows**

| Event | Colour | Icon / label |
|---|---|---|
| sent | success | ↑ sent |
| received | info | ↓ received |
| open | text-muted | ● opened |
| close | text-muted | ■ closed `code` `reason` |
| error | error | ✕ error |

### 5.7 Interaction states

| State | Look |
|---|---|
| Hover | `--dcp-bg-hover` |
| Selected | `--dcp-bg-selected`, plus a 2 px `--dcp-accent` bar at the row start |
| Focus (keyboard) | 2 px `--dcp-accent` outline, 1 px offset, `:focus-visible` only |
| Disabled | 50% opacity on the control (WCAG exempts disabled controls from contrast) |
| Search match | `--dcp-match-bg` behind the text, text in `--dcp-text`; `Mark` / `MarkText` in forced colours |
| Motion | None by default (no transitions on rows). Opening/closing: no animation. |

### 5.8 Mockup

A static mockup in both themes, built from these exact tokens and sizes, lives
in `docs/design/mockup.html` (opens offline; no external files). It is an
illustration: **where it and this document differ, this document wins.**

---

## 6. Architecture

### 6.1 Package and entry points

```
packages/debug-capture/                (becomes its own repository later — D-02)
  README.md · AGENTS.md · package.json · tsconfig*.json
  docs/  design/ (HLD, mockup) · specs/ (S-00…S-10) · research/ · v1/
  scripts/  check-layers.js · contrast-check.js · …
  src/
    contract/ core/ adapters/ install/ index.ts   ← entry "debug-capture"         (from v1, L1–L5)
    angular/                                      ← entry "debug-capture/angular"  (L6)
    react/                                        ← entry "debug-capture/react"    (L6)
    panel/                                        ← entry "debug-capture/panel"    (L6, new: loader)
                                                    + lazy chunk "panel UI" (P1–P4, loaded on first open)
  test/  hosts/ (angular, react, plain) · hostile-host/ · e2e/ · perf/
  dist/  *.mjs + *.d.ts per entry (prebuilt ESM — usable without a bundler)
```

- Every entry point is ESM with type declarations. No runtime dependencies.
  `@angular/core` is a **peer** dependency of `debug-capture/angular` only.
- `debug-capture/panel` is the **loader** (≤ 4 kB): `installDebugPanel`, the
  custom element and its host lockdown, launcher, badge counter, toggle
  shortcut. It loads the **UI chunk** (≤ 25 kB) with one dynamic `import()` on
  first open (`FR-ACT-02`, `NFR-SIZE-01`).
- `debug-capture` (core) never imports `debug-capture/panel`, so the core does
  not grow.

### 6.2 Layers

The v1 rule stays: **each layer imports only the barrel of the layer directly
above it**, checked by a script. v2 adds the panel as a sibling of the Angular
and React seams, with its own inner layers:

```
L1 contract ─► L2 core ─► L3 adapters ─► L4 install ─► L5 public (src/index.ts)
                                                          │
                     ┌────────────────────────┬───────────┴───────────┐
                     ▼                        ▼                       ▼
                L6 angular               L6 react                L6 panel
                                                          ┌──────────┴──────────┐
                                                          P1 model     (pure: no DOM, no globals)      ┐
                                                          P2 ui        (DOM building blocks)           │ UI chunk,
                                                          P3 views     (Network, Console, Settings…)   │ loaded on
                                                          P4 app       (frame, tabs, scheduler, storage)┘ first open
                                                          P5 panel/index.ts  (loader: element, launcher, installDebugPanel)
```

| Layer | Holds | May use |
|---|---|---|
| P1 `panel/model` | `PanelDataSource` interface and the local data source; store (state + reducers); selectors (filtered lists, counts, problem rule, connection state); formatting (time, size, status text); cURL builder | L5 barrel only. No DOM, no timers, no globals — fully unit-testable |
| P2 `panel/ui` | Safe element builder (`text` only, no HTML strings); virtual list (bidi-safe cells); JSON viewer (paged children); split pane; tabs; chips; buttons; empty/no-match block; icons (SVG builders); theme (tokens → one `CSSStyleSheet`) | P1 barrel; the `document` passed in |
| P3 `panel/views` | Title bar, filter bars, HTTP list + detail, WebSocket view, Console view, settings popover, status bar | P2 barrel |
| P4 `panel/app` | `mountPanelUi(shadowRoot, source, options)`: the frame (top tabs, Network sub-tab routing, split, resize, dock, maximize), scheduler (rAF batching), settings storage, banners (capture off, host modal) | P3 barrel |
| P5 `panel/index.ts` | **Loader:** `installDebugPanel()`; the custom element; mount on `<html>`; top layer; host lockdown sheet; event wall; zone handling; toggle shortcut; launcher + badge (own tiny sheet, same tokens) | L5 barrel; P4 only by `import type` and **one** dynamic `import()` — the layer checker fails on any static value import of P4, so the chunk stays lazy |

### 6.3 Data flow

```
probes ──► recorder (redact, truncate, bound) ──onEntry──► PanelDataSource ──► queue
                                                                              │ (root zone)
                                                     one rAF per frame ◄──────┘
                                                              │  ≤ 8 ms budget
                                                              ▼
                                         store.apply(batch) ─► selectors (memoised)
                                                              │
                                                              ▼
                                    views render the visible window only (virtual lists)
```

- On open: `snapshot()` and `pending()` first, then subscribe. On close:
  unsubscribe and remove the panel UI's nodes from the shadow root; the host
  element and the launcher stay, and the loaded chunk stays in memory for the
  next open.
- The model never sees a `CaptureSession` directly — only `PanelDataSource`
  (§6.4). That is what makes the separate window (2.x) a new data source, not
  a rewrite.

### 6.4 Key interfaces (to be fixed exactly in S-00 / S-03)

```ts
/** Where the panel's data comes from: this page now, another window later. */
interface PanelDataSource {
  snapshot(): readonly CaptureEntry[];
  pending(): readonly PendingRequest[];          // C-1
  stats(): CaptureStats;
  capacity(): number;                            // policy.maxEntries      (C-3)
  redactedValue(): string;                       // policy.redactedValue   (C-3)
  subscribe(listener: (event: PanelDataEvent) => void): Unsubscribe;
  clear(): void;
  exportJson(): string;
  capture: { readonly on: boolean; start(): void; stop(): void };   // C-2
}

type PanelDataEvent =
  | { type: 'entry'; entry: CaptureEntry }
  | { type: 'pending-start'; request: PendingRequest }   // C-1
  | { type: 'pending-end'; id: number }                  // C-1: finished, ignored, sampled out, failed or disposed
  | { type: 'cleared' }                                  // C-6
  | { type: 'stats'; stats: CaptureStats }               // C-6: dropped / failed changed
  | { type: 'capture'; on: boolean };                    // C-2

/** C-1. Policed like an HttpEntry: ignoreUrls, sampling, URL and header redaction. */
interface PendingRequest {
  readonly id: number;                     // = HttpEntry.requestId of the finished entry
  readonly t: number;                      // start time (epoch ms)
  readonly transport: 'xhr' | 'fetch';
  readonly method: string;
  readonly url: string;
  readonly reqHeaders: Readonly<Record<string, string>>;
}

interface DebugPanelOptions {
  launcher?: boolean;                      // default true
  shortcut?: string | false;               // default 'ctrl+alt+shift+p'
  defaultDock?: 'bottom' | 'right';        // default 'bottom'
  storageKey?: string | false;             // default 'debug-capture:panel'
}

function installDebugPanel(controller: CaptureController, options?: DebugPanelOptions): DebugPanelHandle;

interface DebugPanelHandle {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;                         // closes (focus returns), unsubscribes, removes launcher, listener, element
}

/** C-2. One recorder for the page's life; `session` never changes. */
interface CaptureController {
  readonly session: CaptureSession;
  readonly on: boolean;
  start(): void;                           // reinstall probes + shortcuts on the same recorder
  stop(): void;                            // remove probes + shortcuts; buffer kept
  onChange(listener: (on: boolean) => void): Unsubscribe;
}
```

### 6.5 Changes v2 needs in the capture layer

| ID | Change | Why | Effect on v1 file format |
|---|---|---|---|
| C-1 | **Pending requests.** Probes report a request when it **starts**. The recorder keeps a live list of `PendingRequest` (§6.4), **capped at 200** (oldest dropped), policed like an `HttpEntry` (`ignoreUrls`, sampling, URL and header redaction). Each gets an `id`; the finished `HttpEntry` carries it as a new `requestId`. Listeners get `pending-start` and `pending-end` — the end fires on completion **and** when the request is ignored, sampled out, fails while recording, or is cut off by `stop()` / `dispose()`. `clear()` and `stop()` empty the list. The stored `HttpEntry` stays one per **completed** request. | `FR-HTTP-02` | Two **optional** fields: `pending` (list) in the file, `requestId` on HTTP entries. `schemaVersion` stays **1**; rule: readers ignore unknown fields. v1 readers keep working. |
| C-2 | **Capture controller.** `createCaptureController(options)` → `CaptureController` (§6.4). It owns **one recorder for the page's life**: `stop()` removes probes and shortcuts only; `start()` reinstalls them on the **same** recorder (`installDebugCapture` gains a `recorder` option). `controller.session` never changes, so `seq` and socket ids never restart and the Angular and React seams (which hold the session) keep working across stop/start. `session.dispose()` called directly acts as `stop()`. | `FR-ACT-09` | None |
| C-3 | **Policy.** The session exposes its resolved policy (read-only), so the panel can show `buffer 1,284 / 5,000` and mark values equal to `redactedValue`. | `FR-BAR-06`, `FR-HTTP-07` | None |
| C-4 | **Angular seam without decorators.** `DebugCaptureErrorHandler` is provided with a factory instead of `@Injectable()`, so the package builds with plain `tsc` (no `ng-packagr`). | §7.2 build | None |
| C-5 | **Copy and download without touching `<body>`.** `copyText` gets an option to place its fallback textarea inside a given root, and `downloadText` an option to place its temporary `<a>` there — the panel passes its shadow root, so no node is added to the host page. To be proven in a spike (`OPEN-04`). | `ISO-04`, research §3.4 | None |
| C-6 | **Change events.** `recorder.onChange(listener)` fires on `clear()` (also from v1's `Ctrl+Alt+Shift+X`) and when only stats change (`dropped`, `failed`). The data source maps it to `cleared` / `stats`. | `FR-BAR-03`, `FR-BAR-06` | None |

### 6.6 Using it in a host

```ts
// main.ts (Angular) or index.tsx (React) — same for both
import { createCaptureController, isDebugRequested } from 'debug-capture';
import { installDebugPanel } from 'debug-capture/panel';  // loader, ≤ 4 kB

const controller = isDebugRequested() ? createCaptureController() : null;  // installs capture now
if (controller) installDebugPanel(controller);  // launcher + shortcut; the UI loads on first open
```

To make even the loader cost 0 bytes with the flag off, `import()` it inside
the `if` instead.

Plain HTML page, no bundler (prebuilt files from `dist/`):

```html
<script type="module">
  import { createCaptureController, isDebugRequested } from './vendor/debug-capture/index.mjs';
  import { installDebugPanel } from './vendor/debug-capture/panel.mjs';
  if (isDebugRequested()) installDebugPanel(createCaptureController());
</script>
```

The Angular seam (`provideDebugCapture()` + `provideDebugCaptureSession(controller?.session ?? null)`)
and the React seam (`createReactRootErrorOptions(controller.session)`) stay as
in v1. They hold `controller.session`, which never changes (`C-2`).

### 6.7 Isolation rules (from tested research)

These are copied from `docs/research/host-impact-edge-cases.md` §1 (where each
has its evidence, severity and test). Short form:

| ID | Rule |
|---|---|
| ISO-01 | **One** host element, mounted once on `<html>` (after `<body>`) by `installDebugPanel()`. Its shadow root holds the launcher and, from first open, the panel UI ("lazy" applies to the UI, not the host element). Shown in the top layer (`popover="manual"`); fallback `position: fixed` + max `z-index`. Never inside a framework root. |
| ISO-02 | Lock the host element: `:host { all: initial !important; … }`, every `:host` declaration `!important`; `contain: strict`. |
| ISO-03 | Set every inherited value on an inner root; **px** sizes; system fonts; `direction: ltr`. |
| ISO-04 | CSP/Trusted-Types-safe DOM: `adoptedStyleSheets` only; `el.style.x =` only; no HTML strings; captured data as text only; no `href`/`src` from data. |
| ISO-05 | Nothing global: `--dcp-` tokens on the inner root; no `@property`, `@font-face`, `part`, document stylesheets. |
| ISO-06 | Hidden when printing. |
| ISO-07 | Event wall on the **host element**: stop propagation of pointer, mouse, key, focus, input, clipboard, drag events (our global chords excepted). |
| ISO-08 | Keys: three-modifier toggle on `event.code`; `preventDefault` only on exact match; `Escape` handled inside. |
| ISO-09 | zone.js: `customElements.define` and **every** listener/timer/rAF/observer inside `Zone.root.run`; one rAF flush. |
| ISO-10 | Virtualise and batch: < 2,000 nodes per tab; ≤ 1 apply per frame, ~8 ms budget. |
| ISO-11 | Zero cost when closed: only the loader runs (launcher badge excepted, §10 `D-07`). |
| ISO-12 | Never feed the recorder: no `console.*`; every callback in `try/catch`; every promise `.catch`; no layout writes in `ResizeObserver`; re-entrancy guard. |
| ISO-13 | Overlay, never dock into the layout; `overscroll-behavior: contain`. |
| ISO-14 | Safe registration: `customElements.get` first; prefixed, versioned name; never throw. |
| ISO-15 | Static host element: no id/class/attribute changes on it after mount (open/closed state lives on inner nodes); no `window` globals. |
| ISO-16 | Focus: never steal focus on automatic open; return focus on close; no focus trap. When closed, the **inner panel root** (never the host element, which also holds the launcher) is `hidden` + `inert`; Chromium 90–101: `display: none`. |
| ISO-17 | A11y: `role="dialog"` `aria-modal="false"`, `aria-label`, `lang="en"`, `dir="ltr"`; no `aria-live` on rows; reduced motion; forced colours. |
| ISO-18 | Bidi-safe data cells. |
| ISO-19 | Drag/resize with pointer capture on our element; no document-level move listeners. |
| ISO-20 | Survive removal: clean up on disconnect, remount on next open; no MutationObserver fights. |
| ISO-21 | Document the limits (host modal, `inert`, fullscreen, host capture-phase listeners). |
| ISO-22 | A "hostile host" fixture; every rule tested against it. |

### 6.8 Security design

- **Input is already safe to store:** the recorder redacts and truncates
  before storing (v1, reviewed twice). The panel shows only what was stored.
- **Output is text only** (`NFR-SEC-01`). A response body full of HTML shows
  as text. URLs are never made clickable.
- **No code execution:** no REPL, no `eval`, no dynamic `Function`.
- **No egress:** the panel makes no requests. Copy/export only on click.
- **Data at rest:** settings and filter chips only in `localStorage` — never
  captured data, never search text.
- **Copy as cURL** is shell-quoted so a pasted command cannot run what a
  captured URL, header or body contains (`FR-HTTP-06`).
- **Copy and download** never add nodes to the host page (`C-5`).
- **Supply chain:** zero runtime dependencies; one tarball with a checksum.

### 6.9 Separate window (2.x, designed now)

The panel's views run unchanged in a page of their own (served by the host
from its assets, same origin). A `BroadcastChannel('debug-capture')` data
source replaces the local one; the host page runs a tiny bridge that forwards
`PanelDataEvent`s and answers `snapshot` requests. Same origin is required.

---

## 7. Engineering standards for v2

v2 adopts the v2 rule set in `docs/research/practices-baseline.md` §3 (31
`AGENTS.md` rules, 17 tooling rules). The ones that shape the package:

### 7.1 Rules (excerpt — full list in the research doc)

- Contract first; one brief per PR; owned paths; exact public names.
- TypeScript strict with the v1 flags; no `any`; inject the outside world.
- Test first; every required spec shown to fail once; timing specs with
  honest margins (several × above measured, several × below the regression).
- Orchestrator re-runs checks on every PR head; fresh-context adversarial
  review for security-sensitive or hot-path work; real-browser end-to-end for
  anything user-facing.
- Never commit links to temporary paths.

### 7.2 Tooling (to set up in S-00)

| Need | Choice | Status |
|---|---|---|
| Test runner | Karma + Jasmine + esbuild, headless Chromium — keeps every v1 spec as it is | Proposed `D-08` |
| Language target | ES2020, `lib: es2020, dom` (Chromium 90+, `NFR-COMP-01`) | Proposed |
| Build | Plain `tsc` → ESM + `.d.ts` per entry point (needs `C-4`); esbuild → prebuilt `dist/*.mjs` per entry, the UI as a separate chunk | Proposed `D-09` |
| Lint | ESLint + typescript-eslint: `no-explicit-any`, `no-console` (with the listed exceptions), no `innerHTML`-family, no `Date.now()` outside the clock | Proposed |
| Format | Prettier, single quotes, 2 spaces | Proposed |
| Layers | `check-layers.js` from v1, re-rooted for the package, plus P1–P5 | Proposed |
| End-to-end, perf, hostile host | Playwright with the installed Chromium; hosts: Angular (this app), React 19, plain HTML | Proposed |
| Contrast | `contrast-check.js` reads the token table and fails under 4.5:1 / 3:1 | Proposed |
| Size | A size check on the loader, the UI chunk and the core (`NFR-SIZE-01`) | Proposed |
| `AGENTS.md` | At the package root; the single source for agent rules | Proposed |
| CI | Once the repository's home is known (GitHub or Azure DevOps — `OPEN-06`) | Open |

`bdi_W` practices will be compared with this list when they are available
(`OPEN-03`); the HLD is then updated.

---

## 8. Test and verification strategy

### 8.1 Levels

| Level | What | Where |
|---|---|---|
| Unit | P1 model (pure), core changes C-1…C-6, cURL quoting with hostile values | Karma, no DOM work |
| Component | P2 ui and P3 views in a real DOM (Shadow DOM, virtual list, JSON viewer, keyboard) | Karma |
| Isolation | Every `ISO-xx` rule against the **hostile host** fixture | Karma + Playwright |
| Host end-to-end | Angular app (this repo), React 19 harness, plain HTML page: install, open, see live HTTP/WS/console, export | Playwright |
| Performance | `NFR-PERF-01…06`: closed cost, open time, frame budget at 100 entries/s, scroll, node count, Angular CD count, memory | Playwright + `performance` APIs |
| Accessibility | Keyboard walk-through, focus order, forced colours, reduced motion, contrast script | Playwright + script |
| Security | CSP + Trusted Types page: no violations; HTML/`javascript:` in captured data renders as text | Playwright |

### 8.2 The hostile host

One test page that does everything a host might: `* { … }` and `body > *`
rules, inherited fonts and `rem`, a `transform` on `<body>`, high-`z-index`
overlays, "click outside to close" menus, global hotkeys, React root event
delegation, an Angular zone, a strict CSP with Trusted Types, an open modal
`<dialog>`, `createRoot(document.body)`, a second copy of the panel. Design in
the research doc §4.

### 8.3 Proof rules

- Every `MUST` requirement maps to at least one test (traceability table in
  each spec; owners in §9.3).
- Wall-clock limits follow the margin rule (§7.1).
- The token contrast check runs in CI.

---

## 9. Delivery plan

### 9.1 Specs to cut from this document

Each spec lives in `docs/specs/<nn>-<slug>/` with `spec.md`, `plan.md` and a
`prs/` folder of briefs, like v1.

| Spec | Covers | Depends on |
|---|---|---|
| **S-00 Foundation** | Tooling (§7.2), `AGENTS.md`, layer checker for the package, contract of the panel (P1 interfaces, `PanelDataSource`, options), core change C-4, mockup | — |
| **S-01 Core changes** | C-1 pending requests, C-2 controller (one recorder), C-3 policy, C-5 copy/download spike, C-6 change events | S-00 |
| **S-02 Panel shell** | P5 loader: element, mount, top layer, lockdown, event wall, zone, toggle, launcher (+ badge), lazy chunk load. P4 app frame: top tabs and Network sub-tab routing, open/close/resize/dock/maximize, scheduler, settings storage, banners. Hostile-host fixture | S-00 |
| **S-03 Panel model** | P1: local data source, store, batching contract, selectors, problem rule, filters, formatting, cURL | S-00 |
| **S-04 UI building blocks** | P2: safe DOM builder, virtual list (bidi-safe), JSON viewer (paged), split pane, tabs, chips, empty/no-match block, icons, theme sheet + contrast check | S-00 |
| **S-05 Network › HTTP** | P3 list + detail sub-tabs + copy | S-02, S-03, S-04 (S-01 for pending) |
| **S-06 Network › WebSocket** | P3 connections + messages + detail | S-02, S-03, S-04 |
| **S-07 Console** | P3 list + detail + stacks | S-02, S-03, S-04 |
| **S-08 Toolbar and status** | Pause/follow, clear, export/copy, capture on/off, buffer gauge, settings popover, states | S-02, S-03, S-04, S-01 |
| **S-09 Accessibility** | Keyboard map, focus, forced colours, reduced motion | S-05 … S-08 |
| **S-10 Integration and verification** | Angular + React + plain hosts, end-to-end, performance, security, packaging (`npm pack`), README | all |

### 9.2 Waves

```
Wave 1:  S-00
Wave 2:  S-01 ║ S-02 ║ S-03 ║ S-04            (parallel — they code against the S-00 contract)
Wave 3:  S-05 ║ S-06 ║ S-07 ║ S-08            (parallel — one view each; they plug into the S-02 frame, no shared files)
Wave 4:  S-09 ─► S-10                         (sequential — S-09 touches every view, after wave 3 is merged)
```

Every wave ends with the merged branch verified as a whole, and the security-
or hot-path-heavy specs (S-01, S-02, S-04, S-08) get a fresh-context review.

### 9.3 Traceability — who owns each requirement

Each spec lists the exact IDs it covers and the test for each. S-10 checks
end to end that every `MUST` is covered.

| Requirements | Owner spec(s) |
|---|---|
| BR-01…07 | S-10 (verified end to end) |
| FR-ACT-01, 02, 03, 04, 05, 06, 07 | S-02 (badge rule from S-03) |
| FR-ACT-08 | S-02 |
| FR-ACT-09 | S-01 (controller) + S-08 (switch and banner) |
| FR-WIN-01…07 | S-02 |
| FR-HTTP-01…07 | S-05 (pending rows need S-01; cURL builder from S-03) |
| FR-WS-01…05 | S-06 |
| FR-CON-01…05 | S-07 |
| FR-BAR-01…07 | S-08 |
| FR-COM-01, 02 | S-04 (JSON viewer, long values) |
| FR-COM-03 | S-03 (formatting) |
| FR-COM-04 | S-04 (the block) + S-05, S-06, S-07 (each view's texts) |
| FR-COM-05 | S-09 |
| NFR-ISO-01 | S-02 (fixture and shell rules) + every view spec for its own rules |
| NFR-PERF-01, 05 | S-02 |
| NFR-PERF-02, 03, 04, 06 | S-03 + S-04 (built), S-10 (measured) |
| NFR-SIZE-01 | S-00 (baseline and check), S-10 (final) |
| NFR-SEC-01…04 | S-04 (safe builder), S-05 (cURL), S-10 (CSP page) |
| NFR-REL-01 | S-02 + every spec (lint rule, guard) |
| NFR-A11Y-01 | S-04 (contrast), S-09 (the rest) |
| NFR-I18N-01 | S-04 (bidi-safe cells) |
| NFR-COMP-01 | S-02 (fallbacks), S-10 (old-Chromium run if one is available) |
| NFR-COMP-02 | S-02 |
| NFR-PORT-01 | S-10 (three hosts, `dist/` build from S-00) |

---

## 10. Decisions

**Decided** = agreed with the owner. **Proposed** = my recommendation; the
owner confirms or changes it before the spec that depends on it starts.

| ID | Decision | Status |
|---|---|---|
| D-01 | The panel is a framework-free Web Component (Shadow DOM), not an Angular or React component. | Decided |
| D-02 | v2 lives in `packages/debug-capture/`, seeded from v1; v1 stays in the host app unchanged. Later its own repository. | Decided |
| D-03 | Overlay docked **bottom** by default, **right** as an option; never changes host layout. | Proposed |
| D-04 | One shared **JSON tree viewer** for console args, HTTP bodies and WS frames (entries are already JSON-safe, so this is cheap). | Proposed |
| D-05 | Show **pending** requests (core change C-1). The export keeps `schemaVersion` 1 with optional new fields; readers ignore unknown fields. | Proposed |
| D-06 | Launcher on by default, bottom-right; toggle `Ctrl+Alt+Shift+P`. | Proposed |
| D-07 | The launcher's problems badge is the one allowed cost while closed (O(1) per entry, ≤ 1 rAF per frame). | Proposed |
| D-08 | Test runner: Karma + Jasmine + esbuild (keeps all v1 specs). | Proposed |
| D-09 | Build with plain `tsc`; drop the Angular decorator (C-4). | Proposed |
| D-10 | Split the panel into a **loader** (≤ 4 kB, at start: launcher, shortcut, badge) and a **UI chunk** (≤ 25 kB, dynamic `import()` on first open). | Proposed |
| D-11 | Element name `debug-capture-panel-v2`; if taken, reuse the existing definition if it is ours, otherwise do nothing and stay silent. | Proposed |
| D-12 | **Clear** clears the capture buffer (not just the view), like v1's shortcut. | Proposed |
| D-13 | Theme **Auto** by default (dark/light by OS); colours as in §5.4. | Proposed |
| D-14 | UI in English; data bidi-safe. Hebrew UI later if needed. | Proposed |
| D-15 | Under a host modal dialog or fullscreen, show a hint; the real fix is the separate window (2.x). | Proposed |
| D-16 | The panel never blocks the host's capture-phase listeners (doing so breaks the panel's own handlers). | Proposed |
| D-17 | **One recorder for the page's life**: capture off/on removes and reinstalls probes on the same recorder (C-2). | Proposed |
| D-18 | HTTP list in **completion order** (`seq`); pending rows at the bottom until they finish. | Proposed |
| D-19 | **Pause** freezes rendering only; Clear and evictions still apply; export always takes the whole buffer. | Proposed |
| D-20 | **Not remembered:** capture on/off and filter search text. Remembered: settings, size, dock, last tab, filter chips. | Proposed |
| D-21 | A **problem** (badge, status bar) = error entry, HTTP 5xx or failed, WebSocket error. Not 4xx, not `console.error`. | Proposed |

---

## 11. Open questions

| ID | Question | Why it matters | Who |
|---|---|---|---|
| OPEN-01 | Which Chrome / Edge versions run on the stations? | Below 114 there is no top layer; the fallback has known limits (`NFR-COMP-01`). | Owner — pilot |
| OPEN-02 | How strict is the host apps' CSP in production (Trusted Types, `style-src`)? | Confirms `NFR-SEC-02` matters in practice. | Owner — pilot |
| OPEN-03 | What does `bdi_W` do for rules, lint, CI, agents, structure? | Updates §7. Needs a session that can reach it. | Owner |
| OPEN-04 | Do the copy fallback and the download link work from inside the panel's shadow root in the station browser? | `C-5`; otherwise copy or download from the panel adds a node to `<body>` for a moment. | S-01 spike |
| OPEN-05 | Is "flag on" enough of a gate in production, or should opening the panel need more (a PIN, an allow-list of stations)? | Who can see captured data on a station. | Owner / security |
| OPEN-06 | Where will the v2 repository live: GitHub or Azure DevOps? | CI system and pipeline format. | Owner |

---

## 12. Glossary

| Term | Meaning |
|---|---|
| Capture / recorder | v1's layer that patches console, errors, XHR, fetch and WebSocket and stores redacted entries. |
| Entry | One recorded item: HTTP request, WebSocket event, log line or error. |
| Host | The app the panel runs inside. |
| Shadow DOM | A private DOM subtree; the page's CSS and scripts do not reach into it normally. |
| Top layer | A browser layer above all page content (used by `popover` and modal dialogs). |
| zone.js | The library Angular uses to know when to update the screen. Code run "in the zone" triggers updates. |
| Virtual list | A list that only creates DOM rows for what is visible. |
| Hostile host | A test page built to break the panel in every way we know. |

## References

- `docs/research/host-impact-edge-cases.md` — 82 ways a Web Component can
  still affect a host; 22 rules; hostile-host design.
- `docs/research/practices-baseline.md` — what we do today, gaps, v2 rules,
  `bdi_W` comparison template.
- `docs/v1/README.md`, `docs/v1/decision-record.md` — v1 usage and decisions.
- Host-app PRs #34–#51 (branch `claude/air-gapped-debug-logging-zkn1nr`).
