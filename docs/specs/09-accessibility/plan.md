# S-09 Accessibility — plan

Spec: [`spec.md`](spec.md) (S09-01 … S09-05). Source of truth: `docs/design/HLD.md`.

## Branch

```
claude/air-gapped-debug-logging-zkn1nr     integration branch
└── claude/dc-v2-s09-a11y                  this slice — one PR into the integration branch
```

One branch, one PR. The owner reviews it. It is not merged from this slice.

## Owned paths

All paths are from the package root (this repository).

| Path | Why |
|---|---|
| `docs/specs/09-accessibility/**` | this spec, plan and brief |
| `docs/specs/README.md` | the S-09 row, plus links for the spec folders that already exist |
| `src/panel/app/frame-css.ts` | the banner mark in forced colours (S09-02) |
| `src/panel/app/frame.spec.ts` | the unit lock for that rule |
| `src/panel/views/http/http-view.ts`, `src/panel/views/ws/ws-view.ts`, `src/panel/views/console/console-view.ts` | the first paint shows empty / no-match / list from the store, before the first update (S09-05) |
| `test/e2e/panel-a11y.spec.mjs` | the keyboard walk and the live forced-colour / reduced-motion check |
| `test/unit/spec-floor.json`, `test/e2e-floor.json` | the new counts |

If the walk finds a real keyboard or focus bug, the fix stays in the file that owns that behaviour, and the PR says so.

## Status

Merged in #93.

- Unit specs: 1122 ran, floor 1122. The banner spec failed once before the CSS rule existed. The first-paint specs failed once while a restored filter still showed the empty message.
- e2e: 33 ran, floor 33. The keyboard walk includes Export and Settings Escape. Reduced motion is checked against an inline transition the rule must turn off.
- Sizes, min+gzip, budgets unchanged: loader 4,084 / 4,096. UI chunk 38,926 / 40,960.
- Contrast, typecheck, lint, layer check and pack check passed.
