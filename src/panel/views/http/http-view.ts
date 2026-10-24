import {
  createChipGroup,
  createDom,
  createEmptyState,
  createSearchBox,
  createSplitPane,
  createVirtualList,
  CreateView,
  HttpFilter,
  HttpRow,
  HttpSort,
  HttpSortKey,
  HttpStatusGroup,
  isPendingRow,
  PanelState,
  rowKey,
  selectHttpRows,
  selectListCounts,
  SplitDirection,
  ViewSettings,
} from '../../ui';
import { HTTP_COLUMNS, renderHttpCell } from './http-cells';
import { createHttpDetail } from './http-detail';

/** Docked bottom the detail sits beside the list; docked right, below it (§4.6). */
const direction = (settings: ViewSettings): SplitDirection => (settings.dock === 'bottom' ? 'row' : 'column');

/** The newest request when following stopped; rows past it count as "new" (S05-15). */
interface Mark {
  readonly seq: number;
  readonly id: number;
}

function markOf(state: PanelState): Mark {
  let seq = 0;
  let id = 0;
  for (const entry of state.entries) {
    seq = entry.seq;
    if (entry.kind === 'http' && entry.requestId !== undefined && entry.requestId > id) id = entry.requestId;
  }
  for (const request of state.pending) if (request.id > id) id = request.id;
  return { seq, id };
}

/** By the pending id when the request had one, so a request that was already pending is not new when it finishes. */
function isNew(row: HttpRow, mark: Mark): boolean {
  if (isPendingRow(row)) return row.id > mark.id;
  return row.requestId !== undefined ? row.requestId > mark.id : row.seq > mark.seq;
}

/**
 * Network › HTTP (S-05). Renders the P1 model with P2 blocks: order, sort,
 * filters and selection live in the store; this view only shows them and
 * turns user actions into store calls. It renders only in `update(state)`.
 */
