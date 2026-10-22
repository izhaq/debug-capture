import {
  ConsoleFilter,
  ConsoleRow,
  createChipGroup,
  createDom,
  createEmptyState,
  createSearchBox,
  createVirtualList,
  CreateView,
  LogLevel,
  PanelState,
  rowKey,
  selectConsoleRows,
  selectListCounts,
} from '../../ui';
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

  // Filter bar (S07-04, 4.5, 4.8: levels, then search): the store holds the filter; the chips start from it (`D-20`).
  let filters: ConsoleFilter = last.filters.console;
  const levels = createChipGroup(dom, {
    ariaLabel: 'Level',
    chips: [
      { id: 'error', label: 'Errors' },
      { id: 'warn', label: 'Warnings' },
      { id: 'info', label: 'Info' },
      { id: 'log', label: 'Log' },
      { id: 'debug', label: 'Debug' },
    ],
    selected: filters.levels,
    onChange: (ids) => store.setFilter('console', { levels: ids as readonly LogLevel[] }),
    onError: report,
  });
  const search = createSearchBox(dom, {
    ariaLabel: 'Filter console messages',
    placeholder: 'Filter message, source',
    value: filters.text,
    schedule: deps.schedule,
    onSearch: (text) => store.setFilter('console', { text }),
    onError: report,
  });
  const element = dom.el('div', { className: 'dcp-view dcp-console' }, [
    dom.el('div', { className: 'dcp-filter-bar' }, [levels.element, search.element]),
    pane,
  ]);

  // List states (S07-06, 4.11): nothing captured yet, or nothing matches.
  const empty = createEmptyState(dom, { message: 'No console messages yet.' });
  const noMatch = createEmptyState(dom, {
    message: 'No entries match the filter.',
    action: {
      label: 'Clear filters',
      onClick: () => {
        // The search box holds text the store may not have yet (debounce): clear both.
        search.setValue('');
        store.clearFilters('console');
      },
    },
    onError: report,
  });
  dom.append(pane, [empty.element, noMatch.element]);

  return {
    element,
    update(state) {
      if (destroyed) return;
      last = state;
      const next = selectConsoleRows(state);
      const changed = next !== rows;
      if (changed) {
        rows = next;
        // States first: the list measures its height in `setItems`, so the blocks beside it must be settled.
        const total = selectListCounts(state, 'console').total;
        empty.element.hidden = total > 0;
        noMatch.element.hidden = total === 0 || rows.length > 0;
        list.element.hidden = rows.length === 0;
        list.setItems(rows);
        countNew();
      }
      if (state.filters.console !== filters) {
        filters = state.filters.console;
        levels.setSelected(filters.levels);
      }
      if (filters.text !== query) {
        query = filters.text;
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
    focusFilter: () => search.focus(),
    handleEscape: () => false,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offScroll();
      list.destroy();
      levels.destroy();
      search.destroy();
      noMatch.destroy();
      element.remove();
    },
  };
};
