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

Docs PR #113 open.

S-14a — done, in review. Unit specs 1250 → **1259** (+9: `install-debug-capture.spec.ts` +5,
`activate.spec.ts` +2, `problem-rule.spec.ts` +1, `selectors.spec.ts` +1). Every new spec
failed once (against stubs, then a mutation round). Old specs changed only to compile: fake
sessions gain `addMessage`, the contract's exhaustive draft switch gains `app`. Version
2.3.0-alpha.0. Until S-14b the Console leaves app messages out (`S14-07`).

S-14b — done, in review. Unit specs 1259 → **1267** (+8: model 3, Console view 4 in
`console-app.spec.ts`, settings 1, loader 1; S-14a's "no list shows them yet" spec removed, as
S-14b gives them rows). e2e 65 → **66** (`panel-v23.spec.mjs`). Every new spec failed once (two
unit mutation rounds, one e2e round). Changed existing specs on purpose: the Console chip list
has **App**; the inert-handle spec calls `message()`. Version 2.3.0-alpha.1.
