# 04c — JSON viewer

**Branch:** `claude/dc-v2-w2-04c-json` → PR into `claude/dc-v2-wave2`
**Covers:** S04-06, S04-07 (viewer part) (`../spec.md`).
**Read first:** `../spec.md`, `../../wave-2.md` (class names), HLD
`FR-COM-01`, `FR-COM-02`, `FR-HTTP-07`, §4.6, §5.4 (json tokens), §5.7, and
`src/core/json-safe.ts` (every placeholder v1 writes).

## Owned paths

`src/panel/ui/json-viewer/**` only, with its own `index.ts` (child barrel).
It may import only the P1 barrel (`'../../model'`). DOM APIs directly; never
HTML strings. Export `JSON_VIEWER_CSS` (uses `--dcp-json-*` tokens and the
`dcp-json-*` classes you own; badges use the shared `dcp-badge*` classes
that 04a styles).

## API (names fixed)

```ts
createJsonViewer(doc: Document, value: JsonValue, options: JsonViewerOptions): JsonViewer
```

Options at least: `redactedValue: string`, `expandDepth?: number` (default
1), `pageSize?: number` (default 100), `longStringLimit?: number`,
`ariaLabel`. Methods: `element`, `expandAll(maxNodes)`, `collapseAll()`,
`destroy()`.

## Tests (Karma, real Chromium; show each failing once)

Each value kind renders with its class; every v1 placeholder from
`json-safe.ts` is detected and shown as a placeholder (and a known limit is
documented: a real string with the same text looks the same); `[redacted]`
leaf gets the badge; truncation suffix gets the badge with N; `"<img src=x
onerror=…>"` stays text; 2,000-key object: first 100 children, "Show 100
more" adds 100; long string "Show all"; collapsed children are not in the DOM;
keyboard: ← → Enter Space with `aria-expanded`; deep nesting (depth 50) does
not blow the stack; timing spec for a 2,000-key expand with honest margins;
`destroy()` removes listeners.

## Verification

```bash
npm ci
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check
```

Report: spec count (do not edit `test/unit/spec-floor.json`), API, timing.
