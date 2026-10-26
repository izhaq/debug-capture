# Handoff — debug-capture v2, S-13 (updated 2026-10-26)

For the next session that picks up **S-13, background control** (release 2.2). When S-13 is
done, rewrite this file for **S-12** (next, below). S-13 comes before S-12 (`D-44`).

**Talking to the owner** (root `CLAUDE.md`): short, simple words; main point first. Never
merge into the integration branch yourself — only the owner merges.

## Status

- v2.0, v2.1 (S-11) and the No limit follow-up are in the integration branch
  `claude/air-gapped-debug-logging-zkn1nr`. **#107** (export schema 2, `D-36`,
  2.1.0-alpha.2) is open; S-13 is stacked on it.
- S-13 spec: [`13-background-control/`](13-background-control/spec.md). HLD rows §3.11
  (`FR-BG-01…10`), `C-11`, decisions `D-37` … `D-45`.
- PRs, all open, in merge order: #107 → #108 docs → #109 S-13a (core chords,
  `debug-capture/activate`, seams) → #110 S-13b (hidden DBG button, About) → S-13c (the app,
  2.2.0-alpha.1). Numbers and notes in [`13-background-control/plan.md`](13-background-control/plan.md).
  After each merge, merge the integration branch into the later branches (no rebase).
- Numbers on #107's head: 1202 unit specs, 55 e2e + perf; core 12,294 B (budget becomes
  13,904 B, `D-43`), loader 4,717 / 5,632 B, UI chunk 40,581 / 45,056 B; warm open 52–67 ms.

## The owner's S-13 decisions in one place

- New chords: activation `Ctrl+Alt+Shift+A`, capture on/off `S`, note `M`; `D` `C` `X` stay
  and work while capture is off. All configurable in code.
- `?debug=1` **stays** (`D-45`); the chord is on top and is remembered (`debug-capture` = `1`).
  The chord again turns it off for good, also on a `?debug=1` page.
- After activation: panel closed, DBG button hidden (`D-41`).
- Download folder: Chrome policy `DownloadDirectory` + `PromptForDownloadLocation` = false,
  no code (`D-39`).
- About in Settings: version + every chord in use.
- Budgets: core v1 + 3.5 kB; activation entry its own small budget; loader / UI unchanged
  (ask before raising them).

## Next: S-12, the AI add-on

- Decision `D-35` (HLD §10): a **separate package** `debug-capture-ai`; the user connects a
  local or on-prem model by URL + token. Ask the owner first: `OPEN-07` (token storage) and
  `OPEN-08` (model API). Then HLD rows and an S-12 spec folder (docs PR first).

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
