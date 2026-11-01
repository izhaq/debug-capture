# 16c — Panel: row menu, Copy as JSON, editors, mock list

Spec rows S16-12 … S16-17. Branch `feat/s16c-panel` (from S-16b) → one PR into `main`.

## Owned paths

`src/panel/**` (a new lazy chunk `replay-ui` under `src/panel/replay-ui/`, loaded by P4 with one
`import()` only when `controller.replay` is set), `test/e2e/` (new `panel-v25.spec.mjs`, an echo
WebSocket and a POST endpoint on the hostile host's server), README, `docs/host-setup.md` (the
dev-only import), the floors, the version.

## Behaviour

As spec rows S16-12 … S16-16. The row menu reuses the Export menu's control (P2 `createMenu`).
Copy as JSON is in the UI chunk (small); the editors and the mock list are in `replay-ui`.

## Required specs (red first)

Row menu by mouse and keyboard; items with and without the add-on; Copy as JSON shape (redacted
and truncated); editors' disabled Send until redacted values are filled; badges; banner / status
/ DBG mark; e2e S16-17.

## Verification

`npm run check` both browsers; UI chunk ≤ 45,056 B (or the owner's raise); the `replay-ui`
chunk's size in the PR.

## Out of scope

As the spec.
