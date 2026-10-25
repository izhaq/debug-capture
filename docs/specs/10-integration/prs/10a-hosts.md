# 10a — Hosts, packaging, README

Spec: [`../spec.md`](../spec.md) (S10-01 … S10-09). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s10a-hosts` → one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

Show the package works the same in an Angular host, a React host and a plain page,
installed as HLD §6.6 shows, from what ships (`dist/`, the tarball). Rewrite the README
for the people who install it.

## Owned paths

See the plan (S-10a rows). Nothing in `src/`. Nothing outside the package.

## Public API

No new exports. The hosts use only the public entry points: `createCaptureController`,
`isDebugRequested` (`debug-capture`), `installDebugPanel` (`debug-capture/panel`),
`provideDebugCapture`, `provideDebugCaptureSession` (`debug-capture/angular`),
`createReactRootErrorOptions` (`debug-capture/react`).

Outside APIs, read from the installed sources:

- Angular 16.2.12: `bootstrapApplication` (`@angular/platform-browser`),
  `provideHttpClient` / `HttpClient` (`@angular/common/http`), `Component` used as a
  plain function call (the package bans decorator syntax), JIT through
  `@angular/compiler`, `zone.js` 0.13.3.
- React 19.3.1: `createRoot(container, { onCaughtError, onUncaughtError, onRecoverableError })`
  (`react-dom/client`), a class error boundary.
- esbuild 0.28.2: `bundle`, `splitting`, `format: 'esm'`, an `onResolve` plugin.

## Behaviour

- `test/hosts/build.mjs` bundles `test/hosts/angular/main.mjs` and `test/hosts/react/main.mjs`
  into `.test-out/hosts/<name>/` with esbuild. A small plugin resolves `debug-capture` and
  `debug-capture/<entry>` through `package.json` `exports` (the `import` condition) to the
  `dist/*.mjs` files. Splitting stays on, so the panel UI stays a lazy chunk.
- `playwright.config.mjs` runs the host build before the static server starts.
- The static server serves `/angular/`, `/react/`, `/plain/` (each `index.html`), the built
  host bundles, and `/vendor/debug-capture/*` → `dist/*` for the plain page.
- Each host page shows its framework's own text and a button that makes a request through
  the framework's usual path (Angular `HttpClient`, React `fetch` in an event handler) and a
  button that throws through the framework's error path. The page sets `window.__hostReady`.
- `test/e2e/hosts.spec.mjs` runs one scenario per host (S10-05) and one flag-off test per
  host (S10-06). WebSocket traffic goes to the hostile server's `/ws-echo` (WebSocket has no
  CORS), made with `page.evaluate`.

## Required specs

- e2e `hosts`: for each of angular, react, plain — the S10-05 scenario; the S10-06 flag-off check.
- Prove each fails once: the scenario without `installDebugPanel` in a host (no launcher);
  the flag-off check with the controller always created.
- `plain-host.spec.mjs` keeps its S00-07 check on the new plain page.

## Verification

`npm run check` from `packages/debug-capture`. Report the spec and e2e counts, the size
table (unchanged), the tarball line, and `git diff --stat` outside the package (empty).

## Out of scope

S-10b (BR walk, performance, final security, Chrome 146, the every-MUST walk). The
playground app. Panel changes, fixes for the known limits, budget changes.
