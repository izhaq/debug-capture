# Handoff — debug-capture v2, wave 3 (written 2026-10-19)

You are the new **orchestrator** for debug-capture v2 (GitHub Copilot in agent
mode, on the owner's **Windows laptop** — see §10 for setup). Waves 1 and 2 are done and
merged. Your job is **wave 3**: S-05 HTTP view, S-06 WebSocket view, S-07 Console
view, S-08 frame + toolbar + status bar. This file is everything you need to start.
Read it first; open other files only when a step needs them, by line range or grep
(§9).

**Talking to the owner** (root `CLAUDE.md` — written for Claude, but it applies to
you too; read it): short, simple words, as if to a junior
developer; main point first; small tables over long text. Ask before anything hard
to undo. Never merge into the integration branch yourself.

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
| `docs/specs/README.md` | Spec list S-00…S-10, waves, spec folder layout, spec rules | Before writing wave-3 specs |
| `docs/specs/wave-2.md` | How wave 2 was planned: tracks, owned paths, contracts, status table | The **template** for `wave-3.md` |
| `docs/specs/0N-*/spec.md`, `prs/*.md` | Wave 1–2 specs and PR briefs | Examples of the spec / brief format |
| `docs/design/mockup.html` | Visual mockup of the panel | S-05…S-08 UI work |
| `docs/research/host-impact-edge-cases.md` | Tested isolation cases (S1…, L1…, E1…, F…) | S-08 (frame inside a hostile host) |

**HLD sections you will need** (line numbers on the integration branch, ±5):

| § | Line | Topic | For |
|---|---|---|---|
| 3.3 | 190 | FR-WIN: dock, resize, maximize, fullscreen | S-08 |
| 3.4 | 202 | FR-HTTP-01…07 | S-05 |
| 3.5 | 214 | FR-WS | S-06 |
| 3.6 | 224 | FR-CON | S-07 |
| 3.7 | 234 | FR-BAR: pause, clear, export, status bar | S-08 |
| 3.8 | 246 | FR-COM: shared JSON viewer, copy… | all views |
| 3.9 | 256 | NFR: ISO, PERF, SIZE, SEC, REL, A11Y, COMP | all |
| 4.1–4.12 | 281–499 | Behaviour: lifecycle, open/close/resize, pause/follow, filters, HTTP detail (Headers / Payload / Response / Timing), WS view, console view, toolbar, settings, states, keyboard | all |
| 5.1–5.8 | 500–699 | Visual design: layout, sizes, colour tokens, type, **columns and status mapping (5.6)**, interaction states | all |
| 6.2 / 6.4 | 728 / 778 | Layers / key interfaces | contract PR |
| 6.7 | 892 | Isolation rules ISO-01…22 | S-08 |
| 8 | 983 | Test strategy, hostile host, proof rules | all |
| 9.1–9.3 | 1015–1082 | Spec rows, waves, **traceability** (which spec owns each requirement) | planning |
| 10 / 11 | 1083 / 1116 | Decisions D-01…D-23 / open questions | — |

## 3. Where things stand

**Integration branch:** `claude/air-gapped-debug-logging-zkn1nr` (never `main`).
Everything below is merged into it (as of `4ebda8a`).

| Wave | Specs | PRs | State |
|---|---|---|---|
| 1 | S-00 Foundation | #59 | Merged |
| 2 | S-01 core changes, S-02 loader, S-03 model, S-04 UI blocks | #60–#68, wave PR #70 | Merged |
| after | Review notes, D-23, Chrome 146+, wave-3 decisions | #69, #71, #72, #73 | Merged |

**Numbers** (`npm run check`, green): **935** unit specs (floor 935), **19** e2e
(floor 19).

| Size budget (min+gzip) | Now | Max | Left |
|---|---|---|---|
| core | 11,743 B | 12,368 B | 625 B |
| panel-loader | 4,041 B | 4,096 B | **55 B** |
| panel-ui (lazy chunk) | 22,695 B | 25,600 B | **~2.9 kB** — see risk R1 |

**Reviews done:** S-00 ×2, S-01 + confirmation, S-02 isolation + fixes, S-04 +
confirmation, one whole-wave review (no blockers).

### What is built, by layer (`AGENTS.md` layer table)

| Layer | Path | What is there (names from each barrel) |
|---|---|---|
| L1–L5 capture | `src/contract`, `core`, `adapters`, `install`, `src/index.ts` | Recorder with **pending requests** (`requestId`); `createCaptureController(options)` — one recorder for the page's life, stable session; probes; sinks `copyText` / `download` taking `{ root }`; `isProblemEntry` (D-21) |
| P1 model | `src/panel/model/` | `createLocalDataSource`, `createPanelStore` (batching, pause, selection), selectors (HTTP rows, WS connections, console rows, counts), filters (`foldCase`, `matchRanges`, `toggleChip`, `EMPTY_FILTERS`), `format`, `describeBody` / redaction ranges, `toCurl` |
| P2 ui | `src/panel/ui/` | `createDom` (safe builder, no `innerHTML`), badge, button, chip group, empty state, highlight, icons, menu / popover, search box, split pane, tabs, theme (`TOKENS`, theme sheet), **virtual list**, **JSON viewer** |
| P3 views | `src/panel/views/` | **Empty** apart from the barrel and a composition spec. Wave 3 fills it (S-05…S-07). |
| P4 app | `src/panel/app/` | **Placeholder** `mountPanelUi` (title + close button). S-08 replaces it with the frame. |
| P5 loader | `src/panel/index.ts`, `loader.ts`, `loader-styles.ts` | `installDebugPanel(controller, options)`: locked-down host element in the top layer, event wall, toggle `Ctrl+Alt+Shift+P`, launcher + problems badge, lazy `import('./app')`, focus move / return, remount after removal |

**P4 contract today** (`src/panel/app/mount-panel-ui.ts`):
`mountPanelUi(root: ShadowRoot, controller, { document, storageKey, defaultDock,
onRequestClose }) → { unmount() }`.

**Test hosts:** `test/hostile-host/` (strict CSP + Trusted Types, hostile CSS,
real-app listeners, a zone.js page; it drives a **fake controller**,
`fake-controller.mjs`) and `test/e2e/panel-*.spec.mjs` (Playwright, ISO rules).

## 4. Decisions (HLD §10)

| State | Decisions |
|---|---|
| **Decided** (all of them, owner 2026-10-19) | D-01 … D-23. D-15 and D-18 were changed by the owner; D-05…D-11, D-16, D-17, D-21, D-22 were already built and accepted as built. |

**Owner changes that wave 3 must implement:**
- **D-18 / FR-HTTP-01:** the HTTP list is in **start order** like DevTools; a pending
  row keeps its place and updates in place when it finishes. **Column sorting:**
  click a header → ascending → descending → back to start order, with `aria-sort`.
  Filters and search apply on top. The model does **not** do this yet (R3).
- **D-15 / FR-WIN-07:** when the page goes **fullscreen**, the launcher and panel are
  raised back on top (shown again in the top layer) and stay usable. A host **modal
  dialog** makes the panel unclickable (browser rule), so a banner says so (§4.11).
  Needs a loader change (R2).
- **D-19:** Pause freezes the view only. **Capture on/off** (FR-ACT-09) is the "stop
  recording" switch, like DevTools' record button, and sits **next to Pause** in the
  toolbar.
- **D-23:** a host registering a `--dcp-*` name with `@property` is out of scope. The
  theme keeps CSS variables; only the loader uses literal colours.

## 5. Wave 3 — the plan

```
Step 0: wave-3.md + specs S-05…S-08 (docs)           → owner glance
Step 1: contract PR (small, you do it)               → wave branch
Step 2: S-05 ║ S-06 ║ S-07 ║ S-08 tracks              → each merged into the wave branch
Step 3: S-08 fresh-context review + confirmation; whole-wave review
Step 4: one PR wave branch → integration, for the owner
```

**Branches** (same as wave 2): wave branch `claude/dc-v2-wave3` from the integration
branch; tracks `claude/dc-v2-w3-05-http`, `-06-ws`, `-07-console`, `-08-frame`. One
agent, one branch and one PR per track into the wave branch, merged with a **merge
commit** after you re-run the checks and read the diff.

### Step 0 — plan and specs

- `docs/specs/wave-3.md`, shaped like `wave-2.md`: tracks, briefs, **owned paths**
  (no two tracks own the same file), the contracts each codes against, the shared
  CSS class table, a status table.
- `docs/specs/05-http-view/`, `06-ws-view/`, `07-console-view/`, `08-frame/`: each a
  `spec.md` (requirement rows citing HLD IDs + traceability table) and
  `prs/<nn>-*.md` briefs (Goal · Owned paths · Public API · Behaviour · Required
  specs · Verification · Out of scope).
- HLD §9.3 says which spec owns each FR/NFR — use it so nothing is missed.
- Docs only → no reviewer (§9).

### Step 1 — the contract PR (small; do it yourself)

Fix these **before** the tracks start, so they can work in parallel:

1. **View interface** — what the frame mounts per tab: a factory
   `(deps) → { element, destroy(), … }`, where `deps` holds the store / data source,
   `document`, the shadow root for sinks, a scheduler and the settings it needs. Put
   the type in P3 `views/` (P4 may import P3).
2. **`panelRoot: HTMLElement` in `MountPanelUiOptions`** — P4 finds the loader's
   `.dcp-root` by a hard-coded class string today. The loader passes `root`; update
   S-02's spec. Touches the loader (55 B left, R2).
3. **Stylesheet contract** — the loader's sheet holds the `:host` lockdown. The UI
   **appends** its sheet (`adoptedStyleSheets = [...existing, ui]`) and never
   replaces the list. Write down who owns the panel root's size and dock: today
   `loader-styles.ts` `.dcp-root` sets `height:40%`, bottom-docked, a background;
   S-08 will own size and dock, so decide which rules move.
4. **HTTP order (D-18)** — decide where start order and sorting live. Recommended:
   change `selectors.ts` `httpRows` to start order and add a sort key to the P1
   filter / store state, so S-05 only renders. Raise the spec floor.

### Step 2 — track notes

| Track | HLD | Must-knows |
|---|---|---|
| **S-05 HTTP** | FR-HTTP-01…07, §4.6, §5.6 | Start order + column sorting (D-18). Pending rows via `requestId`. Detail sub-tabs Headers / Payload / Response / Timing; JSON tree + **Raw** toggle (FR-HTTP-05); copy as cURL (`toCurl`). Sinks get `{ root }` so copy / download never touch `<body>`. A failed download is silent today (`download()` swallows errors) — show it if S-08 adds a toast. |
| **S-06 WebSocket** | FR-WS, §4.7 | Connections list + messages; message detail **Message** (JSON tree / Raw; binary as base64 + hex, a cut base64 tail shown as `…` *cut*) and **Info**. |
| **S-07 Console** | FR-CON, §4.8 | List in `seq` order, args in the shared JSON viewer (D-04), stacks. |
| **S-08 Frame** (security / hot path) | FR-WIN, FR-BAR, FR-ACT-09, §4.3–4.4, §4.9–4.12, ISO-* | Replaces the `src/panel/app/` placeholder. Title bar; tabs (Network › HTTP / WS sub-tabs, Console); resize, dock (bottom default, right option — D-03), maximize; rAF scheduler; settings storage (D-20: remember settings, size, dock, last tab, filter chips — **not** capture on/off or search text); banners (§4.11); toolbar: Pause, **Capture on/off next to Pause**, Clear, Export ▾, settings, maximize, close; status bar (FR-BAR-06); theme Auto (D-13); **fullscreen re-raise** (D-15, R2). Needs a fresh-context review. |

**For every track:**
- Views pass the panel's shadow root to the sinks (`{ root }`).
- UI APIs added in wave-2 reviews: tabs ids / `aria-controls`; list
  `onSelectionLost` (fires **before** the list re-renders — handlers must not
  re-enter `select` / `setItems`); JSON viewer `onError` / `badgeIcon`.
- `launcher-tokens.ts` keeps literal `dark: {…}` / `light: {…}` hex objects
  (`npm run contrast` parses it).
- Switch the e2e from the fake controller to the real `createCaptureController`
  once views exist.
- Add hostile-host e2e tests for each view (AGENTS rule 29) and raise both floors.

### Steps 3–4 — reviews and the wave PR

- S-08: a fresh-context adversarial review (a new chat / session that has not seen
  the code being written, given only the diff, the spec and the ISO rules) → fix
  round → a narrow confirmation review of the fix commits only.
- S-05…S-07: your own diff read + checks; add a review only if something looks risky.
- One whole-wave review focused on the **seams** between tracks, not each file again.
  Fix, then open `claude/dc-v2-wave3` → integration. **Do not merge it.**

## 6. Risks — raise them early

- **R1 — the UI chunk budget is likely too small.** The lazy chunk is already
  22,695 / 25,600 B with only the placeholder UI. Its entry `src/panel/app/index.ts`
  does `export * from '../views'`, which re-exports P2 + P1, so the model and UI
  blocks are probably already counted. That leaves ~**2.9 kB** for three views and
  the frame. In step 1, measure (`npm run build && npm run size`, look at what is in
  the chunk), then give the owner the number and ask for a budget decision
  (NFR-SIZE-01) **before** the tracks start.
- **R2 — the loader has 55 B left.** The fullscreen re-raise (a `fullscreenchange`
  listener, also while closed — update S02-07) and `panelRoot` both touch it. Expect
  to trim or ask the owner to raise the 4 kB budget.
- **R3 — HTTP order.** `selectors.ts` `httpRows` still lists finished rows by `seq`
  with pending rows last. D-18 needs start order + sorting (step 1, item 4).
- **R4 — prove fullscreen.** A Playwright test on the hostile host: after
  `element.requestFullscreen()` the launcher and panel are on top and clickable; with
  a modal `<dialog>` the banner shows.

## 7. Small leftovers from wave 2 (fix when you touch the file)

- `redactUserinfo` (`src/core/redact.ts`) misses URLs with a leading space and
  protocol-relative `//user@host`.
- The 04b virtual-list spec uses a hand-copied focus-ring CSS that can drift from the
  theme (the composition spec covers it).
- The e2e wall listener (`test/hostile-host/hostile.mjs` TYPES) does not watch
  pointermove, mouseover, touch, composition or drag events (unit specs do).
- A committed real-gesture copy test from inside the shadow root is still owed
  (proved once by hand in Chromium 141).
- The loader's `parseChord` is a deliberate copy of `install/shortcuts.ts`
  `parseShortcut` (size budget) — keep it.

## 8. Open items for the owner (do not decide for them)

- OPEN-02 (stations' CSP strictness), OPEN-03 (`bdi_W` practices — repo not
  reachable), OPEN-04 (copy / download from the shadow root on stations), OPEN-05
  (should opening need more than "flag on"), OPEN-06 (where the v2 repo will live).
- Budgets: R1 and R2.

## 9. How to work — token-saving rules (the owner's budget is tight)

1. **Don't read big files whole.** Search and read line ranges; open only the HLD
   section a step needs (§2).
2. **Work in small units.** One track at a time per chat / session, or at most two in
   parallel if your tool runs background agents. Four tracks → S-08 first (it fixes
   the frame the views mount in), then the views.
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

## 10. Environment — Windows laptop

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
- Branches as in §5. A second folder per branch is handy
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
