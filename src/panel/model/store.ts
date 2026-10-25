import { CaptureEntry, IsProblemEntry, PendingRequest, Unsubscribe } from '../..';
import { PanelDataEvent, PanelDataSource } from './panel-data-source';
import { selectRows } from './selectors';
import {
  BufferState,
  EMPTY_FILTERS,
  HttpSortKey,
  ListId,
  PanelFilters,
  PanelSelection,
  PanelState,
  RowOf,
  Selected,
  isPendingRow,
} from './state';

export interface PanelStoreOptions {
  /** Read once, at creation: the initial entries, pending requests, stats, capacity, redacted value and capture state. */
  readonly source: Pick<PanelDataSource, 'snapshot' | 'pending' | 'stats' | 'capacity' | 'redactedValue' | 'capture'>;
  /** C-8: core's `isProblemEntry` — injected so the store and the launcher badge share one rule. */
  readonly isProblemEntry: IsProblemEntry;
  /** Initial filters, e.g. the chips restored from settings (§4.10). Missing parts start empty. */
  readonly filters?: { readonly [L in ListId]?: Partial<PanelFilters[L]> };
}

/**
 * A keyboard move (§4.12): `1` / `-1` = ↓ / ↑, `±n` = PageDown / PageUp by
 * `n` rows, `'first'` / `'last'` = Home / End. Clamped to the visible rows.
 */
export type SelectionMove = number | 'first' | 'last';

/**
 * The panel's state holder (§6.3): one per open panel. It never subscribes
 * by itself — the app (P4) queues the source's events and calls `apply`
 * once per frame, so this layer needs no timers.
 *
 * Every action and `apply` notifies subscribers **once**, and only when the
 * state really changed (a no-op notifies nobody).
 */
