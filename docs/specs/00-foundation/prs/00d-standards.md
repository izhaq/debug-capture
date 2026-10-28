# 00d — Standards: AGENTS.md, contrast check, specs index

**Branch:** `claude/dc-v2-s00d-standards` → PR into `claude/dc-v2-s00-foundation`
**Covers:** S00-11, S00-12, S00-13 (`../spec.md`). HLD §5.4, §7, §8.3, §9.
**Read first:** `../spec.md`, `../plan.md`, HLD §5.4, §6.2, §7, §9, and
`docs/research/practices-baseline.md` §3 (the v2 rule set).

## Owned paths (relative to the package root)

`AGENTS.md`, `CLAUDE.md`, `README.md`, `scripts/contrast-check*`,
`docs/specs/README.md`.

## 1. `AGENTS.md` (the single source of agent rules for this package)

- Adapt the 31 rules of `practices-baseline.md` §3.1 to **this package**:
  paths (`docs/design/HLD.md` is the source of truth; specs in
  `docs/specs/<nn>-<slug>/` with `spec.md`, `plan.md`, `prs/`), the layer
  rules L1–L6 and P1–P5 in short (HLD §6.2, including "P5 imports P4 only by
  `import type` and one dynamic `import()`"), the panel's isolation rules by
  reference (HLD §6.7 `ISO-01…22`), and the check commands — exactly these npm
  scripts, run from the package root: `typecheck`, `lint`,
  `lint:layers`, `format:check`, `contrast`, `test`, `build`, `size`, `e2e`,
  and `check` (all).
- Drop or rewrite rules that only fit the host Angular app (e.g. `ng build`,
  `tsconfig.app.json`, OnPush components — the panel has no Angular).
- Keep it scannable: short numbered rules under a few headings, plain words.
  Target ≤ 200 lines.
- `CLAUDE.md`: two or three lines that point to `AGENTS.md` (practices T15).

## 2. `scripts/contrast-check.mjs` (npm script `contrast`, wired by track 00a)

Node, no dependencies. Reads `docs/design/HLD.md`, parses the §5.4 token table
(both themes), and checks, per theme:

- every **text** token (`text`, `text-muted`, `text-faint`, `accent`,
  `success`, `info`, `warning`, `error`, `json-*`) ≥ **4.5:1** against each of
  the five bases (`bg`, `bg-elevated`, `bg-row-alt`, `bg-hover`,
  `bg-selected`) **and** each base under an 8% blend of `error` and of
  `warning` (blend per channel, rounded to whole RGB values — the HLD numbers
  use that rounding);
- `border-control` ≥ **3:1** against the five bases;
- `text` ≥ 4.5:1 on `match-bg`;
- each **badge** colour (`text-muted` for redacted/pending, `warning` for
  truncated) ≥ 4.5:1 on its opaque background = 12% of it over `bg`;
- the "Measured minimum ratios" paragraph of §5.4 still matches the computed
  minimums (to two decimals). A mismatch fails with a clear message, so the
  HLD can never drift from the tokens.

Output a short table; exit 1 on any failure. `--self-test` runs known pairs
(e.g. `#000`/`#fff` = 21.00, `#777`/`#fff` ≈ 4.48) and a tiny inline table with
one failing pair. S-04 will later reuse the same functions to check the real
theme stylesheet, so export them (`contrastRatio`, `blend`, `parseTokenTable`).

## 3. `docs/specs/README.md`

The list S-00 … S-10 from HLD §9.1 with one line each and the wave plan
(§9.2), the folder layout of a spec, and the rule that every spec cites HLD IDs
and keeps a traceability table (§8.3, §9.3).

## 4. `README.md` (package)

Add a short "Develop" section: `npm ci`, the check commands, where specs and
the HLD live. Keep the existing content.

## Verification

```bash
node scripts/contrast-check.mjs --self-test
node scripts/contrast-check.mjs          # must pass on HLD 0.4 as merged
# prove the drift check: in a scratch COPY of HLD.md change one measured
# number, point the script at it (add a --hld <path> option), see it fail
```

Never commit a link to `/tmp` (AGENTS rule 26).

## Out of scope

`package.json` (00a owns it, and already defines the `contrast` script), any
`src/` file, the HLD itself (if you find an HLD error, report it in the PR).
