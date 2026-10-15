import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CaptureSession, EntryDraft, Recorder } from '..';
import { DebugCaptureErrorHandler } from './debug-capture.error-handler';
import { DEBUG_CAPTURE_SESSION } from './debug-capture.tokens';

/**
 * Angular catches errors thrown in templates, lifecycle hooks and zone tasks
 * itself and hands them to ErrorHandler — the global probes never see them.
 * The handler records them (with the structured stack) when capture is on,
 * and always keeps Angular's default console.error behaviour.
 *
 * The install layer does not exist here, so the session is an inline fake:
 * a recorder that pushes drafts into an array and a fixed clock.
 */
describe('DebugCaptureErrorHandler', () => {
  const now = 1_760_000_000_000;

  let drafts: EntryDraft[];
  let consoleError: jasmine.Spy;

  function fakeSession(overrides: { active?: boolean; recorder?: Partial<Recorder> } = {}): CaptureSession {
    const recorder: Recorder = {
      record: (draft) => {
        drafts.push(draft);
      },
      snapshot: () => [],
      clear: () => undefined,
      stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
      onEntry: () => () => undefined,
      ...overrides.recorder,
    };
    return {
      recorder,
      clock: { now: () => now },
      active: overrides.active ?? true,
      toJson: () => '',
      download: () => undefined,
      copy: () => Promise.resolve(false),
      clear: () => undefined,
      dispose: () => undefined,
    };
  }

  /** `session` undefined = no provider at all (capture never installed). */
  function setup(session?: CaptureSession | null): ErrorHandler {
    TestBed.configureTestingModule({
      providers: [
        DebugCaptureErrorHandler,
        ...(session !== undefined ? [{ provide: DEBUG_CAPTURE_SESSION, useValue: session }] : []),
      ],
    });
    return TestBed.inject(DebugCaptureErrorHandler);
  }

  beforeEach(() => {
    drafts = [];
    // Keeps the run output clean and lets specs assert the delegation.
    consoleError = spyOn(console, 'error');
  });

  it('records an Angular error with message, stack and clock time', () => {
    const handler = setup(fakeSession());
    const error = new Error('template blew up');

    handler.handleError(error);

    expect(drafts).toEqual([
      { kind: 'error', source: 'angular', t: now, message: 'template blew up', stack: error.stack ?? null },
    ]);
  });

  it('unwraps a zone rejection wrapper', () => {
    // zone.js reports an unhandled promise rejection as an Error whose own
    // message is generic; the real cause sits on `rejection`.
    const handler = setup(fakeSession());
    const cause = new Error('request failed');
    const wrapper = Object.assign(new Error('Uncaught (in promise): Error: request failed'), {
      rejection: cause,
    });

    handler.handleError(wrapper);

    expect(drafts.length).toBe(1);
    expect(drafts[0]).toEqual(jasmine.objectContaining({ message: 'request failed', stack: cause.stack ?? null }));
  });

  it('describes string and object errors', () => {
    const handler = setup(fakeSession());
    const circular: { self?: unknown } = {};
    circular.self = circular;

    handler.handleError('plain string');
    handler.handleError({ code: 42 });
    handler.handleError(circular);
    handler.handleError(undefined);
    handler.handleError({ rejection: 'rejected with a string' });

    expect(drafts.map((d) => (d.kind === 'error' ? [d.message, d.stack] : null))).toEqual([
      ['plain string', null],
      ['{"code":42}', null],
      ['[object Object]', null],
      ['undefined', null],
      ['rejected with a string', null],
    ]);
  });

  it('still delegates to the default handler', () => {
    const handler = setup(fakeSession());
    const error = new Error('template blew up');

    handler.handleError(error);

    expect(consoleError).toHaveBeenCalledOnceWith('ERROR', error);
  });

  it('delegates without recording when no session is provided', () => {
    const handler = setup();
    const error = new Error('no capture');

    handler.handleError(error);

    expect(drafts).toEqual([]);
    expect(consoleError).toHaveBeenCalledOnceWith('ERROR', error);
  });

  it('delegates without recording when the session is null', () => {
    // main.ts provides null when capture is switched off.
    const handler = setup(null);
    const error = new Error('capture off');

    handler.handleError(error);

    expect(drafts).toEqual([]);
    expect(consoleError).toHaveBeenCalledOnceWith('ERROR', error);
  });

  it('delegates without recording when the session is inactive', () => {
    const handler = setup(fakeSession({ active: false }));
    const error = new Error('after dispose');

    handler.handleError(error);

    expect(drafts).toEqual([]);
    expect(consoleError).toHaveBeenCalledOnceWith('ERROR', error);
  });

  it('never throws when recording fails', () => {
    const handler = setup(
      fakeSession({
        recorder: {
          record: () => {
            throw new Error('recorder broken');
          },
        },
      }),
    );
    const error = new Error('original');

    expect(() => handler.handleError(error)).not.toThrow();
    expect(consoleError).toHaveBeenCalledOnceWith('ERROR', error);
  });
});
