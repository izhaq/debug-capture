import { CaptureSession, EntryDraft, Recorder } from '..';
import { ReactErrorDefaults, createReactRootErrorOptions, recordReactError } from './index';
import { ReactDefaultsScope, reactDefaultErrorBehaviour } from './react-error-handlers';

/**
 * React catches render and lifecycle errors itself and reports them through
 * its root error callbacks (React 19) or an error boundary's
 * componentDidCatch (React 18), with a component stack the global probes
 * never see. The adapter records them, then does exactly what the app or
 * React would have done anyway.
 *
 * There is no React here: React calls these as plain functions, so the specs
 * do the same. The session is an inline fake (a recorder pushing drafts into
 * an array, a fixed clock) and React's defaults are spies — no spec touches
 * `reportError`, `window` or `console`.
 */
describe('React error handlers', () => {
  const now = 1_760_000_000_000;
  const errorStack = 'Error: render blew up\n    at Broken (app.js:10:5)';
  const componentStack = '\n    at Broken (app.js:10:5)\n    at App (app.js:3:1)';

  let drafts: EntryDraft[];
  let defaults: jasmine.SpyObj<ReactErrorDefaults>;

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

  /** An Error with a fixed stack, so expectations do not depend on the browser's format. */
  function renderError(): Error {
    const error = new Error('render blew up');
    error.stack = errorStack;
    return error;
  }

  /** `[message, stack]` of each recorded draft. */
  function recorded(): (readonly [string, string | null])[] {
    return drafts.map((d) => (d.kind === 'error' ? ([d.message, d.stack] as const) : ['not an error', null]));
  }

  beforeEach(() => {
    drafts = [];
    defaults = jasmine.createSpyObj<ReactErrorDefaults>('defaults', ['reportError', 'logError']);
  });

  it('records an uncaught error with source react and the component stack', () => {
    const options = createReactRootErrorOptions(fakeSession(), {}, defaults);

    options.onUncaughtError(renderError(), { componentStack });

    expect(drafts).toEqual([
      {
        kind: 'error',
        source: 'react',
        t: now,
        message: 'render blew up',
        stack: `${errorStack}\n\nReact component stack (uncaught):${componentStack}`,
      },
    ]);
  });

  it('labels caught and recovered errors in the stack section', () => {
    const options = createReactRootErrorOptions(fakeSession(), {}, defaults);

    options.onCaughtError(renderError(), { componentStack, errorBoundary: {} });
    options.onRecoverableError(renderError(), { componentStack });

    expect(recorded()).toEqual([
      ['render blew up', `${errorStack}\n\nReact component stack (caught by an error boundary):${componentStack}`],
      ['render blew up', `${errorStack}\n\nReact component stack (recovered):${componentStack}`],
    ]);
  });

  it('uses only the component stack when the error has no stack', () => {
    const options = createReactRootErrorOptions(fakeSession(), {}, defaults);
    const stackless = new Error('no stack');
    stackless.stack = undefined;

    options.onUncaughtError(stackless, { componentStack });
    options.onCaughtError('thrown string', { componentStack: 'at Widget' });

    expect(recorded()).toEqual([
      ['no stack', `React component stack (uncaught):${componentStack}`],
      // A stack React gave without its usual leading newline still starts on its own line.
      ['thrown string', 'React component stack (caught by an error boundary):\nat Widget'],
    ]);
  });

  it('stack is null with neither stack nor component stack', () => {
    const options = createReactRootErrorOptions(fakeSession(), {}, defaults);

    options.onUncaughtError('a', {});
    options.onCaughtError('b', { componentStack: null });
    options.onRecoverableError('c', { componentStack: '' });

    expect(recorded()).toEqual([
      ['a', null],
      ['b', null],
      ['c', null],
    ]);
  });

  it('describes string and object errors', () => {
    const options = createReactRootErrorOptions(fakeSession(), {}, defaults);
    const circular: { self?: unknown } = {};
    circular.self = circular;

    options.onUncaughtError('plain string', {});
    options.onUncaughtError({ code: 42 }, {});
    options.onUncaughtError(circular, {});
    options.onUncaughtError(undefined, {});

    expect(recorded()).toEqual([
      ['plain string', null],
      ['{"code":42}', null],
      ['[object Object]', null],
      ['undefined', null],
    ]);
  });

  it("calls React's default after recording (reportError / logError)", () => {
    const options = createReactRootErrorOptions(fakeSession(), {}, defaults);
    const recordedWhenCalled: number[] = [];
    defaults.reportError.and.callFake(() => recordedWhenCalled.push(drafts.length));
    defaults.logError.and.callFake(() => recordedWhenCalled.push(drafts.length));
    const uncaught = renderError();
    const caught = renderError();
    const recoverable = renderError();

    options.onUncaughtError(uncaught, { componentStack });
    options.onCaughtError(caught, { componentStack });
    options.onRecoverableError(recoverable, { componentStack });

    expect(defaults.reportError.calls.allArgs()).toEqual([[uncaught], [recoverable]]);
    expect(defaults.logError.calls.allArgs()).toEqual([[caught]]);
    // Each default ran after its own error was recorded.
    expect(recordedWhenCalled).toEqual([1, 2, 3]);
  });

  it("calls the app's own handler instead of the default when given", () => {
    const next = {
      onUncaughtError: jasmine.createSpy('onUncaughtError'),
      onCaughtError: jasmine.createSpy('onCaughtError'),
      onRecoverableError: jasmine.createSpy('onRecoverableError'),
    };
    next.onUncaughtError.and.callFake(() => expect(drafts.length).toBe(1));
    const options = createReactRootErrorOptions(fakeSession(), next, defaults);
    const error = renderError();
    const uncaughtInfo = { componentStack };
    const caughtInfo = { componentStack, errorBoundary: {} };
    const recoverableInfo = { componentStack };

    options.onUncaughtError(error, uncaughtInfo);
    options.onCaughtError(error, caughtInfo);
    options.onRecoverableError(error, recoverableInfo);

    // The very same arguments React passed, untouched.
    expect(next.onUncaughtError).toHaveBeenCalledOnceWith(error, uncaughtInfo);
    expect(next.onUncaughtError.calls.argsFor(0)[1]).toBe(uncaughtInfo);
    expect(next.onCaughtError.calls.argsFor(0)[1]).toBe(caughtInfo);
    expect(next.onRecoverableError.calls.argsFor(0)[1]).toBe(recoverableInfo);
    expect(defaults.reportError).not.toHaveBeenCalled();
    expect(defaults.logError).not.toHaveBeenCalled();
    expect(drafts.length).toBe(3);
  });

  it('keeps the default for a handler the app did not pass', () => {
    const onCaughtError = jasmine.createSpy('onCaughtError');
    const options = createReactRootErrorOptions(fakeSession(), { onCaughtError }, defaults);
    const error = renderError();

    options.onUncaughtError(error, {});
    options.onCaughtError(error, {});

    expect(defaults.reportError).toHaveBeenCalledOnceWith(error);
    expect(onCaughtError).toHaveBeenCalledTimes(1);
    expect(defaults.logError).not.toHaveBeenCalled();
  });

  it("lets the app's own handler throw through unchanged", () => {
    const fromApp = new Error('app handler failed');
    const options = createReactRootErrorOptions(
      fakeSession(),
      {
        onUncaughtError: () => {
          throw fromApp;
        },
      },
      defaults,
    );

    let thrown: unknown;
    try {
      options.onUncaughtError(renderError(), { componentStack });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBe(fromApp);
    expect(drafts.length).toBe(1);
  });

  it('lets a throwing default throw through unchanged', () => {
    const fromDefault = new Error('reportError failed');
    defaults.reportError.and.throwError(fromDefault);
    const options = createReactRootErrorOptions(fakeSession(), {}, defaults);

    expect(() => options.onRecoverableError(renderError(), {})).toThrow(fromDefault);
  });

  it('still delegates when recording throws', () => {
    const session = fakeSession({
      recorder: {
        record: () => {
          throw new Error('recorder broken');
        },
      },
    });
    const options = createReactRootErrorOptions(session, {}, defaults);
    const error = renderError();

    expect(() => options.onUncaughtError(error, { componentStack })).not.toThrow();
    expect(() => options.onCaughtError(error, { componentStack })).not.toThrow();
    expect(defaults.reportError).toHaveBeenCalledOnceWith(error);
    expect(defaults.logError).toHaveBeenCalledOnceWith(error);
  });

  it('only delegates with a null or inactive session', () => {
    const error = renderError();

    createReactRootErrorOptions(null, {}, defaults).onUncaughtError(error, { componentStack });
    createReactRootErrorOptions(fakeSession({ active: false }), {}, defaults).onCaughtError(error, { componentStack });

    expect(drafts).toEqual([]);
    expect(defaults.reportError).toHaveBeenCalledOnceWith(error);
    expect(defaults.logError).toHaveBeenCalledOnceWith(error);
  });

  it('2.2 (FR-BG-10): takes a session getter, read on each error', () => {
    let current: CaptureSession | null = null;
    const options = createReactRootErrorOptions(() => current, {}, defaults);

    options.onUncaughtError(renderError(), { componentStack });
    current = fakeSession();
    options.onCaughtError(renderError(), { componentStack });
    recordReactError(() => current, renderError());

    expect(recorded().length).toBe(2);
    expect(defaults.reportError).toHaveBeenCalledTimes(1);
    expect(defaults.logError).toHaveBeenCalledTimes(1);
  });

  it('2.2: a throwing session getter records nothing and still delegates', () => {
    const error = renderError();
    const broken = (): CaptureSession | null => {
      throw new Error('getter broke');
    };

    createReactRootErrorOptions(broken, {}, defaults).onUncaughtError(error, { componentStack });

    expect(drafts).toEqual([]);
    expect(defaults.reportError).toHaveBeenCalledOnceWith(error);
  });

  it('recordReactError defaults to caught and never throws', () => {
    // React 18: an error boundary's componentDidCatch(error, info) calls this.
    recordReactError(fakeSession(), renderError(), { componentStack });
    recordReactError(fakeSession(), 'no info');
    recordReactError(fakeSession(), renderError(), { componentStack }, 'uncaught');
    recordReactError(null, renderError(), { componentStack });

    expect(recorded()).toEqual([
      ['render blew up', `${errorStack}\n\nReact component stack (caught by an error boundary):${componentStack}`],
      ['no info', null],
      ['render blew up', `${errorStack}\n\nReact component stack (uncaught):${componentStack}`],
    ]);

    const broken = fakeSession({
      recorder: {
        record: () => {
          throw new Error('recorder broken');
        },
      },
    });
    const brokenClock: CaptureSession = {
      ...fakeSession(),
      clock: {
        now: () => {
          throw new Error('clock broken');
        },
      },
    };
    const hostileInfo = {
      get componentStack(): string {
        throw new Error('getter broken');
      },
    };

    expect(() => recordReactError(broken, renderError(), { componentStack })).not.toThrow();
    expect(() => recordReactError(brokenClock, renderError())).not.toThrow();
    expect(() => recordReactError(fakeSession(), renderError(), hostileInfo)).not.toThrow();
  });

  it('returns exactly the three RootOptions callbacks', () => {
    const options = createReactRootErrorOptions(null, undefined, defaults);

    expect(Object.keys(options).sort()).toEqual(['onCaughtError', 'onRecoverableError', 'onUncaughtError']);
    expect(Object.values(options).every((value) => typeof value === 'function')).toBeTrue();
  });

  describe("React's default behaviour", () => {
    /** A fake `window` that records what was dispatched. */
    function fakeWindow(dispatchResult: boolean): { dispatched: Event[]; window: ReactDefaultsScope['window'] } {
      const dispatched: Event[] = [];
      return {
        dispatched,
        window: {
          ErrorEvent,
          dispatchEvent: (event: Event) => {
            dispatched.push(event);
            return dispatchResult;
          },
        },
      };
    }

    it('the default reportError calls reportError when it is a function', () => {
      const reportError = jasmine.createSpy('reportError');
      const consoleError = jasmine.createSpy('console.error');
      const error = renderError();

      reactDefaultErrorBehaviour({ reportError, console: { error: consoleError } }).reportError(error);

      expect(reportError).toHaveBeenCalledOnceWith(error);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('the default reportError falls back to an ErrorEvent on window when reportError is missing', () => {
      const { dispatched, window } = fakeWindow(true);
      const consoleError = jasmine.createSpy('console.error');
      const error = renderError();

      reactDefaultErrorBehaviour({ window, console: { error: consoleError } }).reportError(error);

      expect(dispatched.length).toBe(1);
      const event = dispatched[0] as ErrorEvent;
      expect(event).toBeInstanceOf(ErrorEvent);
      expect(event.type).toBe('error');
      expect(event.bubbles).toBeTrue();
      expect(event.cancelable).toBeTrue();
      expect(event.message).toBe('render blew up');
      expect(event.error).toBe(error);
      // Nobody cancelled the event, so React also logs it.
      expect(consoleError).toHaveBeenCalledOnceWith(error);
    });

    it('the fallback stops at a cancelled ErrorEvent and logs when there is no window', () => {
      const cancelled = fakeWindow(false);
      const consoleError = jasmine.createSpy('console.error');

      reactDefaultErrorBehaviour({ window: cancelled.window, console: { error: consoleError } }).reportError('a');
      expect(cancelled.dispatched.length).toBe(1);
      expect((cancelled.dispatched[0] as ErrorEvent).message).toBe('a');
      expect(consoleError).not.toHaveBeenCalled();

      reactDefaultErrorBehaviour({ console: { error: consoleError } }).reportError('b');
      expect(consoleError).toHaveBeenCalledOnceWith('b');
    });

    it('the default logError calls console.error, read at call time', () => {
      const scope: { console: { error: (...data: unknown[]) => void } } = { console: { error: () => undefined } };
      const behaviour = reactDefaultErrorBehaviour(scope);
      // Swapped after creation, the way the console probe patches console.error.
      const later = jasmine.createSpy('later console.error');
      scope.console = { error: later };

      behaviour.logError('caught');

      expect(later).toHaveBeenCalledOnceWith('caught');
    });
  });
});
