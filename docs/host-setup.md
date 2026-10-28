# Add debug-capture to a host app

Step by step: get the tarball, install it from `vendor/`, wire it into an
Angular, React or plain HTML app, set the Chrome download policy, and update
to a new version later. The options and the panel itself are in the
[`README`](../README.md).

**A working example:** the playground app
[`izhaq/angular-13-playground`](https://github.com/izhaq/angular-13-playground)
(Angular 16.2) — the wiring is in `src/app/features/debug-panel/`, its guide in
`docs/debug-panel.md`.

## 1. Get the tarball

Download `debug-capture-<version>.tgz` and its `.sha256` file from the
[GitHub Releases](https://github.com/izhaq/debug-capture/releases) page of this
repository (or build it yourself: [`RELEASING.md`](../RELEASING.md)). Check it:

```bash
sha256sum -c debug-capture-<version>.tgz.sha256    # → debug-capture-<version>.tgz: OK
```

## 2. Install it from `vendor/`

Put the tarball in the host's own repository, so the build works with no
network and every developer gets the same file:

```bash
mkdir -p vendor
cp debug-capture-<version>.tgz vendor/
npm install ./vendor/debug-capture-<version>.tgz
```

This writes a `file:` dependency in `package.json`:

```json
"dependencies": {
  "debug-capture": "file:vendor/debug-capture-<version>.tgz"
}
```

Commit `vendor/debug-capture-<version>.tgz`, `package.json` and
`package-lock.json` (the lockfile keeps the tarball's `integrity` hash, so
`npm ci` fails if the file changes). The package has no runtime dependencies.
Angular hosts need `@angular/core` 16 to 20 (a peer dependency).

## 3. Wire it in

The rule for every host (HLD §6.6): call `installDebugActivation()` **first**,
before the app starts, and start the app when `ready` resolves. Then a page
switched on at load (`?debug=1`, or the remembered `Ctrl+Alt+Shift+A`) records
its startup requests too. When the tool is off, `ready` resolves at once and
nothing else loads.

Put the call in a file of its own, so any part of the app can import the
handle (and `main` stays the only place that starts the app):

```ts
// src/debug.ts
import { installDebugActivation } from 'debug-capture/activate';

export const debug = installDebugActivation(); // with ?debug=1 or the stored flag, it starts now
```

Import it **first** in `main`. The framework error seams take a function,
`() => debug.session`, because the session may start after the app did
(someone presses the chord later).

### Angular (16 to 20)

```ts
// main.ts — standalone bootstrap
import { debug } from './debug';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideDebugCapture, provideDebugCaptureSession } from 'debug-capture/angular';
import { AppComponent } from './app/app.component';

debug.ready.then(() =>
  bootstrapApplication(AppComponent, {
    providers: [provideDebugCapture(), provideDebugCaptureSession(() => debug.session)],
  }),
);
```

With an `NgModule` app:

```ts
// main.ts
import { debug } from './debug';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { provideDebugCaptureSession } from 'debug-capture/angular';
import { AppModule } from './app/app.module';

debug.ready.then(() =>
  platformBrowserDynamic([provideDebugCaptureSession(() => debug.session)]).bootstrapModule(AppModule),
);

// app.module.ts:  providers: [provideDebugCapture()]
```

### React (19)

```tsx
// main.tsx
import { debug } from './debug';
import { createRoot } from 'react-dom/client';
import { createReactRootErrorOptions } from 'debug-capture/react';
import { App } from './App';

debug.ready.then(() =>
  createRoot(document.getElementById('root')!, createReactRootErrorOptions(() => debug.session)).render(<App />),
);
```

### Plain HTML page (no bundler)

Copy the package's `dist/` folder (from `node_modules/debug-capture/dist/`, or
unpacked from the tarball's `package/dist/`) next to the page, here as
`vendor/debug-capture/`:

```html
<script type="module">
  import { installDebugActivation } from './vendor/debug-capture/activate.mjs';
  const debug = installDebugActivation();
  window.debug = debug;
  window.debugReady = debug.ready; // the page's own code awaits this before its first request
</script>
```

### Send the app's own messages

Use the handle from `src/debug.ts` and call `message()` anywhere. While the
tool is off it is dropped and costs nothing:

```ts
import { debug } from './debug';

debug.message('order-saved', { id: 42, total: 99.5 });
debug.message('payment-failed', { code: 'E17' }, 'error'); // counts as a problem
```

A small wrapper of your own (for example `debugMessage(type, data, level)`)
keeps the package's types out of the rest of the app. The playground app does
this.

### Check it

1. Open the app with `?debug=1`: the DBG button shows in the corner.
2. `Ctrl+Alt+Shift+P` opens the panel; Network › HTTP lists the startup
   requests.
3. Settings › About shows the version you installed.

## 4. Chrome policy for the download folder

`Ctrl+Alt+Shift+D` saves the capture through Chrome's normal download. To have
every station save into one folder with no dialog, IT sets these Chrome
policies (Group Policy on Windows; a JSON file in
`/etc/opt/chrome/policies/managed/` on Linux):

| Policy                             | Value                                      |
| ---------------------------------- | ------------------------------------------ |
| `DownloadDirectory`                | the folder, e.g. `D:\debug-captures`       |
| `PromptForDownloadLocation`        | `false`                                    |
| `DownloadRestrictions`             | `0` (or not set)                           |
| `AutomaticDownloadsAllowedForUrls` | the app's origin, e.g. `https://app.local` |

`DownloadDirectory` applies to every download in that Chrome; use
`DefaultDownloadDirectory` to only suggest the folder. Check the result in
`chrome://policy`. Details: [README › Save to a fixed folder](../README.md#save-to-a-fixed-folder-chrome-policy).

## Update to a new version

```bash
sha256sum -c debug-capture-<new>.tgz.sha256
git rm vendor/debug-capture-<old>.tgz
cp debug-capture-<new>.tgz vendor/
npm install ./vendor/debug-capture-<new>.tgz   # updates package.json and package-lock.json
npm ci && npm test && npm run build            # the host's own checks
```

Read the release notes first: a new minor version adds features and keeps the
API; a major one may need wiring changes. Commit the new tarball, `package.json`
and `package-lock.json` together, and check Settings › About on a test station.
