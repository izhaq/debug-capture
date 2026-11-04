import { Clock, HttpEntry, MockResponse, createRecorder, resolvePolicy } from '../../../core';
import { FetchHost, installFetchProbe, installXhrProbe, MockBox, XhrHost } from './index';

/** S-16a (C-13, FR-RPL-03, FR-RPL-07): mocks answer the app's fetch and XHR; `send()` resends from the page. */

const location = { href: 'http://app.test/base/page' };
const clock: Clock = { now: () => 1000 };
const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

/** Text bodies are read as a stream after the app has its Response: wait for the entries. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await flush();
  expect(condition()).withContext('condition never became true').toBeTrue();
}

const MOCK: MockResponse = {
  status: 503,
  statusText: 'Mocked',
  headers: { 'content-type': 'application/json', 'x-mock': 'yes' },
  body: '{"down":true}',
};

/** A box whose resolver answers `MOCK` for GET /api/orders and nothing else. */
function box(): MockBox {
  return {
    resolver: (request) => (request.method === 'GET' && request.url === 'http://app.test/api/orders' ? MOCK : null),
  };
}

function recorder() {
  const rec = createRecorder(resolvePolicy());
  const http = () => rec.snapshot().filter((e): e is HttpEntry => e.kind === 'http');
  return { rec, http };
}

describe('installFetchProbe — mocks and send (C-13)', () => {
  it('a hit answers the app without the network; recorded with origin "mock"', async () => {
    const original = jasmine.createSpy<typeof fetch>('fetch');
    const host: FetchHost = { fetch: original, location };
    const { rec, http } = recorder();
    const probe = installFetchProbe(rec, clock, host, box());

    const response = await host.fetch('/api/orders');
    expect(original).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.statusText).toBe('Mocked');
    expect(response.headers.get('x-mock')).toBe('yes');
    expect(await response.json()).toEqual({ down: true });
    await until(() => http().length === 1);
    expect(http()[0]).toEqual(
      jasmine.objectContaining({ method: 'GET', status: 503, resBody: '{"down":true}', origin: 'mock' }),
    );
    probe.dispose();
  });

  it('a miss, or no resolver, goes to the network as before, with no origin', async () => {
    const original = jasmine
      .createSpy<typeof fetch>('fetch')
      .and.callFake(() => Promise.resolve(new Response('ok', { status: 200 })));
    const host: FetchHost = { fetch: original, location };
    const mocks = box();
    const { rec, http } = recorder();
    const probe = installFetchProbe(rec, clock, host, mocks);

    await host.fetch('/api/orders', { method: 'POST' });
    mocks.resolver = null;
    await host.fetch('/api/orders');
    await until(() => http().length === 2);
    expect(original).toHaveBeenCalledTimes(2);
    expect(http().map((e) => e.origin)).toEqual([undefined, undefined]);
    probe.dispose();
  });

  it('send(): the original fetch with the draft, same-origin credentials, recorded with origin "replay"; resolves to the requestId', async () => {
    const original = jasmine
      .createSpy<typeof fetch>('fetch')
      .and.callFake(() => Promise.resolve(new Response('{"id":7}', { status: 201 })));
    const host: FetchHost = { fetch: original, location };
    const { rec, http } = recorder();
    const probe = installFetchProbe(rec, clock, host, box());

    const id = await probe.send({
      method: 'post',
      url: '/api/orders',
      headers: { 'content-type': 'application/json' },
      body: '{"qty":2}',
    });
    await until(() => http().length === 1);
    const [url, init] = original.calls.mostRecent().args;
    expect(url).toBe('http://app.test/api/orders');
    expect(init).toEqual(
      jasmine.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"qty":2}',
        credentials: 'same-origin',
      }),
    );
    const entry = http()[0];
    expect(entry).toEqual(
      jasmine.objectContaining({ method: 'POST', status: 201, reqBody: '{"qty":2}', origin: 'replay' }),
    );
    expect(typeof id).toBe('number');
    expect(entry?.requestId).toBe(id ?? -1);
    probe.dispose();
  });

  it('send() never rejects: a network error is recorded and still resolves; a GET sends no body', async () => {
    const original = jasmine
      .createSpy<typeof fetch>('fetch')
      .and.callFake(() => Promise.reject(new TypeError('Failed to fetch')));
    const host: FetchHost = { fetch: original, location };
    const { rec, http } = recorder();
    const probe = installFetchProbe(rec, clock, host);

    await expectAsync(probe.send({ method: 'GET', url: '/x', headers: {}, body: 'ignored' })).toBeResolved();
    await flush();
    expect(original.calls.mostRecent().args[1]?.body).toBeUndefined();
    expect(http()[0]).toEqual(jasmine.objectContaining({ error: 'network', origin: 'replay' }));
    probe.dispose();
    expect(await probe.send({ method: 'GET', url: '/x', headers: {}, body: null }))
      .withContext('after dispose nothing is sent')
      .toBeNull();
  });
});

