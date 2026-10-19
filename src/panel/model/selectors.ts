import { CaptureEntry, HttpEntry, PendingRequest, WebSocketEntry } from '../..';
import { foldCase } from './filters';
import { consoleLevel, consoleText, httpName, httpStatusGroup, httpStatusLabel } from './format';
import {
  ConsoleFilter,
  ConsoleRow,
  HttpFilter,
  HttpRow,
  HttpSort,
  HttpSortKey,
  ListId,
  PanelState,
  RowOf,
  WsFilter,
  isPendingRow,
} from './state';

/**
 * Selectors: the lists and counts the views show, computed from a
 * `PanelState`. Memoised on the identity of their inputs (the state's parts
 * are immutable): the same input gives the same frozen array, so a view can
 * skip `setItems` with `===`, and an unrelated change (a filter on another
 * list, a capture toggle) costs nothing. Caches are `WeakMap`s keyed on those
 * inputs, so old states are garbage-collected.
 */

/** One WebSocket connection, derived from the entries in the buffer (FR-WS-01, §4.7). */
export interface WsConnection {
  readonly socketId: number;
  readonly url: string;
  /** `error` if the socket had any `error` event, else `closed` if it had a `close`, else `open`. */
  readonly state: 'open' | 'closed' | 'error';
  readonly sent: number;
  readonly received: number;
  /** `t` of the `open` entry; `null` once it left the buffer (shown as `—`). */
  readonly openedAt: number | null;
  readonly closedAt: number | null;
  readonly closeCode: number | null;
  readonly closeReason: string | null;
}

/** `N / M shown` (§4.9): rows after the list's filters / rows before them. */
export interface ListCounts {
  readonly shown: number;
  readonly total: number;
}

interface ByKind {
  readonly http: readonly HttpEntry[];
  readonly ws: readonly WebSocketEntry[];
  readonly console: readonly ConsoleRow[];
}

const byKindCache = new WeakMap<readonly CaptureEntry[], ByKind>();

/** One pass over the entries splits them per list; every list selector shares it. */
function byKind(entries: readonly CaptureEntry[]): ByKind {
  let split = byKindCache.get(entries);
  if (split === undefined) {
    const http: HttpEntry[] = [];
    const ws: WebSocketEntry[] = [];
    const consoleRows: ConsoleRow[] = [];
    for (const entry of entries) {
      if (entry.kind === 'http') http.push(entry);
      else if (entry.kind === 'ws') ws.push(entry);
      else consoleRows.push(entry);
    }
    split = Object.freeze({
      http: Object.freeze(http),
      ws: Object.freeze(ws),
      console: Object.freeze(consoleRows),
    });
    byKindCache.set(entries, split);
  }
  return split;
}

/** A two-key memo: `(a, b) → result`, both keys held weakly. */
function memo2<A extends object, B extends object, R>(compute: (a: A, b: B) => R): (a: A, b: B) => R {
  const cache = new WeakMap<A, WeakMap<B, R>>();
  return (a, b) => {
    let inner = cache.get(a);
    if (inner === undefined) {
      inner = new WeakMap<B, R>();
      cache.set(a, inner);
    }
    let result = inner.get(b);
    if (result === undefined) {
      result = compute(a, b);
      inner.set(b, result);
    }
    return result;
  };
}

/** Folded search text per row, built once per (immutable) row. */
const haystacks = new WeakMap<object, string>();

function haystack(row: object, build: () => string): string {
  let text = haystacks.get(row);
  if (text === undefined) {
    // `\n` between fields: a query never matches across two fields.
    text = foldCase(build());
    haystacks.set(row, text);
  }
  return text;
}

/** Filters `rows`; with no filter at all returns `rows` itself (same instance). */
function filterRows<T>(rows: readonly T[], active: boolean, keep: (row: T) => boolean): readonly T[] {
  return active ? Object.freeze(rows.filter(keep)) : rows;
}

// --- HTTP -------------------------------------------------------------------

/**
 * Start order (`D-18`): an entry's `t` is its start time, like a pending
 * row's, so a finished request lands where its pending row was. The sort is
 * stable: equal times keep finished rows in `seq` order, then pending rows in
 * id order. Entries come almost in start order, which a merge sort (V8's
 * TimSort) handles in close to linear time.
 */
const allHttpRows = memo2((entries: readonly HttpEntry[], pending: readonly PendingRequest[]): readonly HttpRow[] =>
  Object.freeze<HttpRow[]>([...entries, ...pending].sort((a, b) => a.t - b.t)),
);

