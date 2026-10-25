/**
 * Fakes and entry builders for the P1 specs, built only on the contract
 * types (never on `ProbeRecorder` or the real recorder), so the model is
 * proven against the contract the S-01 recorder must meet. A `.spec.ts` file
 * so the build never ships it.
 */
import {
  BufferUsage,
  CaptureController,
  CaptureEntry,
  CapturePolicy,
  CaptureStats,
  ControlledCaptureSession,
  DEFAULT_CAPTURE_POLICY,
  EntryDraft,
  EntryListener,
  ErrorEntry,
  HttpEntry,
  LiveRecorder,
  LogEntry,
  PendingListener,
  PendingRequest,
  RecorderChangeListener,
  Unsubscribe,
  WebSocketEntry,
} from '../..';
import { PanelDataSource } from './panel-data-source';

/** Plain-object entries: the real recorder freezes them, so the builders do too. */
export function httpEntry(seq: number, extra: Partial<Omit<HttpEntry, 'kind' | 'seq'>> = {}): HttpEntry {
  return Object.freeze({
    kind: 'http',
    seq,
    t: 1_000 + seq,
    transport: 'fetch',
    method: 'GET',
    url: `https://app.test/api/items/${seq}?page=1`,
    status: 200,
    durationMs: 12,
    reqHeaders: {},
    resHeaders: {},
    reqBody: null,
    resBody: null,
    bytes: 100,
    error: null,
    ...extra,
  });
}

export function wsEntry(seq: number, extra: Partial<Omit<WebSocketEntry, 'kind' | 'seq'>> = {}): WebSocketEntry {
  return Object.freeze({
    kind: 'ws',
    seq,
    t: 1_000 + seq,
    socketId: 1,
    url: 'wss://app.test/ws',
    event: 'receive',
    opcode: 'text',
    bytes: 5,
    data: 'hello',
    code: null,
    ...extra,
  });
}

export function logEntry(seq: number, extra: Partial<Omit<LogEntry, 'kind' | 'seq'>> = {}): LogEntry {
  return Object.freeze({ kind: 'log', seq, t: 1_000 + seq, level: 'log', args: ['message', seq], ...extra });
}

export function errorEntry(seq: number, extra: Partial<Omit<ErrorEntry, 'kind' | 'seq'>> = {}): ErrorEntry {
  return Object.freeze({
    kind: 'error',
    seq,
    t: 1_000 + seq,
    source: 'window',
    message: `Boom ${seq}`,
    stack: null,
    ...extra,
  });
}

export function pendingRequest(id: number, extra: Partial<Omit<PendingRequest, 'id'>> = {}): PendingRequest {
  return Object.freeze({
    id,
    t: 500 + id,
    transport: 'xhr',
    method: 'POST',
    url: `https://app.test/api/slow/${id}`,
    reqHeaders: {},
    ...extra,
  });
}

/** The S-01 problem rule (`D-21`), restated for the specs. */
export function problemRule(entry: CaptureEntry): boolean {
  switch (entry.kind) {
    case 'error':
      return true;
    case 'http':
      return entry.error !== null || (entry.status !== null && entry.status >= 500);
    case 'ws':
      return entry.event === 'error';
    default:
      return false;
  }
}

/** A `LiveRecorder` the spec drives by hand. Listeners are called directly (no isolation), like a careless recorder. */
export class FakeRecorder implements LiveRecorder {
  entries: CaptureEntry[] = [];
  pendingList: PendingRequest[] = [];
  statsValue: CaptureStats = { recorded: 0, dropped: 0, evicted: 0, failed: 0 };
  readonly entryListeners = new Set<EntryListener>();
  readonly pendingListeners = new Set<PendingListener>();
  readonly changeListeners = new Set<RecorderChangeListener>();

  record(_draft: EntryDraft): void {
    throw new Error('the panel never records');
  }
  snapshot(): readonly CaptureEntry[] {
    return this.entries.slice();
  }
  clear(): void {
    this.entries = [];
    this.pendingList = [];
    this.statsValue = { recorded: 0, dropped: 0, evicted: 0, failed: 0 };
    this.changeListeners.forEach((l) => l({ type: 'cleared' }));
  }
  stats(): CaptureStats {
    return { ...this.statsValue };
  }
  pending(): readonly PendingRequest[] {
    return this.pendingList.slice();
  }
  onEntry(listener: EntryListener): Unsubscribe {
    return subscribe(this.entryListeners, listener);
  }
  onPending(listener: PendingListener): Unsubscribe {
    return subscribe(this.pendingListeners, listener);
  }
  onChange(listener: RecorderChangeListener): Unsubscribe {
    return subscribe(this.changeListeners, listener);
  }
  capacityValue = DEFAULT_CAPTURE_POLICY.maxEntries;
  usage(): BufferUsage {
    return { entries: this.entries.length, capacity: this.capacityValue, bytes: 0, problems: 0 };
  }
  /** C-9: trims like the real recorder and announces `capacity`. */
  setCapacity(capacity: number): void {
    this.capacityValue = capacity;
    if (this.entries.length > capacity) this.entries = this.entries.slice(this.entries.length - capacity);
    this.changeListeners.forEach((l) => l({ type: 'capacity' }));
  }

