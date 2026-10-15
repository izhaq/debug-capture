# debug-capture v2

A debug tool for web apps that run where browser DevTools are not available
(air-gapped stations). It records console output, errors, REST calls and
WebSocket traffic, and — new in v2 — shows them in an **on-screen panel**.

This folder is **v2**. It is meant to become its own package, and later its
own repository: everything it needs lives inside this folder.

## Where things are

|                     |                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source of truth** | [`docs/design/HLD.md`](docs/design/HLD.md) — the high-level design. Every spec and plan for v2 is cut from it.                                |
| Research behind it  | [`docs/research/`](docs/research/) — how a Web Component panel can still affect a host app (82 cases), and our practices baseline / v2 rules. |
| v1 background       | [`docs/v1/`](docs/v1/) — v1's usage guide and decision record, as they were when v2 started.                                                  |
| Code                | `src/` — see below.                                                                                                                           |

## Develop

Everything runs from this folder, with its own install (Node
`^20.19.0 || ^22.13.0 || >=24`, the range ESLint 10 needs):

```bash
cd packages/debug-capture
npm ci
npm run check        # every check below, in order
```

| Command                | What it checks                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | TypeScript, strict, specs included                                                          |
| `npm run lint`         | ESLint rules (no `any`, no `console`, no HTML strings…), after a self-test of the rules     |
| `npm run lint:layers`  | each layer imports only the one above it (HLD §6.2), after its self-test                    |
| `npm run format:check` | Prettier formatting (`npm run format` fixes it)                                             |
| `npm run contrast`     | the HLD §5.4 colour tokens meet WCAG contrast, after its self-test                          |
| `npm test`             | all unit specs, headless Chromium; fails if any spec is skipped or fewer run than the floor |
| `npm run build`        | `.d.ts` per source file (`tsc`) and the `dist/*.mjs` bundles (esbuild)                      |
| `npm run size`         | bundle size budgets, in bytes minified + gzip level 6                                       |
| `npm run pack:check`   | `npm pack`, install the tarball in a scratch app, type-check and import every entry point   |
| `npm run e2e`          | Playwright smoke test on a plain HTML page                                                  |

- **Chromium.** `npm test` (Karma) uses `CHROME_BIN` when it is set, and
  otherwise the Chromium of the pinned `@playwright/test`. `npm run e2e`
  (Playwright) always uses that Playwright Chromium and ignores `CHROME_BIN`;
  it finds it through `PLAYWRIGHT_BROWSERS_PATH`. Never run
  `playwright install`: the browser must match the pinned version (1.56.1).
- `npm run pack:check` and `npm run e2e` read `dist/`; they stop with a clear
  message if it is missing or older than `src/` (`npm run build` first;
  `npm run check` does).
- The spec floor is in `test/unit/spec-floor.json`: raise it when you add
  specs.

- **Rules** for people and agents: [`AGENTS.md`](AGENTS.md).
- **Design** (source of truth): [`docs/design/HLD.md`](docs/design/HLD.md).
- **Specs** (one folder per piece of work): [`docs/specs/`](docs/specs/README.md).

### Using the package

ESM only. Entry points: `debug-capture`, `debug-capture/angular`,
`debug-capture/react`, `debug-capture/panel`; each resolves to a prebuilt
bundle in `dist/` with its `.d.ts`. Types resolve with TypeScript
`moduleResolution` `node` (as in the Angular 16 host), `bundler`, `node16` and
`nodenext`. A plain page can load `dist/index.mjs` and `dist/panel.mjs`
directly with `<script type="module">`.

## Status

**Seed.** `src/` is a copy of v1 as of host-app commit `8fb0a0d`
(PRs #34–#50 on the `claude/air-gapped-debug-logging-zkn1nr` branch), so v2
starts from working, reviewed code:

| v2 path                                                       | Copied from (host app)                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/` (contract, core, adapters, install, react, `index.ts`) | `src/debug-capture/`                                                                          |
| `src/angular/`                                                | `src/app/features/debug-capture/` (imports changed from `'../../../debug-capture'` to `'..'`) |

**Foundation (S-00) done:** the package installs, tests, lints, builds and
size-checks on its own (see Develop). The v2 contracts and the empty panel
layers are in place; the Angular seam needs no decorators (C-4). Not set up
yet: CI (waits for `OPEN-06`).

## v1 and v2

- **v1 stays where it is**, inside the host app (`src/debug-capture/`), and
  keeps working there. It is not deleted or changed by v2 work.
- **v2 grows here**: the panel, and any change to the capture layer it needs.
- The host app keeps using v1 until v2 is ready and the switch is decided.

## Copy note

One spec line was changed in the copy: `src/core/recorder.spec.ts` casts a
`CaptureEntry` to `unknown` before `expect()`, the workaround v1's specs
already use elsewhere. Jasmine's `Expected<T>` on the recursive `JsonValue`
type can hit TypeScript's depth limit (TS2589) depending on file check order;
it compiles in the host app but not standalone.
