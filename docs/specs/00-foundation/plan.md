# S-00 Foundation — plan

Spec: `spec.md` (this folder). Source of truth: `docs/design/HLD.md`.

## Branches

```
claude/air-gapped-debug-logging-zkn1nr        integration branch (v1 + v2 docs)
└── claude/dc-v2-s00-foundation               S-00 foundation branch — the owner reviews this one
    ├── claude/dc-v2-s00a-tooling             PR → foundation
    ├── claude/dc-v2-s00b-contracts           PR → foundation
    ├── claude/dc-v2-s00c-angular-seam        PR → foundation
    └── claude/dc-v2-s00d-standards           PR → foundation
```

Each track is one agent, one branch, one PR into the foundation branch, with a
merge commit. When all four are in, the orchestrator integrates, verifies and
opens **one PR: foundation → integration branch** for the owner.

## Tracks (all in parallel)

| Track | Brief | Owns (only these paths) |
|---|---|---|
| 00a Tooling | `prs/00a-tooling.md` | `package.json`, `package-lock.json`, `tsconfig*.json`, `.gitignore`, `.prettierrc*`, `.prettierignore`, `eslint.config.*`, `karma.conf.*`, `playwright.config.*`, `scripts/**` except `scripts/contrast-check*`, `test/**` |
| 00b Contracts | `prs/00b-contracts.md` | `src/contract/**`, `src/panel/**` |
| 00c Angular seam | `prs/00c-angular-seam.md` | `src/angular/**` |
| 00d Standards | `prs/00d-standards.md` | `AGENTS.md`, `CLAUDE.md`, `README.md`, `scripts/contrast-check*`, `docs/specs/README.md` |

All paths are relative to `packages/debug-capture/`. No track touches another
track's paths, so the merges cannot conflict.

## Fixed names (so tracks can rely on each other without waiting)

- npm scripts (00a writes them all, including ones whose files another track
  creates): `typecheck`, `lint`, `lint:layers`, `format`, `format:check`,
  `test`, `build`, `size`, `e2e`, `contrast` (→ `node scripts/contrast-check.mjs`,
  file by 00d), `check` (runs all of the above except `format`).
- Panel paths and barrels (00b creates, 00a's layer checker knows them):
  `src/panel/model/index.ts` (P1), `src/panel/ui/index.ts` (P2),
  `src/panel/views/index.ts` (P3), `src/panel/app/index.ts` (P4),
  `src/panel/index.ts` (P5). Barrel chain as in v1: each barrel starts with
  `export * from '<barrel above>'`, except P5, which never re-exports P4 values.
- L6 imports L5 by directory path: `'..'` from `src/angular/`, `src/react/`;
  `'../..'` from `src/panel/model/`.

## Integration (orchestrator, after the four merges)

1. Remove `experimentalDecorators` from `tsconfig.json` (possible only once 00c
   is in).
2. One **format sweep**: `npm run format` over the whole package, as its own
   commit (no track reformats files it does not own, to keep merges clean).
3. `npm ci && npm run check` from a clean clone of the foundation branch.
4. Fresh-context review of the whole foundation diff; fix what it finds.
5. Open the PR foundation → integration branch with the numbers.

## Status

| Track | PR | State |
|---|---|---|
| 00a | — | started |
| 00b | — | started |
| 00c | — | started |
| 00d | — | started |
