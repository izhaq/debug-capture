# Debug Capture v2 — High-Level Design (HLD)

**Status:** Draft 0.5 — for owner review. Written 2026-10-14; revised the same day after a
fresh-context review (33 findings), a confirmation review (14 findings) and the
mockup build (14 questions), all applied. 0.5 (2026-10-15): the P4 frame moves
from S-02 to S-08, so wave 2 has no track waiting on another (§9). 0.6 (2026-10-25):
release 2.1 (S-11) — scope §2.1a, requirement rows §3.10, core changes `C-9` / `C-10`,
the 2.1 options, handle and data-source members (§6.4); `D-24` gives way to `D-32`. 0.7 (2026-10-26):
release 2.2 (S-13, background control) — scope §2.1b, rows §3.11, core change `C-11`, the
activation entry `debug-capture/activate` (§6.1, §6.4, §6.6), decisions `D-37` … `D-45`; the
activation shortcut comes on top of the `?debug=1` URL switch, which stays (`D-40`, `D-45`).
0.8 (2026-10-26): release 2.3 (S-14, custom messages) — scope §2.1c, rows §3.12, core change
`C-12`, decisions `D-46`, `D-47`. 0.9 (2026-10-26): the AI moves out of this package — S-12 is
dropped here; the AI assistant is its own product, a Chrome extension in its own repository
(`D-48`, superseding `D-35`). 1.0 (2026-10-28): the package moves to its own repository,
`izhaq/debug-capture` (`D-02` done, `OPEN-06` answered: GitHub; CI is GitHub Actions, §7.2).
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

Words used here: **MUST** = required for 2.0; **MUST (2.1)** = required for release 2.1 (S-11);
**MUST (2.2)** = required for release 2.2 (S-13). **SHOULD** = wanted in 2.0, can
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
  **Console**. Each list has a detail view (HTTP and WebSocket details have
  sub-tabs; the Console detail is one page).
- **It must not touch the host.** The panel is a framework-free **Web
  Component** in a Shadow DOM, mounted on `<html>`, shown in the browser's top
  layer, outside Angular's zone, CSP- and Trusted-Types-safe. It works the same
  in Angular, React and plain HTML apps. 22 isolation rules come from tested
  research (`docs/research/host-impact-edge-cases.md`).
- **It costs almost nothing until used.** At start the page loads only a
  small **loader** (≤ 4 kB in 2.0, ≤ 5.5 kB in 2.1: launcher, toggle shortcut, problems
  badge). The panel UI (≤ 40 kB in 2.0, ≤ 44 kB in 2.1) loads on first open. From 2.2
  (`D-40`) a station that has not switched it on loads only a tiny **activation** piece
  (one key listener); the core and the loader come with dynamic `import()` when it is
  switched on.
- **It is a package.** v2 lives in its own repository, `izhaq/debug-capture` (`D-02`;
  until 2026-10-28 in `packages/debug-capture/` of the playground app
  `izhaq/angular-13-playground`), with entry points `core`, `angular`, `react`, `panel` and
  `activate`. It ships as one tarball attached to a GitHub Release (`BR-05`).
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
  on in one of two ways: the **URL flag** `?debug=1` (or `?debug=true`) for one page load,
  from its very start; or, from 2.2, the **activation shortcut** (`Ctrl+Alt+Shift+A` by
  default), which is remembered on that browser (`localStorage` key `debug-capture` = `1`)
  until it is pressed again (`D-40`, `D-45`). Without either, nothing is patched or shown.
- **Hosts.** Angular apps today (this repo: Angular 16). React apps next.
  Possibly plain pages.
- **Browsers.** Chrome 146.0.7680.72 and later only; no Edge (`OPEN-01`,
  answered by the owner).
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
| Panel open with 5,000 entries | first paint under 100 ms, warm (`NFR-PERF-02`) |
| Bundle cost to a host that never opens the panel | ≤ 4 kB loader (5.5 kB in 2.1, `D-34`); **0 bytes** of panel UI code. From 2.2, a station that never switches it on runs only the activation piece (`NFR-SIZE-01`, `D-43`) |
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

### 2.1a Release 2.1 (S-11, `D-27`)

- **Buffer size** in Settings, up to **No limit**, changed live and remembered (`D-28`).
- **Buffer-near-full** banner and a repeating **memory** warning (`D-29`, `D-30`).
- A **status observer** for the host: `handle.onStatus()` (`D-31`).
- A **"Show DBG button"** setting; the shortcut stays code-only (`D-32`).
- **User notes**: Add note in the panel, `session.addNote()` in code, a `note` entry kind (`D-33`).

Rows: §3.10. Release 2.1 changes nothing above unless a §3.10 row says so.

### 2.1b Release 2.2 (S-13, background control — before S-12, `D-44`)

Everything works **while the panel is closed**, by keyboard chords (`D-37` … `D-42`):

- An **activation shortcut**, on top of the `?debug=1` URL switch (which stays, `D-45`): it
  lazy-loads capture and the panel, runs them in the background with no visible sign, and
  is remembered on the browser; pressing it again turns it off for good (`D-40`, `D-41`).
- **Capture on / off** by a chord that works while capture is off; the download, copy and
  clear chords work while off too (`D-37`).
- A **pre-defined note** by a chord (`D-38`).
- **Save to a pre-defined folder** through Chrome policy, no code (`D-39`).
- **About** in Settings: the version and every shortcut in use (`D-42`).
- Budgets: core v1 + 3.5 kB; the activation piece has its own small budget (`D-43`).

Rows: §3.11. Release 2.2 changes nothing above unless a §3.11 row says so.

### 2.1c Release 2.3 (S-14, custom messages — before S-12, `D-47`)

The host app can send its **own messages** — a type name, a level and any JSON data — into
the capture (`D-46`). They are kept in the buffer, shown in **Console** (with an **App** filter
chip) and exported in the JSON file. Messages sent while the tool is off are dropped. Rows: §3.12.

### 2.2 Later (2.x)

- **Separate window** mode (the panel in its own browser window, fed over
  `BroadcastChannel`) — the escape hatch for host modal dialogs (fullscreen
  is handled in 2.0, `D-15`).
- Export of the **current view** only (filtered).
- Column choice (column sorting is in 2.0, `D-18`).
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
| BR-02 | The tool works in production builds, off by default. It is switched on by the URL flag `?debug=1` (one page load, captured from its very start) or, from 2.2, by an activation shortcut that is remembered on that browser (`D-40`, `D-45`, `FR-BG-01`…`03`). | MUST |
| BR-03 | The same package works in Angular, React and plain HTML apps. | MUST |
| BR-04 | No third-party runtime code. Build and test tools may be third-party (they do not ship). | MUST |
| BR-05 | Everything needed can be carried into an air-gapped network as one versioned file (`npm pack` tarball). | MUST |
| BR-06 | A captured session can still be exported as one file and read without the panel. | MUST |
| BR-07 | The operator's experience does not change: no visible change while the panel is closed, except the launcher (which can be turned off; from 2.2 it is hidden when the tool is switched on by the activation shortcut or the stored flag, and shown on a `?debug=1` page, `D-41`). | MUST |

### 3.2 Functional — activation and lifecycle

