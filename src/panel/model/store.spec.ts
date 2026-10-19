import { CaptureEntry, PendingRequest } from '../..';
import { errorEntry, fakeSource, httpEntry, logEntry, pendingRequest, problemRule, wsEntry } from './fakes.spec';
import { PanelDataEvent } from './panel-data-source';
import { selectConsoleRows, selectHttpRows, selectWsMessages } from './selectors';
import { HttpRow } from './state';
import { PanelStore, createPanelStore } from './store';

function storeWith(
  init: { entries?: readonly CaptureEntry[]; pending?: readonly PendingRequest[]; capacity?: number } = {},
): PanelStore {
  return createPanelStore({ source: fakeSource(init), isProblemEntry: problemRule });
}

const entry = (e: CaptureEntry): PanelDataEvent => ({ type: 'entry', entry: e });
const seqs = (rows: readonly { seq: number }[]): number[] => rows.map((r) => r.seq);
const httpKeys = (rows: readonly HttpRow[]): string[] => rows.map((r) => ('kind' in r ? `#${r.seq}` : `p${r.id}`));

describe('createPanelStore (S03-02)', () => {
  it('starts from snapshot() and pending()', () => {
    const store = storeWith({ entries: [httpEntry(1), logEntry(2)], pending: [pendingRequest(9)], capacity: 10 });
    const state = store.getState();
    expect(seqs(state.entries)).toEqual([1, 2]);
    expect(state.pending.map((p) => p.id)).toEqual([9]);
    expect(state.buffer).toEqual({
      used: 2,
      capacity: 10,
      problems: 0,
      recorded: 2,
      dropped: 0,
      evicted: 0,
      failed: 0,
    });
    expect(state.captureOn).toBe(true);
    expect(state.redactedValue).toBe('[redacted]');
  });

  it('getState() is deeply frozen', () => {
    const state = storeWith({ entries: [httpEntry(1)] }).getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.entries)).toBe(true);
    expect(Object.isFrozen(state.pending)).toBe(true);
    expect(Object.isFrozen(state.buffer)).toBe(true);
    expect(Object.isFrozen(state.filters.http.status)).toBe(true);
    expect(Object.isFrozen(state.selection)).toBe(true);
  });

  it('apply() takes a batch and notifies once', () => {
    const store = storeWith();
    const states: unknown[] = [];
    store.subscribe((s) => states.push(s));
    store.apply([entry(httpEntry(1)), entry(httpEntry(2)), { type: 'capture', on: false }]);
    expect(states.length).toBe(1);
    expect(states[0]).toBe(store.getState());
    expect(seqs(store.getState().entries)).toEqual([1, 2]);
    expect(store.getState().captureOn).toBe(false);
  });

  it('an empty batch or a no-op action changes nothing and notifies nobody', () => {
    const store = storeWith();
    const before = store.getState();
    let calls = 0;
    store.subscribe(() => calls++);
    store.apply([]);
    store.resume();
    store.clearSelection('http');
    expect(calls).toBe(0);
    expect(store.getState()).toBe(before);
  });

  it('each action notifies once; unsubscribe stops it; a throwing listener is isolated', () => {
    const store = storeWith({ entries: [httpEntry(1)] });
    let calls = 0;
    store.subscribe(() => {
      throw new Error('view bug');
    });
    const off = store.subscribe(() => calls++);
    store.setFilter('http', { text: 'x' });
    store.pause();
    expect(calls).toBe(2);
    off();
    store.resume();
    expect(calls).toBe(2);
  });

  it('ignores an entry it already holds (seq not newer)', () => {
    const store = storeWith({ entries: [httpEntry(1), httpEntry(2)] });
    store.apply([entry(httpEntry(2)), entry(httpEntry(3))]);
    expect(seqs(store.getState().entries)).toEqual([1, 2, 3]);
  });

  it('stats events replace the counters', () => {
    const store = storeWith();
    store.apply([{ type: 'stats', stats: { recorded: 5, dropped: 3, evicted: 1, failed: 2 } }]);
    expect(store.getState().buffer).toEqual(
      jasmine.objectContaining({ recorded: 5, dropped: 3, evicted: 1, failed: 2 }),
    );
  });
});

