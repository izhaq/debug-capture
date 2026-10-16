/**
 * The look of the small controls (S04-04, HLD §5.7 "Component looks"):
 * button, tabs, chips, search box, split pane, popover / menu, empty state.
 * The class names are the ones the control builders in `src/panel/ui/` set.
 * Same rules as the theme: px only, tokens only, nothing global.
 */
export const CONTROLS_CSS = [
  // Control: 24 px, 1 px control border, radius 4, panel background.
  '.dcp-btn{height:var(--dcp-control-h);display:inline-flex;align-items:center;justify-content:center;gap:4px;' +
    'flex:none;padding:0 8px;border:1px solid var(--dcp-border-control);border-radius:4px;' +
    'background-color:var(--dcp-bg);color:var(--dcp-text);font-family:var(--dcp-font-ui);' +
    'font-size:var(--dcp-fs-ui);line-height:1;white-space:nowrap;cursor:pointer}',
  '.dcp-btn--icon{width:var(--dcp-control-h);padding:0}',
  '.dcp-btn:hover:not(:disabled),.dcp-chip:hover,.dcp-tab:hover,.dcp-menu__item:hover:not(:disabled)' +
    '{background-color:var(--dcp-bg-hover)}',
  // Tabs: muted; the active one in text colour, 600, with a 2 px accent line.
  '.dcp-tabs{display:flex;align-items:stretch;align-self:stretch;flex:none}',
  '.dcp-tab{padding:0 8px;border:0;border-radius:0;background:none;color:var(--dcp-text-muted);' +
    'font-family:var(--dcp-font-ui);font-size:var(--dcp-fs-ui);white-space:nowrap;cursor:pointer}',
  '.dcp-tab[aria-selected="true"]{color:var(--dcp-text);font-weight:600;box-shadow:inset 0 -2px 0 var(--dcp-accent)}',
  // Chips of one group join into one segmented control.
  '.dcp-chips{display:inline-flex;flex:none}',
  '.dcp-chip{position:relative;height:var(--dcp-control-h);padding:0 8px;margin:0 0 0 -1px;' +
    'border:1px solid var(--dcp-border-control);border-radius:0;background-color:var(--dcp-bg);' +
    'color:var(--dcp-text);font-family:var(--dcp-font-ui);font-size:var(--dcp-fs-ui);white-space:nowrap;cursor:pointer}',
  '.dcp-chip:first-child{margin-left:0;border-radius:4px 0 0 4px}',
  '.dcp-chip:last-child{border-radius:0 4px 4px 0}',
  '.dcp-chip:only-child{border-radius:4px}',
  '.dcp-chip[aria-pressed="true"]{z-index:1;background-color:var(--dcp-bg-selected);' +
    'border-color:var(--dcp-accent);color:var(--dcp-text)}',
  '.dcp-chip:focus-visible{z-index:2}',
  // Search box: icon inside the input's left padding.
  '.dcp-search{position:relative;display:inline-flex;align-items:center;min-width:0}',
  '.dcp-search>.dcp-icon{position:absolute;left:4px;color:var(--dcp-text-muted);pointer-events:none}',
  '.dcp-search__input{width:240px;max-width:100%;min-width:0;height:var(--dcp-control-h);padding:0 8px 0 22px;' +
    'border:1px solid var(--dcp-border-control);border-radius:4px;background-color:var(--dcp-bg);' +
    'color:var(--dcp-text);font-family:var(--dcp-font-ui);font-size:var(--dcp-fs-ui)}',
  '.dcp-search__input::placeholder{color:var(--dcp-text-muted);opacity:1}',
  // Split pane: a 1 px divider with a 6 px hit area (HLD §5.3).
  '.dcp-split{display:flex;flex:1 1 auto;min-width:0;min-height:0}',
  '.dcp-split[data-direction="column"]{flex-direction:column}',
  '.dcp-split__first{display:flex;flex-direction:column;flex:1 1 0;min-width:0;min-height:0;overflow:hidden}',
  '.dcp-split__second{display:flex;flex-direction:column;flex:0 0 45%;min-width:0;min-height:0;overflow:hidden}',
  '.dcp-split__handle{position:relative;z-index:1;flex:0 0 1px;background-color:var(--dcp-divider);touch-action:none}',
  '.dcp-split__handle::before{content:"";position:absolute;top:0;bottom:0;left:-3px;right:-3px;cursor:ew-resize}',
  '.dcp-split[data-direction="column"]>.dcp-split__handle::before{left:0;right:0;top:-3px;bottom:-3px;cursor:ns-resize}',
  '.dcp-split__handle:focus-visible{outline-offset:0}',
  // Popover / menu: elevated, 1 px divider border, radius 6, no shadow.
  '.dcp-popwrap{position:relative;display:inline-flex}',
  '.dcp-pop{position:absolute;top:calc(100% + 4px);right:0;z-index:30;width:max-content;padding:4px;' +
    'border:1px solid var(--dcp-divider);border-radius:6px;background-color:var(--dcp-bg-elevated);color:var(--dcp-text)}',
  '.dcp-menu{display:flex;flex-direction:column;min-width:200px}',
  '.dcp-menu__item{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border:0;' +
    'border-radius:4px;background:transparent;color:var(--dcp-text);font-family:var(--dcp-font-ui);' +
    'font-size:var(--dcp-fs-ui);text-align:left;white-space:nowrap;cursor:pointer}',
  '.dcp-menu__item:focus-visible{outline-offset:-2px}',
  '.dcp-menu__shortcut{margin-left:auto;padding-left:16px;font-family:var(--dcp-font-mono);' +
    'font-size:var(--dcp-fs-meta);color:var(--dcp-text-muted)}',
  // Empty / no-match block, centred in the list area.
  '.dcp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;' +
    'color:var(--dcp-text-muted);text-align:center}',
  '.dcp-empty__message{margin:0}',
  '@media (forced-colors:active){.dcp-chip[aria-pressed="true"],.dcp-tab[aria-selected="true"]{' +
    'forced-color-adjust:none;background-color:Highlight;color:HighlightText;border-color:Highlight}}',
].join('\n');
