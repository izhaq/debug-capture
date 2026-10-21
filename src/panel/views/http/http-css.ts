/** The HTTP view's own rules (`dcp-http-*`, C3-3): px and `--dcp-` tokens only, nothing global. */
export const HTTP_VIEW_CSS = [
  '.dcp-http-status{display:inline-flex;align-items:center;gap:4px}',
  // Detail (§4.6): Copy ▾ and ✕ pushed to the end of the header.
  '.dcp-http-grow{flex:1 1 auto}',
  '.dcp-http-body{padding:8px}',
  '.dcp-http-removed{margin:0;padding:4px 8px;border-bottom:1px solid var(--dcp-divider);color:var(--dcp-warning)}',
  '.dcp-http-h{margin:12px 0 4px;font-size:var(--dcp-fs-ui);font-weight:600}',
  '.dcp-http-h:first-child{margin-top:0}',
  '.dcp-http-kv{border-collapse:collapse;width:100%}',
  '.dcp-http-kv th,.dcp-http-kv td{padding:2px 0;text-align:left;vertical-align:top;overflow-wrap:anywhere}',
  '.dcp-http-kv th{width:30%;padding-right:12px;font-weight:400;color:var(--dcp-text-muted)}',
  '.dcp-http-note{margin:0;color:var(--dcp-text-muted)}',
  '.dcp-http-tools{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.dcp-http-pre{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}',
  // Timing bar (§5.7): accent on a divider track, 6 px.
  '.dcp-http-bar{height:6px;margin-top:8px;background-color:var(--dcp-divider)}',
  '.dcp-http-bar__fill{height:100%;background-color:var(--dcp-accent)}',
].join('\n');
