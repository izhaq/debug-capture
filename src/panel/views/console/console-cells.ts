import {
  consoleLevel,
  consoleLevelLabel,
  ConsoleRow,
  consoleText,
  createIcon,
  Dom,
  formatTime,
  highlightText,
  preview,
  TimeFormat,
  VirtualListColumn,
} from '../../ui';

/** No header row (4.8), so the labels only name the columns for the code. Source fits `unhandledrejection`. */
export const CONSOLE_COLUMNS: readonly VirtualListColumn[] = [
  { key: 'level', label: 'Level', width: 72 },
  { key: 'time', label: 'Time', width: 104 },
  { key: 'source', label: 'Source', width: 144 },
  { key: 'message', label: 'Message', width: 'flex' },
  { key: 'more', label: 'More', width: 24 },
];

/** The 5.6 tint: errors (error entries too) and warnings only. */
export function consoleRowClass(row: ConsoleRow): string | undefined {
  const level = consoleLevel(row);
  return level === 'error' ? 'dcp-row--error' : level === 'warn' ? 'dcp-row--warn' : undefined;
}

/** Icon and word in the level's colour (5.6), so a level never relies on colour alone (`NFR-A11Y-01`). */
export function levelLabel(dom: Dom, row: ConsoleRow): HTMLElement {
  const level = consoleLevel(row);
  const label = consoleLevelLabel(level);
  return dom.el('span', { className: `dcp-console-level dcp-tone-${label.tone}` }, [
    createIcon(dom, level === 'warn' ? 'warning' : level),
    // FR-MSG-05: an app message shows its level's icon and colour, and the word app.
    row.kind === 'app' ? 'app' : label.text,
  ]);
}

/** The detail shows more than the row (4.8): an object or array argument, a stack, or a message the row cuts. */
function hasMore(row: ConsoleRow, text: string): boolean {
  const extra =
    row.kind === 'error'
      ? row.stack !== null
      : row.kind === 'app'
        ? row.data !== null && typeof row.data === 'object'
        : row.kind === 'log' && row.args.some((arg) => arg !== null && typeof arg === 'object');
  return extra || preview(text) !== text;
}

/** Fills one list cell (S07-01, S07-02). The list resets the cell first and sets `dir="auto"`. */
export function renderConsoleCell(
  dom: Dom,
  row: ConsoleRow,
  key: string,
  cell: HTMLElement,
  time: TimeFormat,
  query: string,
  count: number,
): void {
  let content: Node | string = '';
  if (key === 'level') content = levelLabel(dom, row);
  else if (key === 'time') content = formatTime(row.t, time);
  else if (key === 'source') {
    if (row.kind === 'error') content = highlightText(dom, row.source, query);
  } else {
    const text = consoleText(row);
    if (key === 'message') {
      // S07-05: a run of identical messages shows its size before the text.
      if (count > 1) {
        dom.append(cell, [
          dom.el('span', { className: 'dcp-console-count', attrs: { title: `Repeated ${count} times` } }, [
            `${count}\u00d7`,
          ]),
        ]);
      }
      content = highlightText(dom, preview(text), query);
    } else if (hasMore(row, text)) content = createIcon(dom, 'chevron-right', { label: 'More in the detail' });
  }
  dom.append(cell, [content]);
}