describe('buffer mirror (S03-03)', () => {
  it('keeps at most capacity entries, evicting the oldest like the recorder, and counts them', () => {
    const store = storeWith({ entries: [httpEntry(1), httpEntry(2)], capacity: 3 });
    store.apply([entry(httpEntry(3)), entry(httpEntry(4)), entry(httpEntry(5))]);
    const { entries, buffer } = store.getState();
    expect(seqs(entries)).toEqual([3, 4, 5]);
    expect(buffer.used).toBe(3);
    expect(buffer.evicted).toBe(2);
    expect(buffer.recorded).toBe(5);
  });

  it('a snapshot larger than capacity keeps its newest entries', () => {
    const store = storeWith({ entries: [httpEntry(1), httpEntry(2), httpEntry(3)], capacity: 2 });
    expect(seqs(store.getState().entries)).toEqual([2, 3]);
  });

  it('stays correct over many evictions (internal compaction)', () => {
    const store = storeWith({ capacity: 10 });
    for (let s = 1; s <= 5_000; s += 100) {
      const batch: PanelDataEvent[] = [];
      for (let i = s; i < s + 100; i++) batch.push(entry(logEntry(i)));
      store.apply(batch);
    }
    expect(seqs(store.getState().entries)).toEqual([4991, 4992, 4993, 4994, 4995, 4996, 4997, 4998, 4999, 5000]);
    expect(store.getState().buffer.evicted).toBe(4990);
  });

  it('cleared empties everything, pending included, and zeroes the counters', () => {
    const store = storeWith({ entries: [httpEntry(1), errorEntry(2)], pending: [pendingRequest(3)] });
    store.apply([{ type: 'cleared' }]);
    const state = store.getState();
    expect(state.entries).toEqual([]);
    expect(state.pending).toEqual([]);
    expect(state.buffer).toEqual({
      used: 0,
      capacity: 5000,
      problems: 0,
      recorded: 0,
      dropped: 0,
      evicted: 0,
      failed: 0,
    });
  });

  it('a selected entry that is evicted keeps its data with removed: true', () => {
    const first = httpEntry(1);
    const store = storeWith({ entries: [first, httpEntry(2)], capacity: 2 });
    store.select('http', first);
    store.apply([entry(httpEntry(3))]);
    expect(store.getState().selection.http).toEqual({ row: first, removed: true });
  });

  it('cleared marks every selection removed', () => {
    const log = logEntry(2);
    const msg = wsEntry(3);
    const store = storeWith({ entries: [httpEntry(1), log, msg] });
    store.select('console', log);
    store.select('ws', msg);
    store.apply([{ type: 'cleared' }]);
    expect(store.getState().selection.console).toEqual({ row: log, removed: true });
    expect(store.getState().selection.ws).toEqual({ row: msg, removed: true });
  });
});

describe('HTTP list (S03-04)', () => {
  it('start order (D-18): finished and pending rows by start time, whatever the completion order', () => {
    const store = storeWith({ entries: [httpEntry(2), httpEntry(1 + 2, { t: 1 })], pending: [pendingRequest(7)] });
    store.apply([{ type: 'pending-start', request: pendingRequest(8) }, entry(httpEntry(5, { t: 0 }))]);
    // t: #5 0, #3 1, p7 507, p8 508, #2 1002.
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#5', '#3', 'p7', 'p8', '#2']);
  });

  it('pending-end removes the pending row; the finished entry takes its place by start time and replaces nothing else', () => {
    const store = storeWith({ entries: [httpEntry(1)], pending: [pendingRequest(7), pendingRequest(8)] });
    store.apply([entry(httpEntry(2, { t: 507, requestId: 7 }))]);
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#2', 'p7', 'p8', '#1']);
    store.apply([{ type: 'pending-end', id: 7 }]);
    expect(httpKeys(selectHttpRows(store.getState()))).toEqual(['#2', 'p8', '#1']);
  });

  it('a duplicate pending-start and an unknown pending-end change nothing', () => {
    const store = storeWith({ pending: [pendingRequest(7)] });
    const before = store.getState();
    store.apply([
      { type: 'pending-start', request: pendingRequest(7) },
      { type: 'pending-end', id: 99 },
    ]);
    expect(store.getState().pending).toBe(before.pending);
  });

  it('a selected pending row follows its request to the finished entry', () => {
    const p = pendingRequest(7);
    const done = httpEntry(2, { requestId: 7 });
    const store = storeWith({ pending: [p] });
    store.select('http', p);
    store.apply([{ type: 'pending-end', id: 7 }]);
    expect(store.getState().selection.http).toEqual({ row: p, removed: true });
    store.apply([entry(done)]);
    expect(store.getState().selection.http).toEqual({ row: done, removed: false });
  });
});

