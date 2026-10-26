# 13c — The playground app

Spec: [`../spec.md`](../spec.md) (S13-19). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s13c-app` → one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

The Angular 16.2 app at the repo root takes the 2.2 tarball and is switched on as HLD §6.6
shows: `?debug=1` for one load, or the activation chord, remembered.

## Owned paths

`/vendor/debug-capture-2.2.0-alpha.1.tgz` (the old tarball removed), `/package.json`,
`/package-lock.json`, `/src/main.ts`, `/src/app/features/debug-panel/**`,
`/docs/debug-panel.md`.

## Behaviour

- `startDebugPanel()` returns `{ providers, ready }`: `installDebugActivation()` and
  `[provideDebugCaptureSession(() => debug.session)]`. `main.ts` bootstraps after `ready`.
- `docs/debug-panel.md`: both ways on, every shortcut with its default, the Chrome policy
  setup for the download folder, how to turn it off, how to remove it.

## Verification

`npx tsc -p tsconfig.app.json --noEmit`, `npm run lint:layers`, `npx ng build` (report the
main bundle before and after), `ng test` (no-sandbox Karma config). v1 code untouched.
