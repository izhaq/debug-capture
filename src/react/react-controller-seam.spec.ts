import { CaptureController, CaptureEnvironment, CaptureEntry, createCaptureController } from '..';
import { createReactRootErrorOptions, recordReactError } from './index';

/**
 * C-2 (HLD §6.6): the React seam holds `controller.session` and checks its
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

function reactMessages(entries: readonly CaptureEntry[]): string[] {
  return entries
    .filter((e) => e.kind === 'error' && e.source === 'react')
    .map((e) => (e.kind === 'error' ? e.message : ''));
}

describe('React seam with a capture controller', () => {
  let controller: CaptureController;

  beforeEach(() => {
    controller = createCaptureController({ shortcuts: false }, fakeEnvironment());
  });

  afterEach(() => controller.stop());

  it('recordReactError records again after stop → start, and not while off', () => {
    recordReactError(controller.session, new Error('while on'));
    controller.stop();
    recordReactError(controller.session, new Error('while off'));
    controller.start();
    recordReactError(controller.session, new Error('on again'));

    expect(reactMessages(controller.session.recorder.snapshot())).toEqual(['while on', 'on again']);
  });

  it('root error options built once keep recording across stop → start', () => {
    const defaults = { reportError: jasmine.createSpy('reportError'), logError: jasmine.createSpy('logError') };
    const options = createReactRootErrorOptions(controller.session, {}, defaults);

    controller.stop();
    options.onCaughtError(new Error('while off'), {});
    controller.start();
    options.onCaughtError(new Error('on again'), {});

    expect(reactMessages(controller.session.recorder.snapshot())).toEqual(['on again']);
    expect(defaults.logError).toHaveBeenCalledTimes(2);
  });
});