| ID | Requirement | Pri |
|---|---|---|
| FR-ACT-01 | The host installs the panel with one call after creating the capture controller: `installDebugPanel(controller, options?)` (§6.6). A host with no controller (capture not switched on) passes `null`: the call does nothing and returns an inert handle. From 2.2 the activation piece makes this call after it switches capture on (`FR-BG-01`). | MUST |
| FR-ACT-02 | The panel **UI** is **loaded on first open** (dynamic import), not at app start. Before that only the **loader** exists: launcher, toggle shortcut and badge counter (§6.1). | MUST |
| FR-ACT-03 | A **launcher** — a small button in a screen corner — opens the panel. It can be turned off with the `launcher: false` option; from 2.1 the user can also hide it in Settings (`FR-ACT-10`, `D-32`). | MUST |
| FR-ACT-04 | The launcher shows how many **new problems** happened since the panel was last closed. A **problem** is: an `ErrorEntry`; an HTTP entry with `status ≥ 500` or `error ≠ null`; a WebSocket `error` event. Not counted: 4xx, and `console.error` lines (Angular and React errors already make an `ErrorEntry`; counting both would count twice). Opening the panel and **Clear** reset the badge. | SHOULD |
| FR-ACT-05 | A **toggle shortcut** opens and closes the panel: `Ctrl+Alt+Shift+P` (configurable), matched on `KeyboardEvent.code`, like v1's shortcuts. | MUST |
| FR-ACT-06 | The panel never opens by itself. It opens only on a user click or key. `handle.open()` exists only for a host's own user action (a menu item, a button). | MUST |
| FR-ACT-07 | Opening from the keyboard or launcher moves focus into the panel. Closing returns focus to where it was. | MUST |
| FR-ACT-08 | Settings and panel size/position are remembered per browser (`localStorage`, best effort — §4.10). | SHOULD |
| FR-ACT-09 | **Capture on/off** from the panel (and, from 2.2, by a chord, `FR-BG-05`): *off* removes the probes (the page's `fetch`, XHR, WebSocket and console are back to native); from 2.2 the chords stay bound, so they work while off (`D-37`; in 2.0 and 2.1 off removed them too); *on* installs the probes again on the **same recorder** (`C-2`), so the buffer, `seq` and socket ids carry on and the Angular and React seams keep working. Capture state is **not remembered**: a reload with the tool switched on always starts with capture on. | MUST |

### 3.3 Functional — panel window

| ID | Requirement | Pri |
|---|---|---|
| FR-WIN-01 | The panel **overlays** the page. It never pushes, resizes or scrolls the page (`ISO-13`). | MUST |
| FR-WIN-02 | Dock **bottom** (default) or **right**. Bottom: full width, resizable height. Right: full height, resizable width. | MUST / SHOULD (right) |
| FR-WIN-03 | **Resize** by dragging the inner edge. Limits in §5.3. | MUST |
| FR-WIN-04 | **Maximize** to fill the window, and back. | SHOULD |
| FR-WIN-05 | **Close** button, the toggle shortcut, and `Escape` (when no menu, popover or detail view is open — §4.12) close the panel. | MUST |
| FR-WIN-06 | Two top tabs: **Network** and **Console**. Network has two sub-tabs: **HTTP** and **WebSocket**. | MUST |
| FR-WIN-07 | **Fullscreen:** when the page enters fullscreen, the launcher and the panel are raised back on top of it (shown again in the top layer), so they stay **visible and live** over the fullscreen app (`D-15`). Chrome makes everything outside a fullscreen element unclickable and unfocusable, as it does for a modal dialog (the fullscreen element matches `:modal`; proven in the S-08 e2e on Chromium 141), so while fullscreen the panel is for watching: the toggle shortcut still opens and closes it, a banner says it cannot be used, and it works again when fullscreen ends. **Modal dialog:** the same — visible, not usable, banner (`ISO-21`). | SHOULD |

### 3.4 Functional — Network › HTTP

| ID | Requirement | Pri |
|---|---|---|
| FR-HTTP-01 | A list of requests (fetch and XHR) in **start order**, oldest at top, like DevTools' Network panel. A request appears when it starts (`FR-HTTP-02`) and keeps its row: the pending row is updated in place when it finishes. **Column sorting:** clicking a column header sorts by it (ascending, then descending, then back to start order), with the sort shown on the header (`aria-sort`). Filters and search (`FR-HTTP-03`) apply on top of the sort. Columns: Time, Method, Status, Name, Type, Size, Duration (§5.6). | MUST |
| FR-HTTP-02 | Requests **in flight** appear at once as *pending*, and update when they finish. | SHOULD (needs core change `C-1`) |
| FR-HTTP-03 | Filters: text search (URL, method, status), type (All / XHR / Fetch), status class (2xx / 3xx / 4xx / 5xx / Failed / Pending — *Failed* covers network error, abort and timeout; *Pending* the in-flight rows). Filters combine with AND; chips in one group combine with OR. | MUST |
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
| FR-WS-06 | The message detail has **Copy ▾**: Copy message (the data as stored: text as-is, binary as base64) and Copy URL — only on the user's action, inside the panel (`D-26`, `NFR-SEC-04`). | SHOULD |

### 3.6 Functional — Console

| ID | Requirement | Pri |
|---|---|---|
| FR-CON-01 | A list of console calls **and** errors (window errors, unhandled rejections, Angular errors, React errors, capture errors), in time order. | MUST |
| FR-CON-02 | Each row: level (icon **and** label), time, message. Objects show a one-line preview; the **detail pane** shows them as JSON trees (rows have a fixed height and never expand in place). | MUST |
| FR-CON-03 | Error rows show their source as v1 stores it (`window`, `unhandledrejection`, `angular`, `react`, `capture`) and, in the detail pane, a collapsed **stack** that expands on click. React errors show the component stack (v1 `stack` section). | MUST |
| FR-CON-04 | Filters: levels (Errors, Warnings, Info, Log, Debug — each a toggle), text search. | MUST |
| FR-CON-05 | Repeated identical messages in a row are grouped with a count. | COULD |

### 3.7 Functional — toolbar, status, export

| ID | Requirement | Pri |
|---|---|---|
| FR-BAR-01 | **Pause / Resume** the view. Pause freezes **rendering only**: capture continues, and Clear and buffer evictions still apply at once (rows that left the buffer disappear even while paused). The toolbar shows `Paused · N new`, N = min(arrived since pause, capacity). | MUST |
| FR-BAR-02 | **Follow**: when scrolled to the bottom, the list follows new entries. Scrolling up stops following; a "↓ N new" button jumps back. | MUST |
| FR-BAR-03 | **Clear** empties the capture buffer (same as v1 `Ctrl+Alt+Shift+X`, all tabs) and closes every open detail; focus inside a detail moves to its list (or, when the list is empty, its search box). | MUST |
| FR-BAR-04 | **Export** menu: Download all (JSON file, schema 2 — `D-36`), Copy all. Export always takes the **whole buffer** — paused or not, whatever the filters. | MUST |
| FR-BAR-05 | Export the current view only. | COULD (2.x) |
| FR-BAR-06 | **Status bar:** entries shown / total, problems in the buffer (rule in `FR-ACT-04`), buffer use (`4,812 / 5,000`; `4,812 / no limit` from 2.1, `FR-BUF-02`), dropped and evicted counts, capture on/off. Counts update on every entry, clear and stats change (`C-6`). | MUST |
| FR-BAR-07 | **Settings** (§4.10). | MUST |

### 3.8 Functional — common

| ID | Requirement | Pri |
|---|---|---|
| FR-COM-01 | One shared **JSON viewer**: collapsible, keyboard-operable, shows strings, numbers, booleans, null, `[redacted]`, `…[truncated N chars]` and **every** v1 placeholder distinctly — `[Circular]`, `[…]`, `[undefined]`, `[Object]`, `[Array(n)]`, `[Map(n)]`, `[Set(n)]`, `[Function name]`, `[Thrown: …]`, `[Invalid Date]`, `[<TypedArray> n bytes]`, element descriptors (`[HTMLDivElement div#id.a]`, `[Text]`). The full list is `core/json-safe.ts`. Known limit: v1 stores placeholders as plain strings, so a real string with exactly the same text looks the same. | MUST |
| FR-COM-02 | Long values (bodies, frames, stacks) show the first part with "Show all (N chars)"; the rest renders only when asked. JSON objects and arrays show their **first 100 children**, then "Show 100 more". | MUST |
| FR-COM-03 | Time shows as clock time (`14:03:27.412`, default) or relative to capture start (`+12.345 s`), by setting. | MUST |
| FR-COM-04 | Every list has a clear **empty** state and **no match** state (§4.11). | MUST |
| FR-COM-05 | Keyboard: full use without a mouse (§4.12). | MUST |

### 3.9 Non-functional

| ID | Requirement | Pri |
|---|---|---|
| NFR-ISO-01 | The 22 isolation rules in §6.7 (`ISO-01` … `ISO-22`) hold, and each has a test against the hostile-host fixture. | MUST |
| NFR-PERF-01 | **Not switched on (2.2):** only the activation piece runs — one `keydown` listener and one storage read at start; nothing else is loaded (`FR-BG-01`). **Closed:** only the loader runs — no rows in the DOM, no timers, no `requestAnimationFrame`, no observers, no `matchMedia` listeners; one `keydown` listener for the toggle. The launcher badge counter costs O(1) per entry and at most one rAF per frame when its number changes. | MUST |
| NFR-PERF-02 | **Open:** first paint under 100 ms with 5,000 entries buffered, measured **warm** (UI chunk already loaded). The cold first open (chunk fetched from the host's server) is measured and reported, not gated. | MUST |
| NFR-PERF-03 | **Live:** new entries are applied at most once per frame, within an 8 ms budget per frame; no long task over 50 ms caused by the panel, while 100 entries/second arrive. | MUST |
| NFR-PERF-04 | **Scroll:** lists are virtualised — under 2,000 DOM nodes per tab **including the detail pane**, whatever the entry count, for a panel up to **1,080 px** tall; taller (a maximised panel on a 4K screen) adds at most ~23 nodes per extra visible row, because every visible row is drawn (`D-22`). No long task over 50 ms while scrolling. | MUST |
| NFR-PERF-05 | **Angular host:** the panel causes **0** change-detection cycles (verified with an `NgZone` counter). | MUST |
| NFR-PERF-06 | **Memory:** the panel adds under 10 MB on top of the capture buffer with 5,000 entries. | SHOULD |
| NFR-SIZE-01 | **Loader** (`debug-capture/panel`, loaded at start): ≤ **4 kB** min+gzip. **UI chunk** (loaded on first open): ≤ **40 kB** min+gzip (raised from 25 kB, `D-25`); hosts that never open the panel load **0 bytes** of it. **Core:** within ± 2 kB of v1's size — the baseline is measured and recorded in S-00. **2.1** (`D-34`, measured in S-11b): **loader ≤ 5.5 kB** (5,632 B; 4,084 → 4,717 B, +633 B), **UI chunk ≤ 44 kB** (45,056 B; 39,006 → 40,577 B, +1,571 B) — each raise is about 2.5 × the S-11 growth. **2.2** (`D-43`): **core ≤ v1 + 3.5 kB** (13,904 B = the 10,320 B baseline + 3,584 B; was v1 + 2 kB, 12,368 B); the **activation piece** (`debug-capture/activate`, the only part a station loads before it is switched on) **≤ 1.5 kB** (1,536 B; 1,130 B measured in S-13a); loader and UI chunk unchanged. Core measured in S-13a: 12,294 → 12,481 B. | MUST |
| NFR-SEC-01 | No `innerHTML` / `outerHTML` / `insertAdjacentHTML`, no `eval` / `new Function`, no inline handlers. Captured data enters the DOM only as text. No `href` / `src` built from captured data. | MUST |
| NFR-SEC-02 | Works under a strict CSP (`default-src 'self'`, no `'unsafe-inline'`) and Trusted Types (`require-trusted-types-for 'script'`) with no violations. | MUST |
| NFR-SEC-03 | The panel never makes network requests and never reads anything the recorder did not store (it sees only redacted data). | MUST |
| NFR-SEC-04 | Copy and export are explicit user actions only. | MUST |
| NFR-REL-01 | The panel never throws into the host, never logs to `console`, never leaves an unhandled rejection; its own failures cannot reach the recorder (no feedback loop). | MUST |
| NFR-A11Y-01 | Keyboard-complete; visible focus; WCAG 2.1 AA contrast (verified tokens, §5.4); works in forced-colors mode; respects `prefers-reduced-motion`; status never shown by colour alone. | MUST |
| NFR-I18N-01 | UI text is English, left-to-right. Data cells are bidi-safe (`dir="auto"`, `unicode-bidi: plaintext`) so Hebrew or Arabic data cannot reorder the layout. | MUST |
| NFR-COMP-01 | **Chrome 146.0.7680.72+** only (`OPEN-01`, answered by the owner); no Edge, no other browsers. Top layer via `popover` and `inert` are always present, so there are no old-browser fallbacks. Language target stays ES2020 (§7.2). | MUST |
| NFR-COMP-02 | Screens from 1280 × 720 up. Pointer and keyboard; touch not required. | MUST |
| NFR-PORT-01 | Same behaviour in an Angular host, a React host and a plain HTML page — each covered by an end-to-end test. The package ships a prebuilt ESM file per entry point (`dist/*.mjs`) so a plain page needs no bundler (§6.6). | MUST |

### 3.10 Functional — release 2.1 (S-11)

Cut from `D-28` … `D-33` (owner, 2026-10-25). Behaviour in §4.4, §4.9 – §4.11; interfaces in §6.4; core changes `C-9`, `C-10`.

| ID | Requirement | Pri |
|---|---|---|
| FR-BUF-01 | **Buffer size in Settings** (`D-28`): 1,000 · 5,000 · 10,000 · 50,000 · **No limit**. The policy's `maxEntries` (default 5,000) is the default and joins the list when it is not one of them. Changed live; remembered per browser (§4.10). The loader applies the remembered size at install, before the first open, so a reload keeps it. | MUST (2.1) |
| FR-BUF-02 | A size change applies to the recorder at once (`C-9`): a smaller size drops the oldest entries at once (counted as evicted; their rows leave the lists; an open detail keeps the "removed" note, §4.4); a larger size keeps everything. `seq`, request ids and socket ids keep counting (`C-2`). The status bar shows the new capacity: `buffer 812 / 1,000`, or `buffer 812 / no limit`. | MUST (2.1) |
| FR-BUF-03 | **No limit**: the buffer never drops an entry. While it is chosen, Settings shows: "No limit: the page may get slow and use a lot of memory. Use it at your own risk." | MUST (2.1) |
| FR-BUF-04 | **Near-full banner** (`D-29`): when the buffer holds at least `nearFullAt` × capacity entries (panel option, default `0.9`), a banner says "The buffer is almost full (N / M). The oldest entries will soon be dropped." with **Download all**, **Raise the limit** (opens Settings with focus on the buffer size) and **Dismiss**. Shown once per crossing: once dismissed it stays hidden until the buffer is below the threshold again — after **Clear** or a size change — and crosses it again. Never with No limit. | MUST (2.1) |
| FR-BUF-05 | **Memory warning** (`D-30`): the recorder's size estimate (`C-9`) is checked against steps of `memoryStep` bytes (panel option, default 25 MB = 26,214,400 B). Each time it passes a new step, a banner says "Captured data uses about N MB. The page may get slow." with **Download all** and **Dismiss**; once dismissed it comes back at the next step. Falling below a step re-arms that step. | MUST (2.1) |
| FR-STAT-01 | **Status observer** (`D-31`): `handle.onStatus(listener)` returns an unsubscribe function. The listener gets a `DebugPanelStatus` (§6.4): open, capture on/off, entries, capacity, problems in the buffer, near full, estimated bytes and memory step. It is called once when it subscribes, then after a change — at most once per frame, and only when a field changed. Works while the panel is closed and before the UI chunk loads. A throwing listener is isolated (`ISO-12`). The inert handle never calls it. | MUST (2.1) |
| FR-ACT-10 | **"Show DBG button"** setting (`D-32`): Show / Hide, remembered per browser, applied live and by the loader at install. Code `launcher: false` removes the launcher and hides the switch: the host wins. The toggle shortcut stays code-only (`shortcut` option). | MUST (2.1) |
| FR-NOTE-01 | **Add note** (`D-33`): a toolbar button opens a small form — Title, Text, **Add note**. Adding records an entry of the new kind `note` (`C-10`), stamped at the moment of the click; with both fields empty nothing is added. Enter in Title, or Ctrl+Enter in Text, adds too; Escape closes the form. | MUST (2.1) |
| FR-NOTE-02 | Notes show in **Console** in time order, with the icon and the word `note`. Level chips never hide them; the search looks in title and text; the detail shows the title, the time and the whole text. They count in `N / M shown` and are never problems. | MUST (2.1) |
| FR-NOTE-03 | Notes are exported like any entry (`kind: 'note'`, `title`, `text`) in the `entries` list, so equal titles never clash. A reader that does not know `note` skips it (the file is schema 2 since `D-36`). | MUST (2.1) |
| FR-NOTE-04 | A host adds a note from code: `controller.session.addNote(title, text?)`. It records while capture is off too (a note is the user's own act, not a probe). Title and text are redacted and truncated by the policy, like an error message. | MUST (2.1) |

### 3.11 Functional — release 2.2, background control (S-13)

Cut from `D-37` … `D-43` (owner, 2026-10-26). Everything here works **while the panel is
closed**. Behaviour in §4.1, §4.10, §4.12; interfaces in §6.4; core change `C-11`; host
wiring in §6.6. Every chord is configurable in code and matched on `KeyboardEvent.code`
with all four modifiers exact (`ISO-08`).

| ID | Requirement | Pri |
|---|---|---|
| FR-BG-01 | **Activation shortcut** (`D-40`): `installDebugActivation(options?)`, from the new entry `debug-capture/activate`, is the only piece a host loads at start: one `keydown` listener for the activation chord (default `Ctrl+Alt+Shift+A`, `shortcut` option; `false` binds none) and one read of the flags at start — the URL flag `?debug=1` / `?debug=true` and the stored flag, as `isDebugRequested()` reads them (`D-45`); either one activates at once. Activating loads the core and the panel loader with dynamic `import()`, creates the capture controller (`capture` option) and installs the panel (`panel` option) — **closed**. Nothing else runs before. | MUST (2.2) |
| FR-BG-02 | **Remembered on this browser** (`D-40`): activating **by the chord** (or `activate()`) writes `'1'` under the `localStorage` key `debug-capture` (`storageKey` option; `false` remembers nothing). At start, with the flag set, it activates at once, so capture starts with the page and records its startup requests: `handle.ready` resolves when that start-time load has finished (or failed; at once when there is none) and never rejects, so a host that waits for it before bootstrap loses no startup request. The URL flag never writes it: `?debug=1` stays one page load. Storage that throws counts as "not set"; the chord still works for this page. | MUST (2.2) |
| FR-BG-03 | **Turning off for good** (`D-40`, `D-45`): the activation chord while active removes the flag, disposes the panel (focus returns if it was open) and the controller (probes and chords off, `C-11`) — also when this page was switched on by `?debug=1`; the next load follows the URL again. A later press starts afresh (a new, empty buffer). A press while still loading wins: the load is turned off as soon as it lands. A failed load leaves it off with `loadError` set and keeps the flag, so a reload tries again. | MUST (2.2) |
| FR-BG-04 | **No visible sign** (`D-41`): after activation by the chord or the stored flag the panel is closed and the DBG button is **hidden** — it exists, and shows only if the user picks Show in Settings › DBG button (remembered, `FR-ACT-10`). The panel opens only by its toggle chord. On a **`?debug=1` page** the DBG button **shows** (unless Settings stored Hide), as in 2.1 (owner, 2026-10-26). A host can pass its own `launcher` value through the `panel` option. | MUST (2.2) |
| FR-BG-05 | **Capture on / off chord** (`D-37`): `Ctrl+Alt+Shift+S` (`shortcuts.record`) turns capture off and on (`controller.stop()` / `start()`), panel closed or open; the panel's switch and banner follow (`FR-ACT-09`). | MUST (2.2) |
| FR-BG-06 | **Chords live while capture is off** (`D-37`, `C-11`): the controller binds its chords — download, copy, clear, record, note — when it is created and keeps them until `controller.dispose()`; capture off removes only the probes. Download and copy then export the buffer as it is. `installDebugCapture()` (the v1 path, no controller in hand): `session.dispose()` still removes everything, chords included. | MUST (2.2) |
| FR-BG-07 | **Note chord** (`D-38`): `Ctrl+Alt+Shift+M` (`shortcuts.note`) adds a pre-defined note with `session.addNote(title, text)`; title and text come from the `note` option (`{ title?, text? }`; defaults `Mark` and `Added with the keyboard shortcut.`). Works with the panel closed and with capture off (`FR-NOTE-04`). | MUST (2.2) |
| FR-BG-08 | **Save to a pre-defined folder** (`D-39`): no new code. `Ctrl+Alt+Shift+D` downloads; IT sets the Chrome policies `DownloadDirectory` (the folder) and `PromptForDownloadLocation` = false on the stations, so the file lands in that folder with no dialog. The user README and the app guide describe the station setup. `Ctrl+Alt+Shift+C` copies the same JSON to the clipboard, panel closed or open. | MUST (2.2) |
| FR-BG-09 | **About** in Settings (`D-42`): the Settings popover ends with an **About** part — the package version and every shortcut, each with the chord **actually configured** (from the options; a disabled one reads "off"): the background chords (activation, when the panel was installed by it; panel toggle; download; copy; clear; capture on / off; note) and the in-panel keys of §4.12. | MUST (2.2) |
| FR-BG-10 | **Seams find a later session** (`D-40`): `provideDebugCaptureSession()` and `createReactRootErrorOptions()` also take a function that returns the session (`() => debug.session`), read on each error, so the Angular `ErrorHandler` and the React callbacks record into a session that starts after bootstrap, and stop when it is turned off. | MUST (2.2) |

### 3.12 Functional — release 2.3, custom messages (S-14)

Cut from `D-46` (owner, 2026-10-26). Core change `C-12`; interfaces §6.4.

| ID | Requirement | Pri |
|---|---|---|
| FR-MSG-01 | **Send a message from code** (`D-46`): `session.addMessage(type, data?, level?)` records an entry of the new kind `app` — `type` (a short name, e.g. `order-saved`), `level` (`info` · `warn` · `error`; anything else is `info`) and `data` (any value; default `null`), stamped with the session clock. Never throws. | MUST (2.3) |
| FR-MSG-02 | **The host's handle**: the same call is `message(type, data?, level?)` on the activation handle (`installDebugActivation`) and on the panel handle (`installDebugPanel`), so the host keeps one object from start-up and calls it any time. The inert panel handle's `message` does nothing. | MUST (2.3) |
| FR-MSG-03 | **Dropped while off** (`D-46`): before the tool is switched on, after it is turned off, and while capture is off (`FR-ACT-09`, `FR-BG-05`), a message is dropped — nothing is kept, nothing is loaded. (Unlike a note, which is the user's own act, `FR-NOTE-04`.) | MUST (2.3) |
| FR-MSG-04 | **Policed like a log call**: `data` becomes a JSON-safe clone with the policy's redaction and size limits (as `LogEntry.args`); `type` is redacted and cut like a note title. A live object the host keeps changing never changes the stored entry. | MUST (2.3) |
| FR-MSG-05 | **Console** shows app messages in time order: the level icon, the word `app` and `type` with a one-line preview of `data`; the detail shows type, level, time and `data` as a JSON tree. A chip **App** in the level chip group shows or hides them (the level chips do not); search looks in `type` and `data`. They count in `N / M shown`. | MUST (2.3) |
| FR-MSG-06 | **Problems**: an app message with level `error` is a problem (badge, status bar, `onStatus`; the `FR-ACT-04` rule, `C-8`). | MUST (2.3) |
| FR-MSG-07 | **Export**: app messages are entries like any other (`kind: 'app'`, `type`, `level`, `data`, with `sequence` and `time`). `schemaVersion` stays 2 (a new kind is additive; readers skip kinds they do not know, `D-33`). | MUST (2.3) |
| FR-MSG-08 | **Budgets**: no raise — core ≤ 13,904 B, activation ≤ 1,536 B, loader ≤ 5,632 B, UI chunk ≤ 45,056 B (`D-43`, `D-34`). | MUST (2.3) |

---

## 4. Behaviour

### 4.1 Lifecycle

```
   NOT SWITCHED ON  ── only the activation piece (2.2): 1 keydown listener, 1 storage read
                │
   ?debug=1 or the stored flag at start, or the activation chord (remembered; again: off)
                ▼
   import() core + loader ──► createCaptureController() + chords (C-11)
                ▼
createCaptureController()  ──►  installDebugPanel(controller)   (loader; DBG button hidden, or shown on ?debug=1, D-41)
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
- **Turning off for good** (2.2, `FR-BG-03`): the activation chord again removes the flag,
  disposes the panel and the controller (`controller.dispose()`: probes and chords off).
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
  `<dialog>`, a popover — still can (`ISO-21`); on fullscreen the launcher and
  the panel are raised back on top (`FR-WIN-07`).
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
  the buffer disappear from the frozen view. A pending HTTP row that was
  already on screen updates in place when that request finishes (same row,
  highlight kept); it is not counted in `N new`. A request that starts while
  paused stays hidden until Resume. Resume applies everything that waited.
- **Buffer limits:** the capture buffer holds `maxEntries` (default 5,000), or
  from 2.1 the size chosen in Settings, up to **No limit** (`FR-BUF-01` … `03`).
  At 90 % a banner warns once per crossing; a memory banner warns at each
  25 MB step of the size estimate (`FR-BUF-04`, `05`).
  When it is full, the oldest entries drop out of the lists too; the status
  bar shows the evicted count. A selected entry that drops out keeps its
  detail open with the note "This entry was removed from the buffer".
  **Clear** is different: the user asked for it, so every open detail
  closes (`FR-BAR-03`; owner, 2026-10-25).
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
| **Response** | Response body, same rules as Payload. Truncated bodies show the `truncated` badge and the original length from v1's `…[truncated N chars]` note. A fetch body the probe stopped reading at 1 MB (`HttpEntry.resBodyCapped`, `C-7`) shows "over 1 MB — full length unknown" instead of a length. Not read (binary, event-stream) → "Body not captured (reason)". |
| **Timing** | Start time, end time, duration, and a simple bar of the duration against the slowest request in view. (v1 records start and duration only; no DNS/TLS phases.) |

Toolbar of the detail: `Copy ▾` (URL, request body, response body, cURL) and
a close `✕`. `↑` / `↓` in the list moves the selection and updates the detail.

### 4.7 WebSocket view

```
┌ Connections ──────────────────┐┌ Messages — ws://host/api/system-experiments/ws ───────┐
│ ● #3 /api/system-…/ws   open  ││ Dir         Time          Size    Data                │
│     ↑ 2  ↓ 118   14:02:11     ││ ● opened    14:02:11.020          connection opened   │
│ ○ #2 /api/ws          closed  ││ ↓ received  14:02:11.034  3.2 kB  {"entities":[{"en… │
│     ↑ 0  ↓ 6     13:58:40     ││ ↑ sent      14:02:15.501  41 B    {"cmd":"apply","i… │
│ ✕ #1 /api/ws           error  ││ ↓ received  14:02:15.522  3.2 kB  {"entities":[{"en… │
│ ─────────────────────────────  ││ ↓ received  14:02:16.002  512 B   [Binary 512 bytes]  │
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

- Selecting a row opens the detail (one page, no sub-tabs): full message,
  each argument as its own JSON tree, and for errors the full stack (React
  component stack included). `▸` in a row means "more in the detail"; rows
  never expand in place.
- Errors from all sources appear here, with their source tag.

### 4.9 Toolbar and status bar

```
┌ ◉ Debug   [ Network | Console ]        ⏸ Pause   ⟲ Clear   ⇩ Export ▾   ⚙   ⤢   ✕ ┐
│ …                                                                                   │
├ 1,284 / 1,284 shown · ✕ 3 problems · buffer 1,284 / 5,000 · capture ● on · dropped 0 · evicted 0 ┤
```

- **Note** (2.1, `FR-NOTE-01`): a toolbar button before Settings opens the
  Add note form; the note lands in Console and in the export.
- **Clear** asks nothing and is not undoable — like v1's `X` shortcut. It
  clears the capture buffer, so it also empties the next export.
- **Export ▾:** "Download all (JSON)" and "Copy all (JSON)". The whole
  buffer, always. The file is `schemaVersion` 2 (`D-36`): v1's shape, with
  each entry's `seq` written as `sequence`, a readable `time` next to `t`, and
  the optional fields `pending`, `requestId` (`C-1`, §6.5).
- **Problems** count: the rule in `FR-ACT-04`, over the buffer.
- **`N / M shown`**: N = entries the current list shows after filters; M =
  entries that list has before filters (not the whole buffer — that is the
  `buffer` figure). A Console run of repeats (one row with a count, S07-05)
  counts each of its entries (`FR-BAR-06`).
- **v1 shortcuts** (`D` / `C` / `X`) belong to capture: while capture is off
  they do nothing; the panel's toolbar still exports and clears.

### 4.10 Settings

A popover under the gear button.

| Setting | Values | Default |
|---|---|---|
| Theme | Auto (follows the OS, by a CSS `prefers-color-scheme` media query — no JS listener) · Dark · Light | Auto |
| Dock | Bottom · Right | Bottom |
| Text size | Small 11 px · Normal 12 px · Large 14 px (meta text 10 / 11 / 13 px) | Normal |
| Time | Clock · Relative | Clock |
| Capture | On · Off (`FR-ACT-09`) — **not remembered**; every reload starts On | On |
| Buffer (2.1) | 1,000 · 5,000 · 10,000 · 50,000 · No limit (with its warning) — `FR-BUF-01` | the policy's `maxEntries` |
| DBG button (2.1) | Show · Hide — `FR-ACT-10`; not shown when the host passes `launcher: false` | Show (Hide when switched on by the activation shortcut or the stored flag; Show on a `?debug=1` page, `D-41`) |
| About (2.2) | Not a setting: the package version and every shortcut in use, read from the options — `FR-BG-09` | — |

From 2.1 the loader reads two of these at install — `buffer` and `launcher` —
so a reload keeps them before the first open (`D-32`, `D-34`).

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
| Host modal dialog or fullscreen | Banner: "The page has a dialog open or is fullscreen. The panel can be seen but not used until it closes." Chrome blocks clicks and focus outside a modal dialog or a fullscreen element; the panel is still drawn on top and live (`FR-WIN-07`, `D-15`, `ISO-21`). |
| Panel failure | Status bar shows `panel error` with a count; the panel keeps working (`NFR-REL-01`). |
| Buffer near full (2.1) | Banner: "The buffer is almost full (N / M). The oldest entries will soon be dropped." **Download all** · **Raise the limit** · **Dismiss** (`FR-BUF-04`). |
| Memory step passed (2.1) | Banner: "Captured data uses about N MB. The page may get slow." **Download all** · **Dismiss** (`FR-BUF-05`). |

### 4.12 Keyboard

| Keys | Where | Action |
|---|---|---|
| `Ctrl+Alt+Shift+A` | anywhere (2.2) | Switch the tool on (and remember it); again: off for good (`FR-BG-01`…`03`) |
| `Ctrl+Alt+Shift+P` | anywhere | Open / close the panel |
| `Ctrl+Alt+Shift+D` / `C` / `X` | anywhere | Download / copy / clear (v1; from 2.2 also while capture is off, `D-37`) |
| `Ctrl+Alt+Shift+S` | anywhere (2.2) | Capture on / off (`FR-BG-05`) |
| `Ctrl+Alt+Shift+M` | anywhere (2.2) | Add the pre-defined note (`FR-BG-07`) |
| `Escape` | panel | Close the innermost open thing: a menu or popover (Export, Copy, Settings), else the detail, else the panel |
| `↑` `↓` | list | Move selection (and the detail) |
| `Home` `End` `PageUp` `PageDown` | list | Jump |
| `Enter` | list | Open the detail of the selected row |
| `Ctrl+F` | panel | Focus the filter box (only when focus is inside the panel) |
| `Alt+1` / `Alt+2` | panel | Network / Console |
| `←` `→` | tab bar | Move between tabs |
| `←` `→` `Enter` `Space` | JSON tree | Collapse / expand |

Keys pressed inside the panel never reach the host (`ISO-07`), except the
global `Ctrl+Alt+Shift+…` chords. Every chord is configurable in code (2.2: activation
`shortcut`, panel `shortcut`, capture `shortcuts.*`); Settings › About lists the ones in use
(`FR-BG-09`).

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
| Title bar / filter bar / detail header | 32 px each, at every text size |
| Status bar | 22 px, at every text size |
| List row | 22 px (Normal text), 20 px (Small), 26 px (Large) |
| Detail pane | default 45% of the panel (bottom dock: width; right dock: height); min 240 px; draggable splitter |
| Resize handle hit area | 6 px |
| Launcher | 28 px tall, 12 px from the corner |
| Spacing scale | 2 · 4 · 8 · 12 · 16 px |
| Radius | 4 px (controls, chips, badges); 6 px (popovers, menus, launcher); 0 (the panel itself — it touches the window edges) |
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
| `--dcp-info` | 3xx, info level, WS received ↓ (cyan — kept apart from `--dcp-accent`, so a 3xx never looks like focus) | `#5cc8dc` | `#00657a` |
| `--dcp-warning` | 4xx, warn level, `truncated` badge | `#e5b84b` | `#7d5400` |
| `--dcp-error` | 5xx, failed, error level, socket error | `#ff8a80` | `#b0141f` |
| `--dcp-json-key` | JSON keys | `#9cdcfe` | `#0451a5` |
| `--dcp-json-string` | JSON strings | `#e0a77f` | `#a31515` |
| `--dcp-json-number` | JSON numbers | `#b5cea8` | `#08613f` |
| `--dcp-json-literal` | `true` / `false` / `null` | `#79b8ff` | `#0000c4` |
| `--dcp-match-bg` | Search-match highlight (solid; text on it is `--dcp-text`) | `#5a4a16` | `#ffe58a` |

Measured minimum ratios (worst background, tinted rows included): dark —
text 9.06, muted 5.03, faint 4.74, accent 4.86, success 5.40, info 5.73,
warning 6.02, error 4.91, JSON 5.34–7.51, control border 3.28, match 7.00;
light — text 11.61, muted 4.69, faint 4.91, accent 5.08, success 4.93, info
4.91, warning 4.91, error 5.20, JSON 5.53–8.59, control border 3.27,
match 12.66.

**Badges** (`redacted`, `truncated`, `pending`): text in the matching colour
token on an **opaque** background = 12% of that colour over `--dcp-bg`, on any
row (so a tinted or selected row never lowers the badge's contrast; measured
≥ 5.40 in both themes, and part of the contrast check), with an icon (🔒 redacted, ✂ truncated, ◌ pending
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
| Meta (timestamps, sizes, status bar) | the data stack above | 11 px | 400 |

Line height 1.4 for text blocks, row height fixed for lists. No web fonts
(`ISO-05`: no `@font-face`). Text size setting scales all three (11 / 12 /
14 px base).

### 5.6 Columns and status mapping

**HTTP list**

| Column | Content | Width |
|---|---|---|
| Time | clock or relative (setting) | 104 px |
| Method | `GET`, `POST`… | 64 px |
| Status | code + icon; `Failed`, `Aborted`, `Timeout`, `Pending` | 88 px |
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
| Focus (keyboard) | 2 px `--dcp-accent` outline, `:focus-visible` only. Controls: 1 px outside offset. List rows and tabs inside scroll areas: **inset** (`outline-offset: -2px`) so the ring is not clipped |
| Disabled | 50% opacity on the control (WCAG exempts disabled controls from contrast) |
| Search match | `--dcp-match-bg` behind the text, text in `--dcp-text`; `Mark` / `MarkText` in forced colours |
| `[redacted]` inside other text | same look as the `redacted` badge (muted on its opaque tint), no icon |
| Motion | None by default (no transitions on rows). Opening/closing: no animation. |

**Component looks** (the details the tables above do not fix):

| Part | Look |
|---|---|
| Control (button, input, chip) | 24 px tall, 1 px `--dcp-border-control`, radius 4 px, `--dcp-bg` fill |
| Chip, on | `--dcp-bg-selected` fill, `--dcp-accent` border, `--dcp-text` |
| `redacted` badge | `--dcp-text-muted` (badge rule above) |
| `truncated` badge | `--dcp-warning` |
| `pending` badge | `--dcp-text-muted` |
| Banner (capture off, host modal) | full width under the title bar, `--dcp-bg-elevated`, 2 px `--dcp-warning` bar at the start, text + its buttons (the 2.1 warning banners end with **Dismiss**) |
| Popover / menu | `--dcp-bg-elevated`, 1 px `--dcp-divider` border, radius 6 px, no shadow |
| "↓ N new" follow button | a control, bottom-right of the list, 8 px from its edges, `--dcp-bg-elevated` |
| Timing bar | `--dcp-accent` fill on a `--dcp-divider` track, 6 px tall |
| Status bar `capture ● on` / `capture ○ off` | `--dcp-success` / `--dcp-warning` dot and word |

### 5.8 Mockup

A static mockup in both themes, built from these exact tokens and sizes, lives
in `docs/design/mockup.html` (opens offline; no external files). It is an
illustration: **where it and this document differ, this document wins.**

---

## 6. Architecture

### 6.1 Package and entry points

```
debug-capture/                         (the repository izhaq/debug-capture — D-02)
  README.md · CONTRIBUTING.md · RELEASING.md · AGENTS.md · package.json · tsconfig*.json
  docs/  design/ (HLD, mockup) · specs/ (S-00…S-14) · host-setup.md · research/ · v1/
  scripts/  check-layers.mjs · contrast-check.mjs · build.mjs · size.mjs · …
  src/
    contract/ core/ adapters/ install/ index.ts   ← entry "debug-capture"         (from v1, L1–L5)
    angular/                                      ← entry "debug-capture/angular"  (L6)
    react/                                        ← entry "debug-capture/react"    (L6)
    panel/                                        ← entry "debug-capture/panel"    (L6, new: loader)
                                                    + lazy chunk "panel UI" (P1–P4, loaded on first open)
    activate/                                     ← entry "debug-capture/activate" (L6, 2.2: the activation
                                                    piece — the only part loaded before switch-on, D-40)
  test/  hosts/ (angular, react, plain) · hostile-host/ · e2e/ · perf/
  dist/  *.mjs + *.d.ts per entry (prebuilt ESM — usable without a bundler)
```

- Every entry point is ESM with type declarations. No runtime dependencies.
  `@angular/core` is a **peer** dependency of `debug-capture/angular` only.
- `debug-capture/panel` is the **loader** (≤ 5.5 kB since 2.1): `installDebugPanel`, the
  custom element and its host lockdown, launcher, badge counter, toggle
  shortcut. It loads the **UI chunk** (≤ 44 kB since 2.1) with one dynamic `import()` on
  first open (`FR-ACT-02`, `NFR-SIZE-01`).
- `debug-capture` (core) never imports `debug-capture/panel`, so the core does
  not grow.
- `debug-capture/activate` (2.2) imports the core and the panel loader only as types and
  by dynamic `import()` — no static value import, checked by the layer script — so a
  station that never switches the tool on loads only this piece (`FR-BG-01`, `D-43`).

### 6.2 Layers

The v1 rule stays: **each layer imports only the barrel of the layer directly
above it**, checked by a script. v2 adds the panel as a sibling of the Angular
and React seams, with its own inner layers:

```
L1 contract ─► L2 core ─► L3 adapters ─► L4 install ─► L5 public (src/index.ts)
                                                          │
                     ┌────────────────────────┬───────────┴───────────┐
                     ▼                        ▼                       ▼
                L6 angular               L6 react                L6 panel      L6 activate (2.2)
                                                          ┌──────────┴──────────┐
                                                          P1 model     (pure: no DOM, no globals)      ┐
                                                          P2 ui        (DOM building blocks)           │ UI chunk,
                                                          P3 views     (Network, Console, Settings…)   │ loaded on
                                                          P4 app       (frame, tabs, scheduler, storage)┘ first open
                                                          P5 panel/index.ts  (loader: element, launcher, installDebugPanel)
```

| Layer | Holds | May use |
|---|---|---|
| P1 `panel/model` | `PanelDataSource` interface and the local data source (built from a controller); store (state + reducers); selectors (filtered lists, counts via `isProblemEntry`, connection state); formatting (time, size, status text); cURL builder | L5 barrel only. No DOM, no timers, no globals — fully unit-testable |
| P2 `panel/ui` | Safe element builder (`text` only, no HTML strings); virtual list (bidi-safe cells); JSON viewer (paged children); split pane; tabs; chips; buttons; empty/no-match block; icons (SVG builders); theme (tokens → one `CSSStyleSheet`) | P1 barrel; the `document` passed in |
| P3 `panel/views` | Title bar, filter bars, HTTP list + detail, WebSocket view, Console view, settings popover, status bar | P2 barrel |
| P4 `panel/app` | `mountPanelUi(shadowRoot, controller, options)`: the frame (top tabs, Network sub-tab routing, split, resize, dock, maximize), scheduler (rAF batching), settings storage, banners (capture off, host modal) | P3 barrel |
| L6 `activate/` (2.2) | `installDebugActivation()`: the activation chord, the stored flag, the lazy start and stop (`FR-BG-01`…`03`) | L5 barrel and the panel entry (`src/panel/index.ts`) **only** by `import type` and dynamic `import()` |
| P5 `panel/index.ts` | **Loader:** `installDebugPanel()`; the custom element; mount on `<html>`; top layer; host lockdown sheet; event wall; zone handling; toggle shortcut; launcher + badge (own tiny sheet, same tokens; badge uses core's `isProblemEntry`, `C-8`) | L5 barrel; P4 only by `import type` and **one** dynamic `import()` — the layer checker fails on any static value import of P4, so the chunk stays lazy. P5 passes the **controller** to `mountPanelUi`; P4 builds the data source from P1 |

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
  download(root: ShadowRoot): void;                         // C-5: temporary <a> inside `root`
  copyText(text: string, root: ShadowRoot): Promise<boolean>; // C-5: fallback textarea inside `root`
  capture: { readonly on: boolean; start(): void; stop(): void };   // C-2
  // 2.1
  defaultCapacity(): number;                     // policy.maxEntries — the Settings default (FR-BUF-01)
  setCapacity(capacity: number): void;           // C-9: integer ≥ 1 or Infinity (No limit)
  addNote(title: string, text: string): void;    // C-10
}

type PanelDataEvent =
  | { type: 'entry'; entry: CaptureEntry }
  | { type: 'pending-start'; request: PendingRequest }   // C-1
  | { type: 'pending-end'; id: number }                  // C-1: finished, sampled out, failed, capped or stopped
  | { type: 'cleared' }                                  // C-6
  | { type: 'stats'; stats: CaptureStats }               // C-6: dropped / failed changed
  | { type: 'capture'; on: boolean }                     // C-2
  | { type: 'capacity'; capacity: number };              // C-9 (2.1): the store drops its oldest beyond it

/** C-1. Filtered by ignoreUrls and redacted (URL, headers) like an HttpEntry; sample() runs at completion. */
interface PendingRequest {
  readonly id: number;                     // = HttpEntry.requestId of the finished entry
  readonly t: number;                      // start time (epoch ms)
  readonly transport: 'xhr' | 'fetch';
  readonly method: string;
  readonly url: string;
  readonly reqHeaders: Readonly<Record<string, string>>;
}

interface DebugPanelOptions {
  launcher?: boolean | 'hidden';           // default true; 2.2: 'hidden' = there, hidden until Settings says Show (D-41)
  shortcut?: string | false;               // default 'ctrl+alt+shift+p'
  defaultDock?: 'bottom' | 'right';        // default 'bottom'
  storageKey?: string | false;             // default 'debug-capture:panel'
  nearFullAt?: number;                     // 2.1, FR-BUF-04: share of the capacity, (0, 1]; default 0.9
  memoryStep?: number;                     // 2.1, FR-BUF-05: bytes; default 26,214,400 (25 MB)
  activation?: string | false;             // 2.2, FR-BG-09: the activation chord, for About (set by installDebugActivation)
}

function installDebugPanel(controller: CaptureController | null, options?: DebugPanelOptions): DebugPanelHandle;  // null → inert handle

interface DebugPanelHandle {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;                         // closes (focus returns), unsubscribes, removes launcher, listener, element
  onStatus(listener: (status: DebugPanelStatus) => void): Unsubscribe;   // 2.1, FR-STAT-01
}

/** 2.1, FR-STAT-01 (D-31). A fresh object per call. */
interface DebugPanelStatus {
  readonly open: boolean;
  readonly capture: boolean;               // controller.on
  readonly entries: number;                // in the buffer now
  readonly capacity: number;               // Infinity = No limit
  readonly problems: number;               // in the buffer (FR-ACT-04 rule)
  readonly nearFull: boolean;              // entries ≥ nearFullAt × capacity
  readonly bytes: number;                  // C-9 estimate
  readonly memoryStep: number;             // floor(bytes / memoryStep); 0 = below the first step
}

/** C-2. One recorder for the page's life; `session` is one stable wrapper whose
 *  `active` follows `on`; `session.dispose()` acts as `stop()`;
 *  `getActiveCaptureSession()` returns this wrapper. */
interface CaptureController {
  readonly session: ControlledCaptureSession;  // a CaptureSession + recorder: LiveRecorder + policy (C-3)
  readonly on: boolean;
  start(): void;                           // reinstall the probes on the same recorder
  stop(): void;                            // remove the probes; buffer kept; 2.2: the chords stay (D-37)
  onChange(listener: (on: boolean) => void): Unsubscribe;
  // 2.2 (C-11)
  readonly shortcuts: ShortcutConfig | null;  // the chords in use (null: `shortcuts: false`), for About
  dispose(): void;                         // stop() + unbind the chords, for good; start() then does nothing
}

// 2.2 (C-11, FR-BG-05…07)
interface ShortcutConfig { download: string; copy: string; clear: string; record: string; note: string }
// DEFAULT_SHORTCUTS: ctrl+alt+shift+ d / c / x / s / m
interface DebugCaptureOptions {
  policy?: Partial<CapturePolicy>;
  shortcuts?: Partial<ShortcutConfig> | false;
  note?: { title?: string; text?: string };  // the note chord's note; default 'Mark' / 'Added with the keyboard shortcut.'
}
const DEBUG_CAPTURE_VERSION: string;       // the package version, for About (FR-BG-09)

// 2.2 — entry "debug-capture/activate" (FR-BG-01…03, D-40)
interface DebugActivationOptions {
  shortcut?: string | false;               // default 'ctrl+alt+shift+a'; false: only the stored flag switches it on
  storageKey?: string | false;             // default 'debug-capture' (value '1'); false: nothing remembered
  capture?: DebugCaptureOptions;           // for createCaptureController
  panel?: DebugPanelOptions | false;       // for installDebugPanel (launcher true on ?debug=1, else 'hidden', unless given); false: no panel
}
interface DebugActivationHandle {
  readonly active: boolean;                // from switch-on (also while loading) until off
  readonly session: CaptureSession | null; // once loaded; for the seams: () => handle.session (FR-BG-10)
  readonly controller: CaptureController | null;
  readonly panel: DebugPanelHandle | null;
  readonly loadError: unknown;             // why the last switch-on failed; null when it did not
  readonly ready: Promise<void>;           // the start-time switch-on has loaded (or failed); never rejects
  activate(): void;                        // as the chord: on, remembered
  deactivate(): void;                      // as the chord again: off for good, flag removed
  dispose(): void;                         // removes the key listener and turns off; the flag stays
}
function installDebugActivation(options?: DebugActivationOptions): DebugActivationHandle;
const DEBUG_STORAGE_KEY = 'debug-capture';

// 2.3 (C-12, FR-MSG-01…07)
type AppMessageLevel = 'info' | 'warn' | 'error';
interface AppMessageEntry { kind: 'app'; seq: number; t: number; type: string; level: AppMessageLevel; data: JsonValue }
// CaptureEntry gains AppMessageEntry
interface ControlledCaptureSession { addMessage(type: string, data?: unknown, level?: AppMessageLevel): void }  // only while on
interface DebugActivationHandle { message(type: string, data?: unknown, level?: AppMessageLevel): void }  // dropped while off
interface DebugPanelHandle { message(type: string, data?: unknown, level?: AppMessageLevel): void }       // inert: no-op
```

The exact contract types (S-00) live in `src/contract/capture-contract.ts`:
`LiveRecorder` (the read side the panel uses: `onChange`, `pending`,
`onPending`), `ProbeRecorder` (the write side only the probes use:
`startPending`, `endPending`, `nextSocketId`), `ControlledCaptureSession`,
`CaptureController`, `PendingRequest`, `PendingDraft`, `PendingEvent`,
`RecorderChange`, `SinkOptions`, `IsProblemEntry`, `MAX_PENDING_REQUESTS`.
Where this section and that file differ in detail, the file is the contract
and this section is updated to match.

**2.1 (S-11).** The contract adds `NoteEntry` (`C-10`), `BufferUsage` and the
`LiveRecorder` members `usage()` / `setCapacity()` with the `capacity`
change (`C-9`), and `ControlledCaptureSession.addNote()`. The loader keeps
the warning state (which banner is dismissed), because it lives while the
panel is closed; it hands the UI `launcher`, `setLauncher`, `warnings()` and
`dismissWarning()` through `MountPanelUiOptions` (P4's contract).

### 6.5 Changes v2 needs in the capture layer

| ID | Change | Why | Effect on v1 file format |
|---|---|---|---|
| C-1 | **Pending requests.** Probes report a request when it **starts**. The recorder keeps a live list of `PendingRequest` (§6.4), **capped at 200** (oldest dropped). Each gets an `id`; the finished `HttpEntry` carries it as a new `requestId`. At start a pending request is filtered by `ignoreUrls` only and redacted; `sample()` still runs **once, at completion**, on the finished draft (v1's signature). Listeners get `pending-start` and `pending-end` — the end fires on completion **and** when the request is sampled out, fails while recording, is pushed out by the 200 cap, or is cut off by `stop()` / `dispose()`. `clear()` and `stop()` empty the list. The stored `HttpEntry` stays one per **completed** request. | `FR-HTTP-02` | Two **optional** fields: `pending` (list) in the file, `requestId` on HTTP entries. `schemaVersion` stays **1**; rule: readers ignore unknown fields. v1 readers keep working. |
| C-2 | **Capture controller.** `createCaptureController(options)` → `CaptureController` (§6.4). It owns **one recorder for the page's life**: `stop()` removes probes and shortcuts only; `start()` reinstalls them on the **same** recorder. `installDebugCapture()` is a thin wrapper that creates a controller and returns its session (no `recorder` option: a recorder passed in could apply a different policy than `session.policy` shows — S-01 review). `controller.session` is one stable wrapper whose `active` follows `on`, and `getActiveCaptureSession()` returns it, so the Angular and React seams (which hold the session and check `active`) keep working across stop/start. `seq` lives in the recorder; the WebSocket **socket-id counter moves from the probe install into the recorder** (today `let nextSocketId = 1` is per install — the contract comment changes too), so ids never restart. `session.dispose()` called directly acts as `stop()`. | `FR-ACT-09` | None |
| C-3 | **Policy.** The session exposes its resolved policy (read-only), so the panel can show `buffer 1,284 / 5,000` and mark values equal to `redactedValue`. | `FR-BAR-06`, `FR-HTTP-07` | None |
| C-4 | **Angular seam without decorators.** `DebugCaptureErrorHandler` is provided with a factory instead of `@Injectable()`, so the package builds with plain `tsc` (no `ng-packagr`). | §7.2 build | None |
| C-5 | **Copy and download without touching `<body>`.** `copyText` gets an option to place its fallback textarea inside a given root, and `downloadText` an option to place its temporary `<a>` there — the panel passes its shadow root, so no node is added to the host page. To be proven in a spike (`OPEN-04`). | `ISO-04`, research §3.4 | None |
| C-7 | **Capped fetch body flag.** v1's fetch probe stops reading at 1,048,576 chars and appends a note, but the recorder then truncates to `maxBodyLength` (32,768) and the note is lost. The probe sets a new optional `resBodyCapped: true` on the draft instead, kept on the `HttpEntry`. | `§4.6` Response | One optional field on HTTP entries |
| C-8 | **Problem rule in core.** `isProblemEntry(entry)` (the `FR-ACT-04` rule), exported from L5, so the loader's badge and the panel model share one definition. | `FR-ACT-04`, `FR-BAR-06` | None |
| C-9 | **Resizable buffer and usage** (2.1). `recorder.setCapacity(n)` takes an integer ≥ 1 or `Infinity` (No limit; anything else is ignored); a smaller size evicts the oldest entries at once (counted in `evicted`), then `onChange` fires `{ type: 'capacity' }`. `recorder.usage()` returns `{ entries, capacity, bytes, problems }`, kept up to date in O(1) per entry: `problems` by `isProblemEntry` (`C-8`), `bytes` = the size estimate — per entry, 160 B plus 2 B per character of every string and object key in it, at any depth (`D-30`; strings shared between entries count each time, so it errs high). `seq` and the ids never restart (`C-2`). | `FR-BUF-01`…`05`, `FR-STAT-01` | None |
| C-10 | **Note entries** (2.1). A new entry kind `note` (`title`, `text`), policed like an error message (redacted, truncated). `session.addNote(title, text?)` records one with the session clock's time, also while capture is off. Never a problem (`C-8`). | `FR-NOTE-01`…`04` | One new entry kind; `schemaVersion` stays 1; readers skip unknown kinds |
| C-11 | **Chords for the controller's life** (2.2). The controller binds its chords — download, copy, clear, plus the new **record** (`ctrl+alt+shift+s`: `stop()` / `start()`) and **note** (`ctrl+alt+shift+m`: `session.addNote()` with the `note` option's title and text) — when it is created, not with the probes; `stop()` / `start()` leave them. `controller.dispose()` stops capture and unbinds them for good; `controller.shortcuts` is the resolved config (or `null`). `installDebugCapture()` keeps v1's meaning: its `session.dispose()` is a full dispose. `isDebugRequested()` stays (`D-45`); `DEBUG_CAPTURE_VERSION` joins the core. | `FR-BG-05`…`07`, `FR-BG-09`, `D-37` | None |
| C-12 | **App messages** (2.3). A new entry kind `app` (`type`, `level`, `data`) and `session.addMessage(type, data?, level?)`: recorded only while capture is on; `data` by `toJsonSafe` like log args, `type` by `redactFreeText`. `isProblemEntry` is true for `level: 'error'`. | `FR-MSG-01`…`07` | One new entry kind; `schemaVersion` stays 2; readers skip unknown kinds |
| C-6 | **Change events.** `recorder.onChange(listener)` fires on `clear()` (also from v1's `Ctrl+Alt+Shift+X`) and when only stats change (`dropped`, `failed`). The data source maps it to `cleared` / `stats`. | `FR-BAR-03`, `FR-BAR-06` | None |

### 6.6 Using it in a host

From 2.2 (`D-40`, `D-45`) a host loads only the activation piece at start. Two ways switch it on:

- **`?debug=1`** (or `?debug=true`) in the URL — this page load only, captured from its very
  start;
- **the activation chord** (`Ctrl+Alt+Shift+A`) — remembered on this browser, so every later
  load starts capturing with the page; the chord again turns it off for good (also a
  `?debug=1` page, for that load).

```ts
// main.ts (Angular) or index.tsx (React) — same for both, before bootstrap
import { installDebugActivation } from 'debug-capture/activate';  // the only piece loaded at start

// With ?debug=1 or the stored flag it starts now, with the page; otherwise the chord starts it.
// Capture and the panel load then (import()); the panel stays closed, the DBG button hidden.
const debug = installDebugActivation();
// Wait before bootstrap, so a page switched on at start records its startup requests too.
debug.ready.then(() => bootstrap());
```

Plain HTML page, no bundler (prebuilt files from `dist/`):

```html
<script type="module">
  import { installDebugActivation } from './vendor/debug-capture/activate.mjs';
  window.debugReady = installDebugActivation().ready;  // the page's own code awaits it before its first request
</script>
```

The seams take a function, read on each error, because the session may start after
bootstrap (`FR-BG-10`): Angular `provideDebugCapture()` + `provideDebugCaptureSession(() => debug.session)`
(platform providers); React `createReactRootErrorOptions(() => debug.session)`. They still
take a session (or `null`) as in v1. A host that wants capture without activation keeps
calling `createCaptureController()` and `installDebugPanel(controller)` directly (§6.4).

### 6.7 Isolation rules (from tested research)

These are copied from `docs/research/host-impact-edge-cases.md` §1 (where each
has its evidence, severity and test). Short form:

| ID | Rule |
|---|---|
| ISO-01 | **One** host element, mounted once on `<html>` (after `<body>`) by `installDebugPanel()`. Its shadow root holds the launcher and, from first open, the panel UI ("lazy" applies to the UI, not the host element). The host element covers the **whole viewport** with `pointer-events: none !important`; only the launcher and the panel root take `pointer-events: auto`, so the page stays clickable around them and the host element never needs resizing (`ISO-15`). This departs from research rule 2 (`pointer-events: auto` on the host). Shown in the top layer (`popover="manual"`); fallback `position: fixed` + max `z-index`. Never inside a framework root. |
| ISO-02 | Lock the host element: `:host { all: initial !important; … }`, every `:host` declaration `!important`; `contain: strict`. |
| ISO-03 | Set every inherited value on an inner root; **px** sizes; system fonts; `direction: ltr`. |
| ISO-04 | CSP/Trusted-Types-safe DOM: `adoptedStyleSheets` only; `el.style.x =` only; no HTML strings; captured data as text only; no `href`/`src` from data. |
| ISO-05 | Nothing global: `--dcp-` tokens on the inner root; no `@property`, `@font-face`, `part`, document stylesheets. A host `@property` on a `--dcp-*` name is out of scope (D-23). |
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
| ISO-16 | Focus: never steal focus on automatic open; return focus on close; no focus trap. When closed, the **inner panel root** (never the host element, which also holds the launcher) is `hidden` + `inert`. |
| ISO-17 | A11y: `role="dialog"` `aria-modal="false"`, `aria-label`, `lang="en"`, `dir="ltr"`; no `aria-live` on rows; reduced motion; forced colours. |
| ISO-18 | Bidi-safe data cells. |
| ISO-19 | Drag/resize with pointer capture on our element; no document-level move listeners. |
| ISO-20 | Survive removal: clean up on disconnect, remount on next open; no MutationObserver fights. |
| ISO-21 | Document the limits (host modal **and fullscreen** — Chrome makes the panel unclickable and unfocusable while either is open, `D-15`; `inert`; host capture-phase listeners). |
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
| Language target | ES2020, `lib: es2020, dom`. The browser is Chrome 146+ (`NFR-COMP-01`); raising the target is a separate decision. | Proposed |
| Build | Plain `tsc` → ESM + `.d.ts` per entry point (needs `C-4`); esbuild → prebuilt `dist/*.mjs` per entry, the UI as a separate chunk | Proposed `D-09` |
| Lint | ESLint + typescript-eslint: `no-explicit-any`, `no-console` (with the listed exceptions), no `innerHTML`-family, no `Date.now()` outside the clock | Proposed |
| Format | Prettier, single quotes, 2 spaces | Proposed |
| Layers | `check-layers.js` from v1, re-rooted for the package, plus P1–P5 | Proposed |
| End-to-end, perf, hostile host | Playwright with the installed Chromium; hosts: Angular (this app), React 19, plain HTML | Proposed |
| Contrast | `contrast-check.mjs` reads the token table and fails under 4.5:1 / 3:1 | Proposed |
| Size | A size check on the loader, the UI chunk and the core (`NFR-SIZE-01`) | Proposed |
| `AGENTS.md` | At the package root; the single source for agent rules | Proposed |
| CI | GitHub Actions (`.github/workflows/`): `npm run check` on every pull request and on `main` (`OPEN-06` answered) | Decided |

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
| **S-00 Foundation** | Tooling (§7.2), `AGENTS.md`, layer checker for the package, size baseline. **Contracts fixed for the parallel wave:** `PanelDataSource`, `PanelDataEvent`, `PendingRequest`, `CaptureController`, `recorder.onChange`, `isProblemEntry` signature, `mountPanelUi`, panel options. Core change C-4, mockup | — |
| **S-01 Core changes** | C-1 pending requests, C-2 controller (one recorder, stable session, socket ids), C-3 policy, C-5 copy/download spike, C-6 change events, C-7 capped-body flag, C-8 problem rule | S-00 |
| **S-02 Panel loader** | P5 loader: element, mount, top layer, lockdown, event wall, zone, toggle, launcher (+ badge), lazy chunk load, open/close and focus return. A placeholder P4 `mountPanelUi` (an empty panel root with a close button) so the lazy path is real end to end. Hostile-host fixture | S-00 |
| **S-03 Panel model** | P1: local data source (incl. download/copy pass-through), store, batching contract, selectors, filters, formatting, cURL | S-00 |
| **S-04 UI building blocks** | P2: safe DOM builder, virtual list (bidi-safe), JSON viewer (paged), split pane, tabs, chips, empty/no-match block, icons, theme sheet + contrast check | S-00 |
| **S-05 Network › HTTP** | P3 list (start order, column sorting — `D-18`) + detail sub-tabs + copy | S-02, S-03, S-04 (S-01 for pending) |
| **S-06 Network › WebSocket** | P3 connections + messages + detail | S-02, S-03, S-04 |
| **S-07 Console** | P3 list + detail + stacks | S-02, S-03, S-04 |
| **S-08 Frame, toolbar and status** | P4 app frame (replaces S-02's placeholder): title bar, top tabs and Network sub-tab routing, resize/dock/maximize, scheduler (rAF batching), settings storage, banners. Toolbar: pause/follow, clear, export/copy, capture on/off. Status bar, settings popover, states. Fullscreen re-raise (`FR-WIN-07`, `D-15`) needs a loader change: one `fullscreenchange` listener also while closed (update S02-07; the loader has ~55 B of budget left) | S-02, S-03, S-04, S-01 |
| **S-09 Accessibility** | Keyboard map, focus, forced colours, reduced motion | S-05 … S-08 |
| **S-10 Integration and verification** | Angular + React + plain hosts, end-to-end, performance, security, packaging (`npm pack`), README | all |
| **S-11 v2.1 panel features** | Buffer size in Settings incl. "No limit" (`D-28`); buffer-near-full banner (`D-29`); memory warning (`D-30`); status observer (`D-31`); "Show DBG button" setting (`D-32`); user notes (`D-33`); budgets (`D-34`). HLD requirement rows first, in S-11's own spec | S-10 |
| **S-13 Background control** | Activation shortcut on top of `?debug=1`, remembered per browser, hidden DBG button (`D-40`, `D-41`); chords for capture on/off and a pre-defined note, live while capture is off (`D-37`, `D-38`, `C-11`); save to a folder by Chrome policy (`D-39`); About in Settings (`D-42`); budgets (`D-43`). Before S-12 (`D-44`) | S-11 |
| **S-14 Custom messages** | The host sends its own messages (type, level, JSON data) through a handle; buffer, Console (App chip), export; dropped while off (`D-46`, `C-12`). Before S-12 (`D-47`) | S-13 |
| ~~S-12 AI add-on~~ | **Moved out** (`D-48`): the AI assistant is a separate product, the Chrome extension `devtools-ai-assistant` in its own repository. Nothing about AI is built in this package. | — |

### 9.2 Waves

```
Wave 1:  S-00
Wave 2:  S-01 ║ S-02 ║ S-03 ║ S-04            (parallel — they code against the S-00 contract)
Wave 3:  S-05 ║ S-06 ║ S-07 ║ S-08            (parallel — one view each, plus the frame; a small contract PR first fixes the view interface the frame mounts)
Wave 4:  S-09 ─► S-10                         (sequential — S-09 touches every view, after wave 3 is merged)
Wave 5:  S-11 ─► S-13 ─► S-14                 (v2.1, after 2.0 is closed by S-10b — owner, 2026-10-25;
                                               S-13, S-14 — owner, 2026-10-26, D-44, D-47;
                                               S-12 moved out to its own product, D-48)
```

Every wave ends with the merged branch verified as a whole, and the security-
or hot-path-heavy specs (S-01, S-02, S-04, S-08) get a fresh-context review.

### 9.3 Traceability — who owns each requirement

Each spec lists the exact IDs it covers and the test for each. S-10 checks
end to end that every `MUST` is covered.

| Requirements | Owner spec(s) |
|---|---|
| BR-01…07 | S-10 (verified end to end) |
| FR-ACT-01, 02, 03, 04, 05, 06, 07 | S-02 (badge rule `isProblemEntry` from S-01) |
| FR-ACT-08 | S-08 (settings storage) |
| FR-ACT-09 | S-01 (controller) + S-08 (banner and switch) |
| FR-WIN-01, 05 | S-02 (overlay, close) |
| FR-WIN-02, 03, 04, 06, 07 | S-08 (dock, resize, maximize, tabs, host-modal banner) |
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
| NFR-PERF-02, 03, 04, 06 | S-08 (scheduler) + S-03 + S-04 (built), S-10 (measured) |
| NFR-SIZE-01 | S-00 (baseline and check), S-10 (final) |
| NFR-SEC-01…04 | S-04 (safe builder), S-05 (cURL, copy), S-06 (copy), S-08 (export), S-10 (CSP page) |
| NFR-REL-01 | S-02 + every spec (lint rule, guard) |
| NFR-A11Y-01 | S-04 (contrast), S-09 (the rest) |
| NFR-I18N-01 | S-04 (bidi-safe cells) |
| NFR-COMP-01 | S-02 (fallbacks), S-10 (old-Chromium run if one is available) |
| NFR-COMP-02 | S-02 |
| NFR-PORT-01 | S-10 (three hosts, `dist/` build from S-00) |
| FR-BUF-01…05, FR-STAT-01, FR-ACT-10, FR-NOTE-01…04 (2.1) | S-11 (core `C-9`, `C-10` in S-11a; panel in S-11b) |
| FR-MSG-01…08 (2.3) | S-14 (core `C-12` and the activation handle in S-14a; panel handle and Console in S-14b; the app in S-14c) |
| FR-BG-01…10 (2.2), BR-02 (2.2), NFR-SIZE-01 (2.2) | S-13 (core `C-11`, activation, seams in S-13a; panel About and hidden DBG button in S-13b; the app in S-13c) |

---

## 10. Decisions

**Decided** = agreed with the owner. **Proposed** = my recommendation; the
owner confirms or changes it before the spec that depends on it starts.

| ID | Decision | Status |
|---|---|---|
| D-01 | The panel is a framework-free Web Component (Shadow DOM), not an Angular or React component. | Decided |
| D-02 | v2 lives in `packages/debug-capture/`, seeded from v1; v1 stays in the host app unchanged. Later its own repository. **Done (2026-10-28):** split out with its history into `izhaq/debug-capture` on GitHub; hosts, the playground app too, install the release tarball from their `vendor/` folder. | Decided — done |
| D-03 | Overlay docked **bottom** by default, **right** as an option; never changes host layout. | Decided |
| D-04 | One shared **JSON tree viewer** for console args, HTTP bodies and WS frames (entries are already JSON-safe, so this is cheap). | Decided |
| D-05 | Show **pending** requests (core change C-1). The export keeps `schemaVersion` 1 with optional new fields; readers ignore unknown fields. | Decided |
| D-06 | Launcher on by default, bottom-right; toggle `Ctrl+Alt+Shift+P`. | Decided |
| D-07 | The launcher's problems badge is the one allowed cost while closed (O(1) per entry, ≤ 1 rAF per frame). | Decided |
| D-08 | Test runner: Karma + Jasmine + esbuild (keeps all v1 specs). | Decided |
| D-09 | Build with plain `tsc`; drop the Angular decorator (C-4). | Decided |
| D-10 | Split the panel into a **loader** (≤ 4 kB, at start: launcher, shortcut, badge) and a **UI chunk** (≤ 40 kB since `D-25`, dynamic `import()` on first open). | Decided |
| D-11 | Element name `debug-capture-panel-v2`; if taken, reuse the existing definition if it is ours, otherwise do nothing and stay silent. | Decided |
| D-12 | **Clear** clears the capture buffer (not just the view), like v1's shortcut. | Decided |
| D-13 | Theme **Auto** by default (dark/light by OS); colours as in §5.4. | Decided |
| D-14 | UI in English; data bidi-safe. Hebrew UI later if needed. | Decided |
| D-15 | **Fullscreen:** the panel and launcher are raised back on top, so they stay visible and live over the fullscreen app (you can watch it beside the app). Chrome makes everything outside a fullscreen element unclickable and unfocusable, as it does for a modal dialog (the fullscreen element matches `:modal`; proven in the S-08 e2e on Chromium 141): while fullscreen the panel can be seen and toggled by the shortcut, not clicked; a banner says so. **Host modal dialog:** the same. The separate window (2.x) is the real fix for both. | Decided |
| D-16 | The panel never blocks the host's capture-phase listeners (doing so breaks the panel's own handlers). | Decided |
| D-17 | **One recorder for the page's life**: capture off/on removes and reinstalls probes on the same recorder (C-2). | Decided |
| D-18 | HTTP list in **start order**, like DevTools; a pending row keeps its place and updates when the request finishes. **Column sorting** by clicking a header (asc / desc / off), plus filters and search. | Decided |
| D-19 | **Pause** freezes rendering only; Clear and evictions still apply; a pending HTTP row already on screen updates in place when it finishes. Export always takes the whole buffer. To stop recording, use the **Capture on/off** switch (`FR-ACT-09`, like DevTools' record button), placed next to Pause in the toolbar. | Decided |
| D-20 | **Not remembered:** capture on/off and filter search text. Remembered: settings, size, dock, last tab, filter chips. The HTTP column sort (`D-18`) is not remembered either: it resets on reload, like the search text. | Decided |
| D-21 | A **problem** (badge, status bar) = error entry, HTTP 5xx or failed, WebSocket error. Not 4xx, not `console.error`. From 2.3 also an app message with level `error` (`FR-MSG-06`). | Decided |
| D-22 | The 2,000-node budget holds up to a 1,080 px panel; above that the list draws every visible row (~23 nodes each) rather than leaving rows blank. Views keep rows lean (text cells, one icon). Found in the S-04 review. | Decided |
| D-23 | A host page that registers a `--dcp-*` name with `@property` is out of scope (research S4): the theme keeps CSS variables. Only the loader, which must always be visible, uses literal colours. | Decided |
| D-24 | The **Launcher Show / Hide** setting moves to 2.x: remembering "Hide" would make the always-loaded loader read storage at start (loader bytes, `NFR-SIZE-01`). In 2.0 a host turns the launcher off with the `launcher: false` option; the shortcut always works. | Decided for 2.0; **superseded in 2.1 by `D-32`** |
| D-25 | The **UI chunk** budget is **40 kB** min+gzip (was 25 kB). Measured before wave 3: 22,695 B with only the model and the UI blocks (no views, no frame); wave 3 is estimated at +13–15 kB. The chunk loads once, on first open, from the local network; the host's start cost (the 4 kB loader) does not change. | Decided |
| D-26 | The **WebSocket message detail has `Copy ▾`** (message, URL — `FR-WS-06`), as in the mockup (owner, 2026-10-22). Copy and export stay explicit user actions (`NFR-SEC-04`). | Decided |
| D-27 | **Order after 2.0** (owner, 2026-10-25): S-10b closes 2.0; then **S-11** (v2.1 panel features, `D-28`…`D-34`); then **S-12** (the AI add-on, `D-35`). | Decided |
| D-28 | **Buffer size in Settings**, changed live, remembered per browser: default 5,000 (the policy's `maxEntries`); a few sizes plus **No limit**, which shows a warning that the page may get slow and use a lot of memory. A smaller size drops the oldest entries at once. Needs a core change: the recorder can change its capacity (keeps `seq`, `C-2`). | Decided (owner, 2026-10-25); size list (1,000 · 5,000 · 10,000 · 50,000 · No limit) set in S-11, `FR-BUF-01` |
| D-29 | **Buffer-near-full banner**: when the buffer reaches a threshold (default **90 %**, configurable in code), a banner says the oldest entries will soon be dropped and offers **Download all** and **Raise the limit**. Shown once per crossing; again after Clear or a size change. The buffer never clears itself: when full it drops the oldest entry for each new one (§4.4). | Decided (owner, 2026-10-25) |
| D-30 | **Memory warning**, repeating: the panel estimates the size of what the recorder stores (string lengths × 2 B plus a fixed cost per entry — the browser cannot measure the memory of given objects) and warns each time it passes another step (default **25 MB**, configurable in code). | Decided (owner, 2026-10-25); formula set in S-11: 160 B + 2 B per character, per entry (`C-9`) |
| D-31 | **Status observer** for the host app, optional: `handle.onStatus(listener)` → unsubscribe, with open / closed, capture on / off, entry count and capacity, problem count, and the `D-29` / `D-30` warnings. Listener errors are caught (`ISO-12`). | Decided (owner, 2026-10-25); shape set in S-11 (`DebugPanelStatus`, §6.4) |
| D-32 | **Shortcut stays code only** (`shortcut` option). **Settings gets "Show DBG button"**, remembered per browser — this replaces `D-24` for 2.1. The code option `launcher` is the default; `launcher: false` in code also hides the switch, so the host's choice wins. The loader then reads storage at start, so it needs loader bytes (`D-34`). | Decided (owner, 2026-10-25; code-wins accepted with #99) |
| D-33 | **User notes**: an **Add note** action (title + text) records a new entry kind `note` at that moment; it shows in Console and in the export. The file keeps entries as a list, so equal titles never clash (no `title_date` key needed). `schemaVersion` stays 1 (additive); a reader that does not know `note` skips it. A host can also add one from code. | Decided (owner, 2026-10-25); details in `FR-NOTE-01`…`04`, `C-10` |
| D-34 | **Budgets for 2.1**: the owner allows raising the **UI chunk** budget (40 kB, `D-25`). The new value is set in S-11 from a measurement (several times above the measured size growth, as the margin rule). The **loader** (4 kB, 12 B left) also needs a raise for `D-31` / `D-32`; S-11 proposes the number. | Decided (owner, 2026-10-25; the loader raise accepted with #99). Set in S-11b: loader 5.5 kB, UI chunk 44 kB (`NFR-SIZE-01`) |
| D-35 | **AI as a separate package** `debug-capture-ai`, in the same family as the panel. Without it nothing about AI is shown or shipped. With it, the host adds it in code and the panel shows an **AI** section. The user connects it to a **local or company on-prem model** by entering its **URL and a token** in the AI settings. Only this package makes network requests — only to that URL and only on a user action; the panel itself keeps `NFR-SEC-03`. It sends only what the recorder stored (redacted) plus a trimmed page snapshot. Phase 1: read-only insights. Phase 2: it **proposes** DOM / style changes; the user clicks **Apply**, with **Undo**; it never runs code (CSP and Trusted Types stay intact). The host's CSP must allow the model URL in `connect-src`. | **Superseded by `D-48`** (owner, 2026-10-26) |
| D-36 | **Readable export** (owner, 2026-10-26): in the exported file each entry leads with **`sequence`** (its `seq`, renamed in the file only) and **`time`** — `t` as the station's local wall-clock time with its UTC offset (`2026-10-25T15:08:56.618+03:00`, exact: it parses back to `t`). `t` stays. Pending requests get `time` too. Because a field was renamed, the file is **`schemaVersion` 2**. The code API keeps `seq` (`CaptureEntry`, `recorder.snapshot()`), so host code does not change. Supersedes the "schemaVersion stays 1" notes in `D-05`, `D-33`. | Decided |
| D-37 | **Background chords** (owner, 2026-10-26): a chord turns **capture on / off** — default `Ctrl+Alt+Shift+S` — and must work while capture is off, so the controller binds all its chords (download, copy, clear, record, note) for its whole life; capture off removes only the probes (`C-11`; changes `FR-ACT-09` and §4.12). **Clear** stays `Ctrl+Alt+Shift+X`; **copy to the clipboard** stays `Ctrl+Alt+Shift+C` and works with the panel closed. Defaults were checked: `A`, `S` and `M` are used by no other chord (panel `P`; v1 and core `D` `C` `X`) and no in-panel key (§4.12). If Alt is missed, Chrome's `Ctrl+Shift+A` (tab search), `Ctrl+Shift+S` (nothing) and `Ctrl+Shift+M` (profile menu) are harmless; `R` (`Ctrl+Shift+R` hard-reloads, losing the buffer) and `N` (`Ctrl+Shift+N` opens an incognito window) were rejected for that reason. | Decided |
| D-38 | **Pre-defined note by a chord** (owner, 2026-10-26): `Ctrl+Alt+Shift+M` ("mark") adds a note whose title and text are set in code (`note` option of `createCaptureController`; defaults `Mark` and `Added with the keyboard shortcut.`); stamped at the key press, like `FR-NOTE-01`. | Decided |
| D-39 | **Save to a pre-defined folder through Chrome policy, no new code** (owner, 2026-10-26): the download chord (`Ctrl+Alt+Shift+D`) downloads; IT sets `DownloadDirectory` (the folder) and `PromptForDownloadLocation` = false on the stations, so the file lands there with no dialog. Documented in the user README and the app guide (also: `DownloadRestrictions` must allow it, and `AutomaticDownloadsAllowedForUrls` with the app's origin avoids Chrome's "download multiple files" question on a second save). | Decided |
| D-40 | **Activation shortcut** (owner, 2026-10-26): a new entry `debug-capture/activate` is the only always-present piece — one `keydown` listener and one read of the flags (URL and stored). Its chord (default `Ctrl+Alt+Shift+A`) loads the core and the panel with dynamic `import()` and starts capture with the panel closed. It is **remembered on this browser** (`localStorage` key `debug-capture` = `1`, the key 2.0 already read), so after a reload capture starts with the page and records startup requests. Pressing it again turns it off for good: the flag is removed, capture and panel are disposed. Changes `BR-02` and §6.6; the URL switch stays (`D-45`). The framework seams take a function that returns the session, so the Angular `ErrorHandler` finds a session that starts after bootstrap (`FR-BG-10`). Security: anyone at the station who knows the chord can switch it on — see `OPEN-05`. | Decided |
| D-41 | **No visible sign after activation** (S-13 proposal under the owner's rule "no visible sign"): the panel loader gets `launcher: 'hidden'` — the DBG button exists but is hidden until the user picks **Show** in Settings › DBG button (remembered, `D-32`); the toggle chord opens the panel. Not `launcher: false`, which would also remove the Settings switch. The host can override it through the `panel` option. **Except on a `?debug=1` page** (owner, 2026-10-26, after S-13): there someone asked for the tool in the URL, so the DBG button shows (`launcher: true`; a stored Hide still wins). A later chord switch-on in the same page uses the chord's rule. | Decided (S-13 docs PR; the `?debug=1` exception by the owner, 2026-10-26) |
| D-42 | **About in Settings** (owner, 2026-10-26): the Settings popover ends with About — the package version (`DEBUG_CAPTURE_VERSION`, checked against `package.json` by the build) and every shortcut with the chord actually configured: activation, panel toggle, download, copy, clear, capture on / off, note, and the in-panel keys (§4.12). | Decided |
| D-43 | **Budgets for 2.2** (owner, 2026-10-26): the core budget rises from v1 + 2 kB to **v1 + 3.5 kB** (13,904 B, `NFR-SIZE-01`). The activation piece is a new entry in `scripts/size-budgets.json` with its own small budget, set in S-13a from a measurement (margin rule as `D-34`). Loader 5.5 kB and UI chunk 44 kB stay; raising them needs the owner. | Decided |
| D-44 | **S-13 before S-12** (owner, 2026-10-26): background control (S-13) ships as release 2.2 before the AI add-on (S-12). | Decided |
| D-45 | **Keep `?debug=1`** (owner, 2026-10-26, a scope change during S-13): the URL flag (`?debug=1` / `?debug=true`) stays, beside the shortcut. With the shortcut alone nothing is recorded until someone presses it, so a fresh browser's first load (its startup requests) would be lost; the URL flag captures from the very start. `isDebugRequested()` keeps reading the URL and the stored flag; the activation piece reads both too. The URL flag is one page load and never writes the stored flag. **The activation chord also turns off a session started by `?debug=1`**, for the current page (S-13 proposal, accepted with the scope change): the user who pressed it wants it off now; the next load follows the URL again. | Decided |
| D-46 | **Custom messages from the host** (owner, 2026-10-26): the host app sends its own messages through a handle — a **type** name, a **level** (`info` · `warn` · `error`) and any **JSON data** — kept in the buffer and exported. Messages sent while the tool is off are **dropped** (no queue in the always-loaded piece). They show in **Console** with an **App** chip. Level `error` counts as a **problem**. | Decided (owner, 2026-10-26; the four choices were the S-14 proposals) |
| D-47 | **S-14 before S-12** (owner, 2026-10-26). | Decided |
| D-48 | **The AI assistant is its own product, not part of the panel** (owner, 2026-10-26). The goal is Chrome's built-in AI assistance without sign-in and without Google's cloud, for **developers on the corporate network**, talking to a model the user chooses: an OpenAI-compatible API (on-prem servers such as vLLM or Ollama, or online) or Anthropic's API. The debug panel runs on air-gapped stations that cannot reach the on-prem model, so it is the wrong home. It becomes a **self-hosted Chrome extension** (a DevTools panel and a side panel) that each developer installs if they want, in its own repository **`izhaq/devtools-ai-assistant`**: chat about the page and the selected element (explain, find problems, suggest CSS / code) and apply changes to the page with Undo. It has its own HLD there. This package keeps `NFR-SEC-03` (no network) with no exception. Supersedes `D-35`; closes `OPEN-07` and `OPEN-08` here (they move to that repository). | Decided |

---

## 11. Open questions

| ID | Question | Why it matters | Who |
|---|---|---|---|
| OPEN-01 | ~~Which Chrome / Edge versions run on the stations?~~ **Answered (owner, 2026-10-18): Chrome 146.0.7680.72 and later only; Edge is not supported.** | `NFR-COMP-01` updated; the pre-114 fallbacks are removed. | Owner — answered |
| OPEN-02 | How strict is the host apps' CSP in production (Trusted Types, `style-src`)? | Confirms `NFR-SEC-02` matters in practice. | Owner — pilot |
| OPEN-03 | What does `bdi_W` do for rules, lint, CI, agents, structure? | Updates §7. Needs a session that can reach it. | Owner |
| OPEN-04 | Do the copy fallback and the download link work from inside the panel's shadow root in the station browser? | `C-5`; otherwise copy or download from the panel adds a node to `<body>` for a moment. | S-01 spike |
| OPEN-05 | Is "flag on" enough of a gate in production, or should opening the panel need more (a PIN, an allow-list of stations)? From 2.2 (`D-40`) the gate is a chord: **anyone at the station who knows it** can switch capture on (and it stays on for that browser) and open the panel. Mitigations available today: a less obvious chord in code (`shortcut` option), or `shortcut: false` with the flag set by IT only. | Who can see captured data on a station. | Owner / security |
| OPEN-06 | ~~Where will the v2 repository live: GitHub or Azure DevOps?~~ **Answered (owner, 2026-10-28): GitHub, `izhaq/debug-capture`**; CI is GitHub Actions (§7.2). | CI system and pipeline format. | Owner — answered |
| OPEN-07 | ~~Where does the AI add-on keep the model token: in memory for the page session only (safest; asked again after a reload), or remembered in `localStorage` (easier, but any script on the page can read it)? Proposed: memory only, with an opt-in "Remember on this browser".~~ **Moved** to `devtools-ai-assistant` (`D-48`). | The token is a secret on a shared station. | Closed here |
| OPEN-08 | ~~Which API do the local / on-prem models speak? Proposed: the OpenAI-compatible chat API (`POST /v1/chat/completions`, `Authorization: Bearer <token>`), which vLLM, Ollama and most on-prem servers offer.~~ **Moved** to `devtools-ai-assistant` (`D-48`). | The add-on's one network call. | Closed here |

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
- Host-app PRs #34–#51 (branch `claude/air-gapped-debug-logging-zkn1nr` of
  `izhaq/angular-13-playground`; v2 PRs up to #116 are there too, before the move).
