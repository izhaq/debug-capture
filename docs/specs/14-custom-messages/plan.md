# S-14 Custom messages — plan

Spec: [`spec.md`](spec.md) (S14-01 … S14-12). Source of truth: `docs/design/HLD.md`.

## Branches

```
claude/air-gapped-debug-logging-zkn1nr     integration branch
└── claude/dc-v2-debug-url-launcher        #112 (DBG button on ?debug=1)
    └── claude/dc-v2-s14-docs              HLD rows + this folder (docs PR)
        └── claude/dc-v2-s14a-core         S-14a
            └── claude/dc-v2-s14b-panel    S-14b
                └── claude/dc-v2-s14c-app  S-14c
```

Only the owner merges into the integration branch (or says so). Later branches take merged
work in by a merge, no rebase.

## Tracks

| PR | Brief | Spec rows |
|---|---|---|
| docs | this folder; HLD §0 status, §2.1c, §3.12, §6.4, §6.5, §9, §10 | — |
| S-14a | [`prs/14a-core.md`](prs/14a-core.md) | S14-01 … S14-07 |
| S-14b | [`prs/14b-panel.md`](prs/14b-panel.md) | S14-08 … S14-11 |
| S-14c | [`prs/14c-app.md`](prs/14c-app.md) | S14-12 |

## Status

Docs PR open. Code not started.
