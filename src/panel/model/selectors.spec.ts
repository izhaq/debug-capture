import { CaptureEntry, PendingRequest } from '../..';
import { errorEntry, fakeSource, httpEntry, logEntry, pendingRequest, problemRule, wsEntry } from './fakes.spec';
import { matchRanges, toggleChip } from './filters';
import {
  selectConsoleRows,
  selectHttpRows,
  selectListCounts,
  selectRows,
  selectWsConnections,
  selectWsMessages,
} from './selectors';
import { HttpRow } from './state';
import { PanelStore, createPanelStore } from './store';

function storeWith(entries: readonly CaptureEntry[], pending: readonly PendingRequest[] = []): PanelStore {
  return createPanelStore({ source: fakeSource({ entries, pending }), isProblemEntry: problemRule });
}
const seqs = (rows: readonly { seq: number }[]): number[] => rows.map((r) => r.seq);
const httpKeys = (rows: readonly HttpRow[]): string[] => rows.map((r) => ('kind' in r ? `#${r.seq}` : `p${r.id}`));

describe('WebSocket connections and messages (S03-05)', () => {
  const entries: CaptureEntry[] = [
    wsEntry(1, { socketId: 1, event: 'open', url: 'wss://a/1', opcode: null, data: null, t: 100 }),
    wsEntry(2, { socketId: 1, event: 'send' }),
    wsEntry(3, { socketId: 1, event: 'receive' }),
    wsEntry(4, { socketId: 1, event: 'receive' }),
    wsEntry(5, { socketId: 2, event: 'open', url: 'wss://a/2', opcode: null, data: null, t: 200 }),
    wsEntry(6, { socketId: 2, event: 'error', opcode: null, data: null }),
    wsEntry(7, { socketId: 2, event: 'close', code: 1006, opcode: null, data: null, t: 300 }),
    wsEntry(8, { socketId: 3, event: 'send', url: 'wss://a/3' }),
    wsEntry(9, { socketId: 3, event: 'close', code: 1000, data: 'done', opcode: null, t: 400 }),
    logEntry(10),
  ];

  it('derives URL, state, counts and opened time per socket, newest socket first', () => {
    expect(selectWsConnections(storeWith(entries).getState())).toEqual([
      {
        socketId: 3,
        url: 'wss://a/3',
        state: 'closed',
        sent: 1,
        received: 0,
        openedAt: null,
        closedAt: 400,
        closeCode: 1000,
        closeReason: 'done',
      },
      {
        socketId: 2,
        url: 'wss://a/2',
        state: 'error',
        sent: 0,
        received: 0,
        openedAt: 200,
        closedAt: 300,
        closeCode: 1006,
        closeReason: null,
      },
      {
        socketId: 1,
        url: 'wss://a/1',
        state: 'open',
        sent: 1,
        received: 2,
        openedAt: 100,
        closedAt: null,
        closeCode: null,
        closeReason: null,
      },
    ]);
  });

  it('shows the messages of the chosen socket, or of all sockets, lifecycle rows included', () => {
    const store = storeWith(entries);
    expect(seqs(selectWsMessages(store.getState()))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    store.selectConnection(2);
    expect(seqs(selectWsMessages(store.getState()))).toEqual([5, 6, 7]);
    store.selectConnection(99);
    expect(selectWsMessages(store.getState())).toEqual([]);
  });

  it('opened time is null once the open entry left the buffer', () => {
    const store = createPanelStore({
      source: fakeSource({ entries: entries.slice(0, 4), capacity: 3 }),
      isProblemEntry: problemRule,
    });
    expect(selectWsConnections(store.getState())[0]).toEqual(jasmine.objectContaining({ openedAt: null, sent: 1 }));
  });
});

describe('Console rows (S03-06)', () => {
  it('logs and errors together in seq order', () => {
    const store = storeWith([logEntry(1), httpEntry(2), errorEntry(3), wsEntry(4), logEntry(5, { level: 'warn' })]);
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([1, 3, 5]);
  });
});

describe('filters (S03-07)', () => {
  const http = [
    httpEntry(1, { status: 200, transport: 'xhr', url: 'https://a/Users' }),
    httpEntry(2, { status: 302, method: 'POST' }),
    httpEntry(3, { status: 404 }),
    httpEntry(4, { status: 503, transport: 'xhr' }),
    httpEntry(5, { status: null, error: 'abort' }),
  ];
  const pending = [pendingRequest(9, { transport: 'fetch' })];

  it('HTTP: status chips OR inside the group, AND with the type group', () => {
    const store = storeWith(http, pending);
    store.setFilter('http', { status: ['5xx', 'failed', 'pending'] });
    // Start order (D-18): p9 started (t 509) before the finished ones (t 1001…).
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['p9', '#4', '#5']);
    store.setFilter('http', { type: ['xhr'] });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#4']);
    store.setFilter('http', { status: [] });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#1', '#4']);
  });

  it('HTTP: case-insensitive text over URL, method and status', () => {
    const store = storeWith(http, pending);
    store.setFilter('http', { text: 'USERS' });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#1']);
    store.setFilter('http', { text: 'post' });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['p9', '#2']);
    store.setFilter('http', { text: '404' });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#3']);
    store.setFilter('http', { text: 'aborted' });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#5']);
  });

  it('HTTP: text AND chips', () => {
    const store = storeWith(http, pending);
    store.setFilter('http', { text: 'post', status: ['pending'] });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['p9']);
  });

  it('WebSocket: direction and data type chips hide lifecycle rows; text looks in the data', () => {
    const store = storeWith([
      wsEntry(1, { event: 'open', opcode: null, data: null }),
      wsEntry(2, { event: 'send', data: '{"cmd":"Apply"}' }),
      wsEntry(3, { event: 'receive', opcode: 'binary', data: 'AAEC' }),
      wsEntry(4, { event: 'receive', data: 'apply ok' }),
      wsEntry(5, { event: 'close', opcode: null, data: 'bye', code: 1000 }),
    ]);
    store.setFilter('ws', { direction: ['received'] });
    expect(seqs(selectWsMessages(store.getState()))).toEqual([3, 4]);
    store.setFilter('ws', { direction: [], data: ['text'] });
    expect(seqs(selectWsMessages(store.getState()))).toEqual([2, 4]);
    store.setFilter('ws', { data: [], text: 'APPLY' });
    expect(seqs(selectWsMessages(store.getState()))).toEqual([2, 4]);
    store.setFilter('ws', { text: 'bye' });
    expect(seqs(selectWsMessages(store.getState()))).toEqual([5]);
  });

  it('Console: level chips (errors are level error) and text over message and source', () => {
    const store = storeWith([
      logEntry(1, { level: 'info', args: ['Angular is running'] }),
      logEntry(2, { level: 'error', args: ['console.error call'] }),
      errorEntry(3, { source: 'angular', message: 'TypeError' }),
      logEntry(4, { level: 'debug', args: [{ deep: 'Needle' }] }),
    ]);
    store.setFilter('console', { levels: ['error'] });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([2, 3]);
    store.setFilter('console', { levels: [], text: 'ANGULAR' });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([1, 3]);
    store.setFilter('console', { text: 'needle' });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([4]);
  });

  it('"All" (an empty group) resets the group; toggleChip adds and removes a chip', () => {
    expect(toggleChip([], '4xx')).toEqual(['4xx']);
    expect(toggleChip(['4xx', '5xx'], '4xx')).toEqual(['5xx']);
    const store = storeWith(http);
    store.setFilter('http', { status: toggleChip(store.getState().filters.http.status, '4xx') });
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#3']);
    store.setFilter('http', { status: [] });
    expect(selectHttpRows(store.getState()).length).toBe(5);
  });

  it('matchRanges: every case-insensitive match, not overlapping', () => {
    expect(matchRanges('Api /api/API', 'api')).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 8 },
      { start: 9, end: 12 },
    ]);
    expect(matchRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(matchRanges('abc', '')).toEqual([]);
    expect(matchRanges('abc', 'x')).toEqual([]);
    // 'İ' lower-cases to two code units; ranges must still index the original text.
    expect(matchRanges('İx-ix', 'ix')).toEqual([{ start: 3, end: 5 }]);
  });
});

