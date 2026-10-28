# Contributing

How to work on `debug-capture`. The rules are in [`AGENTS.md`](AGENTS.md) (read
it first); the design is [`docs/design/HLD.md`](docs/design/HLD.md). To cut a
version, see [`RELEASING.md`](RELEASING.md).

## Set up

1. **Node 22** — the version is in [`.nvmrc`](.nvmrc) (`nvm use`). Any Node in
   `engines` (`^20.19.0 || ^22.13.0 || >=24`) works.
2. **Install:** `npm ci` (the lockfile is exact; never `npm install` to set up).
3. **Browser:** unit tests and e2e run headless in the Chromium of the pinned
   `@playwright/test` (1.56.1). On your machine, install that one once:
   `npx playwright install chromium` (add `--with-deps` on a fresh Linux box).
   Never install another Playwright version or its browsers.

## Check

```bash
npm run check   # everything below, in this order — what CI runs
```

| Command                | What it checks                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `npm run typecheck`    | `tsc`, strict, specs included                                                          |
| `npm run lint`         | ESLint (no `any`, `console`, `innerHTML`, `eval`, `Date.now()`, `fit`/`xit`…)          |
| `npm run lint:layers`  | the layer rules (`AGENTS.md` › Layers)                                                 |
| `npm run format:check` | Prettier — `npm run format` fixes it                                                   |
| `npm run contrast`     | the HLD §5.4 colour tokens meet 4.5:1 / 3:1                                            |
| `npm test`             | every `src/**/*.spec.ts` in headless Chromium; fails below `test/unit/spec-floor.json` |
| `npm run build`        | `dist/` — the `.d.ts` files and the `*.mjs` bundles that ship                          |
| `npm run size`         | size budgets (`scripts/size-budgets.json`, min + gzip)                                 |
| `npm run pack:check`   | the packed tarball installs and type-checks in a throw-away app                        |
| `npm run e2e`          | Playwright (end-to-end + perf); fails below `test/e2e-floor.json`                      |

- `npm run e2e` needs a fresh `dist/`: run `npm run build` first (it stops and
  says so otherwise). It uses ports 4319 and 4329; free them with
  `fuser -k 4319/tcp 4329/tcp` if an old run is still holding them.
- `npm test` uses `CHROME_BIN` when it is set.

### On the station browser (Chrome 146)

The stations run **Chrome 146.0.7680.72** (`NFR-COMP-01`). Before a release,
and for any change that uses a newer browser feature, run the checks on it too
(Linux x64):

```bash
eval "$(scripts/chrome-146.sh ~/.cache/debug-capture-chrome-146)"   # downloads it once
npm run check
```

The script downloads Chrome for Testing 146 and points `PLAYWRIGHT_BROWSERS_PATH`
and `CHROME_BIN` at it. CI does the same in its `chrome-146` job.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) (GitHub Actions) runs on
every pull request and every push to `main`:

| Job          | What                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `check`      | Node from `.nvmrc`, `npm ci`, the pinned Playwright Chromium, `npm run check` |
| `chrome-146` | the same `npm run check` on Chrome for Testing 146.0.7680.72                  |

npm packages and both browsers are cached. When a job fails, its
`test-results/` folder is attached to the run. A PR is ready only when CI is
green.

## How to work

- **Spec first.** Non-trivial work starts with a folder in `docs/specs/`
  (`spec.md`, `plan.md`, `prs/`), cut from the HLD. See
  [`docs/specs/README.md`](docs/specs/README.md).
- **Test first.** Write the spec, see it fail once, then make it pass. Say the
  red count in the PR. Never weaken, skip or delete a test.
- **Raise the floors** when you add tests: `test/unit/spec-floor.json` (`min`) and
  `test/e2e-floor.json` (`minimumTests`) get the new counts.
- **Layers.** Each layer imports only the barrel of the one above it
  (`AGENTS.md` › Layers; `npm run lint:layers`).
- **Isolation.** The panel lives inside someone else's app: the rules `ISO-01` …
  `ISO-22` (HLD §6.7) apply, checked against the hostile host in
  `test/hostile-host/`.
- **Language level.** TypeScript 5.1.6, `lib: es2020, dom` — no `.at()`,
  `Object.hasOwn`, `replaceAll`. Only Chrome 146 features.
- **Budgets.** `npm run size` fails over a budget. Raising one needs the owner
  (HLD `D-34`, `D-43`).

## Commits and pull requests

- One branch per change, one PR into `main`. Only the owner merges.
- Conventional commits, scope `debug-capture v2`:
  `feat(debug-capture v2): …`, `fix(…)`, `docs(…)`, `ci(…)`, `build(…)`.
  No trailer lines.
- `npm run format` before each commit; `npm run check` green before you push.
- PR body: **What · Review notes · Checks** — with numbers: unit and e2e
  counts, and the `npm run size` table when what ships changes.

## Where things live

See `AGENTS.md` › Where things live. In short: `src/` (code with specs next to
it), `test/` (hosts, hostile host, e2e, perf), `scripts/` (checks, build),
`docs/` (HLD, specs, research, host guide).
