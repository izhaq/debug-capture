# S-16 Replay and mock — plan

Spec: [`spec.md`](spec.md) (S16-01 … S16-17). Source of truth: `docs/design/HLD.md`.

## Branches

```
main
└── docs/s16-replay              HLD rows + this folder (docs PR)
    └── feat/s16a-core           S-16a — core hooks (C-13)
        └── feat/s16b-replay     S-16b — the debug-capture/replay entry
            └── feat/s16c-panel  S-16c — row menu, Copy as JSON, editors, mock list
```

One PR each into `main`, in order; only the owner merges. A later branch takes the merged work in
by a merge, no rebase.

## Tracks

| PR | Brief | Spec rows |
|---|---|---|
| docs | this folder; HLD §0 status, §2.1e, §3.14, §6.1, §6.5 `C-13`, `NFR-SEC-03`, §9, §10 | — |
| S-16a | [`prs/16a-core.md`](prs/16a-core.md) | S16-01 … S16-06 |
| S-16b | [`prs/16b-replay.md`](prs/16b-replay.md) | S16-07 … S16-11 |
| S-16c | [`prs/16c-panel.md`](prs/16c-panel.md) | S16-12 … S16-17 |

## Risks

- **XHR mocking** is the hard part (S16-03): Angular's `HttpClient` reads `readyState`,
  `status`, `getAllResponseHeaders()`, `responseText` / `response` and the `load` events. The
  S-16a spec drives a real `HttpClient` (the Angular test host) through a mock, not only a fake.
- **Size**: the panel's UI chunk has about 2.8 kB left. The editors go to their own chunk; if the
  row menu, Copy as JSON and the banner still do not fit, the PR stops and asks the owner.
- **Core budget**: 1.3 kB left; the hooks must stay small, or a raise goes to the owner.

## Status

Docs PR open.
