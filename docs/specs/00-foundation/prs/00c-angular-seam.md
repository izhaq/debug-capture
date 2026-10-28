# 00c — Angular seam without decorators (C-4)

**Branch:** `claude/dc-v2-s00c-angular-seam` → PR into `claude/dc-v2-s00-foundation`
**Covers:** S00-10 (`../spec.md`). HLD §6.5 `C-4`, `D-09`.
**Read first:** `../spec.md`, HLD §6.5, `src/angular/**`, and the real
Angular 16.2 source for `inject()`, `ErrorHandler`, `Injector.create`,
`EnvironmentInjector` (in the host repo's `node_modules/@angular/core`) —
AGENTS rule 5: do not guess framework APIs.

## Why

The package is built with plain `tsc` (`D-09`). A class decorated with
`@Injectable()` but not compiled by the Angular compiler has no factory in an
AOT host app, so it would fail at runtime there (or need the JIT compiler).
Without the decorator, the package needs no Angular build step and no
`experimentalDecorators`.

## Owned paths (relative to the package root)

`src/angular/**` only. Do not edit `tsconfig.json` (the orchestrator turns
`experimentalDecorators` off after the merge).

## What to change

- Remove `@Injectable()` from `DebugCaptureErrorHandler`. Keep the class, its
  name and its behaviour (`inject(DEBUG_CAPTURE_SESSION, { optional: true })`
  must still run in an injection context).
- `provideDebugCapture()` returns
  `[{ provide: ErrorHandler, useFactory: () => new DebugCaptureErrorHandler() }]`
  (or the equivalent you prove correct) — no `useClass`.
- Public API unchanged: same exported names from `src/angular/index.ts`.
- Update doc comments to say why there is no decorator.

## Required specs (show each failing once)

- Existing Angular specs pass unchanged (or with the smallest change, explained).
- New: the handler works when provided through `Injector.create` /
  `createEnvironmentInjector` with no `TestBed` and no JIT metadata on the class
  (e.g. assert the class has no `ɵfac` / `ɵprov` static, and that an injector
  built from `provideDebugCapture()` + `provideDebugCaptureSession(fake)`
  returns a handler that records an error).
- New: `inject()` outside an injection context is never reached (constructing
  the handler through the factory inside the injector works; document what
  happens if a host does `new DebugCaptureErrorHandler()` by hand).

## Verification

```bash
# from the repo root of your worktree
npx tsc -p tsconfig.json
# prove it compiles WITHOUT decorators: a throwaway tsconfig in your scratch dir
# that extends the package one with "experimentalDecorators": false — must pass
node <pkg-test.cjs> . 'angular'
node <pkg-test.cjs> .   # all 312+ specs
```

Bonus (say if done): wire the seam into the real Angular host app in a
**scratch copy only** (do not commit host-app changes) and confirm an Angular
error is recorded with an AOT production build (`npx ng build`), proving the
point of C-4. If too costly, say why.

Never commit a link to `/tmp` (AGENTS rule 26).

## Out of scope

Anything outside `src/angular/`. The v1 seam in the host app
(`src/app/features/debug-capture/`) stays as it is.
