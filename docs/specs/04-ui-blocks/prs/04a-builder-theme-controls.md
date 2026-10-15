# 04a — Builder, theme, icons, controls

**Branch:** `claude/dc-v2-w2-04a-controls` → PR into `claude/dc-v2-wave2`
**Covers:** S04-01 … S04-04 (`../spec.md`).
**Read first:** `../spec.md`, `../../wave-2.md` (class names and CSS
composition), HLD §5 and §4.5/§4.11/§4.12, `docs/design/mockup.html` (look),
`scripts/contrast-check.mjs` (reuse its exported functions).

## Owned paths

`src/panel/ui/**` except `ui/virtual-list/**` and `ui/json-viewer/**`;
`scripts/theme-check.mjs`; in `package.json` only the `contrast` script line
(→ `node scripts/contrast-check.mjs --self-test && node scripts/contrast-check.mjs && node scripts/theme-check.mjs`).

## How

- Suggested layout: `ui/dom/` (builder), `ui/theme/` (tokens, sheet, CSS),
  `ui/icons/`, `ui/controls/`. The P2 barrel `ui/index.ts` keeps its first
  line `export * from '../model';` and exports your API. Do **not** add the
  `./virtual-list` / `./json-viewer` lines (the orchestrator does).
- `TOKENS` in TypeScript with the HLD token names (without `--dcp-`) and
  values. `scripts/theme-check.mjs` parses `src/panel/ui/theme/tokens.ts` (and
  `src/panel/launcher-tokens.ts` if it exists — track 02 creates it) and fails
  on any name or value that differs from the HLD §5.4 table. Self-test it.
- `createThemeSheet(doc, extraCss: readonly string[] = [])`: builds CSS once
  and `replaceSync`s it into `new (doc.defaultView!).CSSStyleSheet()`; the
  `extraCss` are the other tracks' `VIRTUAL_LIST_CSS` / `JSON_VIEWER_CSS`.
  Also export `CONTROLS_CSS` (yours) so the frame can compose all of them.
- Style the shared classes you own (`dcp-root`, `dcp-badge*`, `dcp-match`)
  and every control. "Component looks" table (HLD §5.7) is the reference.
- Search box debounce and any delay: an injected `schedule(fn, ms) → cancel`
  (no global `setTimeout` in P2 — S-08 provides the real one).

## Tests (Karma, real Chromium DOM; show each failing once)

Builder refuses every forbidden input (and the lint rules still pass);
strings are never parsed as HTML (`<img onerror>` stays text); token parity
via `theme-check` self-test; sheet contains no `rem`, `@font-face`,
`@import`; `data-theme` switches colours (computed style on a test node);
forced-colors CSS present; each control's keyboard map and ARIA; `destroy()`
removes listeners (count with a spy on `addEventListener` /
`removeEventListener`); split pane uses pointer capture on its own handle.

## Verification

```bash
cd packages/debug-capture && npm ci
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check
```

Report: spec count (do not edit `test/unit/spec-floor.json`), public API,
sheet size (bytes), and a screenshot-free description of anything you could
not match from the HLD.
