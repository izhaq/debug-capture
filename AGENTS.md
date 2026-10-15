# AGENTS.md — rules for debug-capture v2

The single source of rules for anyone (person or agent) who changes this
package. `CLAUDE.md` points here. Paths are relative to
`packages/debug-capture/`.

**Source of truth:** [`docs/design/HLD.md`](docs/design/HLD.md). Every spec is
cut from it and cites its IDs (`FR-NET-04`, `ISO-07`, `D-05`…). When a spec
and the HLD disagree, the HLD wins — or change the HLD first, in its own PR.

## Talking

1. Explain in short, plain words; main point first. Not for code, commits or
   PR text.

## Before coding

2. Non-trivial work starts with a spec folder `docs/specs/<nn>-<slug>/`:
   `spec.md` (what), `plan.md` (how, tracks, status) and `prs/` with one brief
   per PR. See [`docs/specs/README.md`](docs/specs/README.md).
3. A brief has: Goal · Owned paths · Public API (exact names) · Behaviour ·
   Required specs · Verification · Out of scope.
4. Shared types go in the contract first (`src/contract/`, or the panel layer
   that owns them). Parallel PRs code against the contract, never against each
   other.
5. Do not guess outside APIs (Angular, React, browsers, Playwright, esbuild).
   Read the real types or source and name the version in the brief.
6. If a brief is wrong or contradicts the real source, make the smallest
   sensible fix in the code and say so under "Review notes" in the PR.

## Code

7. TypeScript 5.1.6, strict, with the flags in `tsconfig.json`. No `any`: use
   `unknown` and narrow. Target `lib: es2020, dom` and Chromium 90+ — no
   `.at()`, `Object.hasOwn`, `replaceAll`, `using`.
8. Inject the outside world: globals, time, sockets, storage, `document` come
   in as a parameter (an `InjectionToken` in `src/angular/`). Specs pass fakes
   and never patch `window`. Time comes only from `src/core/clock.ts`: no
   `Date.now()` anywhere else.
9. Each entry point has one wiring call: `installDebugCapture()` (core),
   `provideDebugCapture()` (Angular), `installDebugPanel()` (panel).
10. Import a layer only through its barrel (`index.ts`), and only the layer
    allowed (see Layers). `npm run lint:layers` enforces it.
11. The panel has no framework. Build DOM safely (views use the P2 safe
    builder): text nodes, `el.style.x =`, `adoptedStyleSheets`. No HTML
    strings, no
    `innerHTML`/`outerHTML`/`insertAdjacentHTML`, no `eval`/`new Function`,
    no `href`/`src` from captured data (`ISO-04`, `NFR-SEC-01`).
12. Never feed the recorder: no `console.*` in `src/` (lint allows none;
    the console probe uses the injected console); every callback in `try/catch`; every
    promise has a `.catch` (`ISO-12`).
13. Doc comments say _why_, not _what_.
14. Specs sit next to the code (`x.ts`, `x.spec.ts`). `TestBed` only in
    `src/angular/` specs; framework-free code is tested without it.

## Layers (HLD §6.2)

Each layer imports only the barrel of the layer directly above it (the
"May import" column).

| Layer       | Path                 | May import                                                      |
| ----------- | -------------------- | --------------------------------------------------------------- |
| L1 contract | `src/contract/`      | nothing                                                         |
| L2 core     | `src/core/`          | L1                                                              |
| L3 adapters | `src/adapters/`      | L2                                                              |
| L4 install  | `src/install/`       | L3                                                              |
| L5 public   | `src/index.ts`       | L4                                                              |
| L6 angular  | `src/angular/`       | L5 (as `'..'`), `@angular/*`, `rxjs`                            |
| L6 react    | `src/react/`         | L5 only (no packages, not even React)                           |
| L6 panel    | `src/panel/`         | see P1–P5                                                       |
| P1 model    | `src/panel/model/`   | L5 (as `'../..'`). Pure: no DOM, no timers, no globals          |
| P2 ui       | `src/panel/ui/`      | P1, and the `document` passed in                                |
| P3 views    | `src/panel/views/`   | P2                                                              |
| P4 app      | `src/panel/app/`     | P3                                                              |
| P5 loader   | `src/panel/index.ts` | L5; P4 **only** by `import type` and **one** dynamic `import()` |

