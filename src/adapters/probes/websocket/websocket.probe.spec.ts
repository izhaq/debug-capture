import { CaptureStats, Clock, EntryDraft, Probe, Recorder, WebSocketEntry } from '../../../core';
import { installWebSocketProbe, WebSocketHost } from './index';

type WsDraft = Omit<WebSocketEntry, 'seq'>;

/**
 * Stands in for the browser's WebSocket so events can be fired on demand.
 * Never installed on `window` — it only ever lives on a host object.
 */
class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly protocols: string | string[] | undefined;
  readyState = FakeWebSocket.CONNECTING;
  /** What actually reached the "wire" through send(). */
  readonly sent: unknown[] = [];

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.protocols = protocols;
  }

  send(data: unknown): void {
    if (this.readyState === FakeWebSocket.CONNECTING) {
      throw new DOMException('Still in CONNECTING state.', 'InvalidStateError');
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  fireOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  fireMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  fireClose(code: number, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }

  fireError(): void {
    this.dispatchEvent(new Event('error'));
  }
}

/** Collects drafts; implements the rest of Recorder just enough to satisfy the type. */
class FakeRecorder implements Recorder {
  readonly drafts: EntryDraft[] = [];
  failWith: Error | null = null;

  record(draft: EntryDraft): void {
    if (this.failWith) {
      throw this.failWith;
    }
    this.drafts.push(draft);
  }

  snapshot(): never[] {
    return [];
  }

  clear(): void {
    this.drafts.length = 0;
  }

  stats(): CaptureStats {
    return { recorded: this.drafts.length, dropped: 0, evicted: 0, failed: 0 };
  }

  onEntry(): () => void {
    return () => undefined;
  }

  ws(): WsDraft[] {
    return this.drafts.filter((d): d is WsDraft => d.kind === 'ws');
  }
}

class FakeClock implements Clock {
  time = 1000;

  now(): number {
    return this.time;
  }
}

function fakeHost(): WebSocketHost {
  return { WebSocket: FakeWebSocket as unknown as typeof WebSocket };
}

/** Creates a socket through the (patched) host and exposes the fake's helpers. */
function openFake(host: WebSocketHost, url = 'ws://example.test/live'): FakeWebSocket {
  return new host.WebSocket(url) as unknown as FakeWebSocket;
}

/** Waits (macrotask by macrotask) until `condition` holds — Blob reads settle asynchronously. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

const RealWebSocket = window.WebSocket;

describe('installWebSocketProbe', () => {
  let recorder: FakeRecorder;
  let clock: FakeClock;
  let probes: Probe[];

  function install(host: WebSocketHost): Probe {
    const probe = installWebSocketProbe(recorder, clock, host);
    probes.push(probe);
    return probe;
  }

  beforeEach(() => {
    recorder = new FakeRecorder();
    clock = new FakeClock();
    probes = [];
  });

  afterEach(() => {
    probes.forEach((probe) => probe.dispose());
    expect(window.WebSocket).withContext('the real global must never be replaced').toBe(RealWebSocket);
  });

  it('keeps instanceof and the static readyState constants', () => {
    const host: WebSocketHost = { WebSocket: RealWebSocket };
    const probe = install(host);

    expect(probe.name).toBe('websocket');
    expect(host.WebSocket).not.toBe(RealWebSocket);
    expect(host.WebSocket.name).toBe('WebSocket');
    expect(host.WebSocket.CONNECTING).toBe(0);
    expect(host.WebSocket.OPEN).toBe(1);
    expect(host.WebSocket.CLOSING).toBe(2);
    expect(host.WebSocket.CLOSED).toBe(3);

    const socket = new host.WebSocket('ws://127.0.0.1:9');
    expect(socket instanceof RealWebSocket).toBeTrue();
    expect(socket instanceof host.WebSocket).toBeTrue();
    expect(socket.readyState).toBe(RealWebSocket.CONNECTING);
    socket.close();
  });

  it("records open, receive, close and error with the socket's url", () => {
    const host = fakeHost();
    install(host);
    const socket = openFake(host);

    clock.time = 10;
    socket.fireOpen();
    clock.time = 20;
    socket.fireMessage('héllo');
    clock.time = 30;
    socket.fireError();
    clock.time = 40;
    socket.fireClose(4001, 'bye');
    clock.time = 50;
    socket.fireClose(1000);

    const base = { kind: 'ws', socketId: 1, url: 'ws://example.test/live' } as const;
    expect(recorder.ws()).toEqual([
      { ...base, t: 10, event: 'open', opcode: null, bytes: null, data: null, code: null },
      { ...base, t: 20, event: 'receive', opcode: 'text', bytes: 6, data: 'héllo', code: null },
      { ...base, t: 30, event: 'error', opcode: null, bytes: null, data: null, code: null },
      { ...base, t: 40, event: 'close', opcode: null, bytes: null, data: 'bye', code: 4001 },
      { ...base, t: 50, event: 'close', opcode: null, bytes: null, data: null, code: 1000 },
    ]);
  });

  it('records text and binary sends after they succeed', () => {
    const host = fakeHost();
    install(host);
    const socket = openFake(host);
    socket.fireOpen();
    const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const view = new Uint8Array(buffer, 1, 3);

    clock.time = 100;
    socket.send('€1');
    clock.time = 101;
    socket.send(buffer);
    clock.time = 102;
    socket.send(view);

    expect(socket.sent).toEqual(['€1', buffer, view]);
    expect(socket.sent[2]).toBe(view);
    const sends = recorder.ws().filter((d) => d.event === 'send');
    expect(sends.map(({ t, opcode, bytes, data }) => ({ t, opcode, bytes, data }))).toEqual([
      { t: 100, opcode: 'text', bytes: 4, data: '€1' },
      { t: 101, opcode: 'binary', bytes: 5, data: btoa('\x01\x02\x03\x04\x05') },
      { t: 102, opcode: 'binary', bytes: 3, data: btoa('\x02\x03\x04') },
    ]);
    expect(sends.every((d) => d.socketId === 1 && d.url === socket.url && d.code === null)).toBeTrue();
  });

  it('does not record a send that throws', () => {
    const host = fakeHost();
    install(host);
    const socket = openFake(host);

    expect(() => socket.send('too early')).toThrowMatching(
      (error: unknown) => error instanceof DOMException && error.name === 'InvalidStateError',
    );

    expect(socket.sent).toEqual([]);
    expect(recorder.ws().filter((d) => d.event === 'send')).toEqual([]);
  });

  it('records ArrayBuffer and Blob frames as base64 with byte counts', async () => {
    const host = fakeHost();
    install(host);
    const socket = openFake(host);
    socket.fireOpen();

    socket.fireMessage(new Uint8Array([104, 105, 0, 255]).buffer);
    socket.fireMessage(new Blob([new Uint8Array([7, 8, 9])]));
    socket.send(new Blob(['ok']));
    await until(() => recorder.ws().length === 4);

    const frames = recorder
      .ws()
      .slice(1)
      .map(({ event, opcode, bytes, data }) => ({ event, opcode, bytes, data }));
    expect(frames).toContain({ event: 'receive', opcode: 'binary', bytes: 4, data: btoa('hi\x00\xff') });
    expect(frames).toContain({ event: 'receive', opcode: 'binary', bytes: 3, data: btoa('\x07\x08\x09') });
    expect(frames).toContain({ event: 'send', opcode: 'binary', bytes: 2, data: btoa('ok') });
  });

  it('stamps Blob frames with the event time, not the read time', async () => {
    const host = fakeHost();
    install(host);
    const socket = openFake(host);
    socket.fireOpen();

    clock.time = 5000;
    socket.fireMessage(new Blob(['payload']));
    clock.time = 9000;
    await until(() => recorder.ws().length === 2);

    expect(recorder.ws()[1].event).toBe('receive');
    expect(recorder.ws()[1].t).toBe(5000);
  });

  it('groups frames by socketId across two sockets', () => {
    const host = fakeHost();
    install(host);
    const first = openFake(host, 'ws://example.test/a');
    const second = openFake(host, 'ws://example.test/b');

    second.fireOpen();
    first.fireOpen();
    first.fireMessage('a1');
    second.fireMessage('b1');
    first.send('a2');

    expect(recorder.ws().map(({ socketId, url, event }) => `${socketId} ${url} ${event}`)).toEqual([
      '2 ws://example.test/b open',
      '1 ws://example.test/a open',
      '1 ws://example.test/a receive',
      '2 ws://example.test/b receive',
      '1 ws://example.test/a send',
    ]);

    // The counter is per install: a fresh probe starts again at 1.
    probes.pop()?.dispose();
    install(host);
    openFake(host).fireOpen();
    expect(recorder.ws()[5].socketId).toBe(1);
  });

  it('does not touch onmessage/onopen handlers set by the app', async () => {
    const before = ['onopen', 'onmessage', 'onerror', 'onclose'].map((key) =>
      Object.getOwnPropertyDescriptor(RealWebSocket.prototype, key),
    );
    const host: WebSocketHost = { WebSocket: RealWebSocket };
    install(host);
    const socket = new host.WebSocket('ws://127.0.0.1:9');

    expect(socket.onopen).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(socket.onerror).toBeNull();
    expect(socket.onclose).toBeNull();
    const after = ['onopen', 'onmessage', 'onerror', 'onclose'].map((key) =>
      Object.getOwnPropertyDescriptor(RealWebSocket.prototype, key),
    );
    expect(after).toEqual(before);

    const appError = jasmine.createSpy('app onerror');
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.onclose = resolve;
    });
    socket.onerror = appError;
    const onclose = socket.onclose;

    await closed;

    expect(appError).toHaveBeenCalledTimes(1);
    expect(socket.onerror).toBe(appError);
    expect(socket.onclose).toBe(onclose);
  });

  it('records error and close from a real refused connection', async () => {
    const host: WebSocketHost = { WebSocket: RealWebSocket };
    install(host);
    clock.time = 777;
    const socket = new host.WebSocket('ws://127.0.0.1:9');

    // Registered after the probe's own listener, so the probe has recorded by the time this fires.
    const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve()));
    await closed;

    expect(recorder.ws()).toEqual([
      {
        kind: 'ws',
        t: 777,
        socketId: 1,
        url: 'ws://127.0.0.1:9/',
        event: 'error',
        opcode: null,
        bytes: null,
        data: null,
        code: null,
      },
      {
        kind: 'ws',
        t: 777,
        socketId: 1,
        url: 'ws://127.0.0.1:9/',
        event: 'close',
        opcode: null,
        bytes: null,
        data: null,
        code: 1006,
      },
    ]);
  });

  it('still delivers events to the app when recording throws', async () => {
    const host = fakeHost();
    install(host);
    recorder.failWith = new Error('recorder is broken');
    const socket = openFake(host);
    const seen: string[] = [];
    for (const type of ['open', 'message', 'error', 'close']) {
      socket.addEventListener(type, () => seen.push(type));
    }

    socket.fireOpen();
    socket.fireMessage('text');
    socket.fireMessage(new Blob(['blob']));
    socket.send('out');
    socket.send(new Blob(['out']));
    socket.fireError();
    socket.fireClose(1000);
    // Let the Blob reads settle: a throw there must not become an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(['open', 'message', 'message', 'error', 'close']);
    expect(socket.sent.length).toBe(2);

    // A throwing clock is just as harmless.
    recorder.failWith = null;
    clock.now = () => {
      throw new Error('clock is broken');
    };
    socket.fireMessage('again');
    socket.send('again');
    expect(seen.length).toBe(6);
    expect(socket.sent.length).toBe(3);
  });

  it('restores the original constructor on dispose', () => {
    const host = fakeHost();
    const original = host.WebSocket;
    const probe = install(host);
    expect(host.WebSocket).not.toBe(original);

    probe.dispose();

    expect(host.WebSocket).toBe(original);

    // Someone patched on top of us: dispose must not unwrap their patch, and
    // sockets made through it (which still run our constructor) stop recording.
    const layered = fakeHost();
    const layeredProbe = install(layered);
    const theirs = class extends layered.WebSocket {};
    layered.WebSocket = theirs;

    layeredProbe.dispose();

    expect(layered.WebSocket).toBe(theirs);
    openFake(layered).fireOpen();
    expect(recorder.ws()).toEqual([]);
  });

  it('stops recording on live sockets after dispose', async () => {
    const host = fakeHost();
    const probe = install(host);
    const socket = openFake(host);
    socket.fireOpen();
    socket.fireMessage(new Blob(['in flight']));

    probe.dispose();
    socket.fireMessage('late');
    socket.send('late');
    socket.fireClose(1000);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recorder.ws().map((d) => d.event)).toEqual(['open']);
    expect(socket.sent).toEqual(['late']);
  });

  it('dispose is idempotent', () => {
    const host = fakeHost();
    const original = host.WebSocket;
    const probe = install(host);

    probe.dispose();
    expect(() => probe.dispose()).not.toThrow();
    expect(host.WebSocket).toBe(original);

    // A later patch by someone else survives a repeated dispose.
    const later = class extends original {};
    host.WebSocket = later;
    probe.dispose();
    expect(host.WebSocket).toBe(later);
  });

  it("probe listeners run outside the app's zone", () => {
    const host = fakeHost();
    install(host);
    const app = countingZone();
    const socket = app.zone.run(() => {
      const created = openFake(host);
      created.addEventListener('message', () => undefined);
      return created;
    });

    socket.fireOpen();
    for (let i = 0; i < 10; i++) socket.fireMessage(`frame ${i}`);
    socket.fireError();
    socket.fireClose(1000);

    expect(recorder.ws().length).toBe(13);
    // Ten frames, ten tasks in the app's zone: only the app's own listener.
    expect(app.events.length).withContext(app.events.join()).toBe(10);
    expect(app.events.every((source) => source.indexOf('message') !== -1)).toBeTrue();
  });

  it('drops its recorder reference on dispose', async () => {
    const touched: PropertyKey[] = [];
    let watching = false;
    const watched = new Proxy(recorder, {
      get(target, key, receiver) {
        if (watching) touched.push(key);
        return Reflect.get(target, key, receiver);
      },
    });
    const host = fakeHost();
    const probe = installWebSocketProbe(watched, clock, host);
    // A socket that stays open, and someone else's subclass on top of ours.
    const socket = openFake(host);
    socket.fireOpen();
    const theirs = class extends host.WebSocket {};
    host.WebSocket = theirs;
    socket.fireMessage(new Blob(['in flight']));

    probe.dispose();
    watching = true;
    socket.fireMessage('late');
    socket.send('late');
    socket.send(new Blob(['late']));
    openFake(host).fireOpen();
    socket.fireClose(1000);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(touched).toEqual([]);
    expect(recorder.ws().map((d) => d.event)).toEqual(['open']);
  });
});
