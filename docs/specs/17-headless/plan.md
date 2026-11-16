# S-17 Headless — plan

Spec: [`spec.md`](spec.md) (S17-01 … S17-09). Source of truth: `docs/design/HLD.md`.

## Branches

```
main
└── docs/s17-headless        HLD rows + this folder (docs PR)
    └── feat/s17a-headless   S-17a — the debug-capture/activate-headless entry
```

One PR each into `main`, in order; only the owner merges. The code branch takes the merged docs
in by a merge, no rebase.

## Tracks

| PR | Brief | Spec rows |
|---|---|---|
| docs | this folder; HLD status, §0, §2.1f, §3.15, `NFR-SIZE-01`, §6.1, §6.2, §6.4, §6.6, §9, `D-56` | — |
| S-17a | [`prs/17a-headless.md`](prs/17a-headless.md) | S17-01 … S17-09 |

## Risks

- **The shared chunk.** Splitting puts the activation code in a chunk both entries import, so a
  station would load two files before switch-on (the S-13 e2e "only `activate.mjs` loads" sees
  it). S-17a builds the two activation entries in a second esbuild pass with no splitting: each
  is one file again, and its `import()` points at the main build's `index.mjs` / `panel.mjs`.
- **Panel types in the headless `.d.ts`.** `DebugActivationOptions` / `DebugActivationHandle`
  name `DebugPanelOptions` / `DebugPanelHandle` by `import type`. Types are erased and never
  reach a host bundle, so `FR-HL-02` holds; `headless.ts` itself may not import `../panel` at all
  (S17-04). If a host's type check should not see panel types either, the brief says how to move
  them.
- **Version.** Main is `2.5.0-alpha.1`; S-17a bumps to `2.5.0-alpha.2` (owner: release 2.5).

## Status

Docs PR #14 — merged. Owner answers (2026-11-15): fail closed, not followed live, one tarball,
release 2.5 (next alpha on `main`).

S-17a — done, in review. Unit specs 1316 → **1336** (+20: `panel-choice.spec.ts` 13,
`headless.spec.ts` 7). e2e 69 → **75** (+6, `test/e2e/headless.spec.mjs`, with two new hosts,
`test/hosts/headless` and `test/hosts/flag`). Red first: 14 of the 20 unit specs failed on type
stubs; the other 6 failed by a mutation each (only promises accepted; no check for a panel entry;
off keeps the controller; `message()` dropped; `?debug=1` ignored; a press while loading loses).
The 6 e2e tests failed by mutation (the headless host imports `debug-capture/activate`; the flag
ignored; the record chord unbound; the flag always `false`). The build check failed on a headless
entry with `import('../panel')`; layer rule 9b's 4 self-test rows failed with the rule off.
Version 2.5.0-alpha.2. Sizes (min + gzip): activation 1,265 → **1,465 B** (≤ 1,536), headless
activation **1,453 B** (≤ 1,536, new), core, loader, UI chunk and replay unchanged. A headless
host bundled by esbuild: 3.2 kB + the 37.7 kB core (raw), no panel file. Both browsers green.

Deviations from the brief and the spec:

- The two activation entries are built in a second esbuild pass with no splitting, so each is one
  file (the shared chunk made the S-13 e2e "before switch-on only `activate.mjs` loads" see a
  second file). Their `import()` points at the main build's `index.mjs` / `panel.mjs`. HLD
  `FR-HL-07`, §6.1 and S17-05 say so now.
- A static `panel: false` now asks for the core only; 2.4 also fetched the panel entry without
  installing it. Nothing visible changes; one request fewer.
- `createHeadlessActivation(options, deps)` in `activate.ts` is the testable seam; `headless.ts`
  only wires `globalThis` and `import('..')`, like `index.ts`.
- The headless `.d.ts` still names the panel's types (through `DebugActivationHandle.panel`); types
  never reach a bundle, so `FR-HL-02` holds.
