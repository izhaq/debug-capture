import {
  CapturePolicy,
  DEFAULT_CAPTURE_POLICY,
  HttpEntry,
  MAX_PENDING_REQUESTS,
  PendingDraft,
  PendingEvent,
  RecorderChange,
  WebSocketEntry,
} from '../contract';
import { resolvePolicy } from './policy';
import { createRecorder } from './recorder';

/**
 * The v2 side of the recorder (HLD C-1, C-2, C-6): pending requests, change
 * events and the socket-id counter. The v1 behaviour stays covered by
 * `recorder.spec.ts`, which is unchanged.
 */

type HttpDraft = Omit<HttpEntry, 'seq'>;

const SECRET = 'S3CRET-VALUE';

function pendingDraft(overrides: Partial<PendingDraft> = {}): PendingDraft {
  return {
    t: 100,
    transport: 'fetch',
    method: 'post',
    url: 'http://localhost/api/items',
    reqHeaders: {},
    ...overrides,
  };
}

function finished(start: PendingDraft, requestId: number | null, overrides: Partial<HttpDraft> = {}): HttpDraft {
  return {
    kind: 'http',
    t: start.t,
    transport: start.transport,
    method: start.method,
    url: start.url,
    status: 200,
    durationMs: 5,
    reqHeaders: start.reqHeaders,
    resHeaders: {},
    reqBody: null,
    resBody: null,
    bytes: 0,
    error: null,
    ...(requestId === null ? {} : { requestId }),
    ...overrides,
  };
}

function recorderWith(overrides: Partial<CapturePolicy> = {}) {
  return createRecorder(resolvePolicy(overrides));
}

/** One log of every event, in delivery order, across both channels. */
function watch(recorder: ReturnType<typeof recorderWith>) {
  const log: string[] = [];
  recorder.onPending((event) => log.push(event.type === 'start' ? `start ${event.request.id}` : `end ${event.id}`));
  recorder.onChange((change) => log.push(change.type));
  recorder.onEntry((entry) => log.push(`entry ${entry.seq}`));
  return log;
}

