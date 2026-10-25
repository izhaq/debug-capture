# Specs for debug-capture v2

Each spec cuts one row of HLD §9.1 into work. The HLD
([`../design/HLD.md`](../design/HLD.md)) is the source of truth: when a spec
and the HLD disagree, the HLD wins — or the HLD is changed first, in its own
PR.

## The list (HLD §9.1)

| Spec | In one line | Depends on |
|---|---|---|
| [S-00 Foundation](00-foundation/spec.md) | Tooling, `AGENTS.md`, layer checker, size baseline, contrast check; the contracts the parallel wave codes against; core change C-4 | — |
| [S-01 Core changes](01-core-changes/spec.md) | Capture-layer changes C-1 … C-3, C-5 … C-8: pending requests, controller, policy, copy/download, change events, capped-body flag, problem rule | S-00 |
| [S-02 Panel loader](02-panel-loader/spec.md) | P5 loader (element, mount, lockdown, event wall, zone, toggle, launcher, lazy load) and a placeholder P4; hostile-host fixture | S-00 |
| [S-03 Panel model](03-panel-model/spec.md) | P1: local data source, store, batching, selectors, filters, formatting, cURL | S-00 |
| [S-04 UI building blocks](04-ui-blocks/spec.md) | P2: safe DOM builder, virtual list, JSON viewer, split pane, tabs, chips, icons, theme sheet + contrast check | S-00 |
| [S-05 Network › HTTP](05-http-view/spec.md) | P3: HTTP list, detail sub-tabs, copy | S-02, S-03, S-04 (S-01 for pending) |
| [S-06 Network › WebSocket](06-ws-view/spec.md) | P3: connections, messages, detail | S-02, S-03, S-04 |
| [S-07 Console](07-console-view/spec.md) | P3: list, detail, stacks | S-02, S-03, S-04 |
| [S-08 Frame, toolbar and status](08-frame/spec.md) | The P4 frame (tabs, resize, dock, maximize, scheduler, settings storage, banners); pause/follow, clear, export/copy, capture on/off, status bar, settings, states | S-01, S-02, S-03, S-04 |
| [S-09 Accessibility](09-accessibility/spec.md) | Keyboard map, focus, forced colours, reduced motion | S-05 … S-08 |
| [S-10 Integration and verification](10-integration/spec.md) | Angular, React and plain hosts; end-to-end, performance, security; `npm pack`; README | all |
| S-11 v2.1 panel features | Buffer size in Settings, near-full and memory warnings, status observer, "Show DBG button", user notes (HLD `D-28`…`D-34`) | S-10 |
| S-12 AI add-on | Separate package `debug-capture-ai`: local / on-prem model by URL + token; insights, then proposed changes (HLD `D-35`) | S-11 |

## Waves (HLD §9.2)

```
Wave 1:  S-00
Wave 2:  S-01 ║ S-02 ║ S-03 ║ S-04     parallel — they code against the S-00 contract
Wave 3:  S-05 ║ S-06 ║ S-07 ║ S-08     parallel — one view each + the frame; a small contract PR first
Wave 4:  S-09 ─► S-10                  in order — S-09 touches every view
Wave 5:  S-11 ─► S-12                  v2.1, after S-10b closes 2.0
```

The wave plans (branches, tracks, owned paths, contracts): [`wave-2.md`](wave-2.md),
[`wave-3.md`](wave-3.md).

Each wave ends with the merged branch checked as a whole. S-01, S-02, S-04
and S-08 (security or hot path) also get a fresh-context review.

## How a spec folder looks

```
docs/specs/<nn>-<slug>/        e.g. 00-foundation
  spec.md                      what: goal, requirements (IDs), out of scope, acceptance
  plan.md                      how: branches, tracks, owned paths, status
  prs/<nn><x>-<slug>.md        one brief per PR, e.g. prs/00a-tooling.md
```

A brief has: Goal · Owned paths · Public API (exact names) · Behaviour ·
Required specs · Verification · Out of scope (`AGENTS.md` rule 3).

## Rules every spec follows

- **Cite HLD IDs.** Every requirement in a spec names the HLD IDs it covers
  (`FR-…`, `NFR-…`, `ISO-…`, `C-…`, `D-…`).
- **Keep a traceability table** (HLD §8.3, §9.3): each `MUST` the spec owns →
  the test that proves it. S-10 checks that every `MUST` is covered.
- **Update the plan when done:** status, numbers, deviations, follow-ups
  (`AGENTS.md` rule 30).
