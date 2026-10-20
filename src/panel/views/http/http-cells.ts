import {
  createBadge,
  createIcon,
  Dom,
  formatDuration,
  formatSize,
  formatTime,
  highlightText,
  httpName,
  httpStatusLabel,
  httpStatusText,
  HttpRow,
  IconName,
  isPendingRow,
  setAttr,
  TimeFormat,
  Tone,
  VirtualListColumn,
} from '../../ui';

const column = (key: string, label: string, width: number | 'flex'): VirtualListColumn => ({
  key,
  label,
  width,
  sortable: true,
});

/** The seven columns at the §5.6 widths. Every header sorts; the keys are `HttpSortKey`s (`D-18`). */
export const HTTP_COLUMNS: readonly VirtualListColumn[] = [
  column('time', 'Time', 104),
  column('method', 'Method', 64),
  column('status', 'Status', 88),
  column('name', 'Name', 'flex'),
  column('type', 'Type', 52),
  column('size', 'Size', 64),
  column('duration', 'Duration', 72),
];

/** One icon per status colour (§5.6), so a status never relies on colour alone (`NFR-A11Y-01`). */
const STATUS_ICONS: Readonly<Partial<Record<Tone, IconName>>> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
};

/**
 * Icon, tone and text of a status (S05-03); a request in flight is the
 * `pending` badge. With `query` it is the list cell (short label, search
 * marks); without, the detail's full text (`200 OK`, `Failed (network error)`).
 */
export function statusLabel(dom: Dom, row: HttpRow, query?: string): HTMLElement {
  if (isPendingRow(row)) return createBadge(dom, 'pending', 'Pending');
  const label = httpStatusLabel(row);
  return dom.el('span', { className: `dcp-http-status dcp-tone-${label.tone}` }, [
    createIcon(dom, STATUS_ICONS[label.tone] ?? 'redirect'),
    query === undefined ? httpStatusText(row) : highlightText(dom, label.text, query),
  ]);
}

/** Fills one list cell (S05-01…04). The list resets the cell first; it already sets `dir="auto"`. */
export function renderHttpCell(
  dom: Dom,
  row: HttpRow,
  key: string,
  cell: HTMLElement,
  time: TimeFormat,
  query: string,
): void {
  const done = isPendingRow(row) ? null : row;
  let content: Node | string;
  if (key === 'time') content = formatTime(row.t, time);
  else if (key === 'method') content = highlightText(dom, row.method, query);
  else if (key === 'status') content = statusLabel(dom, row, query);
  else if (key === 'name') {
    setAttr(cell, 'title', row.url);
    content = highlightText(dom, httpName(row.url), query);
  } else if (key === 'type') content = row.transport;
  // A request in flight has no size or duration yet: blank, not `—` (that means "not known").
  else if (key === 'size') content = done ? formatSize(done.bytes) : '';
  else content = done ? formatDuration(done.durationMs) : '';
  dom.append(cell, [content]);
}
