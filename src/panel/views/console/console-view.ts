import {
  ConsoleFilter,
  ConsoleRow,
  createChipGroup,
  createDom,
  createEmptyState,
  createSearchBox,
  createSplitPane,
  createVirtualList,
  CreateView,
  LogLevel,
  PanelState,
  rowKey,
  selectConsoleRows,
  selectListCounts,
  SplitDirection,
  ViewSettings,
} from '../../ui';
import { CONSOLE_COLUMNS, consoleRowClass, renderConsoleCell } from './console-cells';
import { createConsoleDetail } from './console-detail';

/** Docked bottom the detail sits beside the list; docked right, below it (4.6). */
const direction = (settings: ViewSettings): SplitDirection => (settings.dock === 'bottom' ? 'row' : 'column');

/** What makes two entries identical (S07-05): the same level and arguments, or the same source, message and stack. */
const identity = (row: ConsoleRow): string =>
  JSON.stringify(row.kind === 'error' ? [row.source, row.message, row.stack] : [row.level, row.args]);

/** Each entry's last comparison with the first entry of its run: entries never change, so a pair is compared once. */
const sameAs = new WeakMap<ConsoleRow, { readonly first: ConsoleRow; readonly same: boolean }>();

/** Runs of identical messages in a row (S07-05, FR-CON-05): each run's first entry, and the size of runs over 1. */
function runs(rows: readonly ConsoleRow[]): { firsts: ConsoleRow[]; counts: Map<ConsoleRow, number> } {
  const firsts: ConsoleRow[] = [];
  const counts = new Map<ConsoleRow, number>();
  let first: ConsoleRow | null = null;
  let firstText: string | null = null;
  for (const row of rows) {
    if (first !== null) {
      const known = sameAs.get(row);
      let same = known?.first === first && known.same;
      if (known?.first !== first) {
        try {
          if (row.kind === first.kind) {
            if (firstText === null) firstText = identity(first);
            same = identity(row) === firstText;
          }
        } catch {
          // A value that cannot be read never joins a run; its cells report it.
        }
        sameAs.set(row, { first, same });
      }
      if (same) {
        counts.set(first, (counts.get(first) ?? 1) + 1);
        continue;
      }
    }
    first = row;
    firstText = null;
    firsts.push(row);
  }
  return { firsts, counts };
}

/** `true` when a run's size differs between two groupings. */
const stale = (before: Map<ConsoleRow, number>, after: Map<ConsoleRow, number>): boolean =>
  before.size !== after.size || Array.from(after).some(([row, count]) => before.get(row) !== count);

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
  let shown: readonly ConsoleRow[] = [];
  /** The list's rows: the first entry of each run (S07-05). */
  let rows: readonly ConsoleRow[] = [];
  let counts = new Map<ConsoleRow, number>();
  let shownSelection: PanelState['selection']['console'] | undefined;
  let last = store.getState();
  let mark: number | null = null;
  let destroyed = false;

  const list = createVirtualList<ConsoleRow>(deps.document, {
    rowHeight: settings.rowHeight,
    columns: CONSOLE_COLUMNS,
    header: false,
    ariaLabel: 'Console messages',
    renderCell: (row, key, cell) => renderConsoleCell(dom, row, key, cell, settings.time, query, counts.get(row) ?? 1),
    getKey: rowKey,
    rowClass: consoleRowClass,
    onSelect: (row) => store.select('console', row),
    onActivate: (row) => {
      // Enter / double-click: open the detail and move into it (4.12).
      store.select('console', row);
      detail.focus();
    },
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
  // Detail (S07-07): closing it gives focus back to the list, not to the page.
  const closeDetail = (): void => {
    store.clearSelection('console');
    list.element.focus({ preventScroll: true });
  };
  const detail = createConsoleDetail(dom, deps, closeDetail);
  const split = createSplitPane(dom, {
    direction: direction(settings),
    first: pane,
    second: detail.element,
    ariaLabel: 'Resize detail',
    onError: report,
  });
  split.handle.hidden = true;

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
    split.element,
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
      const changed = next !== shown;
      if (changed) {
        shown = next;
        const before = counts;
        ({ firsts: rows, counts } = runs(next));
        // States first: the list measures its height in `setItems`, so the blocks beside it must be settled.
        const total = selectListCounts(state, 'console').total;
        empty.element.hidden = total > 0;
        noMatch.element.hidden = total === 0 || rows.length > 0;
        list.element.hidden = rows.length === 0;
        list.setItems(rows);
        // A run that grew or split keeps its first entry, so the list would not redraw its count by itself.
        if (stale(before, counts)) list.refresh();
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
      // The store keeps a removed entry selected (`removed: true`), so the detail needs no `onSelectionLost`.
      detail.show(selected, state);
      split.handle.hidden = selected === null;
    },
    applySettings(next) {
      settings = next;
      list.setRowHeight(next.rowHeight);
      list.refresh();
      split.setDirection(direction(next));
      detail.setTime(next.time);
    },
    focusFilter: () => search.focus(),
    handleEscape() {
      // Escape closes the detail; with none open the frame closes the panel (4.12).
      if (last.selection.console === null) return false;
      closeDetail();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offScroll();
      list.destroy();
      levels.destroy();
      search.destroy();
      noMatch.destroy();
      detail.destroy();
      split.destroy();
      element.remove();
    },
  };
};
