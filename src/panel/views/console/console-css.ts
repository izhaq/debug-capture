/** The Console view's own rules (`dcp-console-*`, C3-3): px and `--dcp-` tokens only, nothing global. */
export const CONSOLE_VIEW_CSS = [
  '.dcp-console-level{display:inline-flex;align-items:center;gap:4px}',
  // S07-05: the size of a run of identical messages, before the text.
  '.dcp-console-count{margin-right:6px;padding:0 4px;border-radius:8px;background-color:var(--dcp-bg-selected);color:var(--dcp-text-muted)}',
  // Detail header (4.6): level, time and source; close at the end.
  '.dcp-console-info{display:flex;align-items:center;gap:12px;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap}',
  '.dcp-console-body{padding:8px}',
  '.dcp-console-removed{margin:0;padding:4px 8px;border-bottom:1px solid var(--dcp-divider);color:var(--dcp-warning)}',
  '.dcp-console-h{margin:12px 0 4px;font-size:var(--dcp-fs-ui);font-weight:600}',
  '.dcp-console-h:first-child{margin-top:0}',
  '.dcp-console-pre{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}',
  // The stack starts collapsed (FR-CON-03); its chevron points down while it is open.
  '.dcp-console-stack{margin-bottom:4px}',
  '.dcp-console-stack[aria-expanded="true"] .dcp-icon{transform:rotate(90deg)}',
].join('\n');
