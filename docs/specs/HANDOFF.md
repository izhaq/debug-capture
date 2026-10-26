# Handoff — debug-capture v2, S-12 (updated 2026-10-26)

For the next session that picks up **S-12, the AI add-on** — the last step. Delete this file
in the PR that finishes S-12.

**Talking to the owner** (root `CLAUDE.md`): short, simple words; main point first. Never
merge into the integration branch yourself — only the owner merges.

## Status

- v2.0 (#96–#101) and **S-11 / v2.1** (#102–#105, merged 2026-10-26) are in the integration
  branch `claude/air-gapped-debug-logging-zkn1nr`. Follow-up: the No limit warning wraps inside
  the Settings popover (owner report, 2026-10-26), package **2.1.0-alpha.1**, also in the app.
- Numbers now: 1198 unit specs, 55 e2e + perf; loader 4,717 / 5,632 B, UI chunk ~40.6 / 45,056 B,
  core 12,071 / 12,368 B; warm open 52–67 ms (limit 100).
- The playground app (repo root) installs the package from `vendor/debug-capture-<version>.tgz`;
  wiring in `src/app/features/debug-panel/`, guide `docs/debug-panel.md`.

## Next: S-12, the AI add-on

- Decision `D-35` (HLD §10): a **separate package** `debug-capture-ai`; no AI UI or code without
  it. The user connects a **local or company on-prem model** by **URL + token** in the AI
  settings. Only the add-on makes network requests — only to that URL, only on a user action;
  the panel keeps `NFR-SEC-03`. It sends only stored (redacted) data plus a trimmed page
  snapshot. Phase 1: read-only insights. Phase 2: **proposed** DOM / style changes with
  **Apply** and **Undo**; never runs code (CSP / Trusted Types intact). The host's CSP must
  allow the model URL in `connect-src`.
- **Ask the owner first** (still open in HLD §11):
  - `OPEN-07` — where the token is kept (proposed: memory only, opt-in "Remember on this browser").
  - `OPEN-08` — the model API (proposed: OpenAI-compatible `POST /v1/chat/completions`, Bearer token).
- Then: HLD rows and an S-12 spec folder (docs PR first), the plug-in seam in the panel (how an
  add-on adds a section — mind the loader and UI budgets of `D-34`), the add-on package, an e2e
  against a fake model server, the README, and the app's tarball.

## Rules that bite

- Conventional commits, scope `debug-capture v2`; no trailer lines; never an AI model name.
  `npm run format` before each commit; push every commit before saying a PR is ready.
- Test first; show each new spec red once; raise `test/unit/spec-floor.json` and
  `test/e2e-floor.json`.
- Isolation rules (HLD §6.7), ES2020 lib only, Chrome 146.0.7680.72+ features only.
- Stop and ask the owner only for: a budget beyond `D-34`, a new dependency, or a change to
  an HLD MUST.

## Cloud container tricks

- Playwright 1.56.1 wants Chromium build 1194; the container has 1243 in `/opt/pw-browsers`:
  point `PLAYWRIGHT_BROWSERS_PATH` at a scratch folder of links (`chromium-1194/chrome-linux` →
  `/opt/pw-browsers/chromium-1243/chrome-linux64`; `chromium_headless_shell-1194/chrome-linux/headless_shell`
  → the 1243 headless shell; `ffmpeg-1011`; `INSTALLATION_COMPLETE` files). Never `playwright install`.
- Chrome 146.0.7680.72: `https://storage.googleapis.com/chrome-for-testing-public/146.0.7680.72/linux64/chrome-headless-shell-linux64.zip`.
- Free the e2e ports with `fuser -k 4319/tcp 4329/tcp`, never `pkill -f` (it kills your own shell).
- App `ng test` runs as root: use a Karma config with a `ChromeHeadless` + `--no-sandbox` launcher.
