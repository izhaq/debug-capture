import {
  CAPTURE_SCHEMA_VERSION,
  CaptureController,
  CaptureEntry,
  CaptureFile,
  CapturePolicy,
  CaptureSession,
  CaptureStats,
  ControlledCaptureSession,
  CreateCaptureController,
  DEFAULT_CAPTURE_POLICY,
  DebugCaptureOptions,
  EntryDraft,
  HeaderMap,
  HttpEntry,
  IsProblemEntry,
  LiveRecorder,
  MAX_PENDING_REQUESTS,
  PendingDraft,
  PendingEvent,
  PendingListener,
  PendingRequest,
  ProbeRecorder,
  Recorder,
  RecorderChange,
  RecorderChangeListener,
  SinkOptions,
  Unsubscribe,
} from './index';

/**
 * Compile-time checks for the v2 contract additions (HLD §6.4, §6.5). Most of
 * this file is about types: if a name or a shape drifts, `tsc` fails here
 * before any of the wave-2 specs (S-01 … S-04) notices.
 */

/** `true` only when A and B are the same type (not merely assignable). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its type argument is `true`. */
function assertType<T extends true>(): T | undefined {
  return undefined;
}

const NO_STATS: CaptureStats = { recorded: 0, dropped: 0, evicted: 0, failed: 0 };

const REQUEST: PendingRequest = {
  id: 7,
  t: 1_700_000_000_000,
  transport: 'fetch',
  method: 'POST',
  url: 'http://localhost/api/auth/login',
  reqHeaders: { authorization: '[redacted]' },
};

/** A minimal in-memory LiveRecorder — just enough to prove the interface is implementable. */
function fakeLiveRecorder(): LiveRecorder & {
  emitChange(change: RecorderChange): void;
  emitPending(event: PendingEvent): void;
} {
  const changes: RecorderChangeListener[] = [];
  const pendingListeners: PendingListener[] = [];
  const pending: PendingRequest[] = [REQUEST];
  return {
    record: (_draft: EntryDraft): void => undefined,
    snapshot: (): readonly CaptureEntry[] => [],
    clear: (): void => undefined,
    stats: (): CaptureStats => ({ ...NO_STATS }),
    onEntry: (): Unsubscribe => () => undefined,
    onChange(listener: RecorderChangeListener): Unsubscribe {
      changes.push(listener);
      return () => changes.splice(changes.indexOf(listener), 1);
    },
    pending: (): readonly PendingRequest[] => pending.slice(),
    onPending(listener: PendingListener): Unsubscribe {
      pendingListeners.push(listener);
      return () => pendingListeners.splice(pendingListeners.indexOf(listener), 1);
    },
    emitChange: (change) => changes.forEach((listener) => listener(change)),
    emitPending: (event) => pendingListeners.forEach((listener) => listener(event)),
  };
}

function fakeSession(recorder: LiveRecorder, isActive: () => boolean): ControlledCaptureSession {
  return {
    recorder,
    policy: DEFAULT_CAPTURE_POLICY,
    clock: { now: () => 0 },
    get active(): boolean {
      return isActive();
    },
    toJson: () => '{}',
    download: (): void => undefined,
    copy: async () => false,
    clear: (): void => undefined,
    dispose: (): void => undefined,
  };
}