describe('counts per list (S03-10)', () => {
  it('shown / total per list: after / before filters', () => {
    const store = storeWith(
      [
        httpEntry(1, { status: 500 }),
        httpEntry(2),
        logEntry(3),
        wsEntry(4, { socketId: 1 }),
        wsEntry(5, { socketId: 2 }),
      ],
      [pendingRequest(9)],
    );
    store.setFilter('http', { status: ['5xx'] });
    expect(selectListCounts(store.getState(), 'http')).toEqual({ shown: 1, total: 3 });
    expect(selectListCounts(store.getState(), 'console')).toEqual({ shown: 1, total: 1 });
    store.selectConnection(1);
    store.setFilter('ws', { direction: ['sent'] });
    expect(selectListCounts(store.getState(), 'ws')).toEqual({ shown: 0, total: 1 });
  });

  it('selectRows dispatches by list', () => {
    const store = storeWith([httpEntry(1), logEntry(2), wsEntry(3)]);
    const state = store.getState();
    expect(selectRows(state, 'http')).toBe(selectHttpRows(state));
    expect(selectRows(state, 'ws')).toBe(selectWsMessages(state));
    expect(selectRows(state, 'console')).toBe(selectConsoleRows(state));
  });
});

describe('memoised selectors (S03-14)', () => {
  it('same input → the same array instance; unrelated changes keep it', () => {
    const store = storeWith([httpEntry(1), logEntry(2), wsEntry(3)]);
    const s1 = store.getState();
    const http = selectHttpRows(s1);
    const consoleRows = selectConsoleRows(s1);
    const conns = selectWsConnections(s1);
    expect(selectHttpRows(s1)).toBe(http);

    store.setFilter('console', { text: 'zzz' });
    store.apply([{ type: 'capture', on: false }]);
    const s2 = store.getState();
    expect(s2).not.toBe(s1);
    expect(selectHttpRows(s2)).toBe(http);
    expect(selectWsConnections(s2)).toBe(conns);
    expect(selectConsoleRows(s2)).not.toBe(consoleRows);
    expect(selectListCounts(s2, 'http')).toBe(selectListCounts(s2, 'http'));
  });

  it('returned lists are frozen', () => {
    const state = storeWith([httpEntry(1), wsEntry(2)]).getState();
    expect(Object.isFrozen(selectHttpRows(state))).toBe(true);
    expect(Object.isFrozen(selectWsConnections(state))).toBe(true);
    expect(Object.isFrozen(selectWsConnections(state)[0])).toBe(true);
    expect(Object.isFrozen(selectWsMessages(state))).toBe(true);
  });
});
