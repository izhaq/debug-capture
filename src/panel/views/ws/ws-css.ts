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
].join('\n');