/** A value the cell shows as `—` sorts as "no value". */
function known(n: number | null): number | null {
  return n !== null && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Folded Name cell per (immutable) row, so a re-sort does not parse every URL again. */
const nameKeys = new WeakMap<HttpRow, string>();

/** What a column sorts by; `null` = no value (yet). */
function sortValue(row: HttpRow, key: HttpSortKey): number | string | null {
  switch (key) {
    case 'time':
      return row.t;
    case 'method':
      return row.method;
    case 'type':
      return row.transport;
    case 'name': {
      let name = nameKeys.get(row);
      if (name === undefined) {
        name = foldCase(httpName(row.url));
        nameKeys.set(row, name);
      }
      return name;
    }
    case 'status':
      // As the Status cell: Failed / Aborted / Timeout show no number.
      return isPendingRow(row) || row.error !== null ? null : row.status;
    case 'size':
      return isPendingRow(row) ? null : known(row.bytes);
    default:
      return isPendingRow(row) ? null : known(row.durationMs);
  }
}

/**
 * A column sort (`D-18`). Rank 0 rows sort by value in the chosen direction;
 * rank 1 (Failed / Aborted / Timeout, Status only) and rank 2 (no value yet)
 * follow in both directions. Ties, and rows inside ranks 1 and 2, keep start
 * order.
 */
const sortedHttpRows = memo2((rows: readonly HttpRow[], sort: HttpSort): readonly HttpRow[] => {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const slots = rows.map((row, index) => {
    const value = sortValue(row, sort.key);
    const rank = value !== null ? 0 : sort.key === 'status' && !isPendingRow(row) ? 1 : 2;
    return { row, index, rank, value: value ?? 0 };
  });
  slots.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.rank === 0 ? dir * (a.value < b.value ? -1 : a.value > b.value ? 1 : 0) : 0) ||
      a.index - b.index,
  );
  return Object.freeze(slots.map((slot) => slot.row));
});

const visibleHttpRows = memo2((rows: readonly HttpRow[], filter: HttpFilter): readonly HttpRow[] => {
  const query = foldCase(filter.text);
  const active = query !== '' || filter.status.length > 0 || filter.type.length > 0;
  return filterRows(rows, active, (row) => {
    if (filter.type.length > 0 && filter.type.indexOf(row.transport) === -1) return false;
    if (filter.status.length > 0) {
      const group = httpStatusGroup(row);
      if (group === null || filter.status.indexOf(group) === -1) return false;
    }
    if (query === '') return true;
    const text = haystack(row, () => {
      const status = 'kind' in row && row.status !== null ? row.status : '';
      return `${row.url}\n${row.method}\n${status}\n${httpStatusLabel(row).text}`;
    });
    return text.indexOf(query) !== -1;
  });
});

function httpAll(state: PanelState): readonly HttpRow[] {
  return allHttpRows(byKind(state.entries).http, state.pending);
}

/** The HTTP list (FR-HTTP-01, `D-18`): start order, or the column sort; then filtered. */
export function selectHttpRows(state: PanelState): readonly HttpRow[] {
  const rows = httpAll(state);
  return visibleHttpRows(state.httpSort === null ? rows : sortedHttpRows(rows, state.httpSort), state.filters.http);
}

// --- WebSocket --------------------------------------------------------------

const connectionCache = new WeakMap<readonly WebSocketEntry[], readonly WsConnection[]>();

interface MutableConnection {
  socketId: number;
  url: string;
  state: 'open' | 'closed' | 'error';
  sent: number;
  received: number;
  openedAt: number | null;
  closedAt: number | null;
  closeCode: number | null;
  closeReason: string | null;
}

/** The connections list (FR-WS-01), newest socket first, as in the mockup (§4.7). */
export function selectWsConnections(state: PanelState): readonly WsConnection[] {
  const entries = byKind(state.entries).ws;
  let result = connectionCache.get(entries);
  if (result === undefined) {
    const sockets = new Map<number, MutableConnection>();
    for (const e of entries) {
      let c = sockets.get(e.socketId);
      if (c === undefined) {
        c = {
          socketId: e.socketId,
          url: e.url,
          state: 'open',
          sent: 0,
          received: 0,
          openedAt: null,
          closedAt: null,
          closeCode: null,
          closeReason: null,
        };
        sockets.set(e.socketId, c);
      }
      if (e.event === 'send') c.sent++;
      else if (e.event === 'receive') c.received++;
      else if (e.event === 'open') c.openedAt = e.t;
      else if (e.event === 'error') c.state = 'error';
      else {
        if (c.state !== 'error') c.state = 'closed';
        c.closedAt = e.t;
        c.closeCode = e.code;
        c.closeReason = e.data;
      }
    }
    const list = Array.from(sockets.values(), (c) => Object.freeze({ ...c }) as WsConnection);
    list.sort((a, b) => b.socketId - a.socketId);
    result = Object.freeze(list);
    connectionCache.set(entries, result);
  }
  return result;
}

