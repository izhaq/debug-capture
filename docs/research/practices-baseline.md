# How We Build Here: Baseline and "v2" Rules

**Status:** Research, 2026-10-14. Analysis only. No code changed.
**Branch read:** `claude/dc-research-practices` (same as the integration
branch `claude/air-gapped-debug-logging-zkn1nr` at `cc6672f`, after PR #47).
**What this is for:** the owner wants a second version of *how* we build in
this repo (rules, lints, `AGENTS.md`, AI practices, structure). They also want
to borrow ideas from another project, `bdi_W`. That repo is on a private
network this environment cannot reach, so this document covers only:

1. what this repo has today, and what the `debug-capture` work taught us;
2. a proposed v2 rule set;
3. an empty comparison table for `bdi_W` (section 4), to fill in later.

Nothing below guesses what `bdi_W` contains.

**Words used:**
- *Enforced* = a tool fails when the rule breaks (compiler, script, test).
  Note: today **every** tool has to be run by hand. Nothing runs on its own.
- *Written-only* = the rule lives in a doc or a review. Nothing checks it.
- *Barrel* = an `index.ts` that re-exports a folder's public names.
- *Brief* = the per-PR plan file an agent works from.

---

## 1. Summary (one screen)

### The 10 most valuable practices we already have

| # | Practice | Proof |
|---|---|---|
| 1 | **Master plan + one brief per PR.** Each brief lists owned paths, exact public names, required spec names, the check commands, and what is out of scope. | `specs/4-debug-capture/plan.md`, `prs/*.md` (12 briefs, same headings) |
| 2 | **Contract first.** One file holds a feature's shared types. Six PRs then built in parallel against it with no file overlap. | `capture-contract.ts`, `auth-contract.ts`, `api-contract.ts` |
| 3 | **Strict layers with a checker.** Each layer imports only the barrel of the layer above, and a script fails if one does not. The script tests itself (51 cases). | `scripts/check-debug-capture-layers.js`, `npm run lint:layers` |
| 4 | **Inject the outside world.** Globals, clock, sockets come in as parameters or DI tokens, so specs pass fakes and never patch `window`. | `api-tokens.ts`, every probe's `host` param, `core/clock.ts` |
| 5 | **Test first, and "Prove-It" for fixes.** A fix starts with a spec that fails. Mutation checks prove a spec can fail. | PR #40: 63 red vs stubs; #42: 8 red; #44: 25 red; #38, #39 mutation-checked |
| 6 | **The orchestrator re-checks every PR on its own head** before merge: two type-checks, layer check, focused + full suite, "only owned paths changed". | `plan.md` → Process; every PR body "Checks (re-run by the orchestrator)" |
| 7 | **Fresh-context adversarial review**, then a second review to confirm. Reviewers prove each finding with an experiment spec. | Found 2 blockers + 4 should-fix (PRs #42, #43), then 6 more (PR #44) |
| 8 | **Real-browser end-to-end checks**, not just unit tests. | Playwright 15/15 (#41), 18/18 (#46); real React harness 7/7 (#47) |
| 9 | **Strict compiler settings** for TS and Angular templates. | `tsconfig.json`: `strict`, `noImplicitOverride`, `strictTemplates`, … |
| 10 | **Write down why, and close the loop.** Decision records, learning docs, and a plan that ends with status, numbers, deviations, follow-ups. | `docs/intent/`, `docs/learning/`, `plan.md` → Status |

Also good, but smaller: conventional commits with trailers (100% inside the
feature), an integration branch with merge commits, `provideX()` one-call
wiring seams, "grounded in real source" briefs (PR 15 read React's build
instead of guessing).

### The 10 biggest gaps

| # | Gap | Why it matters |
|---|---|---|
| 1 | **No `AGENTS.md`.** One command (`iz-code-simplify`) already says "Read AGENTS.md" and finds nothing. | Codex, Cursor, Copilot, Gemini and others read `AGENTS.md`. Today our rules are split over `CLAUDE.md`, a Cursor rule and a 265-line feature plan. |
| 2 | **No CI** (`.github/` does not exist). No PR template, no required checks. | Every check depends on someone remembering to run it. Nothing blocks a bad merge. |
| 3 | **No ESLint / angular-eslint.** Yet the code has 6 `eslint-disable` comments. | "No `any`", "no `console`", "no `Date.now()`" are review-only. `strict` does not ban an explicit `any`. |
| 4 | **No Prettier or format check.** `.editorconfig` works only in editors that read it. | Style drifts; review time goes to whitespace. |
| 5 | **No git hooks, no commit-message lint.** | Conventional commits: 124 of 185 non-merge commits overall. The feature hit 100% only because briefs said so. |
| 6 | **No one-shot test command.** `npm test` is watch mode in a visible Chrome (`singleRun: false`). The plan says `<run-tests.sh>`, a script that is not in the repo. | Every agent re-invents how to run tests headless. |
| 7 | **No coverage gate.** `karma-coverage` is installed and set up, but has no thresholds and is not a default reporter. | Coverage can drop silently. |
| 8 | **Claude and Cursor copies are kept by hand and have drifted.** `iz-ship.md` differs; the "explain simply" rule exists twice. Skills are generic: 14 of 23 mention React/Jest/Vitest/`npm run lint`. Commands write to `SPEC.md` and `tasks/plan.md`, which this repo never uses. | Agents get advice that does not fit this stack, and fixes land in one copy only. |
| 9 | **Architecture rules outside debug-capture are written-only.** The `_external/` rule for `system-experiments` is already broken once (a spec imports `components/` directly). | The layer checker shows the fix works; it covers one feature only. |
| 10 | **`specs/` layout is mixed** (numbered `1-…4-` folders next to unnumbered ones and `active/`), and two committed briefs point at `/tmp/...scratchpad` evidence that no longer exists. An empty `portability-guide.md` sits at the root. | Hard for a new agent to know where a plan goes or to follow a link. |

Smaller gaps: `.nvmrc` says Node 16.20.2 but there is no `engines` field
(agents here ran Node 22); bundle budgets are checked only on a manual
production build; wall-clock specs had no rule for margins (one flaked in 2 of
4 runs, fixed in PR #45).

---

## 2. Inventory

Key for the last column: **keep** = good as is; **improve** = right idea,
needs work; **add** = missing.

### 2.1 AI and agent setup

| Item | Where | Enforced or written-only | Verdict |
|---|---|---|---|
| Project instructions: "explain simply" + pointer to the workflow | `CLAUDE.md` (24 lines) | Written-only (loaded by Claude Code) | **improve**: move shared rules to `AGENTS.md`, keep `CLAUDE.md` as a short pointer plus Claude-only notes |
| Same "explain simply" rule for Cursor | `.cursor/rules/explain-simply.mdc` (`alwaysApply: true`) | Written-only (loaded by Cursor) | **improve**: generate from one source, or point it at `AGENTS.md` |
| 23 process skills (spec, plan, TDD, review, security, perf, ship, …) — 6,450 lines | `.claude/skills/*/SKILL.md` | Written-only | **improve**: generic, not Angular-specific; 14 of 23 use React/Jest/Vitest examples. Add a short "in this repo" note per skill (Karma/Jasmine, `tsc` checks, `lint:layers`) |
| Skill reference checklists (a11y, perf, security, testing, orchestration) | `.claude/skills/<7 skills>/references/*.md` | Written-only | **improve**: the same 5 files are copied into 7 skills (identical content); keep one copy |
| 3 personas: `code-reviewer`, `security-auditor`, `test-engineer` | `.claude/agents/*.md` | Written-only | **keep**; add a fourth "adversarial reviewer" persona (see 2.4) |
| Persona guide | `.claude/agents/README.md` | Written-only | **improve**: links to `../references/orchestration-patterns.md`, which does not exist at that path |
| 7 slash commands `/iz-spec … /iz-ship` | `.claude/commands/*.md` | Written-only | **improve**: `iz-spec` saves `SPEC.md` at the root and `iz-plan` saves `tasks/plan.md`; this repo uses `specs/<n>-<name>/`. `iz-code-simplify` reads a missing `AGENTS.md` |
| Cursor mirror of skills, agents, commands | `.cursor/{skills,agents,commands}` | Written-only | **improve**: identical to `.claude/` except `commands/iz-ship.md` (Cursor uses `generalPurpose` subagents). Nothing keeps the two in sync |
| Claude settings / hooks | `.claude/settings.json` | — absent | **add**: e.g. a hook that runs the fast checks before a commit |
| `AGENTS.md` (cross-tool) | repo root | — absent | **add** (gap 1) |
| Copilot instructions | `.github/copilot-instructions.md` | — absent | optional; can point at `AGENTS.md` |
| VS Code | `.vscode/extensions.json` (Angular Language Service), `launch.json`, `tasks.json` | Editor only | **keep**; later add ESLint + Prettier extension recommendations |
| The orchestration pattern we actually used (master plan, briefs, worktrees, re-verify, adversarial review) | only in `specs/4-debug-capture/plan.md` → Process | Written-only, one feature | **improve**: lift into a reusable skill or `AGENTS.md` section (it is our best process and lives in a feature folder) |

### 2.2 Rules and restrictions in force

| Item | Where | Enforced or written-only | Verdict |
|---|---|---|---|
| `strict`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames` | `tsconfig.json` | **Enforced** by `tsc` / `ng build` / `ng test` | **keep**; consider `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` |
| Angular `strictTemplates`, `strictInjectionParameters`, `strictInputAccessModifiers` | `tsconfig.json` → `angularCompilerOptions` | **Enforced** by the Angular compiler | **keep** |
| `lib: es2020 + dom`, TypeScript `~5.1.6` (no `.at()`, `Object.hasOwn`, `using`) | `tsconfig.json`, `package.json` | **Enforced** by `tsc` (missing APIs do not type-check) | **keep**; the plan's note explaining it is useful, move it to `AGENTS.md` |
| Server: `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch` | `server/tsconfig.json` | **Enforced** by `npm run server:build` | **keep** |
| UTF-8, 2 spaces, final newline, single quotes in `.ts` | `.editorconfig` | Editor only | **improve**: add Prettier + a check |
| Bundle budgets: initial 850 kB warn / 1 MB error; component style 4 kB / 6 kB | `angular.json` → production | **Enforced**, but only when someone runs `ng build` | **improve**: run in CI. Today: 829.64 kB, 20 kB under the warning |
| Unit tests: Karma + Jasmine, Chrome, `singleRun: false` | `karma.conf.js` | **Enforced** when run; watch mode by default | **improve**: add `test:ci` (ChromeHeadless, single run) |
| Coverage reporter (html + text-summary), no thresholds | `karma.conf.js` | Not checked | **add** thresholds (`coverageReporter.check`) |
| Node version 16.20.2 | `.nvmrc` | Written-only (no `engines`) | **improve**: add `engines`; decide if 16 is still true |
| Debug-capture import rules 1–7 (one barrel per layer, zero packages below L6, consumers use L5/L6 barrels only) | `plan.md` → Import rules; `scripts/check-debug-capture-layers.js` | **Enforced** by `npm run lint:layers` (+ `--self-test`, 51 cases). Run by hand | **keep**; run it in CI and a pre-commit hook |
| Design rule: probes reversible, `dispose()` idempotent | `plan.md` → Design rules | **Enforced** by specs | **keep** |
| Design rule: probes take an injected host; specs never touch `window` | `plan.md`; stated first in `api-tokens.ts` | Specs follow it; nothing checks it | **keep**; make it an app-wide rule |
| Design rule: never break the app (wrap bookkeeping, call the original exactly once) | `plan.md` | **Enforced** by specs ("never throws when recording fails", mutation-checked) | **keep** |
| Design rule: the recorder owns all policy | `plan.md` | Written-only (review) | **keep** |
| Design rule: bounded memory | `plan.md` | **Enforced** by specs (budgets, ring buffer, timing guards) | **keep** |
| No `Date.now()` outside `core/clock.ts` | `plan.md` → Design rules + DoD | Written-only (true today: 1 hit) | **improve**: ESLint `no-restricted-syntax` |
| No `console.*` in `src/debug-capture/` (except the probe / React adapter) | `plan.md` | Written-only | **improve**: ESLint `no-console` with path overrides |
| No `any`; `unknown` at boundaries | `plan.md` → Code standards | Written-only (true today: 0 hits in `src/`) | **improve**: `@typescript-eslint/no-explicit-any` |
| Barrels export public names only | `plan.md` | Partly: `public-api.spec.ts` checks the chain, not the full list | **improve**: a spec that snapshots each barrel's export names |
| Specs next to code (`x.ts` + `x.spec.ts`), no `TestBed` in framework-free layers | `plan.md` | Written-only (convention holds: 57 spec files) | **keep** |
| Doc comments explain *why* | `plan.md` | Written-only | **keep** |
| Conventional commits, scoped | `plan.md` → Code standards; briefs | Written-only | **improve**: commitlint + hook |
| Definition of done (all checks green, only owned paths changed, exact API) | `plan.md` | Orchestrator by hand | **improve**: a script that diffs changed paths against the brief's owned list |
| `eslint-disable` comments (6) | `scripts/*.js`, `system-experiments-mock.providers.ts` | Dead: there is no ESLint | **add** ESLint so they mean something |
| ESLint / angular-eslint config | — | absent | **add** |
| Prettier config | — | absent | **add** |
| CI (`.github/workflows`) | — | absent | **add** |
| Pre-commit hooks (husky / lint-staged) | — | absent | **add** |
| Commit-message lint (commitlint) | — | absent | **add** |
| PR template / review checklist in repo | — | absent (lives only in persona files) | **add** `.github/pull_request_template.md` |

### 2.3 Architecture and file structure

| Item | Where | Enforced or written-only | Verdict |
|---|---|---|---|
| `src/app/features/<feature>/` — one folder per feature (`auth`, `debug-capture`, `system-experiments`) | `src/app/features/` | Convention | **keep**; write it down |
| `src/app/pages/<feature>/` — host page, route module, live vs mock providers | `src/app/pages/system-experiments/` | Convention | **keep**; the "feature is portable, page is host glue" split is clear |
| `src/app/components/app-*/` — shared UI primitives, each with its own module | `src/app/components/` | Convention | **keep** |
| `src/app/demo/` — component playground page | `src/app/demo/` | Convention | **keep** |
| Inside a feature: `api/`, `boards/`, `components/`, `shared/`, `<feature>-shell/` | `features/system-experiments/` | Convention, one feature | **keep** as the template for big features |
| `_external/` anti-corruption folder: the feature reaches outside only through it | `features/system-experiments/_external/ui-primitives.ts`; `specs/sys-mode-dashboard/migration-guide.md` | Written-only — **already broken** in `board-footer.component.spec.ts` | **improve**: generalise `lint:layers` into a boundary checker |
| Contract file per feature: types + tokens + defaults, mirrors the spec | `auth-contract.ts`, `api/api-contract.ts`, `contract/capture-contract.ts` | Convention | **keep**; make it a rule |
| `InjectionToken`s for config and outside dependencies; self-defaulting tokens where safe (`AUTH_API_CONFIG` with `providedIn: 'root'`); no default where a default would hide a bug (`DEBUG_CAPTURE_SESSION`) | `auth-contract.ts`, `api-tokens.ts`, `debug-capture.tokens.ts` | Convention + a spec for the debug token | **keep**; write the "when to self-default" rule down |
| `provideX(config?)` one-call wiring seam returning a provider array | `auth.providers.ts`, `debug-capture.providers.ts` | Convention | **keep** |
| File names: kebab-case with a role suffix (`.component`, `.service`, `.store`, `.guard`, `.interceptor`, `.providers`, `.tokens`, `.probe`, `.sink`, `.models`, `.types`) | all of `src/` | Convention (Angular CLI style) | **keep**; ESLint can check selectors / class suffixes |
| Mixed NgModule + standalone: 10 NgModules, 2 standalone components; `AppModule` still the root | `src/app/` | — | **improve**: decide direction (Angular 16 favours standalone) and write it down |
| `OnPush`: 14 of 20 components | `src/app/` | Convention, not universal | **improve**: make OnPush the default, ESLint `prefer-on-push-component-change-detection` |
| Framework-free core with framework seams (L6 Angular, L6 React) | `src/debug-capture/`, `src/app/features/debug-capture/` | **Enforced** by `lint:layers` | **keep**; the model for any portable module |
| `specs/<n>-<name>/` with `spec.md`, `plan.md`, `prs/` | `specs/3-login-auth`, `specs/4-debug-capture` | Convention | **keep**; this is the newest shape |
| Older spec folders in other shapes: unnumbered (`cell-flash-on-change`, `sys-mode-dashboard`), `active/`, spec-kit style (`1-config-dashboard` with `tasks.md`, `checklists/`) | `specs/` | — | **improve**: one layout; move or label the old ones |
| `docs/intent/<feature>.md` — decision record ("why"): alternatives, architecture, security, limits, decisions | `docs/intent/` | Convention | **keep** |
| `docs/learning/` — walkthroughs for a reader new to a stack | `docs/learning/` | Convention | **keep** |
| Feature README next to portable code | `src/debug-capture/README.md` | Convention | **keep** |
| Leftovers: empty `portability-guide.md`; `tools/` and `scripts/` both hold rename tools | repo root | — | **improve**: delete or fill; one folder for scripts |

### 2.4 Process we used for debug-capture (PRs #34–#47)

| Item | Where | Enforced or written-only | Verdict |
|---|---|---|---|
| Master plan: why, scope in/out, layer diagram, import rules, design rules, code standards, PR table with waves and owned paths, process, verification, definition of done | `specs/4-debug-capture/plan.md` | Written-only | **keep**; turn into a template |
| Per-PR brief, same headings each time: Goal · Owned paths · Public API (exact names) · Behavior · Required specs (names are the invariants) · Verification · Out of scope | `specs/4-debug-capture/prs/*.md` | Written-only | **keep**; turn into a template |
| File ownership per PR → 6 agents in parallel, zero merge conflicts. PR 1 pre-created every barrel so wave-2 PRs each edited only their own | `plan.md` → PRs | Checked by the orchestrator by hand | **keep**; automate the owned-paths check |
| Integration branch; each PR targets it; merge commits; `main` untouched until the whole plan is done | `plan.md` → header | Written-only | **keep** |
| One worktree + branch per PR | `plan.md` → Process | Written-only | **keep** |
| Test first; Prove-It for fixes (red spec first); mutation checks to prove a spec can fail | briefs; PR bodies #38–#44 | Written-only (evidence in PR bodies) | **keep**; make "say red count in the PR" a rule |
| Orchestrator re-runs every check on the PR head, checks scope, reads the diff, then merges | `plan.md` → Process | Written-only | **keep**; CI would do the mechanical half |
| Re-verify the merged branch after each wave | `plan.md` → How it was verified | Written-only | **keep** |
| Fresh-context adversarial review after wave 2; findings proven with experiment specs; fixes as briefs (PR 9, 10); second review confirms and finds more (PR 12) | `prs/09`, `10`, `12`; PRs #42–#44 | Written-only | **keep**; it found what self-review missed: a page freeze from one `console.log` of a shared object graph (490 ms, 33 MB stored), lost XHR retries, secret leaks via `Map`, stacks and nested URLs |
| Real-browser end-to-end (Playwright on the served app with the Node server, zone.js, real globals) | PR #41, #46; React harness #47 (outside the repo) | Written-only; the scripts are **not** in the repo | **improve**: commit a minimal e2e script so it can be re-run |
| Conventional commits with `Co-Authored-By` + `Claude-Session` trailers; PR bodies with What / Review notes / Checks | git log, PRs #34–#47 | Written-only | **keep**; add commitlint |
| Closing the loop: plan updated with status, numbers, deviations, follow-ups | `plan.md` → Status (PR #46) | Written-only | **keep** |
| "Grounded in real source": brief for React was taken from `@types/react-dom@19.3.0` and react-dom's build, and the implementer still found the brief incomplete and followed the source | `prs/15-react-adapter.md`, PR #47 | Written-only | **keep**; rule: "verify, do not guess" for any outside API |

**What cost time (and the rule each one suggests):**

| What happened | Cost | Rule it suggests |
|---|---|---|
| Plan error: import rule (b) as written let `src/debug-capture/index.ts` skip layers. The implementer caught it and narrowed the rule (PR #34). | Small; caught early because the checker had a self-test | Every rule a tool enforces gets a self-test table, including "should fail" cases. |
| Plan error: the planned "token has no root default" spec could not fail (a `null` factory and "not found" both give `null`). Implementer added an assertion that can fail (PR #35). | Small | Each required spec must be shown to fail once (mutation or red-first). Briefs say "prove it can fail". |
| Plan gap: planned `ClipboardHost` type left out `activeElement`, needed for a behaviour the same plan required (PR #36). React fallback in the brief was incomplete (PR #47). | Small | Implementers may fix a brief when the brief contradicts itself or the real source; they must say so in "Review notes". |
| Self-review missed real defects that a fresh reviewer found: 2 blockers + 4 should-fix, then 6 more. | Three extra PRs (#42, #43, #44) | Any change to security-sensitive or hot-path code gets a fresh-context adversarial review before it reaches `main`. |
| A fix made things slower: PR 9's redaction made a 10 MB form body take 863 ms; PR 12 fixed it (2–8 ms). | One more review round | Fixes on hot paths come with a timing spec for the old worst case. |
| Flaky wall-clock spec: limit 50 ms, measured 45–52 ms under full-suite load; failed 2 of 4 runs (PR #45). | A test-only PR, plus doubt in the suite | Timing guards sit several times above the measured worst and several times below the regression; the comment says both numbers. Run the full suite 3× before calling a timing spec done. |
| Bundle target missed: plan said < 15 kB, real is ~29 kB raw (~9 kB gzip). | Open follow-up | Size targets go in the budget file or a size check, not only in prose. |
| Briefs 09 and 12 link to evidence under `/tmp/.../scratchpad/`, gone after the session. | Broken links in committed docs | Never commit a link to a temp path; copy the evidence into the repo or into the PR body. |
| No in-repo test runner script (`<run-tests.sh>` placeholder). | Each agent set up headless Karma again | Commit `npm run test:ci`. |
| PR number 11 reserved for a closing doc, then re-used as 14. | Confusing numbering | Number PRs as they are created, not in advance. |

---

## 3. Proposed "v2" rule set

Short rules, ready to paste. **[true]** = already how we work (just not
written in one place). **[new]** = not true today.

### 3.1 For `AGENTS.md`

**Talking**
1. [true] Explain in short, plain words; main point first. Not for code, commits or PR text.

**Before coding**
2. [true] Non-trivial work starts with `specs/<n>-<name>/spec.md` and `plan.md`. Multi-PR work also gets `prs/<nn>-<slug>.md`, one brief per PR.
3. [true] A brief has: Goal · Owned paths · Public API (exact names) · Behavior · Required specs · Verification · Out of scope.
4. [true] Shared types go in one contract file first. Parallel PRs code against the contract, never against each other.
5. [new] Do not guess outside APIs (Angular, React, browsers, libraries). Read the real types or source and name the version in the brief.
6. [true] If a brief is wrong or contradicts the real source, fix it in the code, and say so under "Review notes" in the PR.

**Code**
7. [true] TypeScript strict. No `any`; use `unknown` and narrow. Respect `lib: es2020` and TS 5.1 (no `.at()`, `Object.hasOwn`, `replaceAll`, `using`).
8. [true] Inject the outside world: globals, time, sockets, storage come in as a parameter or an `InjectionToken`. Specs pass fakes and never patch `window`.
9. [true] A feature exposes one wiring call, `provideX(config?)`, and one contract file. Tokens self-default only when a missing provider is harmless.
10. [true→new for all features] A feature is imported only through its barrel. A portable feature reaches outside only through `_external/`. A checker enforces it.
11. [new] New components are `OnPush`. New UI is standalone unless it joins an existing NgModule (decide and record this).
12. [true] Doc comments say *why*, not *what*.
13. [true] Specs sit next to code (`x.ts`, `x.spec.ts`). No `TestBed` in framework-free code.

**Tests**
14. [true] Test first. For a bug: write the failing spec, see it fail, then fix (Prove-It). Say the red count in the PR.
15. [new] Every required spec must be shown to fail once (red-first or a quick mutation).
16. [new] Timing specs: limit several times above the measured worst and several times below the regression; the comment states both. Run the full suite 3× before merging one.

**Checks (all must pass before a commit)**
17. [true, manual today] `npx tsc -p tsconfig.spec.json --noEmit` and `npx tsc -p tsconfig.app.json --noEmit`.
18. [true, manual today] `npm run lint:layers` (and later `npm run lint:boundaries`).
19. [new] `npm run lint` (ESLint) and `npm run format:check` (Prettier).
20. [new] `npm run test:ci` — headless, single run, coverage thresholds.
21. [true, manual today] `npx ng build` when a PR changes what ships; report the bundle delta.

**Git and PRs**
22. [true] Conventional commits: `type(scope): subject`. Trailers as the session asks.
23. [true] Change only the paths the brief owns.
24. [true] Big work goes to an integration branch; PRs merge into it with merge commits; `main` waits until the plan is done and reviewed.
25. [true] PR body: What · Review notes · Checks (with numbers).
26. [new] Never commit links to temp paths (`/tmp`, scratchpads). Put evidence in the repo or the PR body.

**Review**
27. [true] The orchestrator re-runs every check on the PR head and reads the diff before merging.
28. [true→new as a rule] Security-sensitive or hot-path work gets a fresh-context adversarial review that proves each finding with a spec, and a second pass to confirm the fixes.
29. [true] User-facing or global-patching work gets a real-browser end-to-end check. [new] Commit the script.
30. [true] When a plan is done, update it: status, numbers, deviations, follow-ups.

**Where things live**
31. [true] `specs/` = what and how (spec, plan, briefs). `docs/intent/` = why (decision records). `docs/learning/` = walkthroughs. Portable code keeps a `README.md` next to it.

### 3.2 For lint and tooling

| # | Rule / tool | Status | Notes |
|---|---|---|---|
| T1 | Keep the current `tsconfig` strict flags and Angular strict template flags | [true] | Consider adding `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` (check the cost first) |
| T2 | `angular-eslint` + `typescript-eslint` (versions that match Angular 16) | [new] | Makes the 6 existing `eslint-disable` comments real |
| T3 | `@typescript-eslint/no-explicit-any: error` | [new] | 0 hits in `src/` today, so it is free |
| T4 | `no-console: error`, with overrides for the console probe, the React adapter and mocks | [new] | Turns a written rule into a check |
| T5 | `no-restricted-syntax` for `Date.now()` in `src/debug-capture/**` except `core/clock.ts` | [new] | 1 legal hit today |
| T6 | `@angular-eslint/prefer-on-push-component-change-detection: warn` | [new] | 14 of 20 already OnPush |
| T7 | Prettier with `singleQuote`, 2 spaces; `format:check` script | [new] | Matches `.editorconfig` |
| T8 | `lint:layers` stays; add `lint:boundaries` for feature barrels and `_external/` (reuse the same script shape, with a self-test) | [true] / [new] | Would have caught the `board-footer` spec import |
| T9 | `test:ci`: `ng test --watch=false --browsers=ChromeHeadless --code-coverage` | [new] | Replaces the missing `<run-tests.sh>` |
| T10 | Coverage thresholds in `karma.conf.js` (`coverageReporter.check`), set at today's level, then raised | [new] | Measure first |
| T11 | CI workflow on every PR: install, both `tsc` checks, `lint`, `format:check`, `lint:layers`, `test:ci`, `ng build` (budgets) | [new] | First real gate in this repo |
| T12 | Pre-commit hook (husky + lint-staged): format + lint staged files; `tsc` + `lint:layers` on push | [new] | Fast feedback for humans and agents |
| T13 | commitlint with the conventional config; allowed scopes listed | [new] | 124/185 today |
| T14 | `engines.node` in `package.json`; align `.nvmrc` with what we really run | [new] | `.nvmrc` 16.20.2 vs agents on 22 |
| T15 | One source for agent files: `AGENTS.md` at the root; `CLAUDE.md` and `.cursor/rules/*.mdc` point to it; a small script (or CI check) keeps `.claude/` and `.cursor/` copies in sync | [new] | Fixes the `iz-ship` drift and the double "explain simply" rule |
| T16 | `.github/pull_request_template.md` with What / Review notes / Checks | [new] | We already write PRs this way |
| T17 | An "owned paths" check: compare `git diff --name-only` with the brief's list | [new] | Automates a manual DoD step |

---

## 4. Comparison template for `bdi_W`

**How to use:** open `bdi_W`, look for each item, fill the two right-hand
columns. "Ours" is filled from sections 2–3. Leave a cell empty if `bdi_W`
has nothing there; that is a finding too.

### 4.1 Agent and AI files

| What to look for in `bdi_W` | Ours today | What `bdi_W` does | Adopt? (yes / no / adapt) |
|---|---|---|---|
| `AGENTS.md`: exists? where? how long? | none | | |
| `AGENTS.md` sections (setup, commands, code style, testing, PR rules, "never do", where things live) | n/a | | |
| Nested `AGENTS.md` per folder/package? | none | | |
| `CLAUDE.md` / `.cursor/rules` / `.github/copilot-instructions.md`: do they point to `AGENTS.md` or repeat it? | `CLAUDE.md` + 1 Cursor rule, duplicated | | |
| How Claude and Cursor (or other tools) copies are kept in sync | by hand; drifted | | |
| Skills / prompts: generic or tailored to their stack? | generic (React/Jest examples) | | |
| Agent personas (reviewer, security, tests, other) | 3 personas | | |
| Slash commands / prompt files and what they chain | 7 `/iz-*` commands | | |
| Hooks or settings for agents (`.claude/settings.json`, permissions, pre-tool hooks) | none | | |
| Rules for multi-agent / parallel work (ownership, worktrees, briefs) | in `specs/4-debug-capture/plan.md` only | | |
| Rules for reviews by a second agent | done in practice, not written as a rule | | |
| MCP servers or tools they configure for agents | none in repo | | |

### 4.2 Lint, format and compiler

| What to look for in `bdi_W` | Ours today | What `bdi_W` does | Adopt? |
|---|---|---|---|
| ESLint config file and plugins (angular-eslint, typescript-eslint, import, rxjs, sonar, …) | none | | |
| Their custom or "error"-level rules (list them) | n/a | | |
| Rules banning `any`, `console`, deep imports, `Date.now` | written-only | | |
| Import / boundary rules (eslint `import/no-restricted-paths`, Nx `enforce-module-boundaries`, custom script) | `lint:layers` for one feature | | |
| Prettier config | none | | |
| `tsconfig` flags beyond `strict` | `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch` | | |
| Angular compiler strict flags | all three on | | |
| Stylelint / SCSS rules | none | | |
| Angular version and standalone vs NgModule policy | 16; mixed | | |
| Change-detection policy (OnPush, signals) | 14/20 OnPush, not a rule | | |

### 4.3 Tests and gates

| What to look for in `bdi_W` | Ours today | What `bdi_W` does | Adopt? |
|---|---|---|---|
| Test runner (Karma, Jest, Vitest, Web Test Runner) and the CI command | Karma/Jasmine, watch mode only | | |
| Coverage thresholds (numbers, per folder?) | none | | |
| e2e tool (Playwright, Cypress) and what runs in CI | ad-hoc Playwright, not committed | | |
| Rules for flaky / timing tests | learned in PR #45, not written | | |
| Test naming / placement conventions | `x.spec.ts` next to `x.ts` | | |
| Bundle-size check (budgets, size-limit) and where it runs | budgets, manual build only | | |

### 4.4 CI, git and review

| What to look for in `bdi_W` | Ours today | What `bdi_W` does | Adopt? |
|---|---|---|---|
| Pipeline file (`azure-pipelines.yml` or similar): stages and gates | none | | |
| Branch policies (required reviewers, required build, linked work items) | none | | |
| PR template | none | | |
| Review checklist (file or wiki) | in persona files only | | |
| Commit message rules and how they are checked | conventional, written-only | | |
| Git hooks (husky, lint-staged, pre-commit) | none | | |
| Branching model (integration branches, release branches) | integration branch per feature | | |
| Versioning / changelog | none | | |
| Security scanning (dependency audit, secrets scan) | none | | |

### 4.5 Architecture and docs

| What to look for in `bdi_W` | Ours today | What `bdi_W` does | Adopt? |
|---|---|---|---|
| Top-level `src/app` layout (core / shared / features / pages / libs) | `features/`, `pages/`, `components/`, `demo/` | | |
| Feature folder template (what sub-folders, what files) | `api/`, `components/`, `shared/`, `<feature>-shell/` (one feature) | | |
| Naming rules (files, selectors, class suffixes, prefixes) | Angular CLI style, `app-` prefix | | |
| How config and outside dependencies are injected (tokens, `provideX()`, environment files) | contract file + tokens + `provideX()` | | |
| State management (services, signals, NgRx, component store) | services / stores (`session.store.ts`) | | |
| Spec / plan / design-doc layout and templates | `specs/<n>-<name>/`, mixed older shapes | | |
| Decision records (ADR) format and location | `docs/intent/` | | |
| Docs for onboarding / learning | `docs/learning/`, `README.md` | | |
| Anything about portability or "extract to another repo" | `_external/`, debug-capture layers | | |

### 4.6 Questions to answer after filling it in

1. Which `bdi_W` rules are **enforced by a tool**, and which are only written?
2. What does `bdi_W` have that would have saved time in the "what cost time" table (section 2.4)?
3. What do we do that `bdi_W` does not (master plan + briefs, adversarial review, layer checker)? Should it flow back?
4. Does anything in `bdi_W` clash with a [true] rule in section 3? Which one wins, and why?
5. Can we copy any of their config files as-is (ESLint, pipeline, PR template), given our Angular 16 / TS 5.1 / Node versions?

---

## Appendix: what was read

- Agent setup: `CLAUDE.md`, `.claude/{skills,agents,commands}`, `.cursor/{rules,skills,agents,commands}`, `.vscode/*.json`. `.claude/` vs `.cursor/` compared file by file.
- Config: `tsconfig*.json`, `server/tsconfig.json`, `.editorconfig`, `.nvmrc`, `.gitignore`, `angular.json`, `karma.conf.js`, `package.json`. Checked absent: `.github/`, `.husky/`, `.eslintrc*`, `.prettierrc*`, `commitlint*`, `.lintstagedrc*`, `AGENTS.md`, `.claude/settings.json`.
- Code: `src/app/` tree, `app.module.ts`, `app-routing.module.ts`, `main.ts`, `auth-contract.ts`, `auth.providers.ts`, `api-tokens.ts`, page providers, `debug-capture.providers.ts`, `_external/ui-primitives.ts`, `scripts/check-debug-capture-layers.js`.
- Process: `specs/4-debug-capture/plan.md`, all 12 briefs in `prs/`, `git log` for the feature (`7181bd9..cc6672f`), PR bodies #34–#47 on GitHub.
- Counts (re-run to refresh): `grep -rn eslint-disable` = 6; `any` types in `src/` = 0; `OnPush` = 14 of 20 components; standalone = 2; NgModules = 10; spec files = 57; conventional commit subjects = 124 of 185 non-merge commits.