describe('installXhrProbe — mocks (C-13, D-54)', () => {
  const HostXhr = class extends XMLHttpRequest {};
  const host = (): XhrHost => ({ XMLHttpRequest: HostXhr as unknown as XhrHost['XMLHttpRequest'], location });
  let probe: ReturnType<typeof installXhrProbe> | null = null;
  afterEach(() => probe?.dispose());

  /** Opens and sends a real XHR; resolves with the events seen in order once `loadend` has run. */
  function run(type: XMLHttpRequestResponseType, url = '/api/orders', method = 'GET') {
    const xhr = new HostXhr();
    const seen: string[] = [];
    xhr.onreadystatechange = () => seen.push(`rs${xhr.readyState}`);
    for (const name of ['loadstart', 'load', 'loadend', 'error']) xhr.addEventListener(name, () => seen.push(name));
    xhr.open(method, url);
    xhr.responseType = type;
    const done = new Promise<void>((resolve) => xhr.addEventListener('loadend', () => setTimeout(resolve)));
    xhr.send();
    return { xhr, seen, done };
  }

  it('a hit answers the XHR without the network: ready states, events, status and headers, asynchronously', async () => {
    const { rec, http } = recorder();
    probe = installXhrProbe(rec, clock, host(), box());
    const { xhr, seen, done } = run('');
    expect(xhr.readyState).withContext('nothing happens inside send()').toBe(1);
    await done;

    expect(seen).toEqual(['rs1', 'loadstart', 'rs2', 'rs3', 'rs4', 'load', 'loadend']);
    expect(xhr.status).toBe(503);
    expect(xhr.statusText).toBe('Mocked');
    expect(xhr.getResponseHeader('X-Mock')).toBe('yes');
    expect(xhr.getAllResponseHeaders()).toContain('x-mock: yes');
    expect(xhr.responseText).toBe('{"down":true}');
    expect(xhr.response).toBe('{"down":true}');
    expect(xhr.responseURL).toBe('http://app.test/api/orders');
    expect(http()[0]).toEqual(
      jasmine.objectContaining({ transport: 'xhr', status: 503, resBody: '{"down":true}', origin: 'mock' }),
    );
  });

  it('responseType "json" and "text" get the parsed object and the text', async () => {
    const { rec } = recorder();
    probe = installXhrProbe(rec, clock, host(), box());
    const json = run('json');
    const text = run('text');
    await Promise.all([json.done, text.done]);
    expect(json.xhr.response).toEqual({ down: true });
    expect(text.xhr.response).toBe('{"down":true}');
  });

  it('a reused instance after a mock is a native XHR again; a miss is never touched', async () => {
    const { rec, http } = recorder();
    probe = installXhrProbe(rec, clock, host(), box());
    const first = run('');
    await first.done;
    const url = URL.createObjectURL(new Blob(['real'], { type: 'text/plain' }));
    const again = new Promise<void>((resolve) => first.xhr.addEventListener('loadend', () => setTimeout(resolve)));
    first.xhr.open('GET', url);
    first.xhr.send();
    await again;
    URL.revokeObjectURL(url);
    expect(first.xhr.status).toBe(200);
    expect(first.xhr.responseText).toBe('real');
    expect(http().map((e) => [e.status, e.origin])).toEqual([
      [503, 'mock'],
      [200, undefined],
    ]);
  });

  it('abort() before the mock answers: no load, recorded as aborted', async () => {
    const { rec, http } = recorder();
    probe = installXhrProbe(rec, clock, host(), box());
    const { xhr, seen } = run('');
    xhr.abort();
    await flush();
    await flush();
    expect(seen).not.toContain('load');
    expect(http()[0]).toEqual(jasmine.objectContaining({ error: 'abort', status: null, origin: 'mock' }));
    expect(rec.pending()).toEqual([]);
  });
});
