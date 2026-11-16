# Choosing how the panel ships

From 2.5, a host app picks one of four ways to ship debug-capture. In all four the tool is
**off** until someone switches it on, and **capture and export work the same**: HTTP (fetch and
XHR), WebSocket, console, errors, notes and the app's own messages, saved as one JSON file. What
changes is whether the on-screen panel exists, and whether its code is in the app at all.

| Option | Panel on screen | Panel code in the app's bundle | Pick it when |
| --- | --- | --- | --- |
| **A. With the panel** | yes, by `Ctrl+Alt+Shift+P` | yes (loaded only when switched on) | your own people debug on the station |
| **B. Headless** | never | **no** | customers must never see it; you only want the file |
| **C. Panel from a backend flag** | only where the flag says yes | yes | one build, and the backend decides per customer or station |
| **D. Per build** | B in one build, A in another | B: no, A: yes | a customer build and an internal build |

For the design and the decisions behind this: HLD §3.15 (`FR-HL-01…10`), `D-56`, `D-57`.

## What the user does, in every option

| Keys | What |
| --- | --- |
| `?debug=1` in the URL | on for this page load, from its very start |
| `Ctrl+Alt+Shift+A` | on, and remembered on this browser; again: off for good |
| `Ctrl+Alt+Shift+D` | save the capture as a file, `debug-capture-<date>-<time>.json` (a new file each time) |
| `Ctrl+Alt+Shift+C` | copy the same JSON to the clipboard |
| `Ctrl+Alt+Shift+S` | stop / start recording (the buffer is kept) |
| `Ctrl+Alt+Shift+M` | add a "Mark" note at this moment |
| `Ctrl+Alt+Shift+X` | clear the buffer |
| `Ctrl+Alt+Shift+P` | open / close the panel — options A, C (flag yes) and D's internal build only; elsewhere the key does nothing |

