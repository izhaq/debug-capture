import {
  createIcon,
  Dom,
  formatSize,
  formatTime,
  highlightText,
  IconName,
  preview,
  setAttr,
  TimeFormat,
  UNKNOWN,
  VirtualListColumn,
  WebSocketEntry,
  WsConnection,
  wsEventLabel,
} from '../../ui';

/** A row of the connections list: a socket, or the last item "All connections" (`FR-WS-05`). */
export type ConnItem = WsConnection | 'all';

/** The messages columns (§4.7, mockup). Socket shows in every mode, so the columns never change. */
export const WS_COLUMNS: readonly VirtualListColumn[] = [
  { key: 'dir', label: 'Dir', width: 100 },
  { key: 'time', label: 'Time', width: 104 },
  { key: 'socket', label: 'Socket', width: 64 },
  { key: 'size', label: 'Size', width: 64 },
  { key: 'data', label: 'Data', width: 'flex' },
];

/** A binary frame is base64 (not for reading): the list names it. `data: null` = a Blob v1 could not read. */
export const binaryText = (e: WebSocketEntry): string =>
  `[${e.data === null ? 'Blob' : 'Binary'} ${e.bytes ?? 0} bytes]`;

/**
 * Fills one message cell (S06-03, §5.6): the direction or lifecycle word with
 * its icon and colour (never colour alone), and for a close row its code and
 * reason. The list resets the cell first and sets `dir="auto"`.
 */
export function renderWsCell(
  dom: Dom,
  e: WebSocketEntry,
  key: string,
  cell: HTMLElement,
  time: TimeFormat,
  query: string,
): void {
  const label = wsEventLabel(e);
  const word = label.text.split(' ', 1)[0] ?? '';
  const tone = `dcp-tone-${label.tone}`;
  let content: Node | string;
  // The icon names match the words: sent, received, opened, closed, error.
  if (key === 'dir')
    content = dom.el('span', { className: `dcp-ws-dir ${tone}` }, [createIcon(dom, word as IconName), word]);
  else if (key === 'time') content = formatTime(e.t, time);
  else if (key === 'socket') content = `#${e.socketId}`;
  else if (key === 'size') content = e.bytes === null ? '' : formatSize(e.bytes);
  else if (e.opcode === null) content = dom.el('span', { className: tone }, [label.text.slice(word.length + 1)]);
  else content = e.opcode === 'binary' ? binaryText(e) : highlightText(dom, preview(e.data ?? ''), query);
  dom.append(cell, [content]);
}

/** State icon and colour (FR-WS-01): ● open, ○ closed, ✕ error — always with the word. */
const STATES: Readonly<Record<WsConnection['state'], readonly [IconName, string]>> = {
  open: ['opened', 'success'],
  closed: ['off', 'muted'],
  error: ['error', 'error'],
};

/** Fills a connection row (S06-01): state, `#id` and URL; then ↑ sent, ↓ received and the opened time. */
export function renderConnCell(dom: Dom, item: ConnItem, cell: HTMLElement, time: TimeFormat): void {
  if (item === 'all') {
    dom.append(cell, ['All connections']);
    return;
  }
  const [icon, tone] = STATES[item.state];
  setAttr(cell, 'title', item.url);
  dom.append(cell, [
    dom.el('div', null, [
      dom.el('span', { className: `dcp-ws-dir dcp-tone-${tone}` }, [createIcon(dom, icon), item.state]),
      ` #${item.socketId} `,
      item.url,
    ]),
    dom.el('div', { className: 'dcp-meta' }, [
      createIcon(dom, 'sent', { label: 'sent' }),
      ` ${item.sent} `,
      createIcon(dom, 'received', { label: 'received' }),
      ` ${item.received} · `,
      item.openedAt === null ? UNKNOWN : formatTime(item.openedAt, time),
    ]),
  ]);
}
