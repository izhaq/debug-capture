/**
 * Shared view chrome (wave 3, C3-1). The view types (`ViewDeps`,
 * `PanelView`, `CreateView`, `ViewSettings`) live in P2's
 * `ui/view-contract.ts`, where every view folder can reach them.
 *
 * Stylesheet contract (C3-3) — the loader's sheet holds the `:host` lockdown,
 * so nobody may replace the shadow root's sheet list:
 * - The loader's sheet also holds a default `.dcp-root` box (bottom, 40%). It
 *   stays as it is: no loader bytes are spent on wave 3's layout.
 * - The frame owns size and dock by inline styles on `panelRoot`
 *   (`el.style.x =`, AGENTS rule 11); inline styles beat the loader default.
 * - The frame builds one UI sheet,
 *   `createThemeSheet(doc, [FRAME_CSS, VIEW_CSS, HTTP_VIEW_CSS, WS_VIEW_CSS, CONSOLE_VIEW_CSS])`,
 *   and appends it: `root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]`.
 *   On `unmount()` it removes only its own sheet.
 * - Views adopt no sheets and style nothing outside their element: their look
 *   is their `*_VIEW_CSS` string, with classes `dcp-http-*`, `dcp-ws-*`,
 *   `dcp-console-*`, plus the shared classes below.
 *
 * Same rules as the theme: px and `--dcp-` tokens only, nothing global.
 */
export const VIEW_CSS = [
  // A view fills its tab: the filter bar on top, then the list and the detail.
  '.dcp-view{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
  // 32 px at every text size (§5.3), elevated like the title bar (§5.4).
  '.dcp-filter-bar{display:flex;align-items:center;gap:8px;flex:none;box-sizing:border-box;height:var(--dcp-bar-h);' +
    'padding:0 8px;border-bottom:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated);overflow:hidden}',
  // Holds a list and its "↓ N new" button, which places itself bottom-right of this box.
  '.dcp-list-pane{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
  '.dcp-detail{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;background-color:var(--dcp-bg)}',
  '.dcp-detail-header{display:flex;align-items:center;gap:8px;flex:none;box-sizing:border-box;' +
    'height:var(--dcp-bar-h);padding:0 8px;border-bottom:1px solid var(--dcp-divider)}',
  '.dcp-detail-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}',
].join('\n');
