# 10b — Verification

Spec: [`../spec.md`](../spec.md) (S10-10 … S10-15). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s10b-verify` (from the integration branch, after S-10a is merged)
→ one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

Close v2: every business requirement shown end to end, the performance `MUST`s measured,
the final size and security pass, and a table that maps every HLD `MUST` to its test.

## Owned paths

See the plan (S-10b rows). Nothing in `src/` unless a gap is a real bug; then the fix stays
in the file that owns the behaviour, with a red-first spec, and the PR says so.

## Public API

None.

## Behaviour

- **BR-01…07** (S10-10): a table, one row per BR: the test that proves it (most come from
  S-10a's host e2e and earlier specs) or a checklist row with evidence.
- **Performance** (S10-11): Playwright + `performance` APIs in `test/perf/`, on the hostile
  host. NFR-PERF-02 open time warm with 5,000 entries (gated < 100 ms) and cold (reported);
  NFR-PERF-03 apply time per frame and long tasks while 100 entries/s arrive; NFR-PERF-04
  DOM nodes per tab with an open detail at 1,080 px, and long tasks while scrolling;
  NFR-PERF-06 memory added with 5,000 entries (`performance.measureUserAgentSpecificMemory`
  if the page is cross-origin isolated, else `memory.usedJSHeapSize` — say which). The
  virtual-list frame-budget spec run **alone** and its number reported (its suite limit was
  relaxed to 16 ms in #91). Limits follow the margin rule (§7.1, AGENTS rule 20); run 3×.
- **Size** (S10-12): the final `npm run size` table against the budgets and v1's core size.
- **Security** (S10-13): the hostile host already runs under strict CSP + Trusted Types; add
  a check that HTML and `javascript:` strings in captured data render as text in each view;
  copy / export only from a user action; the panel makes no network request (watch the
  page's requests while it is open and used).
- **Chrome 146** (S10-14): run the e2e on Chrome 146 if a binary is available; else say so.
- **Every-MUST walk** (S10-15): a table in `spec.md` (or a linked file) — HLD `MUST` ID →
  spec → test; gaps covered or raised with the owner. Delete `docs/specs/HANDOFF.md`.

## Required specs

New perf and security e2e tests, each shown to fail once (a lowered limit or a mutation).

## Verification

`npm run check`, plus the perf run 3×. Report every number.

## Out of scope

New features. Fixes for the known limits (spec "Known limits"), unless the owner says so.
Raising a budget.