export const createHttpView: CreateView = (deps) => {
  const { store, report } = deps;
  const dom = createDom(deps.document);
  let settings = deps.settings;
  let query = '';
  let rows: readonly HttpRow[] = [];
  let sort: HttpSort | null | undefined;
  let shownSelection: PanelState['selection']['http'] | undefined;
  let last = store.getState();
  let mark: Mark | null = null;
  let destroyed = false;

  const list = createVirtualList<HttpRow>(deps.document, {
    rowHeight: settings.rowHeight,
    columns: HTTP_COLUMNS,
    ariaLabel: 'Requests',
    renderCell: (row, key, cell) => renderHttpCell(dom, row, key, cell, settings.time, query),
    getKey: rowKey,
    onSelect: (row) => store.select('http', row),
    onActivate: (row) => {
      // Enter / double-click: open the detail and move into it (§4.12).
      store.select('http', row);
      detail.focus();
    },
    onSort: (key) => store.setHttpSort(key as HttpSortKey),
    follow: true,
    requestFrame: (callback) => deps.requestFrame(callback),
    onError: report,
  });
  const countNew = (): void => {
    if (mark === null) return;
    let count = 0;
    for (const row of rows) if (isNew(row, mark)) count++;
    list.setNewCount(count);
  };
  const offScroll = list.onScrollChange((atEnd) => {
    if (atEnd) {
      mark = null;
      list.setNewCount(0);
    } else if (mark === null) {
      mark = markOf(last);
    }
  });

  const pane = dom.el('div', { className: 'dcp-list-pane' }, [list.element, list.followButton]);
  // Detail (S05-07): closing it gives focus back to the list, not to the page.
  const closeDetail = (): void => {
    store.clearSelection('http');
    list.element.focus({ preventScroll: true });
  };
  const detail = createHttpDetail(dom, deps, closeDetail);
  const split = createSplitPane(dom, {
    direction: direction(settings),
    first: pane,
    second: detail.element,
    ariaLabel: 'Resize detail',
    onError: report,
  });
  split.handle.hidden = true;
  const element = dom.el('div', { className: 'dcp-view dcp-http' }, [split.element]);

  // Filter bar (S05-05, §4.5): the store holds the filter; the chips start from it (`D-20`).
  let filters: HttpFilter = last.filters.http;
  const search = createSearchBox(dom, {
    ariaLabel: 'Filter requests',
    placeholder: 'Filter URL, method, status',
    value: filters.text,
    schedule: deps.schedule,
    onSearch: (text) => store.setFilter('http', { text }),
    onError: report,
  });
  const types = createChipGroup(dom, {
    ariaLabel: 'Type',
    chips: [
      { id: 'xhr', label: 'XHR' },
      { id: 'fetch', label: 'Fetch' },
    ],
    selected: filters.type,
    onChange: (type) => store.setFilter('http', { type: type as HttpFilter['type'] }),
    onError: report,
  });
  const statuses = createChipGroup(dom, {
    ariaLabel: 'Status',
    chips: ['2xx', '3xx', '4xx', '5xx', 'Failed', 'Pending'].map((label) => ({ id: label.toLowerCase(), label })),
    selected: filters.status,
    onChange: (status) => store.setFilter('http', { status: status as readonly HttpStatusGroup[] }),
    onError: report,
  });
  element.insertBefore(
    dom.el('div', { className: 'dcp-filter-bar' }, [search.element, types.element, statuses.element]),
    split.element,
  );

  // List states (S05-06, §4.11): nothing captured yet, or nothing matches.
  const empty = createEmptyState(dom, { message: 'No requests yet.' });
  const noMatch = createEmptyState(dom, {
    message: 'No entries match the filter.',
    action: {
      label: 'Clear filters',
      onClick: () => {
        // The search box holds text the store may not have yet (debounce): clear both.
        search.setValue('');
        store.clearFilters('http');
      },
    },
    onError: report,
  });
  // First paint, before the frame's update: a restored filter must not say
  // "nothing yet" while rows are only hidden (S09-05). `rows` stays `[]` so
  // the first update still fills the list once it can be measured.
  const paintLists = (state: PanelState, next: readonly HttpRow[]): void => {
    const total = selectListCounts(state, 'http').total;
    empty.element.hidden = total > 0;
    noMatch.element.hidden = total === 0 || next.length > 0;
    list.element.hidden = next.length === 0;
  };
  paintLists(last, selectHttpRows(last));
  dom.append(pane, [empty.element, noMatch.element]);

  return {
    element,
    update(state) {
      if (destroyed) return;
      last = state;
      const next = selectHttpRows(state);
      const changed = next !== rows;
      if (changed) {
        rows = next;
        // States first: the list measures its height in `setItems`, so the blocks beside it must be settled.
        paintLists(state, rows);
        list.setItems(rows);
        countNew();
      }
      if (state.filters.http !== filters) {
        filters = state.filters.http;
        types.setSelected(filters.type);
        statuses.setSelected(filters.status);
      }
      if (filters.text !== query) {
        query = filters.text;
        list.refresh();
      }
      if (state.httpSort !== sort) {
        sort = state.httpSort;
        list.setSort(sort);
      }
      const selected = state.selection.http;
      if (changed || selected !== shownSelection) {
        shownSelection = selected;
        const at = selected === null ? -1 : rows.indexOf(selected.row);
        list.select(at < 0 ? null : at);
      }
      // The store keeps a removed entry selected (`removed: true`), so the detail needs no `onSelectionLost`.
      detail.show(selected, state, rows);
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
      // Innermost first (§4.12): the Copy menu, then the detail; else the frame closes the panel.
      if (detail.closeMenu()) return true;
      // The store, not `last`: a row picked since the last frame is open already.
      if (store.getState().selection.http === null) return false;
      closeDetail();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offScroll();
      list.destroy();
      search.destroy();
      types.destroy();
      statuses.destroy();
      noMatch.destroy();
      detail.destroy();
      split.destroy();
      element.remove();
    },
  };
};
