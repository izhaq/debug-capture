import { Clock, EntryDraft, HttpEntry, Recorder, createRecorder, resolvePolicy } from '../../../core';
import { XhrHost, installXhrProbe } from './xhr.probe';

type HttpDraft = Omit<HttpEntry, 'seq'>;

/** Collects drafts; `waitFor(n)` resolves once n have arrived (real XHRs complete asynchronously). */
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

/**
 * A fresh XHR stand-in per call, so every spec patches its own prototype
 * (own methods, like the real `XMLHttpRequest.prototype`). `responseText`
 * throws for non-text response types, exactly like the browser.
 */
function createFakeXhrClass() {
  return class FakeXhr extends EventTarget {
    /** 0 UNSENT → 1 OPENED (open) → 4 DONE (respond / fail), like the real one. */
    readyState = 0;
    status = 0;
    responseType: XMLHttpRequestResponseType = '';
    response: unknown = null;
    text = '';
    rawHeaders = '';

    get responseText(): string {
      if (this.responseType !== '' && this.responseType !== 'text') {
        throw new DOMException('responseText is only available for text', 'InvalidStateError');
      }
      return this.text;
    }

    open(_method: string, _url: string | URL, _async?: boolean): unknown {
      this.readyState = 1;
      return undefined;
    }

    setRequestHeader(_name: string, _value: string): unknown {
      return undefined;
    }

    send(_body?: unknown): unknown {
      return undefined;
    }

    getAllResponseHeaders(): string {
      return this.rawHeaders;
    }

    respond(status: number, rawHeaders: string, text: string, response: unknown = text): void {
      this.readyState = 4;
      this.status = status;
      this.rawHeaders = rawHeaders;
      this.text = text;
      this.response = response;
      this.dispatchEvent(new Event('load'));
      this.dispatchEvent(new Event('loadend'));
    }

    fail(type: 'abort' | 'timeout' | 'error'): void {
      this.readyState = 4;
      this.status = 0;
      this.dispatchEvent(new Event(type));
      this.dispatchEvent(new Event('loadend'));
    }
  };
}

type FakeXhrClass = ReturnType<typeof createFakeXhrClass>;

function hostFor(XhrClass: FakeXhrClass | typeof XMLHttpRequest): XhrHost {
  return { XMLHttpRequest: XhrClass as unknown as XhrHost['XMLHttpRequest'], location };
}

/** Resolves on the request's own `loadend`, after the probe's listener has run. */
function settled(xhr: XMLHttpRequest): Promise<void> {
  return new Promise((resolve) => xhr.addEventListener('loadend', () => setTimeout(resolve), { once: true }));
}

function jsonBlobUrl(text: string): string {
  return URL.createObjectURL(new Blob([text], { type: 'application/json' }));
}

function textBlobUrl(text: string): string {
  return URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
}

