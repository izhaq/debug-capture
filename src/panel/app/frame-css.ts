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
  // Title bar, 32 px at every text size, elevated (§5.3, §5.4).
  '.dcp-titlebar{display:flex;align-items:center;gap:8px;flex:none;height:var(--dcp-bar-h);padding:0 4px 0 8px;' +
    'border-bottom:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated);white-space:nowrap}',
  '.dcp-title{display:inline-flex;align-items:center;gap:4px;flex:none;font-weight:600}',
  '.dcp-title>.dcp-icon{color:var(--dcp-accent)}',
  '.dcp-toolbar{display:flex;align-items:center;gap:4px;flex:none;margin-left:auto}',
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
  // Tab panels; the Network sub-tabs open the view's filter bar (§5.2), or their own bar if it has none.
  '.dcp-body{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
  '.dcp-tabpanel{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
  '.dcp-filter-bar>.dcp-tabs{margin-left:-8px;border-right:1px solid var(--dcp-divider)}',
  '.dcp-subbar{display:flex;align-items:stretch;flex:none;height:var(--dcp-bar-h);padding:0 4px;' +
    'border-bottom:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated)}',
  // Settings popover: one row per setting.
  '.dcp-settings{display:flex;flex-direction:column;gap:4px;padding:4px}',
  '.dcp-setting{display:flex;align-items:center;gap:8px;min-width:0;margin:0;padding:0;border:0}',
  '.dcp-setting>legend{float:left;width:72px;padding:0;color:var(--dcp-text-muted)}',
  '.dcp-setting>label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}',
  '.dcp-setting input{margin:0;accent-color:var(--dcp-accent)}',
  // Status bar, 22 px, meta text (§5.3, §5.5).
  '.dcp-statusbar{display:flex;align-items:center;flex:none;height:var(--dcp-status-h);padding:0 8px;' +
    'border-top:1px solid var(--dcp-divider);background-color:var(--dcp-bg-elevated);font-family:var(--dcp-font-mono);' +
    'font-size:var(--dcp-fs-meta);color:var(--dcp-text-muted);white-space:nowrap;overflow:hidden}',
  '.dcp-status__part{display:inline-flex;align-items:center}',
  '.dcp-status__part+.dcp-status__part::before{content:"\\00b7"/"";padding:0 6px;color:var(--dcp-text-faint)}',
  '.dcp-status__icon{display:inline-flex}',
  '.dcp-status__icon>.dcp-icon{width:12px;height:12px;vertical-align:0}',
].join('\n');
