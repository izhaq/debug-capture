# S-10 Integration and verification — plan

Spec: [`spec.md`](spec.md) (S10-01 … S10-15). Source of truth: `docs/design/HLD.md`.

## Branches

```
claude/air-gapped-debug-logging-zkn1nr     integration branch
├── claude/dc-v2-s10a-hosts                S-10a — hosts, packaging, README (one PR)
└── claude/dc-v2-s10b-verify               S-10b — verification (one PR, after S-10a is merged)
```

Each PR goes into the integration branch. Only the owner merges them.

## Tracks

| PR | Brief | Spec rows | Order |
|---|---|---|---|
| S-10a | [`prs/10a-hosts.md`](prs/10a-hosts.md) | S10-01 … S10-09 | first |
| S-10b | [`prs/10b-verify.md`](prs/10b-verify.md) | S10-10 … S10-15 | after S-10a is merged |

S-10a, in commits:

1. This spec folder.
2. The host build (`test/hosts/build.mjs`) and the Angular host.
3. The React host (React 19 as a dev dependency).
4. The plain page on the §6.6 snippet, and the shared e2e on all three hosts.
5. The user README.
6. Floors, this plan's status, HANDOFF §0.

## Owned paths

All paths are under `packages/debug-capture/`.

| Path | PR | Why |
|---|---|---|
| `docs/specs/10-integration/**` | both | this spec, plan and briefs |
| `docs/specs/README.md`, `docs/specs/HANDOFF.md` | both | the S-10 row and link; the handoff status (deleted in S-10b) |
| `test/hosts/**` | S-10a | the Angular, React and plain hosts and their build |
| `test/static-server.mjs` | S-10a | serves the hosts, the built host bundles and `vendor/debug-capture/` |
| `test/e2e/hosts.spec.mjs`, `test/e2e/plain-host.spec.mjs` | S-10a | the shared host scenario; the S-00 smoke follows the new plain page |
| `playwright.config.mjs` | S-10a | builds the hosts before the static server starts |
| `package.json`, `package-lock.json` | S-10a | React 19 (`react`, `react-dom`) as dev dependencies |
| `README.md` | S-10a | the user README |
| `test/unit/spec-floor.json`, `test/e2e-floor.json` | both | the new counts |
| `test/perf/**`, `test/e2e/*` (new files) | S-10b | measurements and the final security page |

Nothing in `src/`. Nothing outside the package.

## Status

S-10a — in review (PR into the integration branch). S-10b — not started.
