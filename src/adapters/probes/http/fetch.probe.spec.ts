import { Clock, EntryDraft, HttpEntry, Recorder, createRecorder, resolvePolicy } from '../../../core';
import { FetchHost, installFetchProbe } from './fetch.probe';

type HttpDraft = Omit<HttpEntry, 'seq'>;

/** Collects drafts; `waitFor(n)` resolves once n have arrived (bodies are read asynchronously). */
function fakeRecorder() {
  const drafts: EntryDraft[] = [];
  let waiters: Array<() => void> = [];
  const recorder: Recorder = {
    record(draft) {
      drafts.push(draft);
      const ready = waiters;
      waiters = [];
      ready.forEach((wake) => wake());
    },
    snapshot: () => [],
    clear: () => undefined,
    stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
    onEntry: () => () => undefined,
  };
  const http = (): HttpDraft[] => drafts.filter((d): d is HttpDraft => d.kind === 'http');
  const waitFor = (count: number): Promise<HttpDraft[]> =>
    new Promise((resolve) => {
      const check = () => (http().length >= count ? resolve(http()) : waiters.push(check));
      check();
    });
  return { recorder, drafts, http, waitFor };
}

function fakeClock(start = 1000) {
  let time = start;
  const clock: Clock = { now: () => time };
  return { clock, advance: (ms: number) => (time += ms) };
}

const location = { href: 'http://app.test/base/page' };

/** A host around the real fetch — the global itself is never patched. */
function realHost(): FetchHost {
  return { fetch: window.fetch.bind(window), location };
}

