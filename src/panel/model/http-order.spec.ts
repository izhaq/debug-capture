import { CaptureEntry, PendingRequest } from '../..';
import { fakeSource, httpEntry, pendingRequest, problemRule } from './fakes.spec';
import { PanelDataEvent } from './panel-data-source';
import { selectHttpRows, selectListCounts } from './selectors';
import { HttpRow, HttpSort } from './state';
import { PanelStore, createPanelStore } from './store';

function storeWith(entries: readonly CaptureEntry[], pending: readonly PendingRequest[] = []): PanelStore {
  return createPanelStore({ source: fakeSource({ entries, pending }), isProblemEntry: problemRule });
}
const keys = (store: PanelStore): string[] =>
  selectHttpRows(store.getState()).map((r: HttpRow) => ('kind' in r ? `#${r.seq}` : `p${r.id}`));
const entry = (e: CaptureEntry): PanelDataEvent => ({ type: 'entry', entry: e });

describe('HTTP start order (D-18, FR-HTTP-01, C3-4)', () => {
  it('lists finished and pending requests together by start time, not by completion', () => {
    // #1 started at 30 and finished first; #2 started at 10 and finished later; p7 is still running since 20.
    const store = storeWith([httpEntry(1, { t: 30 }), httpEntry(2, { t: 10 })], [pendingRequest(7, { t: 20 })]);
    expect(keys(store)).toEqual(['#2', 'p7', '#1']);
  });

  it('a finished request keeps the place its pending row had (the recorder ends the pending row first)', () => {
    const store = storeWith([httpEntry(1, { t: 10 })], [pendingRequest(7, { t: 20 }), pendingRequest(8, { t: 30 })]);
    expect(keys(store)).toEqual(['#1', 'p7', 'p8']);
    store.apply([{ type: 'pending-end', id: 7 }, entry(httpEntry(2, { t: 20, requestId: 7 }))]);
    expect(keys(store)).toEqual(['#1', '#2', 'p8']);
    expect(selectListCounts(store.getState(), 'http')).toEqual({ shown: 3, total: 3 });
  });

  it('equal start times: finished rows in seq order, then pending rows in id order', () => {
    const store = storeWith([httpEntry(2, { t: 5 }), httpEntry(3, { t: 5 })], [pendingRequest(1, { t: 5 })]);
    expect(keys(store)).toEqual(['#2', '#3', 'p1']);
  });

  it('is memoised: the same inputs give the same frozen array, sorted or not', () => {
    const store = storeWith([httpEntry(1, { t: 30 }), httpEntry(2, { t: 10 })]);
    const rows = selectHttpRows(store.getState());
    expect(selectHttpRows(store.getState())).toBe(rows);
    expect(Object.isFrozen(rows)).toBe(true);
    store.setHttpSort('method');
    const sorted = selectHttpRows(store.getState());
    expect(Object.isFrozen(sorted)).toBe(true);
    store.select('http', sorted[0] as HttpRow);
    expect(selectHttpRows(store.getState())).toBe(sorted);
  });
});