/** Resolves a macrotask after the condition holds — lets every trailing XHR event run first. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(condition()).withContext('condition never became true').toBeTrue();
}

/** The slice of zone.js (loaded by Karma) these specs use — read structurally, never imported. */
interface ZoneTask {
  type: string;
  source: string;
}
interface ZoneDelegate {
  invokeTask(target: unknown, task: ZoneTask, applyThis: unknown, applyArgs?: unknown[]): unknown;
}
interface TestZone {
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

/** A zone standing in for Angular's: NgZone runs change detection after every task it invokes. */
function countingZone() {
  const root = (globalThis as unknown as { Zone: { root: TestZone } }).Zone.root;
  const events: string[] = [];
  const zone = root.fork({
    name: 'app',
    onInvokeTask(delegate, _current, target, task, applyThis, applyArgs) {
      if (task.type === 'eventTask') events.push(task.source);
      return delegate.invokeTask(target, task, applyThis, applyArgs);
    },
  });
  return { zone, events };
}

/** Records into a spy-free sink that lists every member the probe touches once `watch()` is called. */
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

describe('installXhrProbe', () => {
  let Fake: FakeXhrClass;
  let rec: ReturnType<typeof fakeRecorder>;
  let time: ReturnType<typeof fakeClock>;
  const blobUrls: string[] = [];

  beforeEach(() => {
    Fake = createFakeXhrClass();
    rec = fakeRecorder();
    time = fakeClock();
  });

  afterEach(() => blobUrls.splice(0).forEach((url) => URL.revokeObjectURL(url)));

  it('is named xhr', () => {
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    expect(probe.name).toBe('xhr');
    probe.dispose();
  });

  it('records method, absolute URL, status, headers, bodies and duration', () => {
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();
    xhr.open('post', 'api/items?x=1');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send('{"name":"a"}');
    time.advance(25);
    xhr.respond(201, 'Content-Type: application/json\r\nContent-Length: 8\r\n', '{"id":1}');

    expect(rec.http()).toEqual([
      {
        kind: 'http',
        transport: 'xhr',
        t: 1000,
        method: 'POST',
        url: 'http://app.test/base/api/items?x=1',
        status: 201,
        durationMs: 25,
        reqHeaders: { 'content-type': 'application/json' },
        resHeaders: { 'content-type': 'application/json', 'content-length': '8' },
        reqBody: '{"name":"a"}',
        resBody: '{"id":1}',
        bytes: 8,
        error: null,
      },
    ]);
    probe.dispose();
  });

  it('records the response of a real XHR to a blob URL', async () => {
    const HostXhr = class extends XMLHttpRequest {};
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(HostXhr));
    const url = jsonBlobUrl('{"a":1}');
    blobUrls.push(url);

    const xhr = new HostXhr();
    expect(xhr instanceof XMLHttpRequest).toBeTrue();
    xhr.open('get', url);
    xhr.setRequestHeader('Accept', 'application/json');
    const done = settled(xhr);
    xhr.send();
    await done;

    const [draft] = await rec.waitFor(1);
    expect(draft).toEqual(
      jasmine.objectContaining({
        transport: 'xhr',
        method: 'GET',
        url,
        status: 200,
        reqHeaders: { accept: 'application/json' },
        resBody: '{"a":1}',
        bytes: 7,
        error: null,
      }),
    );
    expect(draft.resHeaders['content-type']).toBe('application/json');
    // The global constructor was never touched.
    expect(Object.prototype.hasOwnProperty.call(XMLHttpRequest.prototype, 'send')).toBeTrue();
    expect(XMLHttpRequest.prototype.send).not.toBe(HostXhr.prototype.send);
    probe.dispose();
  });

  it('joins repeated request headers like XHR does', () => {
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();
    xhr.open('GET', '/x');
    xhr.setRequestHeader('X-Tag', 'a');
    xhr.setRequestHeader('x-tag', 'b');
    xhr.setRequestHeader('Accept', 'text/plain');
    xhr.send();
    xhr.respond(200, '', 'ok');

    expect(rec.http()[0].reqHeaders).toEqual({ 'x-tag': 'a, b', accept: 'text/plain' });
    probe.dispose();
  });

  it('records abort, timeout and network errors with status null', async () => {
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    for (const type of ['abort', 'timeout', 'error'] as const) {
      const xhr = new Fake();
      xhr.open('GET', `/${type}`);
      xhr.send();
      xhr.fail(type);
    }
    expect(rec.http().map((d) => [d.error, d.status, d.resBody, d.bytes])).toEqual([
      ['abort', null, null, null],
      ['timeout', null, null, null],
      ['network', null, null, null],
    ]);
    probe.dispose();

    // The same against real browser objects: a real abort and a refused connection.
    const real = fakeRecorder();
    const HostXhr = class extends XMLHttpRequest {};
    const realProbe = installXhrProbe(real.recorder, time.clock, hostFor(HostXhr));
    const url = jsonBlobUrl('{}');
    blobUrls.push(url);

    const aborted = new HostXhr();
    aborted.open('GET', url);
    aborted.send();
    aborted.abort();

    const refused = new HostXhr();
    refused.open('GET', 'http://127.0.0.1:9/');
    const done = settled(refused);
    refused.send();
    await done;

    const drafts = await real.waitFor(2);
    expect(drafts.map((d) => [d.url, d.error, d.status])).toEqual([
      [url, 'abort', null],
      ['http://127.0.0.1:9/', 'network', null],
    ]);
    realProbe.dispose();
  });

  it('describes non-text response types without reading responseText', async () => {
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const cases: Array<[XMLHttpRequestResponseType, unknown]> = [
      ['arraybuffer', new ArrayBuffer(12)],
      ['blob', new Blob(['123456789012'])],
      ['json', { a: [1, 2] }],
      ['document', document.implementation.createHTMLDocument('x')],
    ];
    for (const [type, response] of cases) {
      const xhr = new Fake();
      xhr.open('GET', '/x');
      xhr.responseType = type;
      xhr.send();
      xhr.respond(200, '', '', response);
    }
    expect(rec.http().map((d) => [d.resBody, d.bytes])).toEqual([
      ['[arraybuffer 12 bytes]', null],
      ['[blob 12 bytes]', null],
      ['{"a":[1,2]}', null],
      ['[document]', null],
    ]);
    probe.dispose();

    // A real XHR throws InvalidStateError from responseText here.
    const real = fakeRecorder();
    const HostXhr = class extends XMLHttpRequest {};
    const realProbe = installXhrProbe(real.recorder, time.clock, hostFor(HostXhr));
    const url = jsonBlobUrl('{"a":1}');
    blobUrls.push(url);
    const xhr = new HostXhr();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    const done = settled(xhr);
    xhr.send();
    await done;

    const [draft] = await real.waitFor(1);
    expect([draft.status, draft.resBody, draft.bytes]).toEqual([200, '[arraybuffer 7 bytes]', 7]);
    realProbe.dispose();
  });

  it('handles a reused instance', () => {
    const addListener = spyOn(Fake.prototype, 'addEventListener').and.callThrough();
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();

    xhr.open('POST', '/first');
    xhr.setRequestHeader('X-A', '1');
    xhr.send('one');
    xhr.respond(200, '', 'ok');

    xhr.open('get', '/second');
    xhr.send();
    time.advance(5);
    xhr.fail('error');

    expect(rec.http().map((d) => [d.method, d.url, d.reqHeaders, d.reqBody, d.status, d.error, d.durationMs])).toEqual([
      ['POST', 'http://app.test/first', { 'x-a': '1' }, 'one', 200, null, 0],
      ['GET', 'http://app.test/second', {}, null, null, 'network', 5],
    ]);
    // Listeners are attached on the first send only.
    expect(addListener.calls.count()).toBe(4);
    probe.dispose();
  });

  it('calls each original exactly once with the same this and args', () => {
    const open = spyOn(Fake.prototype, 'open').and.returnValue('opened');
    const setHeader = spyOn(Fake.prototype, 'setRequestHeader').and.returnValue('set');
    const send = spyOn(Fake.prototype, 'send').and.returnValue('sent');
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();

    expect(xhr.open('GET', '/x', false)).toBe('opened');
    expect(xhr.setRequestHeader('A', 'b')).toBe('set');
    const body = new Blob(['x']);
    expect(xhr.send(body)).toBe('sent');

    const expectOneCall = (spy: jasmine.Spy, args: unknown[]) => {
      expect(spy.calls.count()).toBe(1);
      expect(spy.calls.mostRecent().object).toBe(xhr);
      expect(spy.calls.mostRecent().args).toEqual(args);
    };
    expectOneCall(open, ['GET', '/x', false]);
    expectOneCall(setHeader, ['A', 'b']);
    expectOneCall(send, [body]);
    probe.dispose();
  });

  it('still sends when bookkeeping throws', () => {
    const send = spyOn(Fake.prototype, 'send').and.returnValue('sent');
    const brokenClock: Clock = {
      now: () => {
        throw new Error('clock broke');
      },
    };
    const probe = installXhrProbe(rec.recorder, brokenClock, hostFor(Fake));
    const xhr = new Fake();
    xhr.open('GET', '/x');
    expect(xhr.send('body')).toBe('sent');
    expect(send).toHaveBeenCalledOnceWith('body');
    probe.dispose();

    // A throwing recorder inside the loadend listener must not surface as an
    // error (Jasmine fails the spec on any uncaught listener error).
    const brokenRecorder: Recorder = {
      ...rec.recorder,
      record: () => {
        throw new Error('recorder broke');
      },
    };
    const second = installXhrProbe(brokenRecorder, time.clock, hostFor(Fake));
    const other = new Fake();
    other.open('GET', '/y');
    other.send();
    expect(() => other.respond(200, '', 'ok')).not.toThrow();

    // A failing original still throws to the caller, unchanged.
    const failure = new DOMException('bad state', 'InvalidStateError');
    send.and.throwError(failure);
    expect(() => other.send()).toThrow(failure);
    second.dispose();
  });

  it('restores the prototype on dispose (own and inherited methods)', () => {
    const originals = {
      open: Fake.prototype.open,
      setRequestHeader: Fake.prototype.setRequestHeader,
      send: Fake.prototype.send,
    };

    // Own methods (like the real XMLHttpRequest.prototype): assigned back.
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    expect(Fake.prototype.send).not.toBe(originals.send);
    probe.dispose();
    expect(Fake.prototype.open).toBe(originals.open);
    expect(Fake.prototype.setRequestHeader).toBe(originals.setRequestHeader);
    expect(Fake.prototype.send).toBe(originals.send);

    // Inherited methods (a subclass host): our own properties are deleted.
    const Sub = class extends Fake {};
    const subProbe = installXhrProbe(rec.recorder, time.clock, hostFor(Sub));
    expect(Object.prototype.hasOwnProperty.call(Sub.prototype, 'send')).toBeTrue();
    subProbe.dispose();
    for (const name of ['open', 'setRequestHeader', 'send']) {
      expect(Object.prototype.hasOwnProperty.call(Sub.prototype, name)).withContext(name).toBeFalse();
    }
    expect(Sub.prototype.send).toBe(originals.send);

    // Re-patched on top of us: theirs stays, ours becomes a pass-through.
    const again = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const ours = Fake.prototype.send;
    const theirs = function (this: InstanceType<FakeXhrClass>, body?: unknown) {
      return ours.call(this, body);
    };
    Fake.prototype.send = theirs;
    again.dispose();
    expect(Fake.prototype.send).toBe(theirs);
    expect(Fake.prototype.open).toBe(originals.open);

    const xhr = new Fake();
    xhr.open('GET', '/x');
    xhr.send();
    xhr.respond(200, '', 'ok');
    expect(rec.http()).toEqual([]);
  });

  it('records nothing for requests completing after dispose', () => {
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();
    xhr.open('GET', '/x');
    xhr.send();
    probe.dispose();
    xhr.respond(200, '', 'late');
    expect(rec.drafts).toEqual([]);
  });

  it('dispose is idempotent', () => {
    const original = Fake.prototype.send;
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    probe.dispose();
    const other = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const otherSend = Fake.prototype.send;
    probe.dispose(); // must not touch the second probe's patch
    expect(Fake.prototype.send).toBe(otherSend);
    other.dispose();
    other.dispose();
    expect(Fake.prototype.send).toBe(original);
  });

  describe('a reused real XHR', () => {
    let HostXhr: typeof XMLHttpRequest;
    let probe: { dispose(): void };
    let first: string;
    let second: string;

    beforeEach(() => {
      HostXhr = class extends XMLHttpRequest {};
      probe = installXhrProbe(rec.recorder, time.clock, hostFor(HostXhr));
      first = textBlobUrl('FIRST');
      second = textBlobUrl('SECOND');
      blobUrls.push(first, second);
    });

    afterEach(() => probe.dispose());

    const summary = () => rec.http().map((d) => [d.url, d.status, d.resBody, d.error]);

    it('records both requests when the app re-opens inside its load handler', async () => {
      const xhr = new HostXhr();
      let loads = 0;
      xhr.addEventListener('load', () => {
        if (++loads > 1) return;
        // Retry code: the first request's loadend has not fired yet.
        xhr.open('GET', second);
        xhr.send();
      });
      xhr.open('GET', first);
      xhr.send();

      await until(() => loads === 2);
      expect(summary()).toEqual([
        [first, 200, 'FIRST', null],
        [second, 200, 'SECOND', null],
      ]);
      expect(rec.http()[0].resHeaders['content-type']).toBe('text/plain');
    });

    it('records an in-flight request replaced by open() as aborted', async () => {
      const xhr = new HostXhr();
      xhr.open('GET', first);
      xhr.send();
      // The original open() silently aborts the first request — no events at all.
      xhr.open('GET', second);
      const done = settled(xhr);
      xhr.send();
      await done;

      expect(summary()).toEqual([
        [first, null, null, 'abort'],
        [second, 200, 'SECOND', null],
      ]);
    });

    it('never records one request twice', async () => {
      // 1. Re-opened inside the app's loadend handler, which runs before ours.
      const a = new HostXhr();
      let aEnds = 0;
      a.addEventListener('loadend', () => {
        if (++aEnds === 1) {
          a.open('GET', second);
          a.send();
        }
      });
      a.open('GET', first);
      a.send();
      await until(() => aEnds === 2);

      // 2. Retried inside the app's abort handler (it runs before ours, so the
      //    probe has not seen the abort event when open() replaces the request).
      const b = new HostXhr();
      let bAborts = 0;
      b.addEventListener('abort', () => {
        if (++bAborts === 1) {
          b.open('GET', second);
          b.send();
        }
      });
      b.open('GET', first);
      b.send();
      const bDone = new Promise<void>((resolve) => b.addEventListener('load', () => resolve()));
      b.abort();
      await bDone;

      // 3. abort() inside the load handler resets the instance before loadend.
      const c = new HostXhr();
      c.addEventListener('load', () => c.abort());
      c.open('GET', first);
      const cDone = settled(c);
      c.send();
      await cDone;

      await until(() => rec.http().length >= 5);
      expect(summary()).toEqual([
        [first, 200, 'FIRST', null],
        [second, 200, 'SECOND', null],
        [first, null, null, 'abort'],
        [second, 200, 'SECOND', null],
        [first, 200, 'FIRST', null],
      ]);
    });
  });

  it('keeps the failure kind when the app retries inside an earlier error or timeout listener', () => {
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    for (const [type, timeout] of [
      ['timeout', 50],
      ['error', 0],
    ] as const) {
      const xhr = new Fake() as InstanceType<FakeXhrClass> & { timeout: number };
      xhr.timeout = timeout;
      let retried = false;
      xhr.addEventListener(type, () => {
        if (retried) return;
        retried = true;
        xhr.open('GET', '/retry');
        xhr.send();
      });
      xhr.open('GET', `/${type}`);
      xhr.send();
      time.advance(60);
      xhr.fail(type);
      xhr.respond(200, '', 'ok');
    }
    expect(rec.http().map((d) => [d.url, d.status, d.error])).toEqual([
      ['http://app.test/timeout', null, 'timeout'],
      ['http://app.test/retry', 200, null],
      ['http://app.test/error', null, 'network'],
      ['http://app.test/retry', 200, null],
    ]);
    probe.dispose();
  });

  it('records nothing for a re-open whose original open() throws', () => {
    const open = spyOn(Fake.prototype, 'open').and.callThrough();
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();
    xhr.open('GET', '/first');
    xhr.send();
    // An invalid open() throws before it touches the request in flight.
    const failure = new DOMException('bad method', 'SyntaxError');
    open.and.throwError(failure);
    expect(() => xhr.open('BAD METHOD', '/x')).toThrow(failure);
    expect(rec.http()).toEqual([]);

    xhr.respond(200, '', 'ok');
    expect(rec.http().map((d) => [d.url, d.status])).toEqual([['http://app.test/first', 200]]);
    probe.dispose();
  });

  it("probe listeners run outside the app's zone", async () => {
    const HostXhr = class extends XMLHttpRequest {};
    const probe = installXhrProbe(rec.recorder, time.clock, hostFor(HostXhr));
    const url = jsonBlobUrl('{"a":1}');
    blobUrls.push(url);
    const app = countingZone();
    let loaded = false;

    app.zone.run(() => {
      const xhr = new HostXhr();
      xhr.addEventListener('load', () => (loaded = true));
      xhr.open('GET', url);
      xhr.send();
    });

    await rec.waitFor(1);
    await until(() => loaded);
    // Only the app's own listener ran as a task in the app's zone.
    expect(app.events.length).withContext(app.events.join()).toBe(1);
    expect(app.events[0]).toContain('load');
    probe.dispose();
  });

  it('drops its recorder reference on dispose', () => {
    const watched = watchedRecorder();
    const probe = installXhrProbe(watched.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();
    xhr.open('GET', '/before');
    xhr.send();
    xhr.respond(200, '', 'ok');
    expect(watched.base.http().length).toBe(1);

    // A request in flight, and someone else's patch on top of ours that keeps
    // our wrapper alive in their chain.
    const inFlight = new Fake();
    inFlight.open('GET', '/in-flight');
    inFlight.send();
    const ours = Fake.prototype.open;
    Fake.prototype.open = function (this: InstanceType<FakeXhrClass>, method: string, url: string | URL) {
      return ours.call(this, method, url);
    };
    probe.dispose();
    watched.watch();

    inFlight.respond(200, '', 'late');
    const after = new Fake();
    after.open('GET', '/after');
    after.send();
    after.respond(200, '', 'ok');
    expect(watched.touched).toEqual([]);
    expect(watched.base.http().length).toBe(1);
  });
});

describe('installXhrProbe — pending requests (C-1)', () => {
  let Fake: FakeXhrClass;
  let time: ReturnType<typeof fakeClock>;
  let recorder: ReturnType<typeof createRecorder>;
  let events: string[];
  let probe: { dispose(): void };

  beforeEach(() => {
    Fake = createFakeXhrClass();
    time = fakeClock();
    recorder = createRecorder(resolvePolicy({ ignoreUrls: [/\/health/] }));
    events = [];
    recorder.onPending((e) => events.push(e.type === 'start' ? `start ${e.request.id}` : `end ${e.id}`));
    probe = installXhrProbe(recorder, time.clock, hostFor(Fake));
  });

  afterEach(() => probe.dispose());

  const stored = () => recorder.snapshot() as HttpEntry[];

  it('starts at send() with the absolute URL and the headers set so far, redacted like the entry', () => {
    const xhr = new Fake();
    xhr.open('post', 'api/login?access_token=SECRET1');
    xhr.setRequestHeader('Authorization', 'Bearer SECRET2');
    xhr.setRequestHeader('Content-Type', 'application/json');
    expect(recorder.pending()).toEqual([]);

    xhr.send('{"password":"SECRET3"}');

    const [pending] = recorder.pending();
    expect(pending).toEqual({
      id: 1,
      t: 1000,
      transport: 'xhr',
      method: 'POST',
      url: 'http://app.test/base/api/login?access_token=[redacted]',
      reqHeaders: { authorization: '[redacted]', 'content-type': 'application/json' },
    });
    expect(JSON.stringify(recorder.pending())).not.toContain('SECRET');

    xhr.respond(200, '', '{}');
    expect(events).toEqual(['start 1', 'end 1']);
    expect(recorder.pending()).toEqual([]);
    expect(stored()[0].requestId).toBe(1);
    expect(stored()[0].url).toBe(pending.url);
    expect(stored()[0].reqHeaders).toEqual(pending.reqHeaders);
  });

  it('gives a reused instance a new id per send()', () => {
    const xhr = new Fake();
    xhr.open('GET', '/first');
    xhr.send();
    xhr.respond(200, '', 'ok');
    xhr.open('GET', '/second');
    xhr.send();
    xhr.fail('error');

    expect(stored().map((e) => [e.url, e.requestId])).toEqual([
      ['http://app.test/first', 1],
      ['http://app.test/second', 2],
    ]);
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('ends a request that open() replaces while in flight', () => {
    const xhr = new Fake();
    xhr.open('GET', '/replaced');
    xhr.send();
    xhr.open('GET', '/next');

    expect(recorder.pending()).toEqual([]);
    expect(stored().map((e) => [e.error, e.requestId])).toEqual([['abort', 1]]);
  });

  it('ends the request when the original send() throws, and rethrows the same error', () => {
    const failure = new DOMException('sync request failed', 'NetworkError');
    const Failing = class extends Fake {
      override send(): unknown {
        throw failure;
      }
    };
    probe.dispose();
    probe = installXhrProbe(recorder, time.clock, hostFor(Failing));
    const xhr = new Failing();
    xhr.open('GET', '/sync');

    expect(() => xhr.send()).toThrow(failure);

    expect(events).toEqual(['start 1', 'end 1']);
    expect(recorder.pending()).toEqual([]);
  });

  it('ends the replaced request even when building its entry fails', () => {
    const xhr = new Fake();
    xhr.open('GET', '/broken');
    xhr.send();
    // The replaced request is read at open(); a throwing getter makes that fail.
    Object.defineProperty(xhr, 'status', {
      get: () => {
        throw new Error('host bug');
      },
    });
    xhr.open('GET', '/next');

    expect(recorder.pending()).toEqual([]);
    expect(events).toEqual(['start 1', 'end 1']);
  });

  it('dispose() ends every request still in flight; their completion records nothing', () => {
    const first = new Fake();
    first.open('GET', '/a');
    first.send();
    const second = new Fake();
    second.open('GET', '/b');
    second.send();
    const done = new Fake();
    done.open('GET', '/c');
    done.send();
    done.respond(200, '', 'ok');

    probe.dispose();
    probe.dispose();

    expect(recorder.pending()).toEqual([]);
    expect(events).toEqual(['start 1', 'start 2', 'start 3', 'end 3', 'end 1', 'end 2']);
    first.respond(200, '', 'late');
    second.fail('abort');
    expect(stored().length).toBe(1);
  });

  it('never lists an ignored URL', () => {
    const xhr = new Fake();
    xhr.open('GET', '/health?token=SECRET');
    xhr.send();

    expect(recorder.pending()).toEqual([]);
    xhr.respond(200, '', 'ok');
    expect(events).toEqual([]);
    expect(recorder.stats().dropped).toBe(1);
  });

  it('a second send() while in flight throws without ending the live request (review R1)', () => {
    const Strict = class extends Fake {
      sent = false;
      override open(method: string, url: string | URL): unknown {
        this.sent = false;
        return super.open(method, url);
      }
      override send(): unknown {
        if (this.sent) throw new DOMException('The object is already sending.', 'InvalidStateError');
        this.sent = true;
        return undefined;
      }
    };
    probe.dispose();
    probe = installXhrProbe(recorder, time.clock, hostFor(Strict));
    const xhr = new Strict();
    xhr.open('GET', '/live');
    xhr.send();

    expect(() => xhr.send()).toThrowError(DOMException);

    expect(recorder.pending().map((p) => p.id)).toEqual([1]);
    xhr.respond(200, '', 'ok');
    expect(stored().map((e) => e.requestId)).toEqual([1]);
    expect(events).toEqual(['start 1', 'end 1']);
  });

  it('ends the request when its entry cannot be built at loadend (review R2)', () => {
    const xhr = new Fake();
    xhr.open('GET', '/broken');
    xhr.send();
    xhr.getAllResponseHeaders = () => {
      throw new Error('host bug');
    };

    xhr.respond(200, 'X: 1', 'ok');

    expect(recorder.pending()).toEqual([]);
    expect(events).toEqual(['start 1', 'end 1']);
    expect(stored()).toEqual([]);
  });

  it('ends the request when its entry cannot be built in abort() after it finished (review R2)', () => {
    const WithAbort = class extends Fake {
      abort(): unknown {
        return undefined;
      }
    };
    probe.dispose();
    probe = installXhrProbe(recorder, time.clock, hostFor(WithAbort));
    const xhr = new WithAbort();
    xhr.open('GET', '/broken');
    // An app listener, ahead of ours, that aborts the finished request.
    xhr.addEventListener('load', () => xhr.abort());
    xhr.send();
    xhr.getAllResponseHeaders = () => {
      throw new Error('host bug');
    };

    xhr.respond(200, 'X: 1', 'ok');

    expect(recorder.pending()).toEqual([]);
    expect(events).toEqual(['start 1', 'end 1']);
  });

  it('redacts the user info of a URL in the pending row and the entry (review 6)', () => {
    const xhr = new Fake();
    xhr.open('GET', 'http://op:SECRET@api.test/items?x=1');
    xhr.setRequestHeader('Accept', 'text/plain');
    xhr.send();

    expect(recorder.pending()[0].url).toBe('http://[redacted]@api.test/items?x=1');
    xhr.respond(200, '', 'ok');
    expect(stored()[0].url).toBe('http://[redacted]@api.test/items?x=1');
    expect(JSON.stringify(recorder.snapshot())).not.toContain('SECRET');
  });

  it('10,000 requests through the probe with pending tracking stay fast (S01-10)', () => {
    const run = (sink: Recorder): number => {
      const local = installXhrProbe(sink, time.clock, hostFor(Fake));
      const start = performance.now();
      for (let i = 0; i < 10_000; i++) {
        const xhr = new Fake();
        xhr.open('GET', `/api/items/${i}?token=SECRET`);
        xhr.setRequestHeader('Authorization', 'Bearer SECRET');
        xhr.send();
        xhr.respond(200, 'Content-Type: application/json', '{}');
      }
      const elapsed = performance.now() - start;
      local.dispose();
      return elapsed;
    };
    probe.dispose();
    recorder.onEntry(() => undefined);

    const elapsed = run(recorder);

    // Wall-clock guard, not a benchmark. Measured with coverage on the shared
    // 4-CPU runner (load average up to 14): 524–953 ms, i.e. 50–95 µs per
    // request including the fake XHR's own events; the same run with a real
    // recorder but no pending side took 392–537 ms, the bare fake XHR 230–583
    // ms. The limit is ~4× the worst; it fails once a request costs ~400 µs,
    // about 5–8× today.
    expect(elapsed).toBeLessThan(4000);
    expect(recorder.pending()).toEqual([]);
    expect(recorder.stats().recorded).toBe(10_000);
  });

  it('works as v1 with a recorder that has no pending side', () => {
    const v1 = fakeRecorder();
    probe.dispose();
    probe = installXhrProbe(v1.recorder, time.clock, hostFor(Fake));
    const xhr = new Fake();
    xhr.open('GET', '/v1');
    xhr.send();
    xhr.respond(200, '', 'ok');

    expect(v1.http().length).toBe(1);
    expect('requestId' in v1.http()[0]).toBeFalse();
  });
});
