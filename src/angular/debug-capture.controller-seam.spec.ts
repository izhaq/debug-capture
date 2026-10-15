import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CaptureController, CaptureEnvironment, CaptureEntry, createCaptureController } from '..';
import { provideDebugCapture, provideDebugCaptureSession } from './debug-capture.providers';

/**
 * C-2 (HLD §6.6): the Angular seam holds `controller.session` and checks its
 * `active` flag, so it must record again after the controller is stopped and
 * started. Runs against a fake environment: no real global is patched.
 */
function fakeEnvironment(): CaptureEnvironment {
  const quiet = (): void => undefined;
  const location = { href: 'http://app.test/' };
  return {
    clock: { now: () => 1_760_000_000_000 },
    console: { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet },
    errors: new EventTarget(),
    xhr: { XMLHttpRequest: class extends XMLHttpRequest {}, location },
    fetch: { fetch: () => Promise.reject(new TypeError('no network in this spec')), location },
    webSocket: { WebSocket: class extends EventTarget {} as unknown as typeof WebSocket },
    download: {} as CaptureEnvironment['download'],
    clipboard: {} as CaptureEnvironment['clipboard'],
    keyboard: new EventTarget(),
    page: { location, userAgent: 'FakeBrowser/1.0' },
  };
}

function angularMessages(entries: readonly CaptureEntry[]): string[] {
  return entries
    .filter((e) => e.kind === 'error' && e.source === 'angular')
    .map((e) => (e.kind === 'error' ? e.message : ''));
}

describe('DebugCaptureErrorHandler with a capture controller', () => {
  let controller: CaptureController;

  beforeEach(() => {
    controller = createCaptureController({ shortcuts: false }, fakeEnvironment());
    // Angular's default handler logs; keep the run output clean.
    spyOn(console, 'error');
  });

  afterEach(() => controller.stop());

  it('records again after stop → start, and not while off', () => {
    TestBed.configureTestingModule({
      providers: [provideDebugCapture(), provideDebugCaptureSession(controller.session)],
    });
    const handler = TestBed.inject(ErrorHandler);

    handler.handleError(new Error('while on'));
    controller.stop();
    handler.handleError(new Error('while off'));
    controller.start();
    handler.handleError(new Error('on again'));

    expect(angularMessages(controller.session.recorder.snapshot())).toEqual(['while on', 'on again']);
  });
});
