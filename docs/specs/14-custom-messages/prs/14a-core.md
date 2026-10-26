# 14a — Core: the `app` entry kind and `addMessage`

Spec rows S14-01 … S14-07. Paths: `src/contract/`, `src/core/recorder.ts`,
`src/core/problem-rule.ts`, `src/install/install-debug-capture.ts`, `src/activate/`,
`src/panel/model/selectors.ts` (leave `app` out until S-14b), their specs, floors, version.

Public API: see HLD §6.4 (2.3 block). `addMessage` checks `session.active` first, so nothing is
recorded while capture is off. The activation handle's `message` reads `loaded`, so it is a
no-op until the load lands. Specs red once; `npm run check`; sizes in the PR.