export interface PanelStore {
  /** The current state: immutable, deeply frozen. */
  getState(): PanelState;
  /** Called with the new state after each change. A throwing listener is isolated. */
  subscribe(listener: (state: PanelState) => void): Unsubscribe;
  /** Applies a batch of source events, oldest first. O(1) amortised work per event, then one copy of the changed lists. */
  apply(events: readonly PanelDataEvent[]): void;
  /** Merges `patch` into the list's filter. Chip arrays: `[]` = "All". */
  setFilter<L extends ListId>(list: L, patch: Partial<PanelFilters[L]>): void;
  /** Back to no filter — the "Clear filters" button of the no-match state (§4.11). */
  clearFilters(list: ListId): void;
  select<L extends ListId>(list: L, row: RowOf[L]): void;
  clearSelection(list: ListId): void;
  /** Moves the selection within the list's visible (filtered) rows. With nothing selected, down starts at the first row and up at the last. */
  moveSelection(list: ListId, move: SelectionMove): void;
  /** Which socket's messages the WebSocket list shows. Clears the message selection. */
  selectConnection(socketId: number | 'all'): void;
  /**
   * A click on an HTTP column header (`D-18`): a new column sorts ascending,
   * the same column then descending, then back to start order (`null`).
   */
  setHttpSort(key: HttpSortKey): void;
  /** Freezes the visible lists (`D-19`); counts and the status bar keep updating. */
  pause(): void;
  /** Shows everything that arrived while paused. */
  resume(): void;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** Compaction threshold: the dead prefix of the buffer array is dropped once it is this long and half the array. */
const COMPACT_AT = 1024;

export function createPanelStore(options: PanelStoreOptions): PanelStore {
  const { source } = options;
  /** C-9: changes with a `capacity` event. `Infinity` = No limit. */
  let capacity = Math.max(1, Math.floor(source.capacity()));

  // The buffer mirror: `buf[head…]`, oldest first. Evicting moves `head`
  // (O(1)); the dead prefix is cut off now and then (amortised O(1)).
  let buf: CaptureEntry[] = [];
  let head = 0;
  let lastSeq = 0;
  let problems = 0;
  /** Entries counted as problems, so an eviction never asks the rule again. */
  const problemEntries = new WeakSet<CaptureEntry>();
  const stats: Writable<Pick<BufferState, 'recorded' | 'dropped' | 'evicted' | 'failed'>> = { ...source.stats() };
  const livePending = new Map<number, PendingRequest>();

  // Pause: the view is the buffer's entries up to `pauseSeq` that are still
  // in it — always a prefix of the buffer, `viewCount` long. A pending HTTP
  // row already on screen is replaced, when it finishes, by `shownAfterPause`.
  let pauseSeq = 0;
  let viewCount = 0;
  let arrived = 0;
  let shownAfterPause: CaptureEntry[] = [];

  const isProblem = (entry: CaptureEntry): boolean => {
    try {
      return options.isProblemEntry(entry) === true;
    } catch {
      return false;
    }
  };

  const addEntry = (entry: CaptureEntry): void => {
    buf.push(entry);
    lastSeq = entry.seq;
    if (isProblem(entry)) {
      problemEntries.add(entry);
      problems++;
    }
  };

  const snapshot = source.snapshot();
  for (const entry of snapshot.length > capacity ? snapshot.slice(snapshot.length - capacity) : snapshot) {
    addEntry(entry);
  }
  for (const request of source.pending()) livePending.set(request.id, request);

  const listeners = new Set<(state: PanelState) => void>();

  let state: PanelState = Object.freeze({
    entries: Object.freeze(buf.slice()),
    pending: Object.freeze(Array.from(livePending.values())),
    buffer: bufferState(),
    captureOn: source.capture.on,
    redactedValue: source.redactedValue(),
    paused: false,
    newSincePause: 0,
    filters: Object.freeze({
      http: makeFilter(EMPTY_FILTERS.http, options.filters?.http ?? {}),
      ws: makeFilter(EMPTY_FILTERS.ws, options.filters?.ws ?? {}),
      console: makeFilter(EMPTY_FILTERS.console, options.filters?.console ?? {}),
    }),
    httpSort: null,
    selection: Object.freeze({ http: null, ws: null, console: null }),
    wsConnection: 'all',
  });

  function bufferState(): BufferState {
    return Object.freeze({ used: buf.length - head, capacity, problems, ...stats });
  }

  /** Replaces the state when any part differs, freezes it, and notifies once. */
  function commit(patch: Partial<PanelState>): void {
    const keys = Object.keys(patch) as (keyof PanelState)[];
    if (keys.every((key) => patch[key] === state[key])) return;
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch {
        // A view bug must not stop the other views or reach the host (NFR-REL-01).
      }
    });
  }

  function withSelection<L extends ListId>(
    selection: PanelSelection,
    list: L,
    value: Selected<RowOf[L]> | null,
  ): PanelSelection {
    return Object.freeze({ ...selection, [list]: value === null ? null : Object.freeze(value) }) as PanelSelection;
  }

  /** The frozen prefix, plus finished requests that were already pending on screen. */
  function pausedViewEntries(): CaptureEntry[] {
    const frozen = buf.slice(head, head + viewCount);
    if (shownAfterPause.length === 0) return frozen;
    const live = new Set(buf.slice(head));
    const extra = shownAfterPause.filter((item) => live.has(item));
    if (extra.length !== shownAfterPause.length) shownAfterPause = extra;
    return extra.length === 0 ? frozen : frozen.concat(extra);
  }

  function apply(events: readonly PanelDataEvent[]): void {
    if (events.length === 0) return;
    const paused = state.paused;
    let selection = state.selection;
    let captureOn = state.captureOn;
    let liveChanged = false;
    let viewChanged = false;
    let pendingChanged = false;
    let pausedPending = state.pending;

    /** Drops the oldest entries the buffer no longer holds, like the recorder (§4.4). */
    const evictBeyondCapacity = (): void => {
      while (buf.length - head > capacity) {
        const old = buf[head] as CaptureEntry;
        head++;
        stats.evicted++;
        liveChanged = true;
        if (problemEntries.has(old)) problems--;
        if (paused && old.seq <= pauseSeq) {
          viewCount--;
          viewChanged = true;
        }
        if (shownAfterPause.includes(old)) {
          shownAfterPause = shownAfterPause.filter((item) => item !== old);
          viewChanged = true;
        }
        markRemoved(old);
        if (head >= COMPACT_AT && head * 2 >= buf.length) {
          buf = buf.slice(head);
          head = 0;
        }
      }
    };

    const markRemoved = (row: unknown): void => {
      for (const list of ['http', 'ws', 'console'] as const) {
        const sel = selection[list];
        if (sel !== null && !sel.removed && sel.row === row) {
          selection = withSelection(selection, list, { row: sel.row, removed: true });
        }
      }
    };

    for (const event of events) {
      switch (event.type) {
        case 'entry': {
          const entry = event.entry;
          if (entry.seq <= lastSeq) break;
          addEntry(entry);
          stats.recorded++;
          liveChanged = true;
          if (paused) {
            const requestId = entry.kind === 'http' ? entry.requestId : undefined;
            const onScreen = requestId !== undefined && pausedPending.some((row) => row.id === requestId);
            if (onScreen) {
              // Same row, already visible: show the result. It is not a new arrival.
              pausedPending = Object.freeze(pausedPending.filter((row) => row.id !== requestId));
              shownAfterPause.push(entry);
              viewChanged = true;
            } else {
              arrived++;
            }
          }
          evictBeyondCapacity();
          const sel = selection.http;
          if (entry.kind === 'http' && sel !== null && isPendingRow(sel.row) && sel.row.id === entry.requestId) {
            // The selected request finished: the detail follows it to its entry.
            selection = withSelection<'http'>(selection, 'http', { row: entry, removed: false });
          }
          break;
        }
        case 'pending-start':
          if (livePending.has(event.request.id)) break;
          livePending.set(event.request.id, event.request);
          pendingChanged = true;
          break;
        case 'pending-end': {
          const request = livePending.get(event.id);
          if (request === undefined) break;
          livePending.delete(event.id);
          pendingChanged = true;
          markRemoved(request);
          break;
        }
        case 'cleared':
          buf = [];
          head = 0;
          problems = 0;
          stats.recorded = stats.dropped = stats.evicted = stats.failed = 0;
          livePending.clear();
          liveChanged = pendingChanged = true;
          if (paused) {
            viewCount = 0;
            arrived = 0;
            viewChanged = true;
            pausedPending = Object.freeze([]);
            shownAfterPause = [];
          }
          // Clear is the user's own act: every open detail closes (only an
          // evicted entry keeps its detail, with the "removed" note).
          for (const list of ['http', 'ws', 'console'] as const) {
            if (selection[list] !== null) selection = withSelection(selection, list, null);
          }
          break;
        case 'stats':
          Object.assign(stats, {
            recorded: event.stats.recorded,
            dropped: event.stats.dropped,
            evicted: event.stats.evicted,
            failed: event.stats.failed,
          });
          break;
        case 'capture':
          captureOn = event.on;
          break;
        case 'capacity':
          capacity = Math.max(1, Math.floor(event.capacity));
          evictBeyondCapacity();
          break;
      }
    }

    const patch: Writable<Partial<PanelState>> = { selection, captureOn, buffer: sameBuffer(bufferState()) };
    if (paused) {
      if (viewChanged) patch.entries = Object.freeze(pausedViewEntries());
      patch.pending = pausedPending;
      patch.newSincePause = Math.min(arrived, capacity);
    } else {
      if (liveChanged) patch.entries = Object.freeze(buf.slice(head));
      if (pendingChanged) patch.pending = Object.freeze(Array.from(livePending.values()));
    }
    commit(patch);
  }

  /** Keeps the old buffer object when nothing in it changed, so `state.buffer` is stable. */
  function sameBuffer(next: BufferState): BufferState {
    const old = state.buffer;
    const keys = Object.keys(next) as (keyof BufferState)[];
    return keys.every((key) => next[key] === old[key]) ? old : next;
  }

  function setFilter<L extends ListId>(list: L, patch: Partial<PanelFilters[L]>): void {
    const old = state.filters[list];
    const next = makeFilter(old, patch);
    if (sameFilter(old, next)) return;
    commit({ filters: Object.freeze({ ...state.filters, [list]: next }) as PanelFilters });
  }

  function select<L extends ListId>(list: L, row: RowOf[L]): void {
    const sel = state.selection[list];
    if (sel !== null && sel.row === row && !sel.removed) return;
    commit({ selection: withSelection(state.selection, list, { row, removed: false }) });
  }

  function moveSelection(list: ListId, move: SelectionMove): void {
    const rows: readonly RowOf[ListId][] = selectRows(state, list);
    if (rows.length === 0) return;
    const sel: Selected<RowOf[ListId]> | null = state.selection[list];
    const current = sel !== null && !sel.removed ? rows.indexOf(sel.row) : -1;
    let next: number;
    if (move === 'first') next = 0;
    else if (move === 'last') next = rows.length - 1;
    else if (current === -1) next = move < 0 ? rows.length - 1 : 0;
    else next = Math.min(rows.length - 1, Math.max(0, current + Math.trunc(move)));
    select(list, rows[next] as RowOf[ListId]);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply,
    setFilter,
    clearFilters: (list) => setFilter(list, EMPTY_FILTERS[list]),
    select,
    clearSelection(list) {
      if (state.selection[list] === null) return;
      commit({ selection: withSelection(state.selection, list, null) });
    },
    moveSelection,
    selectConnection(socketId) {
      if (state.wsConnection === socketId) return;
      commit({ wsConnection: socketId, selection: withSelection(state.selection, 'ws', null) });
    },
    setHttpSort(key) {
      const old = state.httpSort;
      if (old === null || old.key !== key) commit({ httpSort: Object.freeze({ key, dir: 'asc' }) });
      else commit({ httpSort: old.dir === 'asc' ? Object.freeze({ key, dir: 'desc' }) : null });
    },
    pause() {
      if (state.paused) return;
      pauseSeq = lastSeq;
      viewCount = buf.length - head;
      arrived = 0;
      shownAfterPause = [];
      commit({ paused: true, newSincePause: 0 });
    },
    resume() {
      if (!state.paused) return;
      shownAfterPause = [];
      commit({
        paused: false,
        newSincePause: 0,
        entries: Object.freeze(buf.slice(head)),
        pending: Object.freeze(Array.from(livePending.values())),
      });
    },
  };
}

/** `base` with `patch` merged in; chip arrays are copied and frozen so a caller's array never leaks into the state. */
function makeFilter<F extends object>(base: F, patch: Partial<F>): F {
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    next[key] = Array.isArray(value) ? Object.freeze(value.slice()) : value;
  }
  return Object.freeze(next) as F;
}

function sameFilter(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Object.keys(right).every((key) => {
    const x = left[key];
    const y = right[key];
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => v === y[i]);
    return x === y;
  });
}
