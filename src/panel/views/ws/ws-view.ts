import {
  ChipGroupControl,
  createChipGroup,
  createDom,
  createEmptyState,
  createSearchBox,
  createSplitPane,
  createVirtualList,
  CreateView,
  PanelState,
  rowKey,
  selectListCounts,
  selectWsConnections,
  selectWsMessages,
  SplitDirection,
  ViewSettings,
  WebSocketEntry,
  WsConnection,
  WsFilter,
} from '../../ui';
import { ConnItem, renderConnCell, renderWsCell, WS_COLUMNS } from './ws-cells';
import { createWsDetail } from './ws-detail';

const connKey = (item: ConnItem): number | 'all' => (item === 'all' ? 'all' : item.socketId);

/** Docked bottom the detail sits beside the messages; docked right, below them (§4.6, as S05-07). */
const direction = (settings: ViewSettings): SplitDirection => (settings.dock === 'bottom' ? 'row' : 'column');

/**
 * Network › WebSocket (S-06). Renders the P1 model with P2 blocks: the chosen
 * connection, filters and selection live in the store; this view only shows
 * them and turns user actions into store calls. It renders only in `update(state)`.
 */
export const createWsView: CreateView = (deps) => {
  const { store, report } = deps;
  const dom = createDom(deps.document);
  let settings = deps.settings;
  let query = '';
  let rows: readonly WebSocketEntry[] = [];
  let conns: readonly WsConnection[] | undefined;
  let items: readonly ConnItem[] = [];
  let shownConn: PanelState['wsConnection'] | undefined;
  let shownSelection: PanelState['selection']['ws'] | undefined;
  let last = store.getState();
  /** The newest `seq` when following stopped; rows past it count as "new" (S06-10). */
  let mark: number | null = null;
  let destroyed = false;

  // Connections (S06-01, S06-02): newest first, "All connections" last; a click scopes the messages.
  const connList = createVirtualList<ConnItem>(deps.document, {
    rowHeight: settings.rowHeight * 2,
    columns: [{ key: 'c', label: 'Connection', width: 'flex' }],
    header: false,
    ariaLabel: 'Connections',
    renderCell: (item, _key, cell) => renderConnCell(dom, item, cell, settings.time),
    getKey: connKey,
    onSelect: (item) => store.selectConnection(connKey(item)),
    requestFrame: (callback) => deps.requestFrame(callback),
    onError: report,
  });
  const list = createVirtualList<WebSocketEntry>(deps.document, {
    rowHeight: settings.rowHeight,
    columns: WS_COLUMNS,
    ariaLabel: 'Messages',
    renderCell: (row, key, cell) => renderWsCell(dom, row, key, cell, settings.time, query),
    getKey: rowKey,
    onSelect: (row) => store.select('ws', row),
    onActivate: (row) => {
      // Enter / double-click: open the detail and move into it (§4.12).
      store.select('ws', row);
      detail.focus();
    },
    follow: true,
    requestFrame: (callback) => deps.requestFrame(callback),
    onError: report,
  });
  const countNew = (): void => {
    if (mark === null) return;
    let count = 0;
    for (const row of rows) if (row.seq > mark) count++;
    list.setNewCount(count);
  };
  const offScroll = list.onScrollChange((atEnd) => {
    if (atEnd) {
      mark = null;
      list.setNewCount(0);
    } else if (mark === null) {
      mark = last.entries[last.entries.length - 1]?.seq ?? 0;
    }
  });

  const connPane = dom.el('div', { className: 'dcp-ws-conns' }, [connList.element]);
  const pane = dom.el('div', { className: 'dcp-list-pane' }, [list.element, list.followButton]);
  // Detail (S06-08): closing it gives focus back to the list, not to the page.
  const closeDetail = (): void => {
    store.clearSelection('ws');
    list.element.focus({ preventScroll: true });
  };
  const detail = createWsDetail(dom, deps, closeDetail);
  const split = createSplitPane(dom, {
    direction: direction(settings),
    first: pane,
    second: detail.element,
    ariaLabel: 'Resize detail',
    onError: report,
  });
  split.handle.hidden = true;

  // Filter bar (S06-04, §4.5): the store holds the filter; the chips start from it (`D-20`).
  let filters: WsFilter = last.filters.ws;
  const search = createSearchBox(dom, {
    ariaLabel: 'Filter messages',
    placeholder: 'Filter message data',
    value: filters.text,
    schedule: deps.schedule,
    onSearch: (text) => store.setFilter('ws', { text }),
    onError: report,
  });
  const chips = (label: string, ids: readonly string[], key: 'direction' | 'data'): ChipGroupControl =>
    createChipGroup(dom, {
      ariaLabel: label,
      chips: ids.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })),
      selected: filters[key],
      onChange: (on) => store.setFilter('ws', { [key]: on } as Partial<WsFilter>),
      onError: report,
    });
  const directions = chips('Direction', ['sent', 'received'], 'direction');
  const types = chips('Type', ['text', 'binary'], 'data');
  const element = dom.el('div', { className: 'dcp-view dcp-ws' }, [
    dom.el('div', { className: 'dcp-filter-bar' }, [search.element, directions.element, types.element]),
    dom.el('div', { className: 'dcp-ws-main' }, [connPane, split.element]),
  ]);
  const dock = (): void => {
    element.classList.toggle('dcp-ws--right', settings.dock === 'right');
  };
  dock();

  // List states (S06-05, §4.11): no socket yet, or nothing matches.
  const empty = createEmptyState(dom, { message: 'No WebSocket connections yet.' });
  const noMatch = createEmptyState(dom, {
    message: 'No entries match the filter.',
    action: {
      label: 'Clear filters',
      onClick: () => {
        // The search box holds text the store may not have yet (debounce): clear both.
        search.setValue('');
        store.clearFilters('ws');
      },
    },
    onError: report,
  });
  // First paint, before the frame's update: a restored filter must not say
  // "no socket yet" while messages are only hidden (S09-05). `rows` and
  // `conns` stay unset so the first update still fills the lists.
  const paintLists = (
    state: PanelState,
    nextConns: readonly WsConnection[],
    nextRows: readonly WebSocketEntry[],
  ): void => {
    const total = selectListCounts(state, 'ws').total;
    connPane.hidden = nextConns.length === 0;
    empty.element.hidden = nextConns.length > 0;
    noMatch.element.hidden = total === 0 || nextRows.length > 0;
    list.element.hidden = nextRows.length === 0;
  };
  paintLists(last, selectWsConnections(last), selectWsMessages(last));
  dom.append(pane, [empty.element, noMatch.element]);

  return {
    element,
    update(state) {
      if (destroyed) return;
      last = state;
      const nextConns = selectWsConnections(state);
      if (nextConns !== conns) {
        conns = nextConns;
        items = [...nextConns, 'all'];
        connList.setItems(items);
        shownConn = undefined;
        paintLists(state, nextConns, rows);
      }
      // The chosen socket stays chosen while it has no row (after Clear): its new messages show again.
      if (state.wsConnection !== shownConn) {
        shownConn = state.wsConnection;
        const at = items.findIndex((item) => connKey(item) === shownConn);
        connList.select(at < 0 ? null : at);
      }
      const next = selectWsMessages(state);
      const changed = next !== rows;
      if (changed) {
        rows = next;
        // States first: the list measures its height in `setItems`, so the blocks beside it must be settled.
        paintLists(state, nextConns, rows);
        list.setItems(rows);
        countNew();
      }
      if (state.filters.ws !== filters) {
        filters = state.filters.ws;
        directions.setSelected(filters.direction);
        types.setSelected(filters.data);
      }
      if (filters.text !== query) {
        query = filters.text;
        list.refresh();
      }
      const selected = state.selection.ws;
      if (changed || selected !== shownSelection) {
        shownSelection = selected;
        const at = selected === null ? -1 : rows.indexOf(selected.row);
        list.select(at < 0 ? null : at);
      }
      // Clear closed the detail under the user's focus: give it to the list, as ✕ does, not to the page.
      if (selected === null && detail.element.matches(':focus-within')) {
        // An empty list is hidden: then the search box, which is always there.
        if (list.element.hidden) search.focus();
        else list.element.focus({ preventScroll: true });
      }
      // The store keeps an evicted entry selected (`removed: true`), so the detail needs no `onSelectionLost`.
      detail.show(selected, state);
      split.handle.hidden = selected === null;
    },
    applySettings(next) {
      settings = next;
      list.setRowHeight(next.rowHeight);
      connList.setRowHeight(next.rowHeight * 2);
      list.refresh();
      connList.refresh();
      split.setDirection(direction(next));
      detail.setTime(next.time);
      dock();
    },
    focusFilter: () => search.focus(),
    handleEscape() {
      // Innermost first (§4.12): the Copy menu, then the detail; else the frame closes the panel.
      if (detail.closeMenu()) return true;
      // The store, not `last`: a message picked since the last frame is open already.
      if (store.getState().selection.ws === null) return false;
      closeDetail();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offScroll();
      connList.destroy();
      list.destroy();
      search.destroy();
      directions.destroy();
      types.destroy();
      noMatch.destroy();
      detail.destroy();
      split.destroy();
      element.remove();
    },
  };
};
