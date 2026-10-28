# 04b — Virtual list

**Branch:** `claude/dc-v2-w2-04b-list` → PR into `claude/dc-v2-wave2`
**Covers:** S04-05, S04-07 (list part) (`../spec.md`).
**Read first:** `../spec.md`, `../../wave-2.md` (class names), HLD §4.4
(follow, "↓ N new"), §4.12, §5.3, §5.6 (columns), §5.7, `ISO-10`, `ISO-12`,
`ISO-18`, research `host-impact-edge-cases.md` §3.6 (performance findings).

## Owned paths

`src/panel/ui/virtual-list/**` only, with its own `index.ts` (child barrel).
It may import only the P1 barrel (`'../../model'`) — the layer checker allows
a child directory of P2 to import the barrel above P2. Use DOM APIs directly
(`createElement`, `textContent`); never HTML strings. Export
`VIRTUAL_LIST_CSS` (your CSS, using the `--dcp-` tokens and the `dcp-row*`
classes you own).

## API (names fixed)

```ts
createVirtualList<T>(doc: Document, options: VirtualListOptions<T>): VirtualList<T>
```

Options at least: `rowHeight: number`, `columns` (key, label, width — px or
`'flex'`), `renderCell(item, columnKey, cell: HTMLElement)` (the caller
fills the cell with text/elements), `getKey(item)`, `rowClass?(item)`
(for `--error`/`--warn` tints), `ariaLabel`, `onSelect?(item, index)`,
`onActivate?(item)` (Enter / double-click), `overscan?`, `requestFrame?`
(injected; default none — render synchronously). Methods at least:
`element`, `setItems(items)`, `select(index | null)`, `selectedIndex`,
`scrollToIndex`, `scrollToEnd()`, `isAtEnd()`, `onScrollChange(cb)`,
`setRowHeight(px)`, `destroy()`.

## Tests (Karma, real Chromium; show each failing once)

5,000 and 100,000 items: node count < 2,000 at top, middle, end; correct rows
visible after `scrollTop` changes; keyboard map moves selection and scrolls
it into view; `aria-rowcount`/`aria-rowindex` right; follow-bottom: at end +
new items → stays at end; scrolled up → does not move; bidi cell
attributes; `setItems` with 5,000 new items costs ≤ visible-row work (timing
spec with honest margins, comment states both numbers); `destroy()` removes
every listener and observer.

## Verification

```bash
npm ci
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run check
```

Report: spec count (do not edit `test/unit/spec-floor.json`), API, node
counts and timing numbers.
