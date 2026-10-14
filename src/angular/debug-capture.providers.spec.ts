import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CaptureSession } from '..';
import { DebugCaptureErrorHandler } from './debug-capture.error-handler';
import { provideDebugCapture, provideDebugCaptureSession } from './debug-capture.providers';
import { DEBUG_CAPTURE_SESSION } from './debug-capture.tokens';

/**
 * provideDebugCapture() goes in the root providers; the session itself is
 * provided at platform level by main.ts through provideDebugCaptureSession(),
 * so it exists before bootstrap and reaches every injector below.
 */
describe('debug-capture providers', () => {
  /** Only identity matters here; the handler spec exercises a working fake. */
  const session: CaptureSession = {
    recorder: {
      record: () => undefined,
      snapshot: () => [],
      clear: () => undefined,
      stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
      onEntry: () => () => undefined,
    },
    clock: { now: () => 0 },
    active: true,
    toJson: () => '',
    download: () => undefined,
    copy: () => Promise.resolve(false),
    clear: () => undefined,
    dispose: () => undefined,
  };

  it('provideDebugCapture replaces the ErrorHandler', () => {
    TestBed.configureTestingModule({ providers: [provideDebugCapture()] });

    expect(TestBed.inject(ErrorHandler)).toBeInstanceOf(DebugCaptureErrorHandler);
  });

  it('provideDebugCaptureSession provides the given session', () => {
    TestBed.configureTestingModule({ providers: [provideDebugCaptureSession(session)] });

    expect(TestBed.inject(DEBUG_CAPTURE_SESSION)).toBe(session);
  });

  it('the token has no root default', () => {
    // A providedIn: 'root' factory would be resolved by the root injector
    // and shadow the platform-level session main.ts provides — capture would
    // silently never reach Angular.
    TestBed.configureTestingModule({});

    expect(TestBed.inject(DEBUG_CAPTURE_SESSION, null)).toBeNull();
    // A null default would pass the line above too. A root factory answers
    // whatever the caller's not-found value is; only a token with no default
    // falls through to it.
    expect(TestBed.inject(DEBUG_CAPTURE_SESSION, session)).toBe(session);
  });
});
