/**
 * The frame's look (S-08, HLD §5.2–§5.7): title bar, tabs, toolbar, banners,
 * the resize edge and the status bar. Classes `dcp-frame`, `dcp-titlebar`,
 * `dcp-toolbar`, `dcp-banner`, `dcp-statusbar`, `dcp-resize` (wave-3 class
 * table). Same rules as the theme: px and `--dcp-` tokens only, every rule
 * under a `dcp-` class, nothing global (ISO-03, ISO-05).
 *
 * The panel root's size and dock are inline styles (C3-3); these rules only
 * restyle what the loader's default box draws (its border) for the dock.
 */
export const FRAME_CSS = [
  '.dcp-root{overflow:hidden}',
  '.dcp-root[data-dock="right"]{border-top:0;border-left:1px solid var(--dcp-border-control)}',
  '.dcp-root[data-maximized]{border:0}',
  // The frame fills the root; narrow docks hide the button words (the names stay, as aria-label).
  '.dcp-frame{position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0;' +
    'container-type:inline-size}',
  // §5.3: a 6 px hit area on the inner edge; the cursor shows the direction.
  '.dcp-resize{position:absolute;z-index:40;left:0;right:0;top:0;height:6px;cursor:ns-resize;touch-action:none}',
  '.dcp-root[data-dock="right"] .dcp-resize{right:auto;bottom:0;width:6px;height:auto;cursor:ew-resize}',
  '.dcp-resize:focus-visible{outline-offset:-2px}',
  // Title bar, 32 px up to 14 px text, then growing with it (§5.3, D-50), elevated (§5.4). When the
  // toolbar does not fit beside the tabs (large text, narrow dock) it wraps to a second bar-high
  // line instead of pushing controls out of the panel (FR-TXT-05).
  '.dcp-titlebar{display:flex;flex-wrap:wrap;align-items:center;column-gap:8px;row-gap:0;flex:none;' +
    'min-height:var(--dcp-bar-h);padding:0 4px 0 8px;' +
    'border-bottom:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated);white-space:nowrap}',
  '.dcp-title{display:inline-flex;align-items:center;gap:4px;flex:none;font-weight:600}',
  '.dcp-title>.dcp-icon{color:var(--dcp-accent)}',
  '.dcp-toolbar{display:flex;align-items:center;gap:4px;flex:none;margin-left:auto;' +
    'min-height:calc(var(--dcp-bar-h) - 1px)}',
  '.dcp-titlebar>.dcp-tabs{min-height:calc(var(--dcp-bar-h) - 1px)}',
  '.dcp-paused{font-family:var(--dcp-font-mono);font-size:var(--dcp-fs-meta);color:var(--dcp-warning)}',
  '.dcp-btn>.dcp-icon+.dcp-icon{margin-left:-2px}',
  '@container (max-width:720px){.dcp-toolbar .dcp-btn>span{display:none}' +
    '.dcp-toolbar .dcp-btn{min-width:var(--dcp-control-h);padding:0 4px}.dcp-paused{display:none}}',
  '@container (max-width:440px){.dcp-title>span{display:none}}',
  // Banners: full width under the title bar, a 2 px warning bar at the start, text + one button (§5.7).
  '.dcp-banner{display:flex;align-items:center;gap:8px;flex:none;min-height:var(--dcp-bar-h);padding:4px 8px 4px 10px;' +
    'border-bottom:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated);' +
    'box-shadow:inset 2px 0 0 var(--dcp-warning)}',
  '.dcp-banner__text{flex:1 1 auto;min-width:0}',
  // 2.1 warning banners carry two or three buttons: they wrap under the text on a narrow panel.
  '.dcp-banner[data-warning]{flex-wrap:wrap}',
  // Tab panels; the Network sub-tabs open the view's filter bar (§5.2), or their own bar if it has none.
  '.dcp-body{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
  '.dcp-tabpanel{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
  '.dcp-filter-bar>.dcp-tabs{margin-left:-8px;border-right:1px solid var(--dcp-divider)}',
  '.dcp-subbar{display:flex;align-items:stretch;flex:none;height:var(--dcp-bar-h);padding:0 4px;' +
    'border-bottom:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated)}',
  // Settings popover: one row per setting.
  '.dcp-settings{display:flex;flex-direction:column;gap:4px;padding:4px}',
  '.dcp-about{max-height:160px;overflow:auto;margin:4px 0 0;padding:4px;border-top:1px solid var(--dcp-divider)}',
  '.dcp-about>h3{margin:0 0 2px;font-size:inherit;font-weight:600}',
  '.dcp-about>p{margin:0 0 4px;color:var(--dcp-text-muted)}',
  '.dcp-about table{border-collapse:collapse}',
  '.dcp-about td{padding:1px 8px 1px 0;vertical-align:top;white-space:nowrap}',
  '.dcp-about td+td{white-space:normal}',
  '.dcp-about kbd{font:inherit;font-family:var(--dcp-font-mono)}',
  '.dcp-setting{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0;margin:0;padding:0;border:0}',
  // 6em: 72 px at 12 px text, and as wide as the words at any text size (FR-TXT-03).
  '.dcp-setting>legend{float:left;width:6em;padding:0;color:var(--dcp-text-muted)}',
  '.dcp-setting>label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}',
  '.dcp-setting input{margin:0;accent-color:var(--dcp-accent)}',
  // Text size − / the size / + / Reset (FR-TXT-01): fixed-width digits, so the buttons never move.
  '.dcp-text-size{min-width:5ch;text-align:center;font-variant-numeric:tabular-nums}',
  // The No limit warning (FR-BUF-03): under the Buffer choices, in the warning colour, never by colour alone (it is words).
  // Its own line, wrapped (the toolbar's nowrap reaches the popover); `contain:inline-size` keeps
  // the sentence from widening the popover, so it wraps to the width the choices set.
  '.dcp-setting-note{flex:0 0 100%;box-sizing:border-box;contain:inline-size;margin:0;padding-left:calc(6em + 8px);' +
    'white-space:normal;color:var(--dcp-warning)}',
  // Add note form (FR-NOTE-01): controls as §5.7.
  '.dcp-note{display:flex;flex-direction:column;gap:8px;width:320px;max-width:calc(100vw - 32px);padding:4px}',
  '.dcp-note__field{display:flex;flex-direction:column;gap:2px;color:var(--dcp-text-muted)}',
  '.dcp-note>.dcp-btn{align-self:flex-end}',
  '.dcp-input{box-sizing:border-box;width:100%;min-height:var(--dcp-control-h);margin:0;padding:2px 6px;' +
    'border:1px solid var(--dcp-border-control);border-radius:4px;background-color:var(--dcp-bg);color:var(--dcp-text);' +
    'font:inherit}',
  '.dcp-note__text{height:72px;resize:vertical;font-family:var(--dcp-font-mono)}',
  // Status bar, 22 px, meta text (§5.3, §5.5).
  '.dcp-statusbar{display:flex;align-items:center;flex:none;height:var(--dcp-status-h);padding:0 8px;' +
    'border-top:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated);font-family:var(--dcp-font-mono);' +
    'font-size:var(--dcp-fs-meta);color:var(--dcp-text-muted);white-space:nowrap;overflow:hidden}',
  '.dcp-status__part{display:inline-flex;align-items:center}',
  '.dcp-status__part+.dcp-status__part::before{content:"\\00b7"/"";padding:0 6px;color:var(--dcp-text-faint)}',
  '.dcp-status__icon{display:inline-flex}',
  '.dcp-status__icon>.dcp-icon{width:var(--dcp-icon-sm);height:var(--dcp-icon-sm);vertical-align:0}',
  // §5.7 banner bar is an inset shadow. Forced colours drop shadows, so the
  // mark becomes a 2 px border in the system text colour (S09-02, NFR-A11Y-01).
  '@media (forced-colors:active){.dcp-banner{box-shadow:none;border-inline-start:2px solid CanvasText}}',
].join('\n');