/** Per WebSocket entries array: the messages of each socket id asked for so far. */
const scopeCache = new WeakMap<readonly WebSocketEntry[], Map<number | 'all', readonly WebSocketEntry[]>>();

function wsScope(state: PanelState): readonly WebSocketEntry[] {
  const entries = byKind(state.entries).ws;
  if (state.wsConnection === 'all') return entries;
  let perSocket = scopeCache.get(entries);
  if (perSocket === undefined) {
    perSocket = new Map();
    scopeCache.set(entries, perSocket);
  }
  let scoped = perSocket.get(state.wsConnection);
  if (scoped === undefined) {
    const id = state.wsConnection;
    scoped = Object.freeze(entries.filter((e) => e.socketId === id));
    perSocket.set(id, scoped);
  }
  return scoped;
}

const visibleWsMessages = memo2((rows: readonly WebSocketEntry[], filter: WsFilter): readonly WebSocketEntry[] => {
  const query = foldCase(filter.text);
  const active = query !== '' || filter.direction.length > 0 || filter.data.length > 0;
  return filterRows(rows, active, (row) => {
    if (filter.direction.length > 0) {
      const direction = row.event === 'send' ? 'sent' : row.event === 'receive' ? 'received' : null;
      if (direction === null || filter.direction.indexOf(direction) === -1) return false;
    }
    if (filter.data.length > 0 && (row.opcode === null || filter.data.indexOf(row.opcode) === -1)) return false;
    if (query === '') return true;
    return row.data !== null && haystack(row, () => row.data ?? '').indexOf(query) !== -1;
  });
});

/** The messages of the chosen socket, or of all sockets (`wsConnection: 'all'`), lifecycle rows included (FR-WS-02, 05); filtered. */
export function selectWsMessages(state: PanelState): readonly WebSocketEntry[] {
  return visibleWsMessages(wsScope(state), state.filters.ws);
}

// --- Console ----------------------------------------------------------------

const visibleConsoleRows = memo2((rows: readonly ConsoleRow[], filter: ConsoleFilter): readonly ConsoleRow[] => {
  const query = foldCase(filter.text);
  const active = query !== '' || filter.levels.length > 0;
  return filterRows(rows, active, (row) => {
    if (filter.levels.length > 0 && filter.levels.indexOf(consoleLevel(row)) === -1) return false;
    if (query === '') return true;
    const text = haystack(row, () => (row.kind === 'error' ? `${row.message}\n${row.source}` : consoleText(row)));
    return text.indexOf(query) !== -1;
  });
});

/** The Console list (FR-CON-01): console calls and errors in `seq` order; filtered. */
export function selectConsoleRows(state: PanelState): readonly ConsoleRow[] {
  return visibleConsoleRows(byKind(state.entries).console, state.filters.console);
}

// --- Any list ---------------------------------------------------------------

/** The visible rows of `list` — what keyboard moves walk through. */
export function selectRows<L extends ListId>(state: PanelState, list: L): readonly RowOf[L][];
export function selectRows(state: PanelState, list: ListId): readonly RowOf[ListId][] {
  switch (list) {
    case 'http':
      return selectHttpRows(state);
    case 'ws':
      return selectWsMessages(state);
    default:
      return selectConsoleRows(state);
  }
}

const countsCache = new WeakMap<readonly unknown[], ListCounts>();

/** `N / M shown` for `list`. Memoised on the visible list. */
export function selectListCounts(state: PanelState, list: ListId): ListCounts {
  const visible = selectRows(state, list);
  let counts = countsCache.get(visible);
  if (counts === undefined) {
    const total =
      list === 'http'
        ? httpAll(state).length
        : list === 'ws'
          ? wsScope(state).length
          : byKind(state.entries).console.length;
    counts = Object.freeze({ shown: visible.length, total });
    countsCache.set(visible, counts);
  }
  return counts;
}