- L6 seams never import each other. No packages anywhere in `src/panel/`.
- The P5 rule keeps the UI chunk lazy: a static value import of P4 would pull
  it into the loader (≤ 4 kB, `NFR-SIZE-01`).
- The core never imports the panel.

## Panel isolation (HLD §6.7)

15. The panel lives inside someone else's app. Every rule `ISO-01` … `ISO-22`
    in HLD §6.7 applies; read the ones your brief names before coding, and
    test each against the hostile-host fixture (`ISO-22`).
16. Colours come only from the `--dcp-` tokens in HLD §5.4. Changing a token
    means changing the HLD table and its "Measured minimum ratios" text;
    `npm run contrast` checks both.

## Tests

17. Test first. For a bug: write the failing spec, see it fail, then fix
    (Prove-It). Say the red count in the PR.
18. Every required spec is shown to fail once (red first, or a quick
    mutation).
19. Never weaken, skip or delete a test to get green.
20. Timing specs: the limit is several times above the measured worst and
    several times below the regression; the comment states both. Run the
    full suite 3× before merging one.

## Checks

Run from `packages/debug-capture/` after `npm ci`. All must pass before a
commit.

| Command                | What it checks                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`    | `tsc`, strict, specs included                                                                                      |
| `npm run lint`         | its self-test, then ESLint: no `any`, `console`, `innerHTML`-family, `eval`, decorators, `Date.now()`, `fit`/`xit` |
| `npm run lint:layers`  | its self-test, then the layer rules above                                                                          |
| `npm run format:check` | Prettier (`npm run format` fixes it)                                                                               |
| `npm run contrast`     | its self-test, then HLD §5.4 tokens meet 4.5:1 / 3:1                                                               |
| `npm test`             | every `src/**/*.spec.ts`, headless Chromium, one run; fails on a skipped spec or below `test/unit/spec-floor.json` |
| `npm run build`        | `.d.ts` (tsc) and the `dist/*.mjs` bundles (esbuild) — the bundles are what ships                                  |
| `npm run size`         | size budgets (`NFR-SIZE-01`), min + gzip level 6                                                                   |
| `npm run pack:check`   | the packed tarball installs and type-checks in a temp consumer (`node`, `bundler`, `node16`, `nodenext`)           |
| `npm run e2e`          | Playwright smoke on a plain HTML page                                                                              |
| `npm run check`        | all of the above, in that order (not `format`)                                                                     |

20a. A spec that adds tests raises `test/unit/spec-floor.json` to the new
count, so a lost spec file fails the run.

21. A PR that changes what ships reports the `npm run size` numbers and the
    change.

## Git and PRs

22. Conventional commits: `type(scope): subject`, scope `debug-capture v2`.
    Trailers as the session asks.
23. Change only the paths your brief owns. If another file must change, say
    so in the PR.
24. Big work goes to a spec branch; track PRs merge into it with merge
    commits; the spec branch then gets one PR into the integration branch.
25. PR body: What · Review notes · Checks (with numbers: tests, sizes).
26. Never commit links to temp paths (`/tmp`, scratchpads). Put evidence in
    the repo or the PR body.

## Review

27. The orchestrator re-runs every check on the PR head and reads the diff
    before merging.
28. Security-sensitive or hot-path work (HLD §9.2: S-01, S-02, S-04, S-08)
    gets a fresh-context adversarial review that proves each finding with a
    spec, and a second pass to confirm the fixes.
29. User-facing or global-patching work gets a real-browser end-to-end check
    (Playwright, `test/`). Commit the script.
30. When a plan is done, update it: status, numbers, deviations, follow-ups.

## Where things live

31. Put each thing where it belongs:

| Path             | Holds                                                        |
| ---------------- | ------------------------------------------------------------ |
| `docs/design/`   | the HLD (why, what, and the decisions in §10) and the mockup |
| `docs/specs/`    | specs, plans and PR briefs, one folder per spec              |
| `docs/research/` | evidence behind the HLD (isolation cases, practices)         |
| `docs/v1/`       | v1's guide and decision record, as they were                 |
| `scripts/`       | check scripts (`lint:layers`, `contrast`, `size`…)           |
| `src/`           | the code, with its specs next to it                          |
| `test/`          | test hosts, the hostile host, end-to-end and perf tests      |
