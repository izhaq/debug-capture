# 16b — The `debug-capture/replay` entry

Spec rows S16-07 … S16-11. Branch `feat/s16b-replay` (from S-16a) → one PR into `main`.

## Owned paths

`src/replay/**` (new L6 seam), `scripts/entries.mjs`, `scripts/size-budgets.json`,
`scripts/check-layers.mjs` (the new seam's rule: L5 only), `package.json` `exports` and
`typesVersions` for `./replay`, `scripts/pack-check.mjs` (the new entry), the floors, the version.

## Public API

`installReplay(target: DebugActivationHandle | CaptureController, options: { allow: boolean }):
ReplayApi | null`.

## Behaviour

As spec rows S16-07 … S16-10. The mock store is a small pure module (match, list, persist);
`installReplay` wires it to `setMockResolver`.

## Required specs (red first)

`allow: false` does nothing and logs once; idempotent; waits for the activation handle's
session; matching (method, exact URL, `*` patterns, first on rule wins, off rules skipped);
store round trip, corrupt value, blocked storage; refuses a draft with a redacted value.

## Verification

`npm run check` both browsers; the new entry's size; `pack:check` imports `debug-capture/replay`.

## Out of scope

UI.