const createFakeController: CreateCaptureController = (_options?: DebugCaptureOptions) => {
  let on = true;
  const listeners: Array<(on: boolean) => void> = [];
  const set = (next: boolean): void => {
    if (on !== next) {
      on = next;
      listeners.forEach((listener) => listener(on));
    }
  };
  const session = fakeSession(fakeLiveRecorder(), () => on);
  return {
    session,
    get on(): boolean {
      return on;
    },
    start: () => set(true),
    stop: () => set(false),
    onChange(listener: (on: boolean) => void): Unsubscribe {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
};

const HTTP_DRAFT: Omit<HttpEntry, 'seq' | 'requestId' | 'resBodyCapped'> = {
  kind: 'http',
  t: 2,
  transport: 'fetch',
  method: 'GET',
  url: 'http://localhost/api/big',
  status: 200,
  durationMs: 5,
  reqHeaders: {},
  resHeaders: {},
  reqBody: null,
  resBody: 'x',
  bytes: 1,
  error: null,
};

describe('capture contract v2 (HLD §6.4, §6.5)', () => {
  it('keeps the v1 file format and default policy unchanged', () => {
    // Every v2 change is additive: schemaVersion stays 1 (C-1, C-7).
    expect(CAPTURE_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_CAPTURE_POLICY).toEqual({
      maxEntries: 5000,
      maxBodyLength: 32_768,
      maxArgDepth: 6,
      redactHeaders: [
        'authorization',
        'proxy-authorization',
        'cookie',
        'set-cookie',
        'x-api-key',
        'x-auth-token',
        'x-csrf-token',
        'x-xsrf-token',
      ],
      redactJsonKeys: [
        'password',
        'passwd',
        'secret',
        'token',
        'accesstoken',
        'refreshtoken',
        'apikey',
        'authorization',
        'clientsecret',
        'idtoken',
        'privatekey',
        'sessionid',
        'sessiontoken',
        'csrftoken',
        'xsrftoken',
        'signature',
      ],
      redactBodyUrls: [],
      redactedValue: '[redacted]',
      ignoreUrls: [],
    });
    expect(Object.isFrozen(DEFAULT_CAPTURE_POLICY)).toBeTrue();
  });

  it('C-1: PendingRequest, PendingEvent and LiveRecorder.pending/onPending', () => {
    assertType<Equals<PendingRequest['reqHeaders'], HeaderMap>>();
    assertType<Equals<PendingRequest['transport'], HttpEntry['transport']>>();
    assertType<Equals<PendingEvent['type'], 'start' | 'end'>>();
    assertType<Equals<PendingListener, (event: PendingEvent) => void>>();
    assertType<Equals<ReturnType<LiveRecorder['pending']>, readonly PendingRequest[]>>();

    const recorder = fakeLiveRecorder();
    const seen: PendingEvent[] = [];
    const off = recorder.onPending((event) => seen.push(event));
    recorder.emitPending({ type: 'start', request: REQUEST });
    recorder.emitPending({ type: 'end', id: REQUEST.id });
    off();
    recorder.emitPending({ type: 'end', id: 99 });

    expect(recorder.pending()).toEqual([REQUEST]);
    expect(seen).toEqual([
      { type: 'start', request: REQUEST },
      { type: 'end', id: 7 },
    ]);
  });

  it('C-1: an end event needs the id, a start event the request', () => {
    // @ts-expect-error — `end` carries the id of the request that ended.
    const end: PendingEvent = { type: 'end' };
    // @ts-expect-error — `start` carries the whole request, not just an id.
    const start: PendingEvent = { type: 'start', id: 1 };
    const readOnly = (request: PendingRequest): void => {
      // @ts-expect-error — the recorder hands out read-only snapshots.
      request.url = 'changed';
    };

    expect([end, start, readOnly].length).toBe(3);
  });

  it('C-1, C-7: HttpEntry gains optional requestId and resBodyCapped, and drafts may carry both', () => {
    assertType<Equals<HttpEntry['requestId'], number | undefined>>();
    assertType<Equals<HttpEntry['resBodyCapped'], true | undefined>>();

    const v1Draft: EntryDraft = HTTP_DRAFT;
    const v2Draft: EntryDraft = { ...HTTP_DRAFT, requestId: 7, resBodyCapped: true };
    const stored: HttpEntry = { ...HTTP_DRAFT, seq: 1, requestId: 7, resBodyCapped: true };
    // @ts-expect-error — the flag is present-and-true or absent, never `false` (C-7).
    const notFalse: EntryDraft = { ...HTTP_DRAFT, resBodyCapped: false };

    expect(v1Draft.kind).toBe('http');
    expect(v2Draft).toEqual(jasmine.objectContaining({ requestId: 7, resBodyCapped: true }));
    expect(stored.requestId).toBe(7);
    expect(notFalse.kind).toBe('http');
  });

  it('C-1: the exported file may list pending requests', () => {
    assertType<Equals<CaptureFile['pending'], readonly PendingRequest[] | undefined>>();

    const v1File: CaptureFile = {
      schemaVersion: 1,
      capturedAt: '2026-01-01T00:00:00.000Z',
      page: 'http://localhost/',
      userAgent: 'test',
      stats: NO_STATS,
      entries: [],
    };
    const v2File: CaptureFile = { ...v1File, pending: [REQUEST] };

    expect(v2File.pending?.[0]?.id).toBe(7);
  });

  it('C-6: RecorderChange and LiveRecorder.onChange', () => {
    assertType<Equals<RecorderChange['type'], 'cleared' | 'stats'>>();
    assertType<Equals<RecorderChangeListener, (change: RecorderChange) => void>>();

    const recorder = fakeLiveRecorder();
    const seen: RecorderChange['type'][] = [];
    const off = recorder.onChange((change) => seen.push(change.type));
    recorder.emitChange({ type: 'cleared' });
    recorder.emitChange({ type: 'stats' });
    off();
    recorder.emitChange({ type: 'cleared' });

    expect(seen).toEqual(['cleared', 'stats']);
  });

  it('C-2, C-3: CaptureController hands out one ControlledCaptureSession', () => {
    assertType<Equals<CaptureController['session'], ControlledCaptureSession>>();
    assertType<Equals<ControlledCaptureSession['recorder'], LiveRecorder>>();
    assertType<Equals<ControlledCaptureSession['policy'], Readonly<CapturePolicy>>>();
    assertType<Equals<Parameters<CreateCaptureController>, [options?: DebugCaptureOptions]>>();

    const controller = createFakeController();
    const session = controller.session;
    const changes: boolean[] = [];
    controller.onChange((on) => changes.push(on));

    controller.stop();
    const activeWhenStopped = session.active;
    controller.start();

    // The v1 seams (Angular, React) take a plain CaptureSession and Recorder:
    // the controller's session must still be one, so they keep working (C-2).
    const v1Session: CaptureSession = session;
    const v1Recorder: Recorder = session.recorder;

    expect(controller.session).toBe(session);
    expect(changes).toEqual([false, true]);
    expect(activeWhenStopped).toBeFalse();
    expect(session.active).toBeTrue();
    expect(session.policy.maxEntries).toBe(5000);
    expect(v1Session.recorder).toBe(v1Recorder);
  });

  it('C-2: controller.on and the session policy are read-only', () => {
    const controller = createFakeController();
    const writes = (): void => {
      // @ts-expect-error — only start() / stop() change `on`.
      controller.on = false;
      // @ts-expect-error — the resolved policy is read-only (C-3).
      controller.session.policy.maxEntries = 1;
    };

    expect(typeof writes).toBe('function');
  });

  it('C-8: IsProblemEntry is a predicate over any entry', () => {
    assertType<Equals<IsProblemEntry, (entry: CaptureEntry) => boolean>>();

    const isProblem: IsProblemEntry = (entry) => entry.kind === 'error';

    expect(isProblem({ kind: 'error', seq: 1, t: 0, source: 'window', message: 'x', stack: null })).toBeTrue();
  });

  it('C-1: the pending cap is 200', () => {
    expect(MAX_PENDING_REQUESTS).toBe(200);
  });

  it("C-1 / C-2: a ProbeRecorder is a v1 Recorder with the probes' write side", () => {
    assertType<Equals<PendingDraft, Omit<PendingRequest, 'id'>>>();
    let nextId = 0;
    let nextSocket = 0;
    const ended: number[] = [];
    const base = fakeLiveRecorder();
    const probeSide: ProbeRecorder = {
      record: (draft) => base.record(draft),
      snapshot: () => base.snapshot(),
      clear: () => base.clear(),
      stats: () => base.stats(),
      onEntry: (listener) => base.onEntry(listener),
      startPending: (draft) => (draft.url.includes('ignored') ? null : ++nextId),
      endPending: (id) => {
        ended.push(id);
      },
      nextSocketId: () => ++nextSocket,
    };
    const v1: Recorder = probeSide;
    const draft: PendingDraft = { t: 0, transport: 'fetch', method: 'GET', url: '/a', reqHeaders: {} };

    expect(probeSide.startPending(draft)).toBe(1);
    expect(probeSide.startPending({ ...draft, url: '/ignored' })).toBeNull();
    probeSide.endPending(1);
    expect(ended).toEqual([1]);
    expect([probeSide.nextSocketId(), probeSide.nextSocketId()]).toEqual([1, 2]);
    expect(v1).toBe(probeSide);
  });

  it('C-2: DebugCaptureOptions takes the recorder to install on (S01-07)', () => {
    assertType<Equals<DebugCaptureOptions['recorder'], (LiveRecorder & ProbeRecorder) | undefined>>();
    const v1Options: DebugCaptureOptions = { policy: { maxEntries: 10 }, shortcuts: false };
    expect(v1Options.recorder).toBeUndefined();
  });

  it('C-5: SinkOptions takes a shadow root (or any node to append to)', () => {
    const host = document.createElement('div');
    const options: SinkOptions = { root: host.attachShadow({ mode: 'open' }) };
    const none: SinkOptions = {};

    expect(options.root).toBeDefined();
    expect(none.root).toBeUndefined();
  });
});
