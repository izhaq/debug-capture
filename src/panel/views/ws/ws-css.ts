/** The WebSocket view's own rules (`dcp-ws-*`, C3-3): px and `--dcp-` tokens only, nothing global. */
export const WS_VIEW_CSS = [
  // Connections (280 px, mockup) beside the messages; docked right they stack, connections on top.
  '.dcp-ws-main{display:flex;flex:1 1 auto;min-width:0;min-height:0}',
  '.dcp-ws--right .dcp-ws-main{flex-direction:column}',
  '.dcp-ws-conns{display:flex;flex-direction:column;flex:0 0 280px;min-height:0;border-right:1px solid var(--dcp-divider)}',
  '.dcp-ws--right .dcp-ws-conns{flex-basis:30%;border-right:0;border-bottom:1px solid var(--dcp-divider)}',
  // A connection row is two lines in a double-height row.
  '.dcp-ws-conns .dcp-vlist__cell{display:flex;flex-direction:column;justify-content:center;line-height:1.4}',
  '.dcp-ws-conns .dcp-vlist__cell>*{overflow:hidden;text-overflow:ellipsis}',
  '.dcp-ws-dir{display:inline-flex;align-items:center;gap:4px}',
  // Detail (§4.7): Copy ▾ and ✕ pushed to the end of the header.
  '.dcp-ws-grow{flex:1 1 auto}',
  '.dcp-ws-body{padding:8px}',
  '.dcp-ws-removed{margin:0;padding:4px 8px;border-bottom:1px solid var(--dcp-divider);color:var(--dcp-warning)}',
  '.dcp-ws-p{margin:0 0 8px}',
  '.dcp-ws-note{margin:0;color:var(--dcp-text-muted)}',
  '.dcp-ws-h{margin:12px 0 4px;font-size:var(--dcp-fs-ui);font-weight:600}',
  '.dcp-ws-kv{border-collapse:collapse;width:100%}',
  '.dcp-ws-kv th,.dcp-ws-kv td{padding:2px 0;text-align:left;vertical-align:top;overflow-wrap:anywhere}',
  '.dcp-ws-kv th{width:30%;padding-right:12px;font-weight:400;color:var(--dcp-text-muted)}',
  '.dcp-ws-tools{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.dcp-ws-pre{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}',
  // The hex view keeps its columns: it scrolls sideways instead of wrapping.
  '.dcp-ws-hex{white-space:pre;overflow-wrap:normal;overflow-x:auto}',
].join('\n');
