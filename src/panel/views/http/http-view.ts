import {
  createDom,
  createVirtualList,
  CreateView,
  HttpRow,
  HttpSort,
  HttpSortKey,
  isPendingRow,
  PanelState,
  rowKey,
  selectHttpRows,
} from '../../ui';
import { HTTP_COLUMNS, renderHttpCell } from './http-cells';

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
    onActivate: (row) => store.select('http', row),
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
  const element = dom.el('div', { className: 'dcp-view dcp-http' }, [pane]);

  return {
    element,
    update(state) {
      if (destroyed) return;
      last = state;
      const next = selectHttpRows(state);
      const changed = next !== rows;
      if (changed) {
        rows = next;
        list.setItems(rows);
        countNew();
      }
      if (state.filters.http.text !== query) {
        query = state.filters.http.text;
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