All of them work with the panel closed, and in full screen (F11). To have saves land in one
folder with no "Save as" dialog, set Chrome once per station (Settings › Downloads: pick the
**Location**, turn off **Ask where to save each file**) or by policy for all stations
([`host-setup.md` › 4](host-setup.md#4-chrome-policy-for-the-download-folder)). In F11 full
screen Chrome's download icon is hidden too, so a save shows nothing.

## The one file every option starts from

Put the call in a file of its own, `src/debug.ts`, so the rest of the app imports the handle
from one place. The options differ only in this file (and, for D, in the build config).

```ts
// src/debug.ts
import { installDebugActivation } from 'debug-capture/activate';

export const debug = installDebugActivation();
```

`main.ts` / `main.tsx` then look the same in every option:

**Angular (16 to 20)**

```ts
// src/main.ts
import { debug } from './debug';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideDebugCapture, provideDebugCaptureSession } from 'debug-capture/angular';
import { AppComponent } from './app/app.component';

// Wait for `ready`: a page switched on at load records its start-up requests too.
debug.ready.then(() =>
  bootstrapApplication(AppComponent, {
    providers: [provideDebugCapture(), provideDebugCaptureSession(() => debug.session)],
  }),
);
```

With an `NgModule` app: `platformBrowserDynamic([provideDebugCaptureSession(() => debug.session)])
.bootstrapModule(AppModule)` inside the `then`, and `provideDebugCapture()` in `AppModule`'s
`providers`.

**React (19)**

```tsx
// src/main.tsx
import { debug } from './debug';
import { createRoot } from 'react-dom/client';
import { createReactRootErrorOptions } from 'debug-capture/react';
import { App } from './App';

debug.ready.then(() =>
  createRoot(document.getElementById('root')!, createReactRootErrorOptions(() => debug.session)).render(<App />),
);
```

The seams take `() => debug.session` because the session can start after the app did (someone
presses `Ctrl+Alt+Shift+A` later). Anywhere in the app, `debug.message('order-saved', { id })`
records an app message; it costs nothing while the tool is off.

## A. With the panel

`src/debug.ts` as above. Switched on, the panel is installed **closed**; the user opens it with
`Ctrl+Alt+Shift+P`. On a `?debug=1` page a small DBG button shows in the corner; after the
activation chord it stays hidden. The panel's UI code is downloaded the first time it opens.

## B. Headless — no panel, no panel code

Change the one import:

```ts
// src/debug.ts
import { installDebugActivation } from 'debug-capture/activate-headless';

export const debug = installDebugActivation();
```

`main.ts` / `main.tsx` do not change. The handle is the same; `debug.panel` is always `null`.
Nothing is ever added to the page, `Ctrl+Alt+Shift+P` does nothing, and the build holds no panel
file (the package's own build and an end-to-end test check this). The user saves with
`Ctrl+Alt+Shift+D`. Your app can also offer its own action, for example in a hidden support menu:

```ts
import { debug } from './debug';

export function saveDebugCapture(): void {
  debug.session?.download(); // null while the tool is off: nothing happens
}
```

## C. With the panel, turned on or off by a backend flag

The panel stays in the bundle; a function decides at each switch-on. It is called **after
capture has started**, so `ready` (and so your app's start) never waits for the backend.

```ts
// src/debug.ts
import { installDebugActivation } from 'debug-capture/activate';

export const debug = installDebugActivation({
  panel: () =>
    fetch('/api/features')
      .then((response) => response.json())
      .then((features) => (features.debugPanel === true ? {} : false)),
});
```

The same in Angular and React: this runs before the framework starts, so it uses `fetch`, not
`HttpClient`. (That request is recorded like any other, because capture is already on.)

- Return `{}` (or panel options, such as `{ defaultDock: 'right' }`) for a panel, `false` for none.
- **Fails closed:** a throw, a rejected promise or any other value gives **no panel**. Capture
  keeps running; `debug.panelError` holds the reason.
- `false` downloads nothing of the panel: no element, no DBG button, `Ctrl+Alt+Shift+P` does nothing.
- The answer is read at switch-on and not followed live: a flag that changes applies at the next
  reload or the next `Ctrl+Alt+Shift+A`.

Note: `panel: false` written as a plain value also gives no panel, but its code is still in the
bundle. Only option B leaves it out.

## D. Per build — headless for customers, with the panel inside

Keep two files and let the build pick one.

```ts
// src/debug.ts — internal builds
import { installDebugActivation } from 'debug-capture/activate';
export const debug = installDebugActivation();
```

```ts
// src/debug.headless.ts — customer builds
import { installDebugActivation } from 'debug-capture/activate-headless';
export const debug = installDebugActivation();
```

**Angular** — a build configuration that swaps the file, in `angular.json` under
`projects.<app>.architect.build.configurations`:

```json
"customer": {
  "fileReplacements": [{ "replace": "src/debug.ts", "with": "src/debug.headless.ts" }]
}
```

Build with `ng build --configuration production,customer`. Every other file keeps importing
`./debug`.

**React (Vite)** — import the handle by an alias, and point the alias at one file per mode:

```ts
// vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@debug': fileURLToPath(
        new URL(mode === 'customer' ? './src/debug.headless.ts' : './src/debug.ts', import.meta.url),
      ),
    },
  },
}));
```

```tsx
// src/main.tsx (and anywhere else)
import { debug } from '@debug';
```

Build with `vite build --mode customer`. For TypeScript, add `"paths": { "@debug": ["./src/debug.ts"] }`
to `tsconfig.json` (both files export the same handle type). Other bundlers have the same idea
(webpack: `resolve.alias`).

Do not pick the entry with an `if` in code: a bundler includes every `import()` it can see,
whether it runs or not, so the panel would be back in the customer build.

## Check which one you shipped

- Open the app with `?debug=1` and press `Ctrl+Alt+Shift+P`: a panel opens in A, in C when the
  flag says yes, and in D's internal build; nothing happens in B.
- For B, search the built files for `debug-capture-panel-v2` (the panel's element name). It must
  not be found.
- In every option, `Ctrl+Alt+Shift+D` saves a file you can open in any text editor.