describe('createRecorder — v2 (pending, change events, socket ids)', () => {
  describe('pending requests (C-1)', () => {
    it('lists started requests oldest first with ids from 1, a new frozen array each call', () => {
      const recorder = recorderWith();
      const first = recorder.startPending(pendingDraft({ url: 'http://localhost/a' }));
      const second = recorder.startPending(pendingDraft({ url: 'http://localhost/b', transport: 'xhr' }));

      expect([first, second]).toEqual([1, 2]);
      const list = recorder.pending();
      expect(list).toEqual([
        { id: 1, t: 100, transport: 'fetch', method: 'POST', url: 'http://localhost/a', reqHeaders: {} },
        { id: 2, t: 100, transport: 'xhr', method: 'POST', url: 'http://localhost/b', reqHeaders: {} },
      ]);
      expect(recorder.pending()).not.toBe(list);
      expect(Object.isFrozen(list[0])).toBeTrue();
      expect(Object.isFrozen(list[0].reqHeaders)).toBeTrue();
    });

    it('keeps only the contract fields of a pending draft', () => {
      const recorder = recorderWith();
      const draft = { ...pendingDraft(), reqBody: `{"password":"${SECRET}"}` } as PendingDraft;
      recorder.startPending(draft);

      expect(Object.keys(recorder.pending()[0]).sort()).toEqual([
        'id',
        'method',
        'reqHeaders',
        't',
        'transport',
        'url',
      ]);
      expect(JSON.stringify(recorder.pending())).not.toContain(SECRET);
    });

    it('redacts the URL and headers exactly like the stored entry', () => {
      const recorder = recorderWith({ redactHeaders: [...DEFAULT_CAPTURE_POLICY.redactHeaders, 'x-team-key'] });
      const draft = pendingDraft({
        url: `http://localhost/api/login?user=op&access_token=${SECRET}&next=/cb?password=${SECRET}`,
        reqHeaders: {
          authorization: `Bearer ${SECRET}`,
          cookie: `sid=${SECRET}`,
          'x-access-token': SECRET,
          'x-team-key': SECRET,
          'content-type': 'application/json',
        },
      });

      const id = recorder.startPending(draft);
      const [pending] = recorder.pending();
      recorder.record(finished(draft, id));
      const [stored] = recorder.snapshot() as [HttpEntry];

      expect(JSON.stringify(pending)).not.toContain(SECRET);
      expect(pending.url).toBe(stored.url);
      expect(pending.reqHeaders).toEqual(stored.reqHeaders);
      expect(pending.method).toBe(stored.method);
      expect(pending.reqHeaders['content-type']).toBe('application/json');
    });

    it('truncates the URL and header values like the stored entry, redacting a cut parameter too', () => {
      const recorder = recorderWith({ maxBodyLength: 40 });
      const draft = pendingDraft({
        url: `http://localhost/a?x=1&token=${SECRET}${'y'.repeat(100)}`,
        reqHeaders: { 'x-trace': 'v'.repeat(100), authorization: SECRET },
      });

      const id = recorder.startPending(draft);
      const [pending] = recorder.pending();
      recorder.record(finished(draft, id));
      const [stored] = recorder.snapshot() as [HttpEntry];

      expect(JSON.stringify(pending)).not.toContain(SECRET.slice(0, 4));
      expect(pending.url).toBe(stored.url);
      expect(pending.reqHeaders).toEqual(stored.reqHeaders);
      expect(pending.url.length).toBeLessThan(draft.url.length);
    });

    it('never lists an ignored URL, returns null and counts nothing', () => {
      const recorder = recorderWith({ ignoreUrls: [/\/health/] });
      const log = watch(recorder);

      expect(recorder.startPending(pendingDraft({ url: `http://localhost/health?token=${SECRET}` }))).toBeNull();

      expect(recorder.pending()).toEqual([]);
      expect(log).toEqual([]);
      expect(recorder.stats()).toEqual({ recorded: 0, dropped: 0, evicted: 0, failed: 0 });
    });

    it('does not run sample() at start', () => {
      const sample = jasmine.createSpy('sample').and.returnValue(false);
      const recorder = recorderWith({ sample });

      expect(recorder.startPending(pendingDraft())).toBe(1);
      expect(sample).not.toHaveBeenCalled();
    });

    it(`drops the oldest beyond ${MAX_PENDING_REQUESTS}, with an end event before the new start`, () => {
      const recorder = recorderWith();
      for (let i = 0; i < MAX_PENDING_REQUESTS; i++) recorder.startPending(pendingDraft());
      const log = watch(recorder);

      const id = recorder.startPending(pendingDraft());

      expect(id).toBe(MAX_PENDING_REQUESTS + 1);
      expect(log).toEqual(['end 1', `start ${MAX_PENDING_REQUESTS + 1}`]);
      const ids = recorder.pending().map((p) => p.id);
      expect(ids.length).toBe(MAX_PENDING_REQUESTS);
      expect(ids[0]).toBe(2);
      expect(ids[ids.length - 1]).toBe(MAX_PENDING_REQUESTS + 1);
    });

    it('record() of the finished draft ends it, before the entry is announced, and keeps requestId', () => {
      const recorder = recorderWith();
      const log = watch(recorder);
      const draft = pendingDraft();

      const id = recorder.startPending(draft);
      recorder.record(finished(draft, id));

      expect(log).toEqual(['start 1', 'end 1', 'entry 1']);
      expect(recorder.pending()).toEqual([]);
      expect((recorder.snapshot()[0] as HttpEntry).requestId).toBe(1);
    });

    it('ends it when the finished draft is sampled out', () => {
      const recorder = recorderWith({ sample: (d) => d.kind !== 'http' });
      const log = watch(recorder);
      const draft = pendingDraft();

      recorder.record(finished(draft, recorder.startPending(draft)));

      expect(log).toEqual(['start 1', 'end 1', 'stats']);
      expect(recorder.pending()).toEqual([]);
      expect(recorder.stats().dropped).toBe(1);
    });

    it('ends it when the finished draft fails while recording', () => {
      const recorder = recorderWith();
      const log = watch(recorder);
      const draft = pendingDraft();
      const id = recorder.startPending(draft);

      recorder.record(finished(draft, id, { method: null as unknown as string }));

      expect(log).toEqual(['start 1', 'end 1', 'stats']);
      expect(recorder.pending()).toEqual([]);
      expect(recorder.stats().failed).toBe(1);
    });

    it('ends it when the finished draft is ignored', () => {
      const recorder = recorderWith({ ignoreUrls: [/\/late-ignored/] });
      const log = watch(recorder);
      const draft = pendingDraft();
      const id = recorder.startPending(draft);

      recorder.record(finished(draft, id, { url: 'http://localhost/late-ignored' }));

      expect(log).toEqual(['start 1', 'end 1', 'stats']);
      expect(recorder.pending()).toEqual([]);
    });

    it('endPending is idempotent and ignores unknown ids', () => {
      const recorder = recorderWith();
      const id = recorder.startPending(pendingDraft()) as number;
      const log = watch(recorder);

      recorder.endPending(id);
      recorder.endPending(id);
      recorder.endPending(999);

      expect(log).toEqual([`end ${id}`]);
      expect(recorder.pending()).toEqual([]);
    });

    it('clear() ends every pending request, oldest first, then announces cleared', () => {
      const recorder = recorderWith();
      recorder.startPending(pendingDraft());
      recorder.startPending(pendingDraft());
      recorder.record(finished(pendingDraft(), null));
      const log = watch(recorder);

      recorder.clear();

      expect(log).toEqual(['end 1', 'end 2', 'cleared']);
      expect(recorder.pending()).toEqual([]);
      expect(recorder.snapshot()).toEqual([]);
    });

    it('a request cleared while in flight is still stored when it finishes, with no second end', () => {
      const recorder = recorderWith();
      const draft = pendingDraft();
      const id = recorder.startPending(draft);
      recorder.clear();
      const log = watch(recorder);

      recorder.record(finished(draft, id));

      expect(log).toEqual(['entry 1']);
      expect((recorder.snapshot()[0] as HttpEntry).requestId).toBe(id as number);
    });

    it('ids keep counting after clear()', () => {
      const recorder = recorderWith();
      recorder.startPending(pendingDraft());
      recorder.clear();
      expect(recorder.startPending(pendingDraft())).toBe(2);
    });

    it('freezes events, so one listener cannot change what the next one sees', () => {
      const recorder = recorderWith();
      const seen: PendingEvent[] = [];
      recorder.onPending((event) => {
        (event as { type: string }).type = 'tampered';
      });
      recorder.onPending((event) => seen.push(event));

      recorder.endPending(recorder.startPending(pendingDraft()) as number);

      expect(seen.map((e) => e.type)).toEqual(['start', 'end']);
      expect(Object.isFrozen(seen[0])).toBeTrue();
    });

    it('never throws from startPending; counts the failure and returns null', () => {
      const recorder = recorderWith();
      const log = watch(recorder);

      const id = recorder.startPending(pendingDraft({ method: undefined as unknown as string }));

      expect(id).toBeNull();
      expect(recorder.pending()).toEqual([]);
      expect(recorder.stats().failed).toBe(1);
      expect(log).toEqual(['stats']);
    });
  });

  describe('stored HTTP entries (C-1, C-7)', () => {
    it('keeps requestId and resBodyCapped: true; v1 drafts store neither key', () => {
      const recorder = recorderWith();
      recorder.record(finished(pendingDraft(), 7, { resBodyCapped: true }));
      recorder.record(finished(pendingDraft(), null));
      recorder.record({ ...finished(pendingDraft(), null), resBodyCapped: false } as unknown as HttpDraft);

      const [capped, plain, falseFlag] = recorder.snapshot() as HttpEntry[];
      expect(capped.requestId).toBe(7);
      expect(capped.resBodyCapped).toBeTrue();
      expect('requestId' in plain).toBeFalse();
      expect('resBodyCapped' in plain).toBeFalse();
      expect('resBodyCapped' in falseFlag).toBeFalse();
      expect(Object.isFrozen(capped)).toBeTrue();
    });
  });

  describe('change events (C-6)', () => {
    it('announces stats on a drop and on a failure, never for a plain stored entry', () => {
      const recorder = recorderWith({
        ignoreUrls: [/ignored/],
        sample: (d) => !(d.kind === 'log' && d.args[0] === 'drop'),
      });
      const changes: RecorderChange[] = [];
      recorder.onChange((change) => changes.push(change));

      recorder.record({ kind: 'log', t: 1, level: 'log', args: ['kept'] });
      expect(changes).toEqual([]);

      recorder.record(finished(pendingDraft({ url: 'http://localhost/ignored' }), null));
      recorder.record({ kind: 'log', t: 1, level: 'log', args: ['drop'] });
      recorder.record({ kind: 'nonsense' } as unknown as HttpDraft);

      expect(changes).toEqual([{ type: 'stats' }, { type: 'stats' }, { type: 'stats' }]);
      expect(recorder.stats()).toEqual({ recorded: 1, dropped: 2, evicted: 0, failed: 1 });
    });

    it('announces stats when a throwing sampler counts a failure', () => {
      const recorder = recorderWith({
        sample: () => {
          throw new Error('sampler bug');
        },
      });
      const log = watch(recorder);

      recorder.record({ kind: 'log', t: 1, level: 'log', args: ['x'] });

      expect(log).toEqual(['stats', 'entry 1']);
      expect(recorder.stats().failed).toBe(1);
    });

    it('isolates a throwing listener on every channel, and a failing listener is not a failed draft', () => {
      const recorder = recorderWith();
      const boom = () => {
        throw new Error('listener bug');
      };
      recorder.onChange(boom);
      recorder.onPending(boom);
      recorder.onEntry(boom);
      const log = watch(recorder);
      const draft = pendingDraft();

      recorder.record(finished(draft, recorder.startPending(draft)));
      recorder.clear();

      expect(log).toEqual(['start 1', 'end 1', 'entry 1', 'cleared']);
      expect(recorder.stats().failed).toBe(0);
    });

    it('unsubscribe stops each channel and is idempotent', () => {
      const recorder = recorderWith();
      const seen: string[] = [];
      const offChange = recorder.onChange(() => seen.push('change'));
      const offPending = recorder.onPending(() => seen.push('pending'));

      offChange();
      offChange();
      offPending();
      offPending();
      recorder.startPending(pendingDraft());
      recorder.clear();

      expect(seen).toEqual([]);
    });

    it('delivers events raised inside a listener after the current one, so every listener sees them in order', () => {
      const recorder = recorderWith();
      const first: string[] = [];
      const second: string[] = [];
      recorder.onPending((event) => {
        first.push(event.type);
        // A listener that clears on start: the end it causes must not overtake the start.
        if (event.type === 'start') recorder.clear();
      });
      recorder.onPending((event) => second.push(event.type));

      recorder.startPending(pendingDraft());

      expect(first).toEqual(['start', 'end']);
      expect(second).toEqual(['start', 'end']);
      expect(recorder.pending()).toEqual([]);
    });

    it('keeps entries in seq order for every listener when a listener records', () => {
      const recorder = recorderWith();
      const first: number[] = [];
      const second: number[] = [];
      recorder.onEntry((entry) => {
        first.push(entry.seq);
        if (entry.seq === 1) recorder.record({ kind: 'log', t: 1, level: 'log', args: ['nested'] });
      });
      recorder.onEntry((entry) => second.push(entry.seq));

      recorder.record({ kind: 'log', t: 1, level: 'log', args: ['outer'] });

      expect(first).toEqual([1, 2]);
      expect(second).toEqual([1, 2]);
    });
  });

  describe('socket ids (C-2)', () => {
    it('counts from 1 for the life of the recorder, across clear()', () => {
      const recorder = recorderWith();
      expect([recorder.nextSocketId(), recorder.nextSocketId()]).toEqual([1, 2]);
      recorder.clear();
      expect(recorder.nextSocketId()).toBe(3);
    });

    it('stores the socket id the probe took', () => {
      const recorder = recorderWith();
      const socketId = recorder.nextSocketId();
      recorder.record({
        kind: 'ws',
        t: 1,
        socketId,
        url: 'ws://localhost/s',
        event: 'open',
        opcode: null,
        bytes: null,
        data: null,
        code: null,
      });
      expect((recorder.snapshot()[0] as WebSocketEntry).socketId).toBe(1);
    });
  });

  describe('hot path (S01-10, NFR-PERF-03)', () => {
    it('10,000 start + record pairs with a listener on every channel stay fast', () => {
      const recorder = recorderWith();
      let events = 0;
      recorder.onPending(() => events++);
      recorder.onEntry(() => events++);
      recorder.onChange(() => events++);
      const headers = { authorization: `Bearer ${SECRET}`, accept: 'application/json', 'x-request-id': 'abc' };
      const drafts = Array.from({ length: 10_000 }, (_, i) =>
        pendingDraft({ url: `http://localhost/api/items/${i}?page=${i}&token=${SECRET}`, reqHeaders: headers }),
      );

      const start = performance.now();
      for (const draft of drafts) {
        recorder.record(finished(draft, recorder.startPending(draft)));
      }
      const elapsed = performance.now() - start;

      // Wall-clock guard, not a benchmark. Measured on the shared 4-CPU runner:
      // 53–200 ms with coverage (5–20 µs per request; the same 10,000 records
      // without pending tracking take 34–72 ms). The limit is 5× the worst; a
      // per-request cost of ~100 µs fails it — e.g. copying the 5,000-entry
      // buffer on every request measured 325–1,391 ms.
      expect(elapsed).toBeLessThan(1000);
      expect(events).toBe(30_000);
      expect(recorder.pending()).toEqual([]);
    });
  });
});
