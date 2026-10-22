import { ConsoleRow, createDom, createVirtualList, CreateView, PanelState, rowKey, selectConsoleRows } from '../../ui';
import { CONSOLE_COLUMNS, consoleRowClass, renderConsoleCell } from './console-cells';

/** The newest entry when following stopped: console rows past it count as new (S07-09). */
const lastSeq = (state: PanelState): number => state.entries[state.entries.length - 1]?.seq ?? 0;

/**
 * Console (S-07): console calls and errors in `seq` order. Renders the P1
 * model with P2 blocks: filters and selection live in the store; this view
 * only shows them and turns user actions into store calls. It renders only
 * in `update(state)`, and never writes to `console` (the recorder would see it).
 */
export const createConsoleView: CreateView = (deps) => {
  const { store, report } = deps;
  const dom = createDom(deps.document);
  let settings = deps.settings;
  let query = '';
  let rows: readonly ConsoleRow[] = [];
  let shownSelection: PanelState['selection']['console'] | undefined;
  let last = store.getState();
  let mark: number | null = null;
  let destroyed = false;

  const list = createVirtualList<ConsoleRow>(deps.document, {
    rowHeight: settings.rowHeight,
    columns: CONSOLE_COLUMNS,
    header: false,
    ariaLabel: 'Console messages',
    renderCell: (row, key, cell) => renderConsoleCell(dom, row, key, cell, settings.time, query),
    getKey: rowKey,
    rowClass: consoleRowClass,
    onSelect: (row) => store.select('console', row),
    follow: true,
    requestFrame: (callback) => deps.requestFrame(callback),
    onError: report,
  });
  const countNew = (): void => {
    if (mark === null) return;
    let count = 0;
    // Rows are in `seq` order: the new ones are at the end.
    for (let i = rows.length - 1; i >= 0 && (rows[i]?.seq ?? 0) > mark; i--) count++;
    list.setNewCount(count);
  };
  const offScroll = list.onScrollChange((atEnd) => {
    if (atEnd) {
      mark = null;
      list.setNewCount(0);
    } else if (mark === null) {
      mark = lastSeq(last);
    }
  });

  const pane = dom.el('div', { className: 'dcp-list-pane' }, [list.element, list.followButton]);
  const element = dom.el('div', { className: 'dcp-view dcp-console' }, [pane]);

  return {
    element,
    update(state) {
      if (destroyed) return;
      last = state;
      const next = selectConsoleRows(state);
      const changed = next !== rows;
      if (changed) {
        rows = next;
        list.setItems(rows);
        countNew();
      }
      if (state.filters.console.text !== query) {
        query = state.filters.console.text;
        list.refresh();
      }
      const selected = state.selection.console;
      if (changed || selected !== shownSelection) {
        shownSelection = selected;
        const at = selected === null ? -1 : rows.indexOf(selected.row);
        list.select(at < 0 ? null : at);
      }
    },
    applySettings(next) {
      settings = next;
      list.setRowHeight(next.rowHeight);
      list.refresh();
    },
    focusFilter: () => undefined,
    handleEscape: () => false,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offScroll();
      list.destroy();
      element.remove();
    },
  };
};
