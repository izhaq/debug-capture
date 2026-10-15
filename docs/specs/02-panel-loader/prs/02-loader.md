# 02 — Panel loader

**Branch:** `claude/dc-v2-w2-02-loader` → PR into `claude/dc-v2-wave2`
**Covers:** S02-01 … S02-17 (`../spec.md`).
**Read first:** `../spec.md`, `../../wave-2.md`, HLD §4.1–§4.3, §6.2,
§6.4, §6.7; `docs/research/host-impact-edge-cases.md` §1 (rules), the §3
findings each rule cites, §4 (hostile host). Real browser APIs: read the
Chromium-relevant MDN/spec text for `popover`, `adoptedStyleSheets`,
`inert`, `attachShadow` — do not guess (AGENTS rule 5).

## Owned paths

`src/panel/index.ts` and any other file directly in `src/panel/` (including
`public-api.spec.ts` — update its expected exports), `src/panel/app/**` (the
placeholder; keep `mount-panel-ui.ts`'s types), `test/hostile-host/**`,
`test/e2e/panel-*`, `playwright.config.mjs`.

## Dependencies on other tracks

- `isProblemEntry` (track 01b) and `createCaptureController` (01a) may not be
  merged when you start. Take the problem rule as an internal parameter with
  the `IsProblemEntry` type and a local stub marked `// TODO(wave-2 merge)`;
  the orchestrator will tell you when 01b is in the wave branch — then merge
  it and switch. For e2e, drive the panel with a **fake controller** written in
  the fixture page (it must satisfy `CaptureController`); switch to the real
  controller after 01a merges if time allows, else note it.
- Do not import anything from `src/panel/ui/**` or `src/panel/model/**`
  values (P5 may import L5 and P4-by-type/dynamic only; P4's placeholder may
  import only the P3 barrel, which is empty — use DOM APIs directly).

## Launcher tokens

Put the few colours the launcher needs in `src/panel/launcher-tokens.ts` with
the HLD §5.4 token **names** and **values** (dark and light). Track 04a's
`scripts/theme-check.mjs` will verify they equal the HLD table.

## Tests

- Karma (unit/component, real Chromium DOM): registration and reuse, inert
  handle for `null`, badge counting with a fake recorder (problem / not
  problem, reset on open and on `cleared`, one rAF per frame), toggle matching
  (exact chord only), focus move and return, dispose while open, removal and
  remount, zone: with a fake `Zone.root.run` spy prove every listener/timer is
  created inside it.
- Playwright on `test/hostile-host/index.html` (served with `dist/`): host
  computed styles unchanged after install and after open (snapshot a set of
  host elements); panel inner styles identical with and without the hostile
  CSS; clicks/keys inside the panel never reach host listeners (bubble and
  capture on `document`/`window`), the global chord still does; the host's
  "click outside closes the menu" still works for clicks outside the panel;
  focus returns; print media hides the element; a second copy of the loader
  does not register twice; host removes the element → next open works; CSP
  page (`default-src 'self'`, `require-trusted-types-for 'script'`, no
  `unsafe-inline`) → zero violations (listen to `securitypolicyviolation`);
  no page errors; launcher clickable under a host `z-index: 2147483647`
  overlay (top layer). An Angular-zone case can wait for S-10, but load
  `zone.js` (dev dependency already installed) in one fixture page and prove
  no zone task is scheduled by the closed loader.
- `npm run size`: loader ≤ 4 kB; `panel-ui` chunk reported.

## Verification

```bash
cd packages/debug-capture && npm ci
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check
```

Report: spec count (do not edit `test/unit/spec-floor.json`), Playwright test
count, loader and UI-chunk sizes, which ISO rules each test covers, and any
rule you could not prove.

## Out of scope

Frame, views, settings, banners, resize/dock/maximize (wave 3).
