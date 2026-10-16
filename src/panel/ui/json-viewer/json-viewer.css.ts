/**
 * The JSON viewer's look (HLD §5.4, §5.5, §5.7; mockup "JSON tree"): 16 px
 * indent per level, punctuation in `--dcp-text`, v1 placeholders muted and
 * italic, the four `--dcp-json-*` colours. px only (ISO-03); composed into the
 * panel's one sheet by `createThemeSheet(doc, [JSON_VIEWER_CSS])` (ISO-04,
 * ISO-05). The badges (`dcp-badge*`) are styled by the theme, not here; an
 * inline `[redacted]` borrows the theme's precomputed badge fill
 * (`--dcp-badge-muted-bg`, forced-colours mapped), so no `color-mix()`.
 */
export const JSON_VIEWER_CSS = `
.dcp-json, .dcp-json-group { list-style: none; margin: 0; padding: 0; }
.dcp-json {
  font-family: ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", Menlo, monospace;
  line-height: 1.4;
  color: var(--dcp-text);
}
.dcp-json-group { padding-left: 16px; }
.dcp-json-item, .dcp-json-more { margin: 0; padding: 0; }
.dcp-json-item:focus, .dcp-json-more:focus { outline: none; }
.dcp-json-item:focus-visible > .dcp-json-line, .dcp-json-more:focus-visible {
  outline: 2px solid var(--dcp-accent);
  outline-offset: -2px;
}
.dcp-json-line { display: flex; align-items: baseline; white-space: pre; min-width: 0; }
.dcp-json-item[aria-expanded] > .dcp-json-line { cursor: pointer; }
.dcp-json-line:hover, .dcp-json-more:hover { background: var(--dcp-bg-hover); }
.dcp-json-toggle, .dcp-json-spacer { flex: none; display: inline-block; width: 16px; text-align: center; }
.dcp-json-toggle { color: var(--dcp-text-muted); }
.dcp-json-toggle::before { content: "\\25B8"; display: inline-block; }
.dcp-json-item[aria-expanded="true"] > .dcp-json-line > .dcp-json-toggle::before { transform: rotate(90deg); }
.dcp-json-key { color: var(--dcp-json-key); flex: none; }
.dcp-json-string {
  color: var(--dcp-json-string);
  unicode-bidi: plaintext;
  white-space: pre-wrap;
  word-break: break-all;
  min-width: 0;
}
.dcp-json-number { color: var(--dcp-json-number); }
.dcp-json-literal { color: var(--dcp-json-literal); }
.dcp-json-placeholder { color: var(--dcp-text-muted); font-style: italic; }
.dcp-json-key.dcp-json-placeholder { color: var(--dcp-text-muted); }
.dcp-json-summary { color: var(--dcp-text-muted); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.dcp-json-redacted {
  color: var(--dcp-text-muted);
  background-color: var(--dcp-badge-muted-bg);
  border-radius: 4px;
}
.dcp-json-show-all, .dcp-json-more {
  color: var(--dcp-accent);
  cursor: pointer;
  text-decoration: underline;
}
.dcp-json-more { padding-left: 16px; }
.dcp-json-show-all {
  flex: none;
  margin-left: 8px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
}
.dcp-json .dcp-badge { margin-left: 4px; flex: none; }
@media (forced-colors: active) {
  .dcp-json-item:focus-visible > .dcp-json-line, .dcp-json-more:focus-visible { outline-color: Highlight; }
}
`;
