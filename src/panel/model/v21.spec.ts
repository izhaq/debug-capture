import { CaptureEntry, PendingRequest } from '../..';
import { fakeCapture, fakeSource, httpEntry, logEntry, noteEntry, problemRule } from './fakes.spec';
import { consoleLevel, consoleLevelLabel, consoleText } from './format';
import { createLocalDataSource } from './local-data-source';
import { PanelDataEvent } from './panel-data-source';
import { selectConsoleRows, selectListCounts } from './selectors';
import { PanelStore, createPanelStore } from './store';

/** 2.1 in the panel model (S11-07, S11-15): the live buffer size and notes in Console. */

function storeWith(
  init: { entries?: readonly CaptureEntry[]; pending?: readonly PendingRequest[]; capacity?: number } = {},
): PanelStore {
  return createPanelStore({ source: fakeSource(init), isProblemEntry: problemRule });
}
const entry = (e: CaptureEntry): PanelDataEvent => ({ type: 'entry', entry: e });
const seqs = (rows: readonly { seq: number }[]): number[] => rows.map((r) => r.seq);

describe('local data source — 2.1 (S11-07)', () => {
  it('capacity() is the live size; defaultCapacity() the policy one; setCapacity reaches the recorder', () => {
    const { controller, recorder } = fakeCapture({ maxEntries: 42 });
    const source = createLocalDataSource(controller);
    expect(source.defaultCapacity()).toBe(42);
    recorder.capacityValue = 42;
    source.setCapacity(Number.POSITIVE_INFINITY);
    expect(recorder.capacityValue).toBe(Number.POSITIVE_INFINITY);
    expect(source.capacity()).toBe(Number.POSITIVE_INFINITY);
    expect(source.defaultCapacity()).toBe(42);
  });

  it('a capacity change becomes { type: capacity, capacity }', () => {
    const { controller, recorder } = fakeCapture();
    const source = createLocalDataSource(controller);
    const events: PanelDataEvent[] = [];
    source.subscribe((e) => events.push(e));
    recorder.setCapacity(1000);
    expect(events).toEqual([{ type: 'capacity', capacity: 1000 }]);
  });

  it('addNote goes through the session (C-10), and never throws', () => {
    const { controller, calls } = fakeCapture();
    const source = createLocalDataSource(controller);
    source.addNote('Login', 'clicked');
    expect(calls).toEqual(['session.addNote Login clicked']);
    (controller.session as { addNote: unknown }).addNote = () => {
      throw new Error('broken');
    };
    expect(() => source.addNote('x', 'y')).not.toThrow();
  });

  it('setCapacity never throws into the panel', () => {
    const { controller, recorder } = fakeCapture();
    recorder.setCapacity = () => {
      throw new Error('broken');
    };
    expect(() => createLocalDataSource(controller).setCapacity(10)).not.toThrow();
  });
});

describe('store — capacity event (S11-07, FR-BUF-02)', () => {
  it('a smaller capacity drops the oldest at once and counts them as evicted', () => {
    const store = storeWith({ entries: [1, 2, 3, 4, 5].map((s) => logEntry(s)), capacity: 5 });
    store.apply([{ type: 'capacity', capacity: 2 }]);
    const state = store.getState();
    expect(seqs(state.entries)).toEqual([4, 5]);
    expect(state.buffer.capacity).toBe(2);
    expect(state.buffer.used).toBe(2);
    expect(state.buffer.evicted).toBe(3);
    store.apply([entry(logEntry(6))]);
    expect(seqs(store.getState().entries)).toEqual([5, 6]);
  });

  it('a selected entry dropped by a shrink keeps its detail with removed: true', () => {
    const first = logEntry(1);
    const store = storeWith({ entries: [first, logEntry(2)], capacity: 5 });
    store.select('console', first);
    store.apply([{ type: 'capacity', capacity: 1 }]);
    expect(store.getState().selection.console).toEqual({ row: first, removed: true });
  });

  it('while paused, dropped rows leave the frozen view and N new is capped at the new size', () => {
    const store = storeWith({ entries: [1, 2, 3].map((s) => logEntry(s)), capacity: 10 });
    store.pause();
    store.apply([4, 5, 6, 7].map((s) => entry(logEntry(s))));
    store.apply([{ type: 'capacity', capacity: 2 }]);
    expect(store.getState().entries).toEqual([]);
    expect(store.getState().newSincePause).toBe(2);
  });

  it('Infinity (No limit) keeps everything', () => {
    const store = storeWith({ entries: [logEntry(1)], capacity: 2 });
    store.apply([{ type: 'capacity', capacity: Number.POSITIVE_INFINITY }]);
    store.apply([2, 3, 4, 5].map((s) => entry(logEntry(s))));
    expect(seqs(store.getState().entries)).toEqual([1, 2, 3, 4, 5]);
    expect(store.getState().buffer.capacity).toBe(Number.POSITIVE_INFINITY);
  });

  it('problems follow a shrink', () => {
    const store = storeWith({
      entries: [{ kind: 'error', seq: 1, t: 1, source: 'window', message: 'x', stack: null }, logEntry(2)],
      capacity: 5,
    });
    expect(store.getState().buffer.problems).toBe(1);
    store.apply([{ type: 'capacity', capacity: 1 }]);
    expect(store.getState().buffer.problems).toBe(0);
  });
});

describe('Console notes (S11-15, FR-NOTE-02)', () => {
  it('notes are Console rows in seq order, and count in N / M shown', () => {
    const store = storeWith({ entries: [logEntry(1), noteEntry(2), httpEntry(3)] });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([1, 2]);
    expect(selectListCounts(store.getState(), 'console')).toEqual({ shown: 2, total: 2 });
  });

  it('level chips never hide a note', () => {
    const store = storeWith({ entries: [logEntry(1), noteEntry(2), logEntry(3, { level: 'error' })] });
    store.setFilter('console', { levels: ['error'] });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([2, 3]);
  });

  it('the search looks in title and text', () => {
    const store = storeWith({ entries: [noteEntry(1, 'Login', 'clicked Sign in'), noteEntry(2, 'Other', 'x')] });
    store.setFilter('console', { text: 'login' });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([1]);
    store.setFilter('console', { text: 'sign in' });
    expect(seqs(selectConsoleRows(store.getState()))).toEqual([1]);
  });

  it('format: level note, word note, message = title — text', () => {
    expect(consoleLevel(noteEntry(1))).toBe('note');
    expect(consoleLevelLabel('note')).toEqual(jasmine.objectContaining({ text: 'note' }));
    expect(consoleText(noteEntry(1, 'Login', 'clicked'))).toBe('Login — clicked');
    expect(consoleText(noteEntry(1, 'Login', ''))).toBe('Login');
    expect(consoleText(noteEntry(1, '', 'only text'))).toBe('only text');
  });
});
