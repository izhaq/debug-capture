import {
  CaptureEntry,
  CaptureFile,
  CaptureSession,
  ClipboardHost,
  ConsoleHost,
  CaptureController,
  CreateCaptureController,
  DebugCaptureOptions,
  DownloadHost,
  FetchHost,
  ProbeRecorder,
  RecorderChange,
  WebSocketEntry,
  WebSocketHost,
  createRecorder,
  defaultCaptureFileName,
  resolvePolicy,
} from '../adapters';
import { CaptureEnvironment } from './environment';
import { createCaptureController, getActiveCaptureSession, installDebugCapture } from './install-debug-capture';

/**
 * Everything here runs against a fake CaptureEnvironment: the real console,
 * XMLHttpRequest.prototype, fetch, WebSocket, window and document are never
 * patched, listened on or clicked.
 */

const PAGE = 'http://app.test/experiments?debug=1';
const USER_AGENT = 'FakeBrowser/1.0';
const NOW = Date.UTC(2026, 9, 12, 8, 30, 0);

/** Never installed on `window` — lives only on the fake host. */
class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: unknown[] = [];

  constructor(url: string) {
    super();
    this.url = url;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    // Nothing to close: there is no wire.
  }
}

interface FakeAnchor {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click: jasmine.Spy;
  remove: jasmine.Spy;
}

function fakeEnvironment() {
  const consoleHost: ConsoleHost = {
    log: jasmine.createSpy('console.log'),
    info: jasmine.createSpy('console.info'),
    warn: jasmine.createSpy('console.warn'),
    error: jasmine.createSpy('console.error'),
    debug: jasmine.createSpy('console.debug'),
  };
  const originalLog = consoleHost.log;

  // A subclass, so the probe patches its prototype and never XMLHttpRequest.prototype.
  const XhrClass = class extends XMLHttpRequest {};
  const fetchFn = window.fetch.bind(window);
  const fetchHost = { fetch: fetchFn, location: { href: PAGE } };
  const webSocketHost: WebSocketHost = { WebSocket: FakeWebSocket as unknown as typeof WebSocket };

  const anchors: FakeAnchor[] = [];
  const blobs: Blob[] = [];
  const download: DownloadHost = {
    document: {
      createElement: () => {
        const anchor: FakeAnchor = {
          href: '',
          download: '',
          rel: '',
          style: { display: '' },
          click: jasmine.createSpy('anchor.click'),
          remove: jasmine.createSpy('anchor.remove'),
        };
        anchors.push(anchor);
        return anchor;
      },
      body: { appendChild: (node: unknown) => node },
    } as unknown as DownloadHost['document'],
    URL: {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return `blob:fake/${blobs.length}`;
      },
      revokeObjectURL: () => undefined,
    } as unknown as DownloadHost['URL'],
    defer: (fn) => fn(),
  };

  const writeText = jasmine.createSpy<(text: string) => Promise<void>>('writeText').and.resolveTo();
  const clipboard: ClipboardHost = {
    navigator: { clipboard: { writeText } },
    document: {} as ClipboardHost['document'],
    isSecureContext: true,
  };

  const errors = new EventTarget();
  const keyboard = new EventTarget();

  const env: CaptureEnvironment = {
    clock: { now: () => NOW },
    console: consoleHost,
    errors,
    xhr: { XMLHttpRequest: XhrClass, location: { href: PAGE } },
    fetch: fetchHost,
    webSocket: webSocketHost,
    download,
    clipboard,
    keyboard,
    page: { location: { href: PAGE }, userAgent: USER_AGENT },
  };

  return {
    env,
    consoleHost,
    originalLog,
    XhrClass,
    fetchHost,
    fetchFn,
    webSocketHost,
    errors,
    keyboard,
    anchors,
    blobs,
    writeText,
  };
}

type Fake = ReturnType<typeof fakeEnvironment>;

const objectUrls: string[] = [];

/** A same-document URL: real XHR / fetch traffic without a server. */
function blobUrl(text: string, type = 'application/json'): string {
  const url = URL.createObjectURL(new Blob([text], { type }));
  objectUrls.push(url);
  return url;
}

