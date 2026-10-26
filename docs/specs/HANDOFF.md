# Handoff — debug-capture v2 (updated 2026-10-26)

For the next session that works on this package. There is **no planned spec** right now:
S-13 and S-14 are merged, and the AI work (old S-12) moved to its own product (`D-48`).

**Talking to the owner** (root `CLAUDE.md`): short, simple words; main point first. Never
merge into the integration branch yourself unless the owner says so.

## Status

- In the integration branch `claude/air-gapped-debug-logging-zkn1nr`: v2.0, v2.1 (S-11),
  export schema 2 (#107), **S-13 background control** (#108–#111), the DBG button on
  `?debug=1` (#112) and **S-14 custom messages** (#113–#116). Package **2.3.0-alpha.1**; the
  playground app uses it from `vendor/`.
- Numbers: 1267 unit specs, 66 e2e + perf; core 12,607 / 13,904 B, activation 1,197 / 1,536 B,
  loader 4,783 / 5,632 B, UI chunk 41,474 / 45,056 B; warm open about 60 ms (limit 100).
- Plans with all numbers and notes: [`13-background-control/plan.md`](13-background-control/plan.md),
  [`14-custom-messages/plan.md`](14-custom-messages/plan.md).

## The AI assistant is not here

`D-48` (owner, 2026-10-26): the AI assistant is a self-hosted **Chrome extension** for
developers on the corporate network, in its own repository **`izhaq/devtools-ai-assistant`**
(its own HLD). This package stays network-free (`NFR-SEC-03`). Do not add AI code here.

## Still open here

- `OPEN-05`: anyone at a station who knows the activation chord can switch the tool on.
- `OPEN-02`, `OPEN-03`, `OPEN-06` (HLD §11).

## Rules that bite

- Conventional commits, scope `debug-capture v2`; no trailer lines; never an AI model name.
  `npm run format` before each commit; push every commit before saying a PR is ready.
- Test first; show each new spec red once; raise `test/unit/spec-floor.json` and
  `test/e2e-floor.json`.
- Isolation rules (HLD §6.7), ES2020 lib only, Chrome 146.0.7680.72+ features only.

## Cloud container tricks

- Playwright 1.56.1 wants Chromium build 1194; the container has 1243 in `/opt/pw-browsers`:
  point `PLAYWRIGHT_BROWSERS_PATH` at a scratch folder of links (`chromium-1194/chrome-linux` →
  `/opt/pw-browsers/chromium-1243/chrome-linux64`; `chromium_headless_shell-1194/chrome-linux/headless_shell`
  → the 1243 headless shell; `ffmpeg-1011`; `INSTALLATION_COMPLETE` files). Never `playwright install`.
- Chrome 146.0.7680.72: `https://storage.googleapis.com/chrome-for-testing-public/146.0.7680.72/linux64/chrome-headless-shell-linux64.zip`.
- Free the e2e ports with `fuser -k 4319/tcp 4329/tcp`, never `pkill -f` (it kills your own shell).
- App `ng test` runs as root: use a Karma config with a `ChromeHeadless` + `--no-sandbox` launcher.
