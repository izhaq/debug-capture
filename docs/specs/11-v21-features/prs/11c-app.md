# 11c — The playground app takes 2.1

Spec: [`../spec.md`](../spec.md) (S11-18). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s11c-app` → one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

The Angular 16.2 app at the repo root uses `debug-capture` 2.1.0-alpha.0 from a new vendored
tarball.

## Owned paths

`/vendor/debug-capture-2.1.0-alpha.0.tgz` (the old tarball removed), `/package.json`,
`/package-lock.json`, `/docs/debug-panel.md`. Nothing in `src/debug-capture/` or
`src/app/features/debug-capture/` (v1 stays).

## Public API

None.

## Behaviour

`npm pack` in the package after S-11b; the app's dependency points at the new file; the guide
names the new version and the 2.1 settings and notes.

## Required specs

None new; the app's own checks.

## Verification

From the repo root: `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint:layers`,
`npx ng build`, `ng test` (a scratch Karma config with `--no-sandbox`).

## Out of scope

Wiring new 2.1 options into the app beyond what it already passes.