describe('selection (S03-08)', () => {
  const rows = [logEntry(1), logEntry(2), logEntry(3), logEntry(4)];

  it('select / clearSelection per list', () => {
    const store = storeWith({ entries: rows });
    store.select('console', rows[1]);
    expect(store.getState().selection.console).toEqual({ row: rows[1], removed: false });
    expect(store.getState().selection.http).toBeNull();
    store.clearSelection('console');
    expect(store.getState().selection.console).toBeNull();
  });

  it('moves next / previous / first / last / by a page, clamped to the visible rows', () => {
    const store = storeWith({ entries: rows });
    const at = (): number | undefined => store.getState().selection.console?.row.seq;
    store.moveSelection('console', 1);
    expect(at()).toBe(1);
    store.moveSelection('console', 1);
    expect(at()).toBe(2);
    store.moveSelection('console', -1);
    expect(at()).toBe(1);
    store.moveSelection('console', -1);
    expect(at()).toBe(1);
    store.moveSelection('console', 'last');
    expect(at()).toBe(4);
    store.moveSelection('console', 10);
    expect(at()).toBe(4);
    store.moveSelection('console', -2);
    expect(at()).toBe(2);
    store.moveSelection('console', 'first');
    expect(at()).toBe(1);
  });

  it('with nothing selected, up starts at the last row; moving in an empty list does nothing', () => {
    const store = storeWith({ entries: rows });
    store.moveSelection('console', -1);
    expect(store.getState().selection.console?.row.seq).toBe(4);
    const before = store.getState();
    store.moveSelection('http', 1);
    expect(store.getState()).toBe(before);
  });

  it('moves within the filtered rows', () => {
    const store = storeWith({ entries: [logEntry(1), logEntry(2, { level: 'warn' }), logEntry(3, { level: 'warn' })] });
    store.setFilter('console', { levels: ['warn'] });
    store.moveSelection('console', 'first');
    expect(store.getState().selection.console?.row.seq).toBe(2);
    store.moveSelection('console', 1);
    expect(store.getState().selection.console?.row.seq).toBe(3);
  });

  it('from a removed selection, a move starts again at the edge', () => {
    const first = logEntry(1);
    const store = storeWith({ entries: [first, logEntry(2)], capacity: 2 });
    store.select('console', first);
    store.apply([entry(logEntry(3))]);
    store.moveSelection('console', 1);
    expect(store.getState().selection.console).toEqual({ row: logEntry(2), removed: false });
  });

  it('selectConnection picks the socket and drops the message selection', () => {
    const msg = wsEntry(1, { socketId: 2 });
    const store = storeWith({ entries: [msg] });
    store.select('ws', msg);
    store.selectConnection(2);
    expect(store.getState().wsConnection).toBe(2);
    expect(store.getState().selection.ws).toBeNull();
  });
});