function fakeHost(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const fetchSpy = jasmine.createSpy<typeof fetch>('fetch').and.callFake(impl);
  const host: FetchHost = { fetch: fetchSpy, location };
  return { host, fetchSpy };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks (the probe's body read) run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

/** The slice of zone.js (loaded by Karma) these specs use — read structurally, never imported. */
interface ZoneTask {
  type: string;
}
interface ZoneDelegate {
  invokeTask(target: unknown, task: ZoneTask, applyThis: unknown, applyArgs?: unknown[]): unknown;
}
interface TestZone {
  name: string;
  run<T>(work: () => T): T;
  fork(spec: {
    name: string;
    onInvokeTask(
      delegate: ZoneDelegate,
      current: TestZone,
      target: TestZone,
      task: ZoneTask,
      applyThis: unknown,
      applyArgs?: unknown[],
    ): unknown;
  }): TestZone;
}
const zones = (globalThis as unknown as { Zone: { root: TestZone; current: TestZone } }).Zone;

/** A zone standing in for Angular's: NgZone runs change detection after every task it invokes. */
function countingZone() {
  let tasks = 0;
  const zone = zones.root.fork({
    name: 'app',
    onInvokeTask(delegate, _current, target, task, applyThis, applyArgs) {
      tasks++;
      return delegate.invokeTask(target, task, applyThis, applyArgs);
    },
  });
  return { zone, tasks: () => tasks };
}

/** Lists every recorder member the probe touches once `watch()` is called. */
function watchedRecorder() {
  const touched: PropertyKey[] = [];
  let watching = false;
  const base = fakeRecorder();
  const recorder = new Proxy(base.recorder, {
    get(target, key, receiver) {
      if (watching) touched.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  return { recorder, base, touched, watch: () => (watching = true) };
}

const CAP_MARKER = '…[capture stopped at 1048576 chars]';

describe('installFetchProbe', () => {
  let rec: ReturnType<typeof fakeRecorder>;
  let time: ReturnType<typeof fakeClock>;
  const blobUrls: string[] = [];

  function jsonBlobUrl(text: string): string {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    blobUrls.push(url);
    return url;
  }

  beforeEach(() => {
    rec = fakeRecorder();
    time = fakeClock();
  });

  afterEach(() => blobUrls.splice(0).forEach((url) => URL.revokeObjectURL(url)));

  it('is named fetch', () => {
    const probe = installFetchProbe(rec.recorder, time.clock, realHost());
    expect(probe.name).toBe('fetch');
    probe.dispose();
  });

  it('records a real fetch of a blob URL with its body', async () => {
    const host = realHost();
    const probe = installFetchProbe(rec.recorder, time.clock, host);
    const url = jsonBlobUrl('{"a":1}');

    const response = await host.fetch(url, { headers: { Accept: 'application/json' } });
    expect(await response.json()).toEqual({ a: 1 });

    const [draft] = await rec.waitFor(1);
    expect(draft).toEqual(
      jasmine.objectContaining({
        kind: 'http',
        transport: 'fetch',
        t: 1000,
        method: 'GET',
        url,
        status: 200,
        durationMs: 0,
        reqHeaders: { accept: 'application/json' },
        reqBody: null,
        resBody: '{"a":1}',
        bytes: 7,
        error: null,
      }),
    );
    expect(draft.resHeaders['content-type']).toBe('application/json');
    probe.dispose();
  });

  it('resolves with the same Response object and leaves its body readable', async () => {
    const response = new Response('hello é', { status: 201, headers: { 'Content-Type': 'text/plain' } });
    const { host, fetchSpy } = fakeHost(() => Promise.resolve(response));
    const probe = installFetchProbe(rec.recorder, time.clock, host);

    const init = { method: 'post', body: 'ping' };
    const got = await host.fetch('/api/x', init);

    expect(got).toBe(response);
    expect(got.bodyUsed).toBeFalse();
    expect(await got.text()).toBe('hello é');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.calls.mostRecent().object).toBe(host);
    expect(fetchSpy.calls.mostRecent().args).toEqual(['/api/x', init]);

    const [draft] = await rec.waitFor(1);
    expect(draft).toEqual(
      jasmine.objectContaining({
        method: 'POST',
        url: 'http://app.test/api/x',
        status: 201,
        reqBody: 'ping',
        resBody: 'hello é',
        resHeaders: { 'content-type': 'text/plain' },
        bytes: 8,
      }),
    );
    probe.dispose();
  });

  it('takes method, headers and body from init over a Request', async () => {
    const { host } = fakeHost(() => Promise.resolve(new Response('')));
    const probe = installFetchProbe(rec.recorder, time.clock, host);
    const request = new Request('http://other.test/r', {
      method: 'PUT',
      headers: { 'X-A': 'req' },
      body: 'from request',
    });

    await host.fetch(request, { method: 'patch', headers: [['X-B', 'init']], body: new URLSearchParams({ q: '1' }) });
    await host.fetch(new Request('http://other.test/plain', { method: 'DELETE', headers: { 'X-C': 'c' } }));
    await host.fetch(new URL('https://other.test/u'));

    const drafts = await rec.waitFor(3);
    expect(drafts.map((d) => [d.method, d.url, d.reqHeaders, d.reqBody])).toEqual([
      ['PATCH', 'http://other.test/r', { 'x-b': 'init' }, 'q=1'],
      ['DELETE', 'http://other.test/plain', { 'x-c': 'c' }, null],
      ['GET', 'https://other.test/u', {}, null],
    ]);
    probe.dispose();
  });

  it('marks a Request body without reading it', async () => {
    const { host, fetchSpy } = fakeHost(() => Promise.resolve(new Response('')));
    const probe = installFetchProbe(rec.recorder, time.clock, host);
    const request = new Request('http://other.test/upload', { method: 'POST', body: 'secret stream' });

    await host.fetch(request);

    const [draft] = await rec.waitFor(1);
    expect(draft.reqBody).toBe('[Request body]');
    expect(request.bodyUsed).toBeFalse();
    expect(fetchSpy.calls.mostRecent().args[0]).toBe(request);
    probe.dispose();
  });

  it('does not read non-textual or event-stream bodies', async () => {
    const binary = new Response(new Uint8Array(5), {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '5' },
    });
    const stream = new Response('data: x\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    const binaryClone = spyOn(binary, 'clone').and.callThrough();
    const streamClone = spyOn(stream, 'clone').and.callThrough();
    const responses = [binary, stream];
    const { host } = fakeHost(() => Promise.resolve(responses.shift() as Response));
    const probe = installFetchProbe(rec.recorder, time.clock, host);

    await host.fetch('/bin');
    await host.fetch('/events');

    const drafts = await rec.waitFor(2);
    expect(drafts.map((d) => [d.url, d.status, d.resBody, d.bytes])).toEqual([
      ['http://app.test/bin', 200, null, 5],
      ['http://app.test/events', 200, null, null],
    ]);
    expect(binaryClone).not.toHaveBeenCalled();
    expect(streamClone).not.toHaveBeenCalled();
    probe.dispose();
  });

  it('records a network error and rethrows the same error', async () => {
    const failure = new TypeError('Failed to fetch');
    const { host } = fakeHost(() => Promise.reject(failure));
    const probe = installFetchProbe(rec.recorder, time.clock, host);

    const caught = await host.fetch('/down').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    expect(caught).toBe(failure);
    probe.dispose();

    // A real refused connection.
    const real = realHost();
    const realProbe = installFetchProbe(rec.recorder, time.clock, real);
    await expectAsync(real.fetch('http://127.0.0.1:9/')).toBeRejectedWithError(TypeError);
    realProbe.dispose();

    const drafts = await rec.waitFor(2);
    expect(drafts.map((d) => [d.url, d.status, d.error, d.resBody, d.bytes])).toEqual([
      ['http://app.test/down', null, 'network', null, null],
      ['http://127.0.0.1:9/', null, 'network', null, null],
    ]);
  });

  it('records an abort as error abort', async () => {
    const host = realHost();
    const probe = installFetchProbe(rec.recorder, time.clock, host);
    const controller = new AbortController();

    const pending = host.fetch(jsonBlobUrl('{}'), { signal: controller.signal });
    controller.abort();
    const caught = await pending.then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught instanceof DOMException && caught.name).toBe('AbortError');

    const [draft] = await rec.waitFor(1);
    expect([draft.status, draft.error]).toEqual([null, 'abort']);
    probe.dispose();

    // AbortSignal.timeout() rejects with a TimeoutError — the contract has a slot for it.
    const timeout = new DOMException('timed out', 'TimeoutError');
    const fake = fakeHost(() => Promise.reject(timeout));
    const timeoutProbe = installFetchProbe(rec.recorder, time.clock, fake.host);
    await expectAsync(fake.host.fetch('/slow')).toBeRejectedWith(timeout);
    expect(rec.http()[1].error).toBe('timeout');
    timeoutProbe.dispose();
  });

  it('restores fetch on dispose; pass-through if re-patched', async () => {
    const { host, fetchSpy } = fakeHost(() => Promise.resolve(new Response('')));
    const original = host.fetch;

    const probe = installFetchProbe(rec.recorder, time.clock, host);
    expect(host.fetch).not.toBe(original);
    probe.dispose();
    probe.dispose();
    expect(host.fetch).toBe(original);

    const again = installFetchProbe(rec.recorder, time.clock, host);
    const ours = host.fetch;
    const theirs: typeof fetch = (input, init) => ours(input, init);
    host.fetch = theirs;
    again.dispose();
    expect(host.fetch).toBe(theirs);

    const response = await host.fetch('/after');
    await flush();
    expect(response).toEqual(jasmine.any(Response));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rec.drafts).toEqual([]);
  });

  it('records nothing for fetches settling after dispose', async () => {
    const headers = deferred<Response>();
    const failing = deferred<Response>();
    const queue = [headers.promise, failing.promise];
    const { host } = fakeHost(() => queue.shift() as Promise<Response>);
    const probe = installFetchProbe(rec.recorder, time.clock, host);

    const ok = host.fetch('/slow');
    const bad = host.fetch('/broken').then(
      () => null,
      (error: unknown) => error,
    );
    probe.dispose();

    headers.resolve(new Response('late'));
    const failure = new TypeError('late failure');
    failing.reject(failure);

    expect(await (await ok).text()).toBe('late');
    expect(await bad).toBe(failure);
    await flush();
    expect(rec.drafts).toEqual([]);
  });

  it('records a fetch aborted while its body is read as error abort', async () => {
    // A real fetch, aborted after the headers arrived.
    const host = realHost();
    const probe = installFetchProbe(rec.recorder, time.clock, host);
    const controller = new AbortController();
    const url = URL.createObjectURL(new Blob(['x'.repeat(100_000)], { type: 'text/plain' }));
    blobUrls.push(url);
    const response = await host.fetch(url, { signal: controller.signal });
    controller.abort();
    await expectAsync(response.text()).toBeRejected();

    // The same failure, deterministically: the body stream errors with an AbortError.
    const aborting = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('partial'));
        stream.error(new DOMException('The user aborted a request.', 'AbortError'));
      },
    });
    const fake = fakeHost(() =>
      Promise.resolve(new Response(aborting, { headers: { 'Content-Type': 'application/json' } })),
    );
    const fakeProbe = installFetchProbe(rec.recorder, time.clock, fake.host);
    await fake.host.fetch('/aborted');

    const drafts = await rec.waitFor(2);
    expect(drafts.map((d) => [d.url, d.status, d.resBody, d.error])).toEqual([
      [url, 200, null, 'abort'],
      ['http://app.test/aborted', 200, null, 'abort'],
    ]);
    probe.dispose();
    fakeProbe.dispose();
  });

  it("stops reading an endless text body at the cap and leaves the app's body readable", async () => {
    const chunk = new TextEncoder().encode('{"tick":1}\n'.repeat(1000));
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull: (stream) => stream.enqueue(chunk),
      cancel: () => {
        cancelled = true;
      },
    });
    const response = new Response(endless, { headers: { 'Content-Type': 'application/x-ndjson' } });
    const { host } = fakeHost(() => Promise.resolve(response));
    const probe = installFetchProbe(rec.recorder, time.clock, host);

    const got = await host.fetch('/ticks');
    const [draft] = await rec.waitFor(1);
    const body = draft.resBody ?? '';
    expect(body.length).toBe(1_048_576 + CAP_MARKER.length);
    expect(body.endsWith(CAP_MARKER)).toBeTrue();
    expect(body.startsWith('{"tick":1}\n{"tick":1}\n')).toBeTrue();
    // Neither a content-length nor the whole text: the size is unknown.
    expect(draft.bytes).toBeNull();
    expect(draft.error).toBeNull();

    // Cancelling our branch of the clone left the source (and the app's branch) alone.
    expect(cancelled).toBeFalse();
    expect(got.bodyUsed).toBeFalse();
    const reader = (got.body as ReadableStream<Uint8Array>).getReader();
    const read = await reader.read();
    expect(read.done).toBeFalse();
    expect(read.value?.byteLength).toBe(chunk.byteLength);
    // Once the app cancels its branch too, the source is cancelled: ours already was.
    await reader.cancel();
    expect(cancelled).toBeTrue();
    probe.dispose();
  });

  it('keeps a text body that ends exactly at the cap whole', async () => {
    const text = 'a'.repeat(1_048_576);
    const { host } = fakeHost(() => Promise.resolve(new Response(text, { headers: { 'Content-Type': 'text/plain' } })));
    const probe = installFetchProbe(rec.recorder, time.clock, host);
    await host.fetch('/exact');
    const [draft] = await rec.waitFor(1);
    expect(draft.resBody).toBe(text);
    expect(draft.bytes).toBe(1_048_576);
    probe.dispose();
  });

  it("probe listeners run outside the app's zone", async () => {
    const app = countingZone();
    const recordedIn: string[] = [];
    const recorder: Recorder = {
      ...rec.recorder,
      record: (draft) => {
        recordedIn.push(zones.current.name);
        rec.recorder.record(draft);
      },
    };

    async function tasksFor(contentType: string): Promise<{ tasks: number; callbackZone: string }> {
      const { host } = fakeHost(() =>
        Promise.resolve(new Response('{"a":1}', { headers: { 'Content-Type': contentType } })),
      );
      const probe = installFetchProbe(recorder, time.clock, host);
      const before = app.tasks();
      let callbackZone = '';
      const count = rec.http().length;
      app.zone.run(() => host.fetch('/x').then(() => (callbackZone = zones.current.name)));
      await rec.waitFor(count + 1);
      await flush();
      probe.dispose();
      return { tasks: app.tasks() - before, callbackZone };
    }

    const binary = await tasksFor('application/octet-stream');
    const json = await tasksFor('application/json');
    // The caller's promise stays in the caller's zone...
    expect(json.callbackZone).toBe('app');
    // ...but reading the body adds no task to it.
    expect(json.tasks).toBe(binary.tasks);
    expect(recordedIn[1]).toBe('<root>');
  });

  it('drops its recorder reference on dispose', async () => {
    const watched = watchedRecorder();
    const pending = deferred<Response>();
    const queue = [Promise.resolve(new Response('ok')), pending.promise, Promise.resolve(new Response('after'))];
    const { host } = fakeHost(() => queue.shift() as Promise<Response>);
    const probe = installFetchProbe(watched.recorder, time.clock, host);
    await host.fetch('/before');
    await watched.base.waitFor(1);

    // A fetch in flight, and someone else's patch on top of ours that keeps
    // our wrapper alive in their chain.
    const inFlight = host.fetch('/in-flight');
    const ours = host.fetch;
    host.fetch = (input, init) => ours(input, init);
    probe.dispose();
    watched.watch();

    pending.resolve(new Response('late'));
    expect(await (await inFlight).text()).toBe('late');
    expect(await (await host.fetch('/after')).text()).toBe('after');
    await flush();
    expect(watched.touched).toEqual([]);
    expect(watched.base.http().length).toBe(1);
  });
});