describe('HTTP column sort (D-18, FR-HTTP-01, C3-4)', () => {
  // Start order: #1, #2, #3.
  const three = (): PanelStore =>
    storeWith([
      httpEntry(1, { t: 10, durationMs: 300, method: 'POST' }),
      httpEntry(2, { t: 20, durationMs: 100, method: 'GET' }),
      httpEntry(3, { t: 30, durationMs: 200, method: 'POST' }),
    ]);

  it('starts with no sort: start order', () => {
    expect(three().getState().httpSort).toBeNull();
  });

  it('setHttpSort cycles ascending → descending → start order', () => {
    const store = three();
    store.setHttpSort('duration');
    expect(store.getState().httpSort).toEqual({ key: 'duration', dir: 'asc' });
    expect(keys(store)).toEqual(['#2', '#3', '#1']);
    store.setHttpSort('duration');
    expect(store.getState().httpSort).toEqual({ key: 'duration', dir: 'desc' });
    expect(keys(store)).toEqual(['#1', '#3', '#2']);
    store.setHttpSort('duration');
    expect(store.getState().httpSort).toBeNull();
    expect(keys(store)).toEqual(['#1', '#2', '#3']);
  });

  it('each click notifies once and stores a frozen sort', () => {
    const store = three();
    const seen: (HttpSort | null)[] = [];
    store.subscribe((state) => seen.push(state.httpSort));
    store.setHttpSort('size');
    expect(seen).toEqual([{ key: 'size', dir: 'asc' }]);
    expect(Object.isFrozen(store.getState().httpSort)).toBe(true);
  });

  it('another column starts ascending; ties keep start order in both directions', () => {
    const store = three();
    store.setHttpSort('duration');
    store.setHttpSort('method');
    expect(store.getState().httpSort).toEqual({ key: 'method', dir: 'asc' });
    expect(keys(store)).toEqual(['#2', '#1', '#3']);
    store.setHttpSort('method');
    expect(keys(store)).toEqual(['#1', '#3', '#2']);
  });

  it('time sorts by start time; equal times keep start order in both directions', () => {
    const store = storeWith([
      httpEntry(1, { t: 3 }),
      httpEntry(2, { t: 1 }),
      httpEntry(3, { t: 2 }),
      httpEntry(4, { t: 1 }),
    ]);
    store.setHttpSort('time');
    expect(keys(store)).toEqual(['#2', '#4', '#3', '#1']);
    store.setHttpSort('time');
    expect(keys(store)).toEqual(['#1', '#3', '#2', '#4']);
  });

  it('status: by the number; Failed, Aborted and Timeout after the numbers; pending last — in both directions', () => {
    const store = storeWith(
      [
        httpEntry(1, { t: 1, status: 500 }),
        httpEntry(2, { t: 2, status: null, error: 'network' }),
        httpEntry(3, { t: 3, status: 200 }),
        httpEntry(4, { t: 4, status: null, error: 'timeout' }),
        httpEntry(5, { t: 5, status: 404 }),
        // An abort after the headers keeps its code, but the cell shows `Aborted`: no number.
        httpEntry(6, { t: 6, status: 200, error: 'abort' }),
      ],
      [pendingRequest(8, { t: 0 }), pendingRequest(9, { t: 7 })],
    );
    store.setHttpSort('status');
    expect(keys(store)).toEqual(['#3', '#5', '#1', '#2', '#4', '#6', 'p8', 'p9']);
    store.setHttpSort('status');
    expect(keys(store)).toEqual(['#1', '#5', '#3', '#2', '#4', '#6', 'p8', 'p9']);
  });

  it('size and duration: rows with no value (pending, or unknown `—`) go last in start order, in both directions', () => {
    const store = storeWith(
      [
        httpEntry(1, { t: 1, bytes: 50, durationMs: 9 }),
        httpEntry(2, { t: 2, bytes: null, durationMs: null }),
        httpEntry(3, { t: 3, bytes: 10, durationMs: 30 }),
      ],
      [pendingRequest(9, { t: 0 })],
    );
    store.setHttpSort('size');
    expect(keys(store)).toEqual(['#3', '#1', 'p9', '#2']);
    store.setHttpSort('size');
    expect(keys(store)).toEqual(['#1', '#3', 'p9', '#2']);
    store.setHttpSort('duration');
    expect(keys(store)).toEqual(['#1', '#3', 'p9', '#2']);
    store.setHttpSort('duration');
    expect(keys(store)).toEqual(['#3', '#1', 'p9', '#2']);
  });

  it('name sorts by the shown name (last path segment + query), ignoring case', () => {
    const store = storeWith(
      [
        httpEntry(1, { t: 1, url: 'https://a.test/b/Zeta' }),
        httpEntry(2, { t: 2, url: 'https://z.test/alpha?x=1' }),
        httpEntry(3, { t: 3, url: 'https://a.test/beta' }),
      ],
      [pendingRequest(9, { t: 4, url: 'https://a.test/x/Gamma' })],
    );
    // By full URL, or case-sensitive, #1 or p9 would come first.
    store.setHttpSort('name');
    expect(keys(store)).toEqual(['#2', '#3', 'p9', '#1']);
    store.setHttpSort('name');
    expect(keys(store)).toEqual(['#1', 'p9', '#3', '#2']);
  });

  it('type and method sort pending rows by their value like finished ones', () => {
    const store = storeWith(
      [
        httpEntry(1, { t: 1, transport: 'xhr', method: 'GET' }),
        httpEntry(2, { t: 2, transport: 'fetch', method: 'PUT' }),
      ],
      [pendingRequest(9, { t: 3, transport: 'xhr', method: 'POST' })],
    );
    store.setHttpSort('type');
    expect(keys(store)).toEqual(['#2', '#1', 'p9']);
    store.setHttpSort('type');
    expect(keys(store)).toEqual(['#1', 'p9', '#2']);
    store.setHttpSort('method');
    expect(keys(store)).toEqual(['#1', 'p9', '#2']);
  });

  it('new rows land in their sorted place', () => {
    const store = three();
    store.setHttpSort('duration');
    store.apply([entry(httpEntry(4, { t: 40, durationMs: 150 }))]);
    expect(keys(store)).toEqual(['#2', '#4', '#3', '#1']);
  });

  it('filters apply on top of the sort, and keyboard moves walk the sorted rows', () => {
    const store = three();
    const [first] = selectHttpRows(store.getState());
    store.select('http', first as HttpRow);
    store.setHttpSort('duration');
    expect(store.getState().selection.http?.row).toBe(first);
    store.moveSelection('http', -1);
    expect(keys(store)[1]).toBe('#3');
    expect(store.getState().selection.http?.row).toBe(selectHttpRows(store.getState())[1]);
    store.setFilter('http', { text: 'post' });
    expect(keys(store)).toEqual(['#3', '#1']);
    expect(selectListCounts(store.getState(), 'http')).toEqual({ shown: 2, total: 3 });
  });
});
