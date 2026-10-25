# Handoff — debug-capture v2, S-10 (updated 2026-10-25)

You are the new **orchestrator** for debug-capture v2 (GitHub Copilot in agent
mode, on the owner's **Windows laptop** — see §6 for setup). Waves 1–3 and S-09 are
done and merged. Your job is **S-10, integration and verification — the last spec**
(§0). This file is everything you need to start.
Read it first; open other files only when a step needs them, by line range or grep
(§5).

**Talking to the owner** (root `CLAUDE.md` — written for Claude, but it applies to
you too; read it): short, simple words, as if to a junior
developer; main point first; small tables over long text. Ask before anything hard
to undo. Never merge into the integration branch yourself.

## 0. Start here

**Status (keep this section current — update it before you stop):**

- **Waves 1–3 and S-09 are merged** into the integration branch
  `claude/air-gapped-debug-logging-zkn1nr`: wave 3 in **#92** (frame, HTTP, WebSocket,
  Console; review fixes #90, #91; a paused-row fix `7f1aed2`), **S-09 accessibility in #93**
  (keyboard walk e2e, forced-colour banner border, first paint follows a restored filter).
- Last checks on the integration branch (#93 head): green — **1122** unit specs (floor 1122),
  **33** e2e (floor 33); loader **4,084 / 4,096 B (12 B left)**, panel-ui **38,926 / 40,960 B
  (~2 kB left)**, core 11,743 / 12,368 B. S-10 should add **no panel code**; ask the owner
  before raising any budget.
- **S-10a — hosts, packaging, README: done, in review** (branch `claude/dc-v2-s10a-hosts`, one PR
  into the integration branch; **the owner merges it**). Spec folder `docs/specs/10-integration/`
  (spec S10-01…15, plan, briefs `prs/10a-hosts.md`, `prs/10b-verify.md`). Built: Angular 16.2,
  React 19.3.1 and plain hosts in `test/hosts/` (Angular / React bundled from `dist/` through
  `exports` by `test/hosts/build.mjs`); `test/e2e/hosts.spec.mjs` runs one scenario and a
  flag-off test on each; user README; React as a dev dependency. No `src/` change.
  Checks on the S-10a head: **1122** unit (floor 1122), **39** e2e (floor 39), sizes unchanged,
  tarball `debug-capture-2.0.0-alpha.0.tgz` 126 files, 329,217 B.
- **Next: S-10b — verification** (branch `claude/dc-v2-s10b-verify`, from the integration branch
  **after S-10a is merged**). Brief: `docs/specs/10-integration/prs/10b-verify.md` (S10-10…15):
  **BR-01…07** end to end (a test or a checklist row each — S-10a's host e2e covers BR-01/02/03/
  05/06/07 on real hosts); **NFR-PERF-02/03/04/06 measured** (open time, apply budget, node
  count, memory; the virtual-list frame-budget spec **in isolation** — its suite limit was
  relaxed to 16 ms in #91); **NFR-SIZE-01 final**; **NFR-SEC-01…04** final pass; **NFR-COMP-01**
  on Chrome 146 if one is available; the **every-MUST walk**. Delete this file in that PR.
  - Angular note: the hosts are Angular 16+ (HLD §1.1, package peer range). The repo name says
    "angular-13" but the app is Angular 16.2; do not target Angular 13 unless the owner says so.
- **Known limits (name them in the S-10 PRs):** fullscreen and a host modal dialog — panel drawn
  on top and live but not clickable (Chrome rule, `D-15`); a modal dialog inside a host's shadow
  root is not seen (ISO-21); in a narrow right dock the HTTP filter bar clips its last chips;
  `redactUserinfo` (`src/core/redact.ts`) misses leading-space and `//host` URLs.
- **Process:** every change goes through a PR — never push straight to the integration branch
  (or a wave branch). Commit and push after each step; `npm run format` before each commit.
- Keep the loader's `parseChord` as a copy of `install/shortcuts.ts` `parseShortcut` (size budget).
- The hostile host uses the real `createCaptureController` (`test/hostile-host/controller.mjs`).
  A view's e2e makes real traffic with `page.evaluate` (fetch / XHR / WebSocket / console)
  and finds rows inside the shadow root. Spec stages' `cleanup()` must destroy their views.
- **Windows tip:** a terminal opened by the IDE may not have the user variable
  `CHROME_BIN`; Karma then tries the blocked `chrome.exe` (`spawn EPERM`). Set
  it in the command: `$env:CHROME_BIN = [Environment]::GetEnvironmentVariable('CHROME_BIN','User')`.

**Setup (Windows, PowerShell; details in §6):**

```powershell
git config core.autocrlf false
git fetch origin
git switch claude/air-gapped-debug-logging-zkn1nr
git pull
cd packages/debug-capture
npm ci
npx playwright install chromium   # once per machine; if it fails, stop and tell the owner
npm run check
```

**Owner's answers (already settled — don't ask again):**

- **Browser:** tests use Playwright's Chromium. Do **not** point `CHROME_BIN` at the
  laptop's Chrome 155. Stations run Chrome 146.0.7680.72+: never use web features
  newer than Chrome 146.
- **PRs:** use `gh` (`gh pr create`, `gh pr merge <n> --merge`), merge commits only.
  S-10a and S-10b each open one PR into `claude/air-gapped-debug-logging-zkn1nr`;
  **only the owner merges it**.
- **Commits:** conventional commits, scope `debug-capture v2`
  (`test(debug-capture v2): Angular host e2e`). No trailer lines. Never
  an AI model name in commits or PRs.
- **Budgets:** UI chunk 40 kB (`D-25`). The **loader has 12 B left** (4,084 /
  4,096 B) — ask the owner before raising its 4 kB budget.

**Your first reply to the owner:**

1. Did `npm run check` pass on `claude/air-gapped-debug-logging-zkn1nr`? Test counts and the size table,
   or the exact error.
2. Your plan for the next step in the status above, in a few lines.
3. Anything in the docs that looks unclear or contradictory.

Then **wait for the owner's "go"** before writing code, and ask for a "go" before
each later step. Order: S-10a (spec first, then hosts, packaging, README) → S-10b.

**Before you stop** (budget, end of day, or done): push your work, update this §0
and the status in `docs/specs/10-integration/plan.md`, so the next agent can start
from here. **In the PR that finishes S-10b, delete this file** (rule 11 in §5).

---

## 1. The project in one screen

- **What:** an on-screen debug panel (Network: HTTP + WebSocket, Console) for web
  apps on **air-gapped stations** with no DevTools. It floats over the host app like
  DevTools.
- **Two parts:** the **capture layer** ("v1", seeded from the host app's
  `src/debug-capture/`, which stays unchanged) patches `fetch`, XHR, WebSocket and
  console and records entries in a ring buffer; the **panel** (new in v2) is a
  framework-free Web Component in a shadow root.
- **Where:** everything lives in `packages/debug-capture/` in this repo
  (`izhaq/angular-13-playground`). The host Angular 13 app (repo root) must stay
  unaffected. Later the package moves to its own repository (OPEN-06).
- **Browser:** **Chrome 146.0.7680.72+ only**; no Edge, no old-browser fallbacks
  (NFR-COMP-01, OPEN-01 answered). Language target stays ES2020 / `lib: es2020, dom`
  (AGENTS rule 7: no `.at()`, `Object.hasOwn`, `replaceAll`).
- **Source of truth:** `docs/design/HLD.md` (Draft 0.5, ~1,150 lines). Rules for
  people and agents: `AGENTS.md`. Spec index and waves: `docs/specs/README.md`.
  When a spec and the HLD disagree, the HLD wins — or the HLD changes first, in its
  own PR.

## 2. Map of the docs

| File | What it holds | Read when |
|---|---|---|
| `AGENTS.md` (164 lines) | All coding, layer, isolation, test, git and review rules | Before the first brief; agents read it too |
| `docs/specs/README.md` | Spec list S-00…S-10, waves, spec folder layout, spec rules | Before writing the S-10 spec |
| `docs/specs/09-accessibility/` | The latest spec folder (spec, plan, one brief) | The **template** for `10-integration/` |
| `docs/specs/0N-*/spec.md` | Every spec with its traceability table | The every-MUST walk (S-10b) |
| `README.md` (package root) | The package README (S-10a rewrites it) | S-10a |
| `test/hostile-host/`, `test/e2e/` | The hostile host (real controller) and every e2e | Pattern for the S-10a host e2e |

**HLD sections you will need** (line numbers on the integration branch, ±5):

| § | Line | Topic | For |
|---|---|---|---|
| 1.4 / 1.6 | ~91 / ~113 | Goals; how we know it worked (BR rows) | S-10b |
| 3.1 | ~164 | Business requirements BR-01…07 | S-10b |
| 3.9 | ~256 | NFR: PERF, SIZE, SEC, COMP, PORT | S-10a / S-10b |
| 6.1 / 6.6 | ~702 / ~864 | Package entry points; using it in a host | S-10a |
| 8 | ~983 | Test strategy, hostile host, proof rules | both |
| 9.1–9.3 | ~1015–1085 | Spec rows, waves, **traceability** (which spec owns each requirement) | S-10b |
| 10 / 11 | ~1086 / ~1120 | Decisions D-01…D-26 / open questions | — |

## 3. Decisions (HLD §10)

| State | Decisions |
|---|---|
| **Decided** (all of them, owner 2026-10-19 / 2026-10-22) | D-01 … D-26. D-15 and D-18 were changed by the owner; D-05…D-11, D-16, D-17, D-21, D-22 were already built and accepted as built; D-24 (no Launcher setting in 2.0) and D-25 (UI chunk 40 kB) were added during wave-3 planning; D-26 (WebSocket detail Copy ▾) during S-06. |

**Decisions that shape behaviour (all built):** D-15 fullscreen / host modal — panel drawn on top
and live but not clickable, banner; D-18 HTTP list in start order with column sorting; D-19
Pause freezes the view, Capture on/off stops recording; D-23 a host `@property --dcp-*` is out of
scope; D-24 no Launcher setting in 2.0; D-25 UI chunk budget 40 kB; D-26 WebSocket detail Copy ▾.

## 4. Open items for the owner (do not decide for them)

- OPEN-02 (stations' CSP strictness), OPEN-03 (`bdi_W` practices — repo not
  reachable), OPEN-04 (copy / download from the shadow root on stations), OPEN-05
  (should opening need more than "flag on"), OPEN-06 (where the v2 repo will live).
- Budgets: the loader has 12 B left — ask the owner before raising it.

## 5. How to work — token-saving rules (the owner's budget is tight)

1. **Don't read big files whole.** Search and read line ranges; open only the HLD
   section a step needs (§2).
2. **Work in small units.** One PR at a time: S-10a, then S-10b.
3. **Small fixes: do them yourself.** Start a **fresh** chat only for a review (it must
   not have seen the code being written). Don't drag a long chat history into small
   fixes — start a new one with a short brief instead.
4. **Model choice** (if you can choose): a fast model for implementation and fixes; the
   strongest model for the S-08 security / isolation review; a fast model for narrow
   confirmation reviews (diff only).
5. **Short briefs, short reports.** Briefs point to the spec file instead of repeating
   it; reports ≤ 300–400 words.
6. **Run `npm run check` once per merge**, and read only the summary lines (`TOTAL`,
   `spec count`, `e2e count`, `FAILED`, the size table), not the whole log.
7. **No reviewers for docs-only changes.**
8. **If a session runs out of budget mid-track:** commit and push what works (on the
   track branch, never the wave or integration branch), write 5 lines of "where I
   stopped" in the PR description, and continue in a new session from there.
9. **Owner updates:** a few lines or a small table; ask for a "go" before each step.
10. **Prove new tests:** for each fix, show the new spec failing on the old code once
    (revert the fix, run the tests, restore).
11. **A handoff lives only while its step is open.** Keep one file (this one), rewrite it for
    the next step, and **delete it in the PR that finishes the last step** (S-10b). Never keep
    old waves' plans or status in it — git history has them.

## 6. Environment — Windows laptop

**Browsers:** the laptop has **Chrome 155**; the stations run **Chrome 146.0.7680.72+**
(NFR-COMP-01). Do **not** use web APIs or CSS added after Chrome 146, even though they
work on the laptop. The automated tests run in Playwright's own Chromium (141 for the
pinned `@playwright/test` 1.56.1), which keeps you honest. Use Chrome 155 only for
looking at the panel by hand.

**One-time setup** (PowerShell, from the repo root):

```powershell
git config core.autocrlf false        # the package's .gitattributes forces LF; this avoids CRLF noise
git fetch origin
git switch claude/air-gapped-debug-logging-zkn1nr
cd packages/debug-capture
npm ci                                # Node 22 LTS (engines: ^20.19 || ^22.13 || >=24)
npx playwright install chromium       # once per machine; downloads Playwright's Chromium
```

(The old "never run `playwright install`" rule was for the cloud container only. On
the laptop you must run it once.)

**If the laptop's security software gets in the way** (seen on the owner's laptop,
2026-10-19; Node 26, npm 11):