describe('installFetchProbe — pending requests (C-1) and the capped-body flag (C-7)', () => {
  let time: ReturnType<typeof fakeClock>;
  let recorder: ReturnType<typeof createRecorder>;
  let events: string[];
  const probes: Array<{ dispose(): void }> = [];

  function install(host: FetchHost, sink: Recorder = recorder): void {
    probes.push(installFetchProbe(sink, time.clock, host));
  }

  /** Waits for `count` stored entries (bodies are read asynchronously). */
  async function storedAfter(count: number): Promise<HttpEntry[]> {
    for (let i = 0; i < 200 && recorder.snapshot().length < count; i++) await flush();
    return recorder.snapshot() as HttpEntry[];
  }

  beforeEach(() => {
    time = fakeClock();
    recorder = createRecorder(resolvePolicy({ ignoreUrls: [/\/health/] }));
    events = [];
    recorder.onPending((e) => events.push(e.type === 'start' ? `start ${e.request.id}` : `end ${e.id}`));
  });

  afterEach(() => probes.splice(0).forEach((probe) => probe.dispose()));

  it('starts at call time, redacted like the entry, and ends when the body was read', async () => {
    const response = deferred<Response>();
    const { host } = fakeHost(() => response.promise);
    install(host);

    const call = host.fetch('/api/items?token=SECRET1', {
      method: 'put',
      headers: { 'X-Api-Key': 'SECRET2', Accept: 'application/json' },
      body: '{"password":"SECRET3"}',
    });

    const [pending] = recorder.pending();
    expect(pending).toEqual({
      id: 1,
      t: 1000,
      transport: 'fetch',
      method: 'PUT',
      url: 'http://app.test/api/items?token=[redacted]',
      reqHeaders: { 'x-api-key': '[redacted]', accept: 'application/json' },
    });
    expect(JSON.stringify(recorder.pending())).not.toContain('SECRET');

    response.resolve(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
    await call;
    const [entry] = await storedAfter(1);
    expect(entry.requestId).toBe(1);
    expect(entry.url).toBe(pending.url);
    expect(entry.reqHeaders).toEqual(pending.reqHeaders);
    expect(events).toEqual(['start 1', 'end 1']);
    expect('resBodyCapped' in entry).toBeFalse();
  });

  it('ends a request that fails', async () => {
    const { host } = fakeHost(() => Promise.reject(new TypeError('Failed to fetch')));
    install(host);

    await host.fetch('/down').catch(() => null);
    const [entry] = await storedAfter(1);

    expect([entry.error, entry.requestId]).toEqual(['network', 1]);
    expect(events).toEqual(['start 1', 'end 1']);
  });

  it('ends a request whose original fetch throws synchronously, and rethrows the same error', () => {
    const failure = new TypeError('patched fetch threw');
    const host: FetchHost = {
      fetch: () => {
        throw failure;
      },
      location,
    };
    install(host);

    expect(() => host.fetch('/sync-throw')).toThrow(failure);
    expect(events).toEqual(['start 1', 'end 1']);
    expect(recorder.pending()).toEqual([]);
  });

  it('ends a request whose original fetch returns no promise, and hands the value back untouched', () => {
    const odd = { not: 'a promise' };
    const host: FetchHost = { fetch: (() => odd) as unknown as typeof fetch, location };
    install(host);

    expect(host.fetch('/odd') as unknown).toBe(odd);
    expect(events).toEqual(['start 1', 'end 1']);
  });

  it('ends a request whose response cannot be read', async () => {
    const used = new Response('already read', { headers: { 'Content-Type': 'text/plain' } });
    await used.text();
    const { host } = fakeHost(() => Promise.resolve(used));
    install(host);

    expect(await host.fetch('/used')).toBe(used);
    await flush();

    expect(recorder.pending()).toEqual([]);
    expect(events).toEqual(['start 1', 'end 1']);
  });

  it('dispose() ends every request still in flight; their settling records nothing', async () => {
    const slow = deferred<Response>();
    const failing = deferred<Response>();
    const queue = [Promise.resolve(new Response('fast')), slow.promise, failing.promise];
    const { host } = fakeHost(() => queue.shift() as Promise<Response>);
    install(host);
    await (await host.fetch('/fast')).text();
    await storedAfter(1);

    const ok = host.fetch('/slow');
    const bad = host.fetch('/broken').catch((error: unknown) => error);
    probes.splice(0).forEach((probe) => {
      probe.dispose();
      probe.dispose();
    });

    expect(recorder.pending()).toEqual([]);
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'start 3', 'end 2', 'end 3']);
    slow.resolve(new Response('late'));
    failing.reject(new TypeError('late'));
    expect(await (await ok).text()).toBe('late');
    await bad;
    await flush();
    expect(recorder.snapshot().length).toBe(1);
    expect(events.length).toBe(6);
  });

  it('dispose() while the body is being read ends the request too', async () => {
    let pull: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      pull: () =>
        new Promise<void>((resolve) => {
          pull = resolve;
        }),
    });
    const { host } = fakeHost(() =>
      Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'text/plain' } })),
    );
    install(host);
    await host.fetch('/streaming');
    await flush();
    expect(recorder.pending().length).toBe(1);

    probes.splice(0).forEach((probe) => probe.dispose());

    expect(recorder.pending()).toEqual([]);
    expect(events).toEqual(['start 1', 'end 1']);
    expect(pull).not.toBeNull();
  });

  it('never lists an ignored URL', async () => {
    const { host } = fakeHost(() => Promise.resolve(new Response('ok')));
    install(host);

    await (await host.fetch('/health?token=SECRET')).text();
    await flush();

    expect(events).toEqual([]);
    expect(recorder.stats().dropped).toBe(1);
  });

  it('flags a body it stopped reading at the cap, and the recorder keeps the flag', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(65_536));
    const endless = new ReadableStream<Uint8Array>({ pull: (s) => s.enqueue(chunk) });
    const { host } = fakeHost(() =>
      Promise.resolve(new Response(endless, { headers: { 'Content-Type': 'text/plain' } })),
    );
    install(host);

    const got = await host.fetch('/endless');
    const [entry] = await storedAfter(1);

    expect(entry.resBodyCapped).toBeTrue();
    expect(entry.requestId).toBe(1);
    await got.body?.cancel();
  });

  it('puts neither field on the draft for a v1 recorder or a whole body', async () => {
    const v1 = fakeRecorder();
    const { host } = fakeHost(() =>
      Promise.resolve(new Response('whole', { headers: { 'Content-Type': 'text/plain' } })),
    );
    install(host, v1.recorder);

    await host.fetch('/v1');
    const [draft] = await v1.waitFor(1);

    expect('requestId' in draft).toBeFalse();
    expect('resBodyCapped' in draft).toBeFalse();
  });
});
