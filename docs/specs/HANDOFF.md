# Orchestrator handoff — debug-capture v2 (written 2026-10-16)

You are the new **orchestrator** for debug-capture v2. The previous session
ran out of budget, so it handed off here. Read this file first; read other
files only when a step needs them. Explain things to the owner in short,
plain words (root `CLAUDE.md`).

## 1. What this is (one screen)

- An on-screen debug panel (Network: HTTP + WebSocket, Console) for apps on
  air-gapped stations with no DevTools. A framework-free Web Component on top
  of a capture layer ("v1", kept unchanged in the host app at `src/debug-capture/`).
- v2 lives in `packages/debug-capture/`. **Source of truth:**
  `docs/design/HLD.md` (Draft 0.5). Rules for people and agents: `AGENTS.md`.
  Spec index and waves: `docs/specs/README.md`.
- Delivery is in waves of parallel tracks. Each track = one agent, one
  branch, one PR into a **wave branch**, merged with a merge commit after the
  orchestrator re-runs the checks and reads the diff. Security / hot-path /
  isolation specs (S-01, S-02, S-04, S-08) also get a fresh-context review, a
  fix round and a short confirmation review. Each wave ends with one PR
  (wave branch → integration branch) for the **owner** to review.
- Integration branch (never `main`): `claude/air-gapped-debug-logging-zkn1nr`.

## 2. Where things stand (updated 2026-10-18)

- S-00 Foundation: **PR #59** → integration, waiting for the owner's review. Do not merge it yourself.
- Wave 2 is complete on `claude/dc-v2-wave2`: 01a (#66), 01b (#60, #62), 02 (#67),
  03 (#61), 04a–c (#63–#65), confirmation fixes (#68). 935 specs, 19 e2e, `npm run check` green.
- Reviews done: S-00 ×2, S-01 + confirmation, S-02 isolation + fixes, S-04 + confirmation,
  whole-wave review (no blockers; findings in §5).
- The wave PR `claude/dc-v2-wave2` → integration is open for the owner. Do not merge it.

## 3. What to do next

1. Wait for the owner's review of PR #59 and the wave-2 PR, and their decision on the
   theme-colour question (§4).
2. Then plan wave 3 (§5), starting with the small contract PR.

## 4. Open items for the owner (do not decide for them)

- Decisions `D-03` … `D-22` in HLD §10 are **Proposed**; `D-08/09/10/17`
  were confirmed for S-00. `D-22` (node budget above a 1,080 px panel) is new.
- Open questions `OPEN-01` … `OPEN-06` (HLD §11) — most important: station
  Chrome/Edge versions.
- `bdi_W` practices comparison still waits for access to that repo.
- Theme colours vs. a host `@property --dcp-*`: **decided (a)** — out of scope, HLD D-23.
- OPEN-01 answered: Chrome 146.0.7680.72+ only, no Edge; the pre-114 fallbacks are removed.
- D-21 (problem rule) is still "Proposed" in HLD §10, but the code relies on it.

## 5. Notes for wave 3 (from wave-2 reports and reviews)

- Wave 3 = S-05 HTTP, S-06 WebSocket, S-07 Console, S-08 frame + toolbar +
  status (S-08 replaces S-02's placeholder `src/panel/app/`). Start with a
  small contract PR fixing the view interface the frame mounts.
- Views pass the panel's shadow root to the sinks (`{ root }`); a failed
  download is silent today (`download()` swallows errors) — S-08 may show it.
- S-02's e2e drives a fake controller — switch to the real
  `createCaptureController` once both are merged.
- A committed real-gesture copy test from inside the shadow root is still
  owed (01b proved it once by hand in Chromium 141).
- `launcher-tokens.ts` must hold literal `dark: {…}` / `light: {…}` hex
  objects (the theme check parses it).
- UI APIs added in review: tabs ids / `aria-controls`, list
  `onSelectionLost`, JSON viewer `onError` / `badgeIcon`.
- Contract PR for wave 3 (whole-wave review): add `panelRoot: HTMLElement` to
  `MountPanelUiOptions` (P4 finds `.dcp-root` by a hard-coded string today), and write
  down that the UI appends its stylesheet after the loader's (never replaces
  `adoptedStyleSheets` — that sheet holds the `:host` lockdown) and who owns the
  root's size and dock (`loader-styles.ts` `.dcp-root` rules today).
- Small leftovers: `onSelectionLost` fires before the list re-renders; the 04b spec's
  hand-copied focus CSS; `redactUserinfo` misses leading-space and `//host` URLs.
- The loader is at 4,043 of 4,096 B: any loader change needs trimming or a budget raise.

## 6. How to work here — token-saving rules (important)

The last session used almost the owner's whole budget. Follow these:

1. **Don't re-read big files whole.** Use `grep` / line ranges. The HLD is
   ~1,100 lines — open only the sections a step needs.
2. **At most 2–3 agents at once.** Seven in parallel was too costly.
3. **Small fixes: do them yourself**, or start a **fresh** agent with a short
   brief. **Never resume a long-history agent for a small fix** — each resume
   re-reads its whole history (100k–300k tokens).
4. **Model choice:** implementation and fix agents `model: "sonnet"`;
   fresh-context reviews of security / isolation / hot path may use the
   default model. Confirmation reviews: diff only, `model: "sonnet"`.
5. **Short briefs, short reports.** Briefs point to the spec file instead
   of repeating it; ask for reports ≤ 300–400 words.
6. **Run `npm run check` once per merge**, not repeatedly; read logs with
   `grep -E "TOTAL|spec count|e2e count|FAILED|core  "`, never `cat` a log.
7. **No reviewers for docs-only changes.**
8. **On a usage-limit stop:** if little work is left, finish it yourself or
   with a fresh small agent; resume the old agent only for large remaining work.
9. Keep owner updates short (a few lines or a small table).

## 7. Environment (a new container starts empty)

- Package checks: `cd packages/debug-capture && npm ci && CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check`.
  Node 22. Playwright finds its Chromium in `/opt/pw-browsers`; **never run
  `playwright install`**.
- Host app (must stay unaffected): from the repo root `npm ci`, then
  `npx tsc -p tsconfig.app.json --noEmit && npm run lint:layers`.
- Git worktrees per branch are handy (`git worktree add ../wt-x <branch>`);
  each needs its own `npm ci` in `packages/debug-capture`.
- GitHub through the MCP tools (`mcp__github__create_pull_request`,
  `mcp__github__merge_pull_request` with `merge_method: "merge"` and the full
  40-char `expectedHeadSha`). No `gh` CLI (only `gh api`).
- Commits end with the two trailer lines the session's system reminder gives
  (`Co-Authored-By: …`, `Claude-Session: …`); PR bodies end with the line the
  reminder gives. Never put a model name in commits or PRs. Never commit
  `/tmp` or scratchpad paths.
