# debug-capture

An on-screen debug panel for web apps that run where browser DevTools are not
available (air-gapped stations). It records HTTP requests, WebSocket traffic,
console output and errors, and shows them live in a panel that floats over
your app — like DevTools, inside the page.

- **Off by default.** Nothing is patched until `?debug=1` or a keyboard shortcut turns it on.
- **Works in any app:** Angular (16 to 20), React 19, or a plain HTML page with no bundler.
- **No runtime dependencies.** Everything ships in one tarball you can carry into
  a closed network.
- **Small:** before it is turned on, a page loads only a 1.1 kB activation piece
  (min + gzip). Capture and the 4.7 kB panel loader come when it is turned on; the
  panel UI (about 40 kB) only the first time someone opens the panel.
- **Chrome 146 or newer** only.

## Turn it on

Two ways, both work the same on every host:

| How                                              | For                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `?debug=1` (or `?debug=true`) in the page URL    | this page load only, recorded from its very start                 |
| **`Ctrl+Alt+Shift+A`** (the activation shortcut) | this browser, from now on: every later page load starts capturing |

The shortcut works on any page that has the package, with no visible sign:
capture starts, the panel stays closed and the DBG button stays hidden. It is
remembered in this browser (`localStorage` key `debug-capture` = `1`), so after
a reload capture starts with the page and records its first requests. Press
**`Ctrl+Alt+Shift+A`** again to turn it off for good: capture stops, the panel
goes and the browser forgets it. (On a `?debug=1` page this turns it off for
that page; the next load follows the URL again.)