function xhrRequest(fake: Fake, method: string, url: string, body?: string): Promise<void> {
  return new Promise((resolve) => {
    const xhr = new fake.XhrClass();
    xhr.addEventListener('loadend', () => resolve());
    xhr.open(method, url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(body);
  });
}

/** Waits (macrotask by macrotask) until `condition` holds — real XHR / fetch settle asynchronously. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(condition()).withContext('condition never became true').toBeTrue();
}

function entries(session: CaptureSession): readonly CaptureEntry[] {
  return session.recorder.snapshot();
}

function kinds(session: CaptureSession): string[] {
  return entries(session).map((e) => (e.kind === 'http' ? `http:${e.transport}` : e.kind));
}

function chord(code: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { code, ctrlKey: true, altKey: true, shiftKey: true, cancelable: true });
}

describe('installDebugCapture', () => {
  let fake: Fake;

  beforeEach(() => {
    fake = fakeEnvironment();
  });

  afterEach(() => {
    // The active session is module state: never let it leak into the next spec.
    getActiveCaptureSession()?.dispose();
    objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  });

  it('captures console, errors, xhr, fetch and websocket end to end', async () => {
    const session = installDebugCapture({}, fake.env);

    fake.consoleHost.log('hello', { step: 1 });
    expect(fake.originalLog).toHaveBeenCalledOnceWith('hello', { step: 1 });

    fake.errors.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));

    await xhrRequest(fake, 'GET', blobUrl('{"via":"xhr"}'));
    await until(() => kinds(session).includes('http:xhr'));

    const response = await fake.fetchHost.fetch(blobUrl('{"via":"fetch"}'));
    expect(await response.json()).toEqual({ via: 'fetch' });
    await until(() => kinds(session).includes('http:fetch'));

    const socket = new fake.webSocketHost.WebSocket('ws://app.test/live');
    socket.dispatchEvent(new Event('open'));
    socket.send('ping');
    socket.dispatchEvent(new MessageEvent('message', { data: 'pong' }));

    expect(kinds(session)).toEqual(['log', 'error', 'http:xhr', 'http:fetch', 'ws', 'ws', 'ws']);
    const json = session.toJson();
    expect(json).toContain('"hello"');
    expect(json).toContain('boom');
    expect(json).toContain('{\\"via\\":\\"xhr\\"}');
    expect(json).toContain('{\\"via\\":\\"fetch\\"}');
    expect(json).toContain('"pong"');
  });

  it('redacts the login password before it reaches the export', async () => {
    const session = installDebugCapture({}, fake.env);
    const login = JSON.stringify({ username: 'op', password: 's3cret', mode: 'ops', position: 'lead' });

    await xhrRequest(fake, 'POST', blobUrl('{}'), login);
    await until(() => kinds(session).includes('http:xhr'));

    const json = session.toJson();
    expect(json).not.toContain('s3cret');
    expect(json).toContain('[redacted]');
    expect(json).toContain('\\"username\\":\\"op\\"');
  });

  it('toJson produces a schema-versioned file', () => {
    const session = installDebugCapture({}, fake.env);
    fake.consoleHost.warn('careful');

    const file = JSON.parse(session.toJson()) as CaptureFile;

    expect(file.schemaVersion).toBe(1);
    expect(file.capturedAt).toBe(new Date(NOW).toISOString());
    expect(file.page).toBe(PAGE);
    expect(file.userAgent).toBe(USER_AGENT);
    expect(file.stats).toEqual({ recorded: 1, dropped: 0, evicted: 0, failed: 0 });
    expect(file.entries.length).toBe(1);
    expect(file.entries[0] as unknown).toEqual({ kind: 'log', seq: 1, t: NOW, level: 'warn', args: ['careful'] });
  });

  it('download and copy hand the JSON to the sinks', async () => {
    const session = installDebugCapture({}, fake.env);
    fake.consoleHost.info('to export');
    const json = session.toJson();

    session.download('named.json');
    expect(fake.anchors.length).toBe(1);
    expect(fake.anchors[0].download).toBe('named.json');
    expect(fake.anchors[0].click).toHaveBeenCalledTimes(1);
    expect(fake.blobs[0].type).toBe('application/json');
    expect(await fake.blobs[0].text()).toBe(json);

    session.download();
    expect(fake.anchors[1].download).toBe(defaultCaptureFileName(new Date(NOW)));

    expect(await session.copy()).toBeTrue();
    expect(fake.writeText).toHaveBeenCalledOnceWith(json);
  });

  it('shortcuts trigger download, copy and clear', async () => {
    const session = installDebugCapture({ shortcuts: { copy: 'ctrl+alt+shift+k' } }, fake.env);
    fake.consoleHost.log('before');

    const downloadKey = chord('KeyD');
    fake.keyboard.dispatchEvent(downloadKey);
    expect(downloadKey.defaultPrevented).toBeTrue();
    expect(fake.anchors.length).toBe(1);
    expect(fake.anchors[0].click).toHaveBeenCalledTimes(1);

    // The default copy chord was replaced, so it does nothing now.
    fake.keyboard.dispatchEvent(chord('KeyC'));
    fake.keyboard.dispatchEvent(chord('KeyK'));
    await until(() => fake.writeText.calls.count() > 0);
    expect(fake.writeText).toHaveBeenCalledTimes(1);

    fake.keyboard.dispatchEvent(chord('KeyX'));
    expect(entries(session).length).toBe(0);
  });

  it('shortcuts: false binds nothing', () => {
    const keyboard = jasmine.createSpyObj<CaptureEnvironment['keyboard']>('keyboard', [
      'addEventListener',
      'removeEventListener',
    ]);

    installDebugCapture({ shortcuts: false }, { ...fake.env, keyboard });

    expect(keyboard.addEventListener).not.toHaveBeenCalled();
  });

  it('returns the active session instead of installing twice', () => {
    const first = installDebugCapture({}, fake.env);
    const other = fakeEnvironment();
    const originalOtherLog = other.consoleHost.log;

    const second = installDebugCapture({}, other.env);

    expect(second).toBe(first);
    expect(getActiveCaptureSession()).toBe(first);
    expect(other.consoleHost.log).toBe(originalOtherLog);
  });

  it('keeps going when one probe fails to install, and records why', () => {
    const session = installDebugCapture({}, { ...fake.env, webSocket: {} as WebSocketHost });

    fake.consoleHost.log('still captured');

    const [failure, log] = entries(session);
    expect(failure.kind).toBe('error');
    if (failure.kind === 'error') {
      expect(failure.source).toBe('capture');
      expect(failure.message).toMatch(/^probe websocket failed to install: /);
    }
    expect(log.kind).toBe('log');
    expect(fake.consoleHost.log).not.toBe(fake.originalLog);
  });

  it('rejects an invalid policy before patching anything', () => {
    const xhrOpen = fake.XhrClass.prototype.open;

    expect(() => installDebugCapture({ policy: { maxEntries: 0 } }, fake.env)).toThrowError(RangeError);

    expect(getActiveCaptureSession()).toBeNull();
    expect(fake.consoleHost.log).toBe(fake.originalLog);
    expect(Object.prototype.hasOwnProperty.call(fake.XhrClass.prototype, 'open')).toBeFalse();
    expect(fake.XhrClass.prototype.open).toBe(xhrOpen);
    expect(fake.fetchHost.fetch).toBe(fake.fetchFn);
    expect(fake.webSocketHost.WebSocket).toBe(FakeWebSocket as unknown as typeof WebSocket);
  });

  it('dispose restores every host and unbinds shortcuts', () => {
    const consoleBefore = { ...fake.consoleHost };
    const session = installDebugCapture({}, fake.env);
    expect(fake.fetchHost.fetch).not.toBe(fake.fetchFn);
    expect(fake.webSocketHost.WebSocket).not.toBe(FakeWebSocket as unknown as typeof WebSocket);

    session.dispose();
    session.dispose();

    expect(session.active).toBeFalse();
    expect(getActiveCaptureSession()).toBeNull();
    expect({ ...fake.consoleHost }).toEqual(consoleBefore);
    for (const name of ['open', 'setRequestHeader', 'send']) {
      expect(Object.prototype.hasOwnProperty.call(fake.XhrClass.prototype, name)).withContext(name).toBeFalse();
    }
    expect(fake.fetchHost.fetch).toBe(fake.fetchFn);
    expect(fake.webSocketHost.WebSocket).toBe(FakeWebSocket as unknown as typeof WebSocket);

    fake.consoleHost.log('after');
    fake.errors.dispatchEvent(new ErrorEvent('error', { message: 'after' }));
    fake.keyboard.dispatchEvent(chord('KeyD'));
    expect(entries(session).length).toBe(0);
    expect(fake.anchors.length).toBe(0);
  });

  it('can install again after dispose', () => {
    const first = installDebugCapture({}, fake.env);
    first.dispose();

    const second = installDebugCapture({}, fake.env);

    expect(second).not.toBe(first);
    expect(second.active).toBeTrue();
    expect(getActiveCaptureSession()).toBe(second);
    fake.consoleHost.log('again');
    expect(entries(second).length).toBe(1);
    expect(entries(first).length).toBe(0);
  });
});

describe('createCaptureController', () => {
  let fake: Fake;

  beforeEach(() => {
    fake = fakeEnvironment();
  });

  afterEach(() => {
    getActiveCaptureSession()?.dispose();
  });

  /** A fetch that settles only when the spec says so. */
  function heldFetch(): { host: FetchHost; resolve(response: Response): void } {
    let resolve: (response: Response) => void = () => undefined;
    const host: FetchHost = {
      fetch: () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
      location: { href: PAGE },
    };
    return { host, resolve: (response) => resolve(response) };
  }

  function wsIds(session: CaptureSession): number[] {
    return entries(session)
      .filter((e): e is WebSocketEntry => e.kind === 'ws')
      .map((e) => e.socketId);
  }

  it('matches the contract type', () => {
    const create: CreateCaptureController = createCaptureController;
    expect(typeof create).toBe('function');
  });

  it('installs capture at once and hands out the session as the active one', () => {
    const controller = createCaptureController({}, fake.env);

    expect(controller.on).toBeTrue();
    expect(controller.session.active).toBeTrue();
    expect(getActiveCaptureSession()).toBe(controller.session);
    fake.consoleHost.log('captured');
    expect(kinds(controller.session)).toEqual(['log']);
  });

  it('stop() removes probes and shortcuts and keeps the buffer; start() reinstalls on the same recorder', () => {
    const consoleBefore = { ...fake.consoleHost };
    const controller = createCaptureController({}, fake.env);
    const { session } = controller;
    const recorder = session.recorder;
    fake.consoleHost.log('before');

    controller.stop();

    expect(controller.on).toBeFalse();
    expect(session.active).toBeFalse();
    expect(getActiveCaptureSession()).toBeNull();
    expect({ ...fake.consoleHost }).toEqual(consoleBefore);
    expect(fake.fetchHost.fetch).toBe(fake.fetchFn);
    expect(fake.webSocketHost.WebSocket).toBe(FakeWebSocket as unknown as typeof WebSocket);
    fake.consoleHost.log('while off');
    fake.keyboard.dispatchEvent(chord('KeyD'));
    expect(fake.anchors.length).toBe(0);
    expect(entries(session).length).toBe(1);

    controller.start();

    expect(controller.session).toBe(session);
    expect(session.recorder).toBe(recorder);
    expect(session.active).toBeTrue();
    expect(getActiveCaptureSession()).toBe(session);
    fake.consoleHost.log('after');
    expect(entries(session).map((e) => e.seq)).toEqual([1, 2]);
    fake.keyboard.dispatchEvent(chord('KeyD'));
    expect(fake.anchors.length).toBe(1);
  });

  it('start() and stop() are no-ops in the matching state; onChange fires on real changes only', () => {
    const controller = createCaptureController({}, fake.env);
    const seen: boolean[] = [];
    const off = controller.onChange((on) => seen.push(on));

    controller.start();
    controller.stop();
    controller.stop();
    controller.start();
    controller.start();
    off();
    off();
    controller.stop();

    expect(seen).toEqual([false, true]);
  });

  it('isolates a throwing onChange listener and keeps the order when a listener changes state', () => {
    const controller = createCaptureController({}, fake.env);
    const first: boolean[] = [];
    const second: boolean[] = [];
    controller.onChange(() => {
      throw new Error('listener bug');
    });
    controller.onChange((on) => {
      first.push(on);
      if (on) controller.stop();
    });
    controller.onChange((on) => second.push(on));
    controller.stop();

    controller.start();

    expect(first).toEqual([false, true, false]);
    expect(second).toEqual([false, true, false]);
    expect(controller.on).toBeFalse();
  });

  it('session.dispose() acts as stop(), and capture can be turned on again', () => {
    const controller = createCaptureController({}, fake.env);
    const seen: boolean[] = [];
    controller.onChange((on) => seen.push(on));

    controller.session.dispose();
    controller.session.dispose();

    expect(controller.on).toBeFalse();
    expect(seen).toEqual([false]);
    controller.start();
    expect(controller.session.active).toBeTrue();
  });

  it('session.policy is the resolved, frozen policy', () => {
    const controller = createCaptureController({ policy: { maxEntries: 42 } }, fake.env);
    const { policy } = controller.session;

    expect(policy.maxEntries).toBe(42);
    expect(policy.redactedValue).toBe('[redacted]');
    expect(Object.isFrozen(policy)).toBeTrue();
    expect(Object.isFrozen(policy.redactHeaders)).toBeTrue();
  });

  it('toJson, download, copy and clear work while off', async () => {
    const controller = createCaptureController({}, fake.env);
    fake.consoleHost.info('kept');
    controller.stop();

    expect((JSON.parse(controller.session.toJson()) as CaptureFile).entries.length).toBe(1);
    controller.session.download('off.json');
    expect(fake.anchors[0].download).toBe('off.json');
    expect(await controller.session.copy()).toBeTrue();
    controller.session.clear();
    expect(entries(controller.session)).toEqual([]);
  });

  it('seq, request ids and socket ids never restart across stop/start', async () => {
    const held = heldFetch();
    const controller = createCaptureController({}, { ...fake.env, fetch: held.host });
    const { session } = controller;
    new fake.webSocketHost.WebSocket('ws://app.test/a').dispatchEvent(new Event('open'));
    void held.host.fetch('/one');
    expect(session.recorder.pending().map((p) => p.id)).toEqual([1]);

    controller.stop();
    controller.start();

    new fake.webSocketHost.WebSocket('ws://app.test/b').dispatchEvent(new Event('open'));
    void held.host.fetch('/two');
    expect(session.recorder.pending().map((p) => p.id)).toEqual([2]);
    expect(wsIds(session)).toEqual([1, 2]);
    expect(entries(session).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('stop() ends every request in flight, and the late response records nothing', async () => {
    const held = heldFetch();
    const controller = createCaptureController({}, { ...fake.env, fetch: held.host });
    const recorder = controller.session.recorder;
    const ended: number[] = [];
    recorder.onPending((event) => {
      if (event.type === 'end') ended.push(event.id);
    });
    const call = held.host.fetch('/slow');
    expect((JSON.parse(controller.session.toJson()) as CaptureFile).pending?.length).toBe(1);

    controller.stop();

    expect(ended).toEqual([1]);
    expect(recorder.pending()).toEqual([]);
    held.resolve(new Response('late'));
    await call;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(entries(controller.session)).toEqual([]);
    expect('pending' in (JSON.parse(controller.session.toJson()) as CaptureFile)).toBeFalse();
  });

  /** The session's recorder is the real one: it has the probes' write side too. */
  function probeSide(controller: CaptureController): ProbeRecorder {
    return controller.session.recorder as unknown as ProbeRecorder;
  }

  it('stop() empties the pending list even when a probe left a request behind', () => {
    const controller = createCaptureController({}, fake.env);
    const recorder = controller.session.recorder;
    // As if a probe had started a request and then failed to end it on dispose.
    probeSide(controller).startPending({
      t: 1,
      transport: 'xhr',
      method: 'GET',
      url: 'http://app.test/x',
      reqHeaders: {},
    });

    controller.stop();

    expect(recorder.pending()).toEqual([]);
  });

  it('the clear shortcut announces cleared (S01-04)', () => {
    const controller = createCaptureController({}, fake.env);
    const changes: RecorderChange[] = [];
    controller.session.recorder.onChange((change) => changes.push(change));
    fake.consoleHost.log('x');

    fake.keyboard.dispatchEvent(chord('KeyX'));

    expect(changes).toEqual([{ type: 'cleared' }]);
  });

  it('ignores a recorder smuggled into the options: session.policy is the policy applied (review 4)', () => {
    const smuggled = createRecorder(resolvePolicy({ redactHeaders: [] }));
    const options = { shortcuts: false, recorder: smuggled } as DebugCaptureOptions;

    const controller = createCaptureController(options, fake.env);
    probeSide(controller).startPending({
      t: 1,
      transport: 'fetch',
      method: 'GET',
      url: 'http://app.test/a',
      reqHeaders: { cookie: 'sid=SECRET' },
    });

    expect(controller.session.recorder).not.toBe(smuggled as unknown as typeof controller.session.recorder);
    expect(controller.session.policy.redactHeaders).toContain('cookie');
    expect(controller.session.recorder.pending()[0].reqHeaders['cookie']).toBe(controller.session.policy.redactedValue);
  });

  it('installDebugCapture() records with a recorder built from its policy', () => {
    const session = installDebugCapture({ policy: { maxEntries: 1 } }, fake.env);
    fake.consoleHost.log('first');
    fake.consoleHost.log('second');

    expect(entries(session).length).toBe(1);
    expect(session.recorder.stats().evicted).toBe(1);
  });

  it('onChange never says off while capture is on, when a listener restarts it during stop() (review R9)', () => {
    const held = heldFetch();
    const controller = createCaptureController({}, { ...fake.env, fetch: held.host });
    const said: Array<[boolean, boolean]> = [];
    controller.onChange((on) => said.push([on, controller.on]));
    let restarted = false;
    controller.session.recorder.onPending((event) => {
      if (event.type === 'end' && !restarted) {
        restarted = true;
        controller.start();
      }
    });
    void held.host.fetch('/slow');

    controller.stop();

    expect(controller.on).toBeTrue();
    expect(said.every(([on, actual]) => on === actual))
      .withContext(JSON.stringify(said))
      .toBeTrue();
    expect(said[said.length - 1]).toEqual([true, true]);
  });

  it('installDebugCapture() while a controller is on returns its session, patching nothing twice', () => {
    const controller = createCaptureController({}, fake.env);
    const patchedLog = fake.consoleHost.log;

    expect(installDebugCapture({}, fake.env)).toBe(controller.session);
    expect(fake.consoleHost.log).toBe(patchedLog);
  });

  it('stays off, and says why, while another capture is installed', () => {
    const first = installDebugCapture({}, fake.env);
    const patchedLog = fake.consoleHost.log;

    const second = createCaptureController({}, fake.env);

    expect(second.on).toBeFalse();
    expect(getActiveCaptureSession()).toBe(first);
    expect(fake.consoleHost.log).toBe(patchedLog);
    const [failure] = entries(second.session);
    expect(failure.kind === 'error' && failure.source === 'capture').toBeTrue();
    first.dispose();
    second.start();
    expect(second.on).toBeTrue();
  });

  it('code that installs while the probes go in gets this session, not a second capture', () => {
    const nested: CaptureSession[] = [];
    let Socket = fake.webSocketHost.WebSocket;
    // A host whose WebSocket getter runs app code — here, an install — while the probes go in.
    const webSocket: WebSocketHost = {
      get WebSocket(): typeof WebSocket {
        if (nested.length === 0) nested.push(installDebugCapture({}, fake.env));
        return Socket;
      },
      set WebSocket(value: typeof WebSocket) {
        Socket = value;
      },
    };

    const controller = createCaptureController({}, { ...fake.env, webSocket });
    const patchedLog = fake.consoleHost.log;
    fake.consoleHost.log('once');

    expect(nested).toEqual([controller.session]);
    expect(kinds(controller.session)).toEqual(['log']);
    controller.stop();
    expect(fake.consoleHost.log).toBe(fake.originalLog);
    expect(patchedLog).not.toBe(fake.originalLog);
  });

  it('rejects an invalid policy before patching anything', () => {
    expect(() => createCaptureController({ policy: { maxBodyLength: -1 } }, fake.env)).toThrowError(RangeError);
    expect(getActiveCaptureSession()).toBeNull();
    expect(fake.consoleHost.log).toBe(fake.originalLog);
  });
});