| Symptom | Fix |
|---|---|
| Files show `w/crlf` in `git ls-files --eol` after setting `autocrlf false` | With a clean tree only: `git rm --cached -r -q . ; git reset --hard -q` (re-checks out every file) |
| `npx playwright install chromium` freezes while unpacking `chrome.dll` | Install by hand: `npx playwright install --dry-run chromium` lists the four zips and folders (`chromium-1194`, `chromium_headless_shell-1194`, `ffmpeg-1011`, `winldd-1007`). For each: `curl.exe -sSfL -o x.zip <url>`, `tar -xf x.zip -C "$env:LOCALAPPDATA\ms-playwright\<folder>"`, then create an empty `INSTALLATION_COMPLETE` file in the folder. |
| Karma: `spawn EPERM` (the full `chrome.exe` is blocked) | Point Karma at the headless shell, the same Chromium 141 the e2e tests use: user variable `CHROME_BIN` = `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1194\chrome-win\headless_shell.exe` |
| `npm ci` warns that esbuild's install script is not allowed | Harmless: esbuild runs without it |

**Every check run** (from `packages/debug-capture`):

```powershell
npm run check
```

- Karma uses Playwright's Chromium automatically; to use another Chrome, set
  `$env:CHROME_BIN` to its `chrome.exe` first (on the owner's laptop Chrome is in
  `C:\Program Files (x86)\Google\Chrome\Application\`).
- The checks expect **LF line endings** (Prettier, the contrast check). The package's
  `.gitattributes` forces LF on checkout. If `format:check` fails on every file, run
  `git add --renormalize .` once, or check `core.autocrlf`.
- The e2e servers use ports 4319 and 4329 (`E2E_PORT`, `E2E_HOSTILE_PORT` change
  them). Allow them through the Windows firewall prompt if asked; they bind to
  127.0.0.1 only.

**Host app** (must stay unaffected): a wave that changes nothing outside the package
cannot affect it. Check with
`git diff --stat <base>...<head> -- . ":!packages/debug-capture"`. If it ever does
change something outside, run from the repo root `npm ci`, then
`npx tsc -p tsconfig.app.json --noEmit` and `npm run lint:layers`.

**Git and GitHub:**
- Branches as in §0. A second folder per branch is handy
  (`git worktree add ..\wt-08 claude/dc-v2-w3-08-frame`); each needs its own `npm ci`
  in `packages/debug-capture`.
- Open and merge PRs on github.com or with the GitHub CLI
  (`gh pr create --base <branch>`, `gh pr merge <n> --merge`). Always use a **merge
  commit**, never squash or rebase.
- Commits: conventional commits, scope `debug-capture v2` (AGENTS rule 22). Never put
  an AI model name in commits or PRs. Never commit temp paths.
- **Who merges:** track PRs into the **wave branch** — you, after re-running the checks
  and reading the diff. PRs into `claude/air-gapped-debug-logging-zkn1nr` (the wave PR,
  docs or decision PRs) — **only the owner**.
