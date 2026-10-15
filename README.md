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

Everything runs from this folder, with its own install:

```bash
cd packages/debug-capture
npm ci
npm run check        # every check below, in order
```

| Command                | What it checks                                          |
| ---------------------- | ------------------------------------------------------- |
| `npm run typecheck`    | TypeScript, strict, specs included                      |
| `npm run lint`         | ESLint rules (no `any`, no `console`, no HTML strings…) |
| `npm run lint:layers`  | each layer imports only the one above it (HLD §6.2)     |
| `npm run format:check` | Prettier formatting (`npm run format` fixes it)         |
| `npm run contrast`     | the HLD §5.4 colour tokens meet WCAG contrast           |
| `npm test`             | all unit specs, headless Chromium                       |
| `npm run build`        | ESM + `.d.ts` per entry point, and `dist/*.mjs` bundles |
| `npm run size`         | bundle size budgets                                     |
| `npm run e2e`          | Playwright smoke test on a plain HTML page              |

- `npm test` and `npm run e2e` need Chromium: set `CHROME_BIN`, or let them
  use Playwright's installed Chromium. `npm run e2e` serves `dist/`, so run
  `npm run build` first (`npm run check` does).
- **Rules** for people and agents: [`AGENTS.md`](AGENTS.md).
- **Design** (source of truth): [`docs/design/HLD.md`](docs/design/HLD.md).
- **Specs** (one folder per piece of work): [`docs/specs/`](docs/specs/README.md).

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
