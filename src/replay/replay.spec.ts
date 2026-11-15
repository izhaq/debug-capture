import { CaptureController, CaptureEnvironment, createCaptureController, HttpEntry, MockRule } from '..';
import { MOCKS_STORAGE_KEY } from './mocks';
import { installReplay, ReplayScope, ReplayTarget } from './replay';

/** S-16b (S16-07, S16-08, FR-RPL-01, 03 … 08, 11): `installReplay()` on a real controller. */
describe('installReplay (S-16b)', () => {
  const location = { href: 'http://app.test/base/page' };
  let network: jasmine.Spy<typeof fetch>;
  let fetchHost: { fetch: typeof fetch; location: { href: string } };
  let stored: Map<string, string>;
  let warn: jasmine.Spy;
  let controllers: CaptureController[];

  function environment(): CaptureEnvironment {
    const quiet = (): void => undefined;
    fetchHost = { fetch: network, location };
    return {
      clock: { now: () => 1_760_000_000_000 },
      console: { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet },
      errors: new EventTarget(),
      xhr: { XMLHttpRequest: class extends XMLHttpRequest {}, location },
      fetch: fetchHost,
      webSocket: { WebSocket: class extends EventTarget {} as unknown as typeof WebSocket },
      download: {} as CaptureEnvironment['download'],
      clipboard: {} as CaptureEnvironment['clipboard'],
      keyboard: new EventTarget(),
      page: { location, userAgent: 'FakeBrowser/1.0' },
    };
  }
  const controller = (): CaptureController => {
    const made = createCaptureController({ shortcuts: false }, environment());
    controllers.push(made);
    return made;
  };
  const scope = (overrides: Partial<ReplayScope> = {}): ReplayScope => ({
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => void stored.set(key, value),
    },
    console: { warn },
    location,
    ...overrides,
  });
  const http = (c: CaptureController) => c.session.recorder.snapshot().filter((e): e is HttpEntry => e.kind === 'http');
  const RULE: Omit<MockRule, 'id'> = {
    on: true,
    method: 'GET',
    url: '/api/orders',
    response: { status: 418, headers: { 'x-mock': '1' }, body: 'teapot' },
  };

  beforeEach(() => {
    network = jasmine.createSpy<typeof fetch>('fetch').and.callFake(() => Promise.resolve(new Response('real')));
    stored = new Map();
    warn = jasmine.createSpy('warn');
    controllers = [];
  });
  afterEach(() => controllers.forEach((c) => c.dispose()));

  it('FR-RPL-11: without allow: true it does nothing, returns null and logs one line saying why', async () => {
    const c = controller();
    expect(installReplay(c, { allow: false }, scope())).toBeNull();
    expect(installReplay(c, {} as { allow: boolean }, scope())).toBeNull();
    expect(c.replay).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.calls.first().args[0])).toContain('allow: true');
    stored.set(
      MOCKS_STORAGE_KEY,
      JSON.stringify({ v: 1, rules: [{ id: 'm1', ...RULE, url: 'http://app.test/api/orders' }] }),
    );
    expect(installReplay(c, { allow: false }, scope())).toBeNull();
    expect((await fetchHost.fetch('/api/orders')).status)
      .withContext('no mock is set')
      .toBe(200);
  });

  it('on a controller: sets controller.replay, the mocks answer the app, and a second call gives the same API', async () => {
    const c = controller();
    const api = installReplay(c, { allow: true }, scope());
    expect(api).not.toBeNull();
    expect(c.replay).toBe(api);
    expect(installReplay(c, { allow: true }, scope()))
      .withContext('idempotent')
      .toBe(api);
    api?.mocks.add(RULE);
    const response = await fetchHost.fetch('/api/orders');
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('teapot');
    expect(network).not.toHaveBeenCalled();
  });

  it('D-53: rules stored by an earlier page apply from the first request; corrupt storage gives none', async () => {
    stored.set(
      MOCKS_STORAGE_KEY,
      JSON.stringify({ v: 1, rules: [{ id: 'm1', ...RULE, url: 'http://app.test/api/orders' }] }),
    );
    const c = controller();
    const api = installReplay(c, { allow: true }, scope());
    expect(api?.mocks.list().length).toBe(1);
    expect((await fetchHost.fetch('/api/orders')).status).toBe(418);

    stored.set(MOCKS_STORAGE_KEY, 'garbage');
    const other = controller();
    expect(installReplay(other, { allow: true }, scope())?.mocks.list()).toEqual([]);
  });

  it('a page whose storage getter throws still gets the API, with rules for this page only', () => {
    const blocked = scope();
    Object.defineProperty(blocked, 'localStorage', {
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    const api = installReplay(controller(), { allow: true }, blocked);
    expect(api?.mocks.add(RULE).id).toBe('m1');
  });

  it('FR-RPL-03, 04: send() resends from the page; a draft that still holds a redacted value is refused', async () => {
    const c = controller();
    const api = installReplay(c, { allow: true }, scope());
    const redacted = c.session.policy.redactedValue;

    expect(await api?.send({ method: 'GET', url: '/a', headers: { authorization: redacted }, body: null })).toBeNull();
    expect(await api?.send({ method: 'POST', url: '/a', headers: {}, body: `{"password":"${redacted}"}` })).toBeNull();
    expect(network).not.toHaveBeenCalled();

    const id = await api?.send({ method: 'POST', url: '/a', headers: { authorization: 'Bearer real' }, body: '{}' });
    expect(typeof id).toBe('number');
    expect(network).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 200 && http(c).length === 0; i++) await new Promise((r) => setTimeout(r));
    expect(http(c).find((e) => e.requestId === id)?.origin).toBe('replay');
  });

  it('FR-RPL-05, 06: resend() and deliver() go to the controller sockets; false for a socket it does not know', () => {
    const c = controller();
    const api = installReplay(c, { allow: true }, scope());
    expect(api?.resend(99, 'x')).toBeFalse();
    expect(api?.deliver(99, 'x')).toBeFalse();
    const send = spyOn(c.sockets, 'send').and.returnValue(true);
    const deliver = spyOn(c.sockets, 'deliver').and.returnValue(true);
    expect(api?.resend(3, 'out')).toBeTrue();
    expect(api?.deliver(4, 'in')).toBeTrue();
    expect(send).toHaveBeenCalledOnceWith(3, 'out');
    expect(deliver).toHaveBeenCalledOnceWith(4, 'in');
  });

  it('on the activation handle: waits for the session, then follows each new controller; one rule list for all', async () => {
    let listener: ((c: CaptureController | null) => void) | null = null;
    let current: CaptureController | null = null;
    const handle: ReplayTarget = {
      get controller() {
        return current;
      },
      onChange: (l) => {
        listener = l;
        return () => (listener = null);
      },
    };
    const api = installReplay(handle, { allow: true }, scope());
    expect(api).not.toBeNull();
    expect(installReplay(handle, { allow: true }, scope()))
      .withContext('idempotent')
      .toBe(api);
    api?.mocks.add(RULE);
    expect(await api?.send({ method: 'GET', url: '/a', headers: {}, body: null }))
      .withContext('off: nothing sent')
      .toBeNull();
    expect(api?.resend(1, 'x')).toBeFalse();

    const first = controller();
    current = first;
    (listener as ((c: CaptureController | null) => void) | null)?.(first);
    expect(first.replay).toBe(api);
    expect((await fetchHost.fetch('/api/orders')).status).toBe(418);

    current = null;
    (listener as ((c: CaptureController | null) => void) | null)?.(null);
    first.dispose();
    const second = controller();
    current = second;
    (listener as ((c: CaptureController | null) => void) | null)?.(second);
    expect(second.replay).toBe(api);
    expect((await fetchHost.fetch('/api/orders')).status)
      .withContext('the same rules')
      .toBe(418);
  });

  it('on a handle already switched on: attaches to its controller at once', async () => {
    const c = controller();
    const api = installReplay({ controller: c, onChange: () => () => undefined }, { allow: true }, scope());
    expect(c.replay).toBe(api);
    api?.mocks.add(RULE);
    expect((await fetchHost.fetch('/api/orders')).status).toBe(418);
  });
});
