import { XhrFactory } from '@angular/common';
import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CaptureController, CaptureEnvironment, HttpEntry, MockResponse, createCaptureController } from '..';

/**
 * S-16a (S16-03, FR-RPL-07, D-54): a mock answers a real Angular `HttpClient`
 * call through `HttpXhrBackend` — the XHR the app's own code path builds, read
 * the way Angular reads it. Nothing global is patched: Angular builds its XHRs
 * from the subclass the probe patches.
 */
const AppXhr = class extends XMLHttpRequest {};

function environment(): CaptureEnvironment {
  const quiet = (): void => undefined;
  const location = { href: 'http://app.test/' };
  return {
    clock: { now: () => 1_760_000_000_000 },
    console: { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet },
    errors: new EventTarget(),
    xhr: { XMLHttpRequest: AppXhr, location },
    fetch: { fetch: () => Promise.reject(new TypeError('no network in this spec')), location },
    webSocket: { WebSocket: class extends EventTarget {} as unknown as typeof WebSocket },
    download: {} as CaptureEnvironment['download'],
    clipboard: {} as CaptureEnvironment['clipboard'],
    keyboard: new EventTarget(),
    page: { location, userAgent: 'FakeBrowser/1.0' },
  };
}

describe('Angular HttpClient answered by a mock (C-13)', () => {
  let controller: CaptureController;

  beforeEach(() => {
    controller = createCaptureController({ shortcuts: false }, environment());
    controller.setMockResolver((request): MockResponse | null => {
      if (request.url.endsWith('/api/orders')) {
        return { status: 200, headers: { 'Content-Type': 'application/json', 'X-Mock': '1' }, body: '{"n":3}' };
      }
      if (request.url.endsWith('/api/down')) return { status: 503, statusText: 'Down', headers: {}, body: 'oops' };
      return null;
    });
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), { provide: XhrFactory, useValue: { build: () => new AppXhr() } }],
    });
  });

  afterEach(() => controller.dispose());

  it('a success: status, headers and the parsed JSON body reach the app; recorded as mocked', async () => {
    const http = TestBed.inject(HttpClient);
    const response = await firstValueFrom(
      http.get<{ n: number }>('http://app.test/api/orders', { observe: 'response' }),
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ n: 3 });
    expect(response.headers.get('x-mock')).toBe('1');
    expect(response.url).toBe('http://app.test/api/orders');
    const [entry] = controller.session.recorder.snapshot().filter((e): e is HttpEntry => e.kind === 'http');
    expect(entry).toEqual(jasmine.objectContaining({ transport: 'xhr', status: 200, origin: 'mock' }));
  });

  it('an error status reaches the app as an HttpErrorResponse with that status and body', async () => {
    const http = TestBed.inject(HttpClient);
    const failure = await firstValueFrom(http.get('http://app.test/api/down', { responseType: 'text' })).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HttpErrorResponse);
    expect(failure).toEqual(jasmine.objectContaining({ status: 503, statusText: 'Down', error: 'oops' }));
  });
});
