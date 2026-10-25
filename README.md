# debug-capture

An on-screen debug panel for web apps that run where browser DevTools are not
available (air-gapped stations). It records HTTP requests, WebSocket traffic,
console output and errors, and shows them live in a panel that floats over
your app — like DevTools, inside the page.

- **Off by default.** Nothing is patched until a flag turns it on.
- **Works in any app:** Angular (16 to 20), React 19, or a plain HTML page with no bundler.
- **No runtime dependencies.** Everything ships in one tarball you can carry into
  a closed network.
- **Small:** the loader is about 4 kB (min + gzip). The panel UI (about 39 kB)
  loads only the first time someone opens the panel.
- **Chrome 146 or newer** only.

## Turn it on

Capture runs only when the station or page asks for it:

| How                                                         | For                             |
| ----------------------------------------------------------- | ------------------------------- |
| `?debug=1` (or `?debug=true`) in the page URL               | one page load                   |
| `localStorage.setItem('debug-capture', '1')` in the browser | every page load in that browser |

Then press **`Ctrl+Alt+Shift+P`** or click the **DBG** button in the corner to
open the panel. Remove the flag (and reload) to turn it off again.

## Install

The package ships as one file. Build it once on a machine with access to the
source, carry the tarball in, and install it like any other package:

```bash
npm install ./debug-capture-2.0.0-alpha.1.tgz
```

ESM only, with type declarations. Entry points:

| Import                  | What                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `debug-capture`         | the recorder: `createCaptureController`, `isDebugRequested`, policies, types |
| `debug-capture/panel`   | the panel loader: `installDebugPanel`                                        |
| `debug-capture/angular` | Angular providers (`@angular/core` 16–20 as a peer)                          |
| `debug-capture/react`   | React root error options (no React import of its own)                        |

Each entry is a prebuilt file in `dist/` (`index.mjs`, `panel.mjs`, `angular.mjs`,
`react.mjs`). TypeScript resolves the types with `moduleResolution` `node`,
`bundler`, `node16` or `nodenext`.

## Add it to your app

Start capture **before** your app starts, so its first requests are recorded.
The same two lines work in every host:

```ts
import { createCaptureController, isDebugRequested } from 'debug-capture';
import { installDebugPanel } from 'debug-capture/panel';

const controller = isDebugRequested() ? createCaptureController() : null; // installs capture now
installDebugPanel(controller); // launcher + shortcut; the UI loads on first open (null → does nothing)
```

With the flag off, `controller` is `null` and `installDebugPanel` does nothing.
To skip even the 4 kB loader when the flag is off, `import()` it inside the `if`.

The examples below are the test hosts in `test/hosts/`; an end-to-end test
runs each of them (`test/e2e/hosts.spec.mjs`).

### Angular (16 to 20; tested on 16.2)

Add the two providers, so errors Angular catches itself are recorded too:

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { createCaptureController, isDebugRequested } from 'debug-capture';
import { provideDebugCapture, provideDebugCaptureSession } from 'debug-capture/angular';
import { installDebugPanel } from 'debug-capture/panel';
import { AppComponent } from './app/app.component';

const controller = isDebugRequested() ? createCaptureController() : null;
installDebugPanel(controller);

bootstrapApplication(AppComponent, {
  providers: [provideDebugCapture(), provideDebugCaptureSession(controller?.session ?? null)],
});
```

With an `NgModule` app, pass `provideDebugCaptureSession(…)` to
`platformBrowserDynamic([…])` and put `provideDebugCapture()` in the root
module's `providers`. The panel runs outside Angular's zone: it causes no change
detection.

### React (19)

Give the root the error options, so errors React catches (error boundaries,
uncaught render errors) are recorded:

```ts
// main.tsx
import { createRoot } from 'react-dom/client';
import { createCaptureController, isDebugRequested } from 'debug-capture';
import { installDebugPanel } from 'debug-capture/panel';
import { createReactRootErrorOptions } from 'debug-capture/react';
import { App } from './App';

const controller = isDebugRequested() ? createCaptureController() : null;
installDebugPanel(controller);

