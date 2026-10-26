# 14c — The playground app

Spec row S14-12. Paths: `/vendor/`, `/package.json`, `/package-lock.json`,
`/src/app/features/debug-panel/**`, `/docs/debug-panel.md`.

`debugMessage(type, data?, level?)` forwards to the activation handle `startDebugPanel()`
created (a no-op before it is called). Checks: `tsc`, `lint:layers`, `ng build`, `ng test`.
