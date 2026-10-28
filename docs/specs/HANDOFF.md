# Handoff — debug-capture (updated 2026-10-28)

For the next session that works on this repository. Read [`AGENTS.md`](../../AGENTS.md)
first (all rules), then this page. The design is [`docs/design/HLD.md`](../design/HLD.md).

**Talking to the owner:** short, simple words; main point first. Only the owner merges
into `main`. Ask only for real owner decisions.

## Where things are

- **This repository, `izhaq/debug-capture`**, is the package's home since 2026-10-28
  (HLD `D-02` done, `OPEN-06` answered: GitHub). It was split out of
  `izhaq/angular-13-playground` (folder `packages/debug-capture/`) with its history. Old
  branch names and PR numbers in `docs/specs/` (#34 … #116) are in that repository.
- **`main`** is the integration branch. One PR per change.
- **The playground app** `izhaq/angular-13-playground` (Angular 16.2) is a host: it installs
  the release tarball from its `vendor/` folder (`src/app/features/debug-panel/`,
  `docs/debug-panel.md`). Another session works on it.
- How to work: [`CONTRIBUTING.md`](../../CONTRIBUTING.md). How to release:
  [`RELEASING.md`](../../RELEASING.md). How a host adds it: [`docs/host-setup.md`](../host-setup.md).

## Status

- Done: v2.0, 2.1 (S-11), 2.2 (S-13 background control), 2.3 (S-14 custom messages).
  Package **2.3.0**, released as `v2.3.0` (GitHub Release, `RELEASING.md`). No planned spec.
- Numbers: 1267 unit specs, 66 e2e + perf; core 12,602 / 13,904 B, activation 1,198 / 1,536 B,
  loader 4,783 / 5,632 B, UI chunk 41,474 / 45,056 B (min + gzip); warm open about 60 ms
  (limit 100). The same on Chrome 146.0.7680.72.
- Plans with all numbers and notes: [`13-background-control/plan.md`](13-background-control/plan.md),
  [`14-custom-messages/plan.md`](14-custom-messages/plan.md).

## Next

- Nothing planned. The playground app switches from 2.3.0-alpha.1 to the 2.3.0 tarball
  (`docs/host-setup.md` › Update). A new version starts as `2.4.0-alpha.0` on a spec branch.

## The AI assistant is not here

`D-48`: the AI assistant is a self-hosted Chrome extension in its own repository,
`izhaq/devtools-ai-assistant`. This package stays network-free (`NFR-SEC-03`). No AI code here.

## Still open

- `OPEN-05`: anyone at a station who knows the activation chord can switch the tool on.
- `OPEN-02`, `OPEN-03` (HLD §11).

## Rules that bite

- Conventional commits, scope `debug-capture v2`; no trailer lines; never an AI model name.
  `npm run format` before each commit; push every commit before saying a PR is ready.
- PR body: What · Review notes · Checks (unit and e2e counts, sizes).
- Test first; show each new spec red once; raise `test/unit/spec-floor.json` and
  `test/e2e-floor.json`. Never weaken or skip a test.
- Isolation rules (HLD §6.7), ES2020 lib only, Chrome 146.0.7680.72+ features only.

## Cloud container tricks

- Playwright 1.56.1 wants Chromium build 1194; the container has 1243 in `/opt/pw-browsers`.
  Never `playwright install` in the container. Point `PLAYWRIGHT_BROWSERS_PATH` at a scratch
  folder of links: `chromium-1194/chrome-linux` → `/opt/pw-browsers/chromium-1243/chrome-linux64`;
  `chromium_headless_shell-1194/chrome-linux/` → the files of
  `/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/`, plus
  `headless_shell` → its `chrome-headless-shell`; `ffmpeg-1011` → `/opt/pw-browsers/ffmpeg-1011`;
  an `INSTALLATION_COMPLETE` file in each `-1194` folder. Set
  `CHROME_BIN=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.
- Chrome 146: `eval "$(scripts/chrome-146.sh <scratch dir>)"` downloads it and sets both
  variables.
- Free the e2e ports with `fuser -k 4319/tcp 4329/tcp`, never `pkill -f` (it kills your own
  shell). `npm run e2e` needs a fresh `dist/` (`npm run build`).
