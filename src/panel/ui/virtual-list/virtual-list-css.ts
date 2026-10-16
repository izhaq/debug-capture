/**
 * The virtual list's look (HLD §5.3, §5.6, §5.7), composed into the one
 * panel sheet by `createThemeSheet(doc, [VIRTUAL_LIST_CSS])` (04a). Colours
 * come only from the `--dcp-` tokens on `.dcp-root`; sizes are px (ISO-03,
 * ISO-05). The two `--dcp-vlist-*` properties are set by the list itself on
 * its own element.
 *
 * - Rows are recycled and absolutely placed, so `:nth-child` cannot stripe
 *   them: `dcp-row--alt` does.
 * - Tints are an 8 % overlay (`::before` + opacity), not `color-mix()`, which
 *   Chromium only has from 111 (we support 90+).
 * - The grid holds focus (`aria-activedescendant`); the ring is drawn inset on
 *   the selected row, or on the grid when nothing is selected (§5.7). The
 *   focus rules are (0,3,0) so they beat the theme's `.dcp-root
 *   :focus-visible` (0,2,0): one ring, never a second one on the grid.
 */
export const VIRTUAL_LIST_CSS = `
.dcp-vlist {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-behavior: auto;
  background-color: var(--dcp-bg);
  color: var(--dcp-text);
  outline: none;
}
.dcp-vlist:focus-visible:not([aria-activedescendant]) {
  outline: 2px solid var(--dcp-accent);
  outline-offset: -2px;
}
.dcp-vlist[aria-activedescendant]:focus-visible {
  outline: none;
}
.dcp-vlist__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: var(--dcp-vlist-cols);
  box-sizing: border-box;
  height: var(--dcp-vlist-row-h);
  line-height: calc(var(--dcp-vlist-row-h) - 1px);
  border-bottom: 1px solid var(--dcp-divider);
  background-color: var(--dcp-bg);
  color: var(--dcp-text-muted);
  font-family: system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-weight: 400;
  white-space: nowrap;
}
.dcp-vlist__body {
  position: relative;
}
.dcp-row {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: var(--dcp-vlist-cols);
  box-sizing: border-box;
  height: var(--dcp-vlist-row-h);
  line-height: var(--dcp-vlist-row-h);
  contain: strict;
  background-color: var(--dcp-bg);
  color: var(--dcp-text);
  font-family: ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", Menlo, monospace;
  white-space: nowrap;
  cursor: default;
}
.dcp-row--alt {
  background-color: var(--dcp-bg-row-alt);
}
.dcp-row:hover {
  background-color: var(--dcp-bg-hover);
}
.dcp-row--selected,
.dcp-row--selected:hover {
  background-color: var(--dcp-bg-selected);
  box-shadow: inset 2px 0 0 var(--dcp-accent);
}
.dcp-row--error::before,
.dcp-row--warn::before {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  opacity: 0.08;
  pointer-events: none;
}
.dcp-row--error::before {
  background-color: var(--dcp-error);
}
.dcp-row--warn::before {
  background-color: var(--dcp-warning);
}
.dcp-vlist:focus-visible .dcp-row--selected {
  outline: 2px solid var(--dcp-accent);
  outline-offset: -2px;
}
.dcp-vlist__cell,
.dcp-vlist__colhead {
  position: relative;
  min-width: 0;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dcp-vlist__cell {
  unicode-bidi: plaintext;
  text-align: left;
}
@media (forced-colors: active) {
  .dcp-row--selected,
  .dcp-row--selected:hover {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
    box-shadow: none;
  }
  .dcp-row--error::before,
  .dcp-row--warn::before {
    display: none;
  }
  .dcp-vlist:focus-visible .dcp-row--selected,
  .dcp-vlist:focus-visible:not([aria-activedescendant]) {
    outline-color: CanvasText;
  }
}
`;