  /** Stores `entry` and tells the entry listeners. */
  push(entry: CaptureEntry): void {
    this.entries.push(entry);
    this.statsValue = { ...this.statsValue, recorded: this.statsValue.recorded + 1 };
    this.entryListeners.forEach((l) => l(entry));
  }
  start(request: PendingRequest): void {
    this.pendingList.push(request);
    this.pendingListeners.forEach((l) => l({ type: 'start', request }));
  }
  end(id: number): void {
    this.pendingList = this.pendingList.filter((p) => p.id !== id);
    this.pendingListeners.forEach((l) => l({ type: 'end', id }));
  }
  drop(): void {
    this.statsValue = { ...this.statsValue, dropped: this.statsValue.dropped + 1 };
    this.changeListeners.forEach((l) => l({ type: 'stats' }));
  }
  listenerCount(): number {
    return this.entryListeners.size + this.pendingListeners.size + this.changeListeners.size;
  }
}

function subscribe<T>(set: Set<T>, listener: T): Unsubscribe {
  set.add(listener);
  return () => set.delete(listener);
}

export interface FakeCapture {
  readonly controller: CaptureController;
  readonly recorder: FakeRecorder;
  readonly controllerListeners: Set<(on: boolean) => void>;
  readonly calls: string[];
}

/** A `CaptureController` on a `FakeRecorder`. `calls` logs the session and controller calls. */
export function fakeCapture(policy: Partial<CapturePolicy> = {}): FakeCapture {
  const recorder = new FakeRecorder();
  const calls: string[] = [];
  const controllerListeners = new Set<(on: boolean) => void>();
  let on = true;
  const setOn = (next: boolean): void => {
    if (next === on) return;
    on = next;
    controllerListeners.forEach((l) => l(on));
  };
  const session: ControlledCaptureSession = {
    recorder,
    policy: Object.freeze({ ...DEFAULT_CAPTURE_POLICY, ...policy }),
    clock: { now: () => Date.UTC(2026, 9, 15, 14, 3, 27, 412) },
    get active(): boolean {
      return on;
    },
    toJson: () => `{"entries":${recorder.entries.length}}`,
    download: (): void => {
      calls.push('session.download');
    },
    copy: async (): Promise<boolean> => {
      calls.push('session.copy');
      return true;
    },
    clear: (): void => {
      calls.push('session.clear');
      recorder.clear();
    },
    addNote: (title: string, text = ''): void => {
      calls.push(`session.addNote ${title} ${text}`);
    },
    dispose: (): void => setOn(false),
  };
  const controller: CaptureController = {
    session,
    get on(): boolean {
      return on;
    },
    start: () => {
      calls.push('start');
      setOn(true);
    },
    stop: () => {
      calls.push('stop');
      setOn(false);
    },
    onChange: (listener) => subscribe(controllerListeners, listener),
  };
  return { controller, recorder, controllerListeners, calls };
}

/** A `PanelDataSource` over plain arrays, for store specs that need no controller. */
export function fakeSource(
  init: { entries?: readonly CaptureEntry[]; pending?: readonly PendingRequest[]; capacity?: number } = {},
): PanelDataSource {
  return {
    snapshot: () => init.entries ?? [],
    pending: () => init.pending ?? [],
    stats: () => ({ recorded: (init.entries ?? []).length, dropped: 0, evicted: 0, failed: 0 }),
    capacity: () => init.capacity ?? 5000,
    redactedValue: () => '[redacted]',
    subscribe: () => () => undefined,
    clear: () => undefined,
    exportJson: () => '{}',
    download: () => undefined,
    copyText: async () => true,
    capture: { on: true, start: () => undefined, stop: () => undefined },
  };
}

describe('P1 spec fakes', () => {
  it('the fake recorder and controller follow the contract they stand in for', () => {
    const { controller, recorder } = fakeCapture({ maxEntries: 3 });
    const seen: number[] = [];
    const off = recorder.onEntry((e) => seen.push(e.seq));
    recorder.push(httpEntry(1));
    off();
    recorder.push(httpEntry(2));
    controller.stop();
    expect(seen).toEqual([1]);
    expect(controller.session.active).toBe(false);
    expect(controller.session.policy.maxEntries).toBe(3);
    expect(problemRule(httpEntry(3, { status: 404 }))).toBe(false);
    expect(problemRule(logEntry(4, { level: 'error' }))).toBe(false);
  });
});
