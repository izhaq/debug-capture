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
| 00a Tooling | #57 | merged — 336 specs, coverage 96.4 % statements; core baseline 10,316 B min+gz |
| 00b Contracts | #55 | merged — types only, contract JS byte-identical |
| 00c Angular seam | #56 | merged — AOT production build proven in a scratch copy |
| 00d Standards | #54 | merged — contrast check 34 pairs + drift check |

**Deviations recorded in the track PRs:** eslint 10 (9 is deprecated; Node ≥ 20.19
to develop); `CaptureFile.pending?` added per HLD C-1; TS 5.1 does not reject a
leftover decorator, so ESLint bans decorators; contrast script is `.mjs`.

**Review round (fresh-context, no blockers):** contract made complete for
the parallel wave by the orchestrator — `ProbeRecorder` (write side for
probes: `startPending`, `endPending`, `nextSocketId`), `PendingDraft`,
`MAX_PENDING_REQUESTS`, `SinkOptions` (C-5 root); HLD §6.4 updated. Tooling
fixes in track 00e.

**Follow-ups for later specs:**
- S-01: implement `LiveRecorder` + `ProbeRecorder` in one recorder; move the
  socket-id counter (update the `WebSocketEntry.socketId` comment); add
  `SinkOptions` as the last optional parameter of `copyText` / `downloadText`;
  implement `isProblemEntry` and `createCaptureController`.
- S-02 and S-03 run beside S-01: take `isProblemEntry` as an injected
  function (type `IsProblemEntry`) or a local stub until S-01 is merged, and
  build fakes against `LiveRecorder` only (never `ProbeRecorder`).
- S-02: update `src/panel/public-api.spec.ts` when `installDebugPanel` lands.
