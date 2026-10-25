# Handoff — debug-capture v2, S-11 (updated 2026-10-25)

For the next session that picks up **S-11, v2.1 panel features**. Delete this file when
S-12 (the last step) is done.

**Talking to the owner** (root `CLAUDE.md`): short, simple words; main point first. Never
merge into the integration branch yourself — only the owner merges.

## Status

- v2.0 is complete and merged (#96–#101). Integration branch:
  `claude/air-gapped-debug-logging-zkn1nr`.
- S-11 spec: [`11-v21-features/`](11-v21-features/spec.md) (S11-01 … S11-18); HLD §2.1a,
  §3.10, `C-9`, `C-10`, `D-28` … `D-34`.
- PRs, in merge order:

| PR | Branch | State |
|---|---|---|
| docs | `claude/dc-v2-s11-docs` | open, #102 |
| S-11a core | `claude/dc-v2-s11a-core` | open (stacked on docs) |
| S-11b panel | `claude/dc-v2-s11b-panel` | not started |
| S-11c app | `claude/dc-v2-s11c-app` | not started |

- Numbers at the start of S-11: 1126 unit specs, 48 e2e + perf; loader 4,084 / 4,096 B,
  UI chunk 39,001 / 40,960 B, core 11,743 / 12,368 B; warm open 49–60 ms (limit 100).

## Rules that bite

- Conventional commits, scope `debug-capture v2`; no trailer lines; never an AI model name.
  `npm run format` before each commit; push every commit before saying a PR is ready.
- Test first; show each new spec red once; raise `test/unit/spec-floor.json` and
  `test/e2e-floor.json`.
- Isolation rules (HLD §6.7), ES2020 lib only, Chrome 146.0.7680.72+ features only.
- Stop and ask the owner only for: a budget beyond `D-34`, a new dependency, or a change to
  an HLD MUST.

## Next

After S-11c: S-12, the AI add-on (`D-35`, `OPEN-07`, `OPEN-08`) — its own spec folder.