createRoot(document.getElementById('root')!, createReactRootErrorOptions(controller?.session ?? null)).render(<App />);
```

`createReactRootErrorOptions(session, next)` also takes your own
`onCaughtError` / `onUncaughtError` / `onRecoverableError`; it calls them after
recording.

### Plain HTML page (no bundler)

Copy the package's `dist/` folder next to your page (here as
`vendor/debug-capture/`) and load it with a module script:

```html
<script type="module">
  import { createCaptureController, isDebugRequested } from './vendor/debug-capture/index.mjs';
  import { installDebugPanel } from './vendor/debug-capture/panel.mjs';
  if (isDebugRequested()) installDebugPanel(createCaptureController());
</script>
```

Put it before your own scripts, so capture is on before they run.

## Options

`installDebugPanel(controller, options)`:

| Option        | Default                 | What                                                                                 |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `launcher`    | `true`                  | Show the DBG button in the corner. `false` hides it; the shortcut still works.       |
| `shortcut`    | `'ctrl+alt+shift+p'`    | The open / close chord, matched on the physical key. `false` binds none.             |
| `defaultDock` | `'bottom'`              | Where the panel opens the first time: `'bottom'` or `'right'`.                       |
| `storageKey`  | `'debug-capture:panel'` | `localStorage` key for the panel's settings and filter chips. `false` keeps nothing. |

It returns a handle: `open()` (for your own menu item or button — the panel
never opens by itself), `close()`, `isOpen`, `loadError` (why the UI failed to
load, if it did) and `dispose()`.

`createCaptureController(options)`:

| Option                  | What                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `policy.maxEntries`     | Entries kept (default 5,000); the oldest go first.                                                                               |
| `policy.maxBodyLength`  | Longer bodies, messages and stacks are cut, with a marker (default 32,768 characters).                                           |
| `policy.redactHeaders`  | Header names whose values are hidden (default: `authorization`, `cookie`, `set-cookie`, `x-api-key` and other auth headers).     |
| `policy.redactJsonKeys` | Secret key names hidden in bodies, frames, logs and URL parameters (default: `password`, `token`, `secret`, `apikey`, and more). |
| `policy.redactBodyUrls` | URLs (`RegExp`) whose bodies are hidden whole.                                                                                   |
| `policy.ignoreUrls`     | URLs (`RegExp`) not recorded at all.                                                                                             |
| `shortcuts`             | The capture shortcuts below; `false` binds none.                                                                                 |

## Using the panel

- **Network › HTTP:** every `fetch` and XHR in start order, pending ones too.
  Sort by a column, filter by status or type, search. Open a row for headers,
  body (as a JSON tree when it is JSON), timing and **Copy as cURL**.
- **Network › WebSocket:** each connection and its messages, text or binary.
- **Console:** logs at every level, uncaught errors, unhandled rejections and
  the errors your framework catches, with their stacks.
- **Toolbar:** pause the view, clear, export (**Download all (JSON)** or
  **Copy all (JSON)**), and switch capture off and on.
- Dock bottom or right, resize, maximize. Settings are remembered per browser.

The exported file is plain JSON (`schemaVersion` 1, the same format as v1): you
can read it without the panel.

### Keyboard

| Keys                                     | Where     | Action                                                              |
| ---------------------------------------- | --------- | ------------------------------------------------------------------- |
| `Ctrl+Alt+Shift+P`                       | anywhere  | Open / close the panel                                              |
| `Ctrl+Alt+Shift+D` / `C` / `X`           | anywhere  | Download / copy / clear the capture (inactive while capture is off) |
| `Escape`                                 | panel     | Close the innermost thing: a menu, else the detail, else the panel  |
| `↑` `↓` `Home` `End` `PageUp` `PageDown` | list      | Move the selection                                                  |
| `Enter`                                  | list      | Open the detail                                                     |
| `Ctrl+F`                                 | panel     | Focus the filter box                                                |
| `Alt+1` / `Alt+2`                        | panel     | Network / Console                                                   |
| `←` `→`                                  | tab bar   | Move between tabs                                                   |
| `←` `→` `Enter` `Space`                  | JSON tree | Collapse / expand                                                   |

Keys pressed inside the panel never reach your app, except the chords above.

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