describe('pause (S03-09)', () => {
  it('freezes the visible lists while capture goes on, and counts what arrived', () => {
    const store = storeWith({ entries: [logEntry(1)], pending: [pendingRequest(5)] });
    store.pause();
    const frozen = store.getState();
    store.apply([
      entry(logEntry(2)),
      entry(httpEntry(3)),
      { type: 'pending-start', request: pendingRequest(6) },
      { type: 'pending-end', id: 5 },
    ]);
    const state = store.getState();
    expect(state.paused).toBe(true);
    expect(state.entries).toBe(frozen.entries);
    expect(state.pending).toBe(frozen.pending);
    expect(state.newSincePause).toBe(2);
    expect(state.buffer.used).toBe(3);
  });

  it('evicted rows still disappear while paused; newSincePause is capped at capacity', () => {
    const store = storeWith({ entries: [logEntry(1), logEntry(2), logEntry(3)], capacity: 3 });
    store.pause();
    store.apply([entry(logEntry(4))]);
    expect(seqs(store.getState().entries)).toEqual([2, 3]);
    store.apply([5, 6, 7, 8, 9].map((s) => entry(logEntry(s))));
    expect(store.getState().entries).toEqual([]);
    expect(store.getState().newSincePause).toBe(3);
  });

  it('cleared still applies while paused', () => {
    const store = storeWith({ entries: [logEntry(1)], pending: [pendingRequest(5)] });
    store.pause();
    store.apply([entry(logEntry(2)), { type: 'cleared' }, entry(logEntry(3))]);
    const state = store.getState();
    expect(state.entries).toEqual([]);
    expect(state.pending).toEqual([]);
    expect(state.newSincePause).toBe(1);
  });

  it('resume applies everything that waited', () => {
    const store = storeWith({ entries: [logEntry(1)], pending: [pendingRequest(5)] });
    store.pause();
    store.apply([entry(logEntry(2)), { type: 'pending-start', request: pendingRequest(6) }]);
    store.resume();
    const state = store.getState();
    expect(state.paused).toBe(false);
    expect(seqs(state.entries)).toEqual([1, 2]);
    expect(state.pending.map((p) => p.id)).toEqual([5, 6]);
    expect(state.newSincePause).toBe(0);
  });

  it('pause twice is a no-op', () => {
    const store = storeWith();
    store.pause();
    const paused = store.getState();
    store.pause();
    expect(store.getState()).toBe(paused);
  });
});

describe('counts (S03-10)', () => {
  it('problems over the buffer use the injected rule, follow evictions and clears', () => {
    const rule = jasmine.createSpy('isProblemEntry', problemRule).and.callThrough();
    const store = createPanelStore({
      source: fakeSource({ entries: [errorEntry(1), httpEntry(2, { status: 500 }), logEntry(3)], capacity: 3 }),
      isProblemEntry: rule,
    });
    expect(store.getState().buffer.problems).toBe(2);
    store.apply([entry(wsEntry(4, { event: 'error' })), entry(httpEntry(5, { status: 404 }))]);
    expect(store.getState().buffer.problems).toBe(1);
    store.apply([{ type: 'cleared' }]);
    expect(store.getState().buffer.problems).toBe(0);
    expect(rule).toHaveBeenCalledTimes(5);
  });

  it('problems count the whole buffer even while paused', () => {
    const store = storeWith();
    store.pause();
    store.apply([entry(errorEntry(1))]);
    expect(store.getState().buffer.problems).toBe(1);
  });

  it('a throwing problem rule counts as "not a problem"', () => {
    const store = createPanelStore({
      source: fakeSource({ entries: [errorEntry(1)] }),
      isProblemEntry: () => {
        throw new Error('rule bug');
      },
    });
    expect(store.getState().buffer.problems).toBe(0);
  });

  it('filters are kept per list; clearFilters resets one list', () => {
    const store = storeWith();
    store.setFilter('http', { text: 'api', status: ['5xx'] });
    store.setFilter('console', { levels: ['error'] });
    expect(store.getState().filters.http).toEqual({ text: 'api', status: ['5xx'], type: [] });
    store.clearFilters('http');
    expect(store.getState().filters.http).toEqual({ text: '', status: [], type: [] });
    expect(store.getState().filters.console.levels).toEqual(['error']);
  });

  it('initial chips come from options (restored settings)', () => {
    const store = createPanelStore({
      source: fakeSource({ entries: [logEntry(1), logEntry(2, { level: 'warn' })] }),
      isProblemEntry: problemRule,
      filters: { console: { levels: ['warn'] } },
    });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([2]);
    expect(selectWsMessages(store.getState())).toEqual([]);
  });
});
