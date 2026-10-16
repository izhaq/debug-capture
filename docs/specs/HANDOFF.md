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

## 2. Where things stand

| Item | Branch / PR | State |
|---|---|---|
| S-00 Foundation | `claude/dc-v2-s00-foundation`, **PR #59** → integration | Done, reviewed twice, green. **Waiting for the owner's review. Do not merge it yourself.** |
| Wave 2 branch | `claude/dc-v2-wave2` (based on S-00) | Has 01b, 03, 04a, 04b, 04c merged; 803 specs, `npm run check` green at `c7de85e` |
| 01b sinks + problem rule | PR #60, #62 | Merged |
| 03 panel model | PR #61 | Merged |
| 04a / 04b / 04c UI blocks | PR #63 / #64 / #65 | Merged after the S-04 review fix round; composition spec + barrel lines + D-22 in `c7de85e` |
| **01a core** (recorder, probes, controller) | `claude/dc-v2-w2-01a-core` @ `52a664b` | **Not merged.** S-01 review fixes done; already merged with the wave branch; the old orchestrator verified `npm run check` = exit 0, **879 specs**, core 11,740 B (budget 12,368). Next: open PR → wave2, merge. |
| **02 loader** | `claude/dc-v2-w2-02-loader` @ `d971648` | **Not merged, not yet verified by an orchestrator.** Loader + launcher + badge + lazy UI + hostile-host fixture (`test/hostile-host/`) + e2e (`test/e2e/panel-*.spec.mjs`) are committed. The agent was stopped (usage limit) while proving tests red by mutation. It merged the wave branch only up to 01b. |

Fresh-context reviews done: S-00 (2 rounds), S-01 (1 round + fixes; the
confirmation round is still owed), S-04 (1 round + fixes; the confirmation
round is still owed). S-02 has had **no** review yet.

## 3. What to do next (in order)

1. **Merge 01a.** Re-run `npm run check` on `claude/dc-v2-w2-01a-core` after
   merging the latest wave branch; open the PR → `claude/dc-v2-wave2`; merge;
   raise `test/unit/spec-floor.json` to the new count; update the status table
   in `docs/specs/wave-2.md`.
2. **Finish 02.** On `claude/dc-v2-w2-02-loader`: merge the wave branch
   (expect a conflict only in `playwright.config.mjs` — keep both the track's
   changes and the e2e guard `reporter` line), run `npm run check`, read the
   diff against `docs/specs/02-panel-loader/` (S02-01…17). Small gaps → fix
   them yourself. Then **one** fresh-context isolation review (ISO rules, the
   hostile host, focus, zone, CSP), a fix round, merge, raise both floors
   (`test/unit/spec-floor.json`, `test/e2e-floor.json`).
3. **Confirmation reviews, narrow:** S-01 (only the 01a fix commits since the
   review + PR #62) and S-04 (only the fix commits in #63–#65 + `c7de85e`).
   One reviewer each, diff only, report ≤ 400 words.
4. **Whole-wave review** (one reviewer) of `git diff
   origin/claude/dc-v2-s00-foundation...origin/claude/dc-v2-wave2 --
   packages/debug-capture` → fix → open the PR `claude/dc-v2-wave2` →
   `claude/air-gapped-debug-logging-zkn1nr` (note in the body: it contains
   S-00's commits until PR #59 merges). Do not merge it.
5. Tell the owner, briefly, what is ready and what needs their decision.

## 4. Open items for the owner (do not decide for them)

- Decisions `D-03` … `D-22` in HLD §10 are **Proposed**; `D-08/09/10/17`
  were confirmed for S-00. `D-22` (node budget above a 1,080 px panel) is new.
- Open questions `OPEN-01` … `OPEN-06` (HLD §11) — most important: station
  Chrome/Edge versions.
- `bdi_W` practices comparison still waits for access to that repo.

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