Once it is on, press **`Ctrl+Alt+Shift+P`** to open the panel. Every other
shortcut is under [Keyboard](#keyboard), and in the panel under **Settings ›
About**.

## Install

The package ships as one file. Build it once on a machine with access to the
source, carry the tarball in, and install it like any other package:

```bash
npm install ./debug-capture-2.2.0-alpha.0.tgz
```

ESM only, with type declarations. Entry points:

| Import                   | What                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `debug-capture/activate` | the activation piece: `installDebugActivation` — the only part loaded before it is on |
| `debug-capture`          | the recorder: `createCaptureController`, `isDebugRequested`, policies, types          |
| `debug-capture/panel`    | the panel loader: `installDebugPanel`                                                 |
| `debug-capture/angular`  | Angular providers (`@angular/core` 16–20 as a peer)                                   |
| `debug-capture/react`    | React root error options (no React import of its own)                                 |

Each entry is a prebuilt file in `dist/` (`activate.mjs`, `index.mjs`, `panel.mjs`,
`angular.mjs`, `react.mjs`). TypeScript resolves the types with `moduleResolution` `node`,
`bundler`, `node16` or `nodenext`.

## Add it to your app

Install the activation piece **before** your app starts. It binds the
activation shortcut and reads the flags; when one is set (or the shortcut is
pressed) it loads capture and the panel with `import()`. Wait for `ready`
before you start the app, so a page that starts switched on records its first
requests too:

```ts
import { installDebugActivation } from 'debug-capture/activate';

const debug = installDebugActivation(); // with ?debug=1 or the stored flag, it starts now
debug.ready.then(() => startYourApp()); // never rejects; at once when it is off
```

Your framework's error seam takes a function, `() => debug.session`, because
the session may start after your app did.

The examples below are the test hosts in `test/hosts/`; end-to-end tests run
each of them (`test/e2e/hosts.spec.mjs`, `test/e2e/background.spec.mjs`).

### Angular (16 to 20; tested on 16.2)

Add the two providers, so errors Angular catches itself are recorded too:

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { installDebugActivation } from 'debug-capture/activate';
import { provideDebugCapture, provideDebugCaptureSession } from 'debug-capture/angular';
import { AppComponent } from './app/app.component';

const debug = installDebugActivation();

debug.ready.then(() =>
  bootstrapApplication(AppComponent, {
    providers: [provideDebugCapture(), provideDebugCaptureSession(() => debug.session)],
  }),
);
```

With an `NgModule` app, pass `provideDebugCaptureSession(() => debug.session)` to
`platformBrowserDynamic([…])` and put `provideDebugCapture()` in the root
module's `providers`. The panel runs outside Angular's zone: it causes no change
detection.

### React (19)

Give the root the error options, so errors React catches (error boundaries,
uncaught render errors) are recorded:

```ts
// main.tsx
import { createRoot } from 'react-dom/client';
import { installDebugActivation } from 'debug-capture/activate';
import { createReactRootErrorOptions } from 'debug-capture/react';
import { App } from './App';

const debug = installDebugActivation();

debug.ready.then(() =>
  createRoot(document.getElementById('root')!, createReactRootErrorOptions(() => debug.session)).render(<App />),
);
```

`createReactRootErrorOptions(session, next)` also takes your own
`onCaughtError` / `onUncaughtError` / `onRecoverableError`; it calls them after
recording.

### Plain HTML page (no bundler)

Copy the package's `dist/` folder next to your page (here as
`vendor/debug-capture/`) and load it with a module script:

```html
<script type="module">
  import { installDebugActivation } from './vendor/debug-capture/activate.mjs';
  window.debugReady = installDebugActivation().ready;
</script>
```

Have your own code `await window.debugReady` before its first request.

### Without the activation piece

`createCaptureController()` and `installDebugPanel(controller)` still work on
their own, as in 2.1 (`isDebugRequested()` reads `?debug=1` and the stored flag):

```ts
import { createCaptureController, isDebugRequested } from 'debug-capture';
import { installDebugPanel } from 'debug-capture/panel';

const controller = isDebugRequested() ? createCaptureController() : null;
installDebugPanel(controller); // null → does nothing
```

## Options

`installDebugActivation(options)`:

| Option       | Default              | What                                                                                   |
| ------------ | -------------------- | -------------------------------------------------------------------------------------- |
| `shortcut`   | `'ctrl+alt+shift+a'` | The activation chord, matched on the physical key. `false` binds none (flags only).    |
| `storageKey` | `'debug-capture'`    | Where the shortcut remembers "on" (`'1'`). `false` remembers nothing (this page only). |
| `capture`    | —                    | Options for `createCaptureController` (below).                                         |
| `panel`      | —                    | Options for `installDebugPanel` (below). `false`: capture with no panel.               |

It returns a handle: `active`, `session`, `controller` and `panel` (`null`
until loaded), `loadError`, `ready`, `activate()`, `deactivate()` (as the
shortcut: on and remembered / off for good) and `dispose()`.

`installDebugPanel(controller, options)`:

| Option        | Default                 | What                                                                                                   |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `launcher`    | `true`                  | Show the DBG button in the corner. `false` hides it and the Settings switch; the shortcut still works. |
| `shortcut`    | `'ctrl+alt+shift+p'`    | The open / close chord, matched on the physical key. `false` binds none.                               |
| `defaultDock` | `'bottom'`              | Where the panel opens the first time: `'bottom'` or `'right'`.                                         |
| `storageKey`  | `'debug-capture:panel'` | `localStorage` key for the panel's settings and filter chips. `false` keeps nothing.                   |
| `nearFullAt`  | `0.9`                   | Show the "buffer almost full" banner from this share of the buffer size (above 0, up to 1).            |
| `memoryStep`  | `26214400` (25 MB)      | Show the memory banner each time the size estimate passes another multiple of this many bytes.         |

It returns a handle: `open()` (for your own menu item or button — the panel
never opens by itself), `close()`, `isOpen`, `loadError` (why the UI failed to
load, if it did), `dispose()` and `onStatus(listener)`.

`onStatus(listener)` lets your app watch the panel and the buffer, also while
the panel is closed. It calls `listener` once at once, then after a change (at
most once per frame), and returns a function that stops it:

```ts
const stop = handle.onStatus((s) => {
  // s.open, s.capture, s.entries, s.capacity (Infinity = no limit), s.problems,
  // s.nearFull, s.bytes (an estimate), s.memoryStep (0 below the first step)
});
```

The listener runs outside Angular's zone: wrap UI updates in `NgZone.run`. An
error it throws is caught and ignored.

To add a note from code (it shows in Console and in the export, also while
capture is off): `controller.session.addNote('Login', 'clicked Sign in')`.

`createCaptureController(options)`:

| Option                  | What                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy.maxEntries`     | Entries kept (default 5,000); the oldest go first.                                                                                                                                                          |
| `policy.maxBodyLength`  | Longer bodies, messages and stacks are cut, with a marker (default 32,768 characters).                                                                                                                      |
| `policy.redactHeaders`  | Header names whose values are hidden (default: `authorization`, `cookie`, `set-cookie`, `x-api-key` and other auth headers).                                                                                |
| `policy.redactJsonKeys` | Secret key names hidden in bodies, frames, logs and URL parameters (default: `password`, `token`, `secret`, `apikey`, and more).                                                                            |
| `policy.redactBodyUrls` | URLs (`RegExp`) whose bodies are hidden whole.                                                                                                                                                              |
| `policy.ignoreUrls`     | URLs (`RegExp`) not recorded at all.                                                                                                                                                                        |
| `shortcuts`             | The capture shortcuts: `download`, `copy`, `clear`, `record` (capture on / off) and `note` — see [Keyboard](#keyboard). Give only the ones you change (`{ note: 'ctrl+alt+shift+9' }`); `false` binds none. |
| `note`                  | The note the note shortcut adds: `{ title, text }` (defaults `Mark` and `Added with the keyboard shortcut.`).                                                                                               |

The controller's shortcuts stay bound while capture is off, so they can turn it
back on. `controller.dispose()` stops capture and unbinds them for good.

## Using the panel

- **Network › HTTP:** every `fetch` and XHR in start order, pending ones too.
  Sort by a column, filter by status or type, search. Open a row for headers,
  body (as a JSON tree when it is JSON), timing and **Copy as cURL**.
- **Network › WebSocket:** each connection and its messages, text or binary.
- **Console:** logs at every level, uncaught errors, unhandled rejections and
  the errors your framework catches, with their stacks.
- **Toolbar:** pause the view, clear, export (**Download all (JSON)** or
  **Copy all (JSON)**), switch capture off and on, and **Note** — write a note
  (a title and some text) that lands in Console and in the export at that moment.
- **Settings:** theme, dock, text size, time, **Buffer** (1,000 · 5,000 · 10,000 ·
  50,000 · No limit; a smaller size drops the oldest entries at once; No limit
  may make the page slow and use a lot of memory), **DBG button** (show or hide
  the corner button) and capture on / off. Settings are remembered per browser
  (capture always starts on).
- **Warnings:** a banner when the buffer is almost full (it offers **Download
  all** and **Raise the limit**) and one each time the captured data passes
  another 25 MB (an estimate). Dismiss either; it comes back at the next step.
- Dock bottom or right, resize, maximize.

The exported file is plain JSON (`schemaVersion` 2): you can read it without
the panel. Each entry starts with `sequence` (1, 2, 3… in the order things were
recorded) and `time`, the station's local time with its UTC offset
(`"2026-10-25T15:08:56.618+03:00"`); `t` is the same moment in epoch
milliseconds. For `http` entries the time is when the request started. Notes
are entries with `kind: "note"`, `title` and `text`; a reader that does not
know them can skip them. (Schema 1, before 2.1.0-alpha.2, wrote `seq` and had
no `time`. In code, entries keep `seq`.)

### Keyboard

| Keys                                     | Where     | Action                                                             |
| ---------------------------------------- | --------- | ------------------------------------------------------------------ |
| `Ctrl+Alt+Shift+A`                       | anywhere  | Turn the tool on (remembered); again: off for good                 |
| `Ctrl+Alt+Shift+P`                       | anywhere  | Open / close the panel                                             |
| `Ctrl+Alt+Shift+D`                       | anywhere  | Download the capture as a JSON file                                |
| `Ctrl+Alt+Shift+C`                       | anywhere  | Copy the capture (JSON) to the clipboard                           |
| `Ctrl+Alt+Shift+X`                       | anywhere  | Clear the capture                                                  |
| `Ctrl+Alt+Shift+S`                       | anywhere  | Capture on / off                                                   |
| `Ctrl+Alt+Shift+M`                       | anywhere  | Add the pre-set note (`Mark`)                                      |
| `Escape`                                 | panel     | Close the innermost thing: a menu, else the detail, else the panel |
| `↑` `↓` `Home` `End` `PageUp` `PageDown` | list      | Move the selection                                                 |
| `Enter`                                  | list      | Open the detail                                                    |
| `Ctrl+F`                                 | panel     | Focus the filter box                                               |
| `Alt+1` / `Alt+2`                        | panel     | Network / Console                                                  |
| `←` `→`                                  | tab bar   | Move between tabs                                                  |
| `←` `→` `Enter` `Space`                  | JSON tree | Collapse / expand                                                  |

The `Ctrl+Alt+Shift` shortcuts work with the panel closed, and the capture ones
(`D` `C` `X` `S` `M`) also while capture is off. Every one can be changed in
code (the options above). Keys pressed inside the panel never reach your app,
except these chords.

### Save to a fixed folder (Chrome policy)

`Ctrl+Alt+Shift+D` saves the file through Chrome's normal download. To have it
land in one folder on every station, with no "Save as" dialog, IT sets these
Chrome policies (Group Policy on Windows, or a JSON file in
`/etc/opt/chrome/policies/managed/` on Linux):

| Policy                             | Value                                      | Why                                                       |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `DownloadDirectory`                | the folder, e.g. `D:\debug-captures`       | every download goes there; the user cannot change it      |
| `PromptForDownloadLocation`        | `false`                                    | no dialog                                                 |
| `DownloadRestrictions`             | `0` (or not set)                           | downloads are allowed                                     |
| `AutomaticDownloadsAllowedForUrls` | the app's origin, e.g. `https://app.local` | no "download multiple files?" question on the second save |

Then check `chrome://policy` on a station. Note: `DownloadDirectory` applies to
**every** download in that Chrome, not only this tool's files. To only suggest
the folder, use `DefaultDownloadDirectory` instead. The file is named
`debug-capture-<date>-<time>.json`.

## Safety

- **Secrets are hidden before they are stored.** The panel shows, copies and
  exports only what the recorder kept.
- **Text only.** Captured data never becomes HTML or a link; a body full of HTML
  shows as text. No `innerHTML`, no `eval`.
- **No network.** The panel makes no requests. Copy and export happen only when
  someone clicks.
- **Strict CSP is fine:** works under `default-src 'self'` with no
  `'unsafe-inline'`, and with Trusted Types (`require-trusted-types-for 'script'`).
- **Stays out of your way:** the panel lives in its own shadow root in the top
  layer. Your CSS does not reach it and its CSS does not reach your page. It
  stores only its settings in `localStorage` — never captured data.

## Known limits

- In **fullscreen**, or while your app shows a **modal dialog**, the panel is
  drawn on top and stays live, but it cannot be clicked (a browser rule). It says
  so in a banner. Leave fullscreen or close the dialog to use it.
- A modal dialog inside your app's own **shadow root** is not detected.
- Docked **right** and narrow, the HTTP filter bar cuts off its last chips.
- URL user-info redaction misses URLs with a leading space and protocol-relative
  `//host` URLs.

## Develop

Everything runs from this folder, with its own install (Node
`^20.19.0 || ^22.13.0 || >=24`):

```bash
npm ci
npm run check   # typecheck, lint, layers, format, contrast, unit tests, build, size, pack check, e2e
npm pack        # → debug-capture-<version>.tgz, the file to carry in
```

`npm run e2e` uses the Chromium of the pinned `@playwright/test`; never run
`playwright install` for another version. Rules for people and agents are in
[`AGENTS.md`](AGENTS.md); the design is in [`docs/design/HLD.md`](docs/design/HLD.md);
specs are in [`docs/specs/`](docs/specs/README.md).

v2 was seeded from v1, which lives in the host app at the repository root
(`src/debug-capture/`, as of commit `8fb0a0d`) and keeps working there unchanged.
