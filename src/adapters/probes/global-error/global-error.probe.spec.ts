import { Clock, EntryDraft, Recorder } from '../../../core';
import { installGlobalErrorProbe } from './global-error.probe';

function createRecorder(): { recorder: Recorder; drafts: EntryDraft[] } {
  const drafts: EntryDraft[] = [];
  const recorder: Recorder = {
    record: (draft) => {
      drafts.push(draft);
    },
    snapshot: () => [],
    clear: () => undefined,
    stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
    onEntry: () => () => undefined,
  };
  return { recorder, drafts };
}

const clock: Clock = { now: () => 2_000 };

/**
 * A real PromiseRejectionEvent. Its promise never settles on purpose: the
 * event constructor copies a Zone.js promise into a fresh native one, and a
 * rejected copy has no `.catch` — Jasmine would then see a genuine unhandled
 * rejection. The probe reads only `reason`, so the promise's state is irrelevant.
 */
function rejection(reason: unknown): PromiseRejectionEvent {
  const promise = new Promise<never>(() => undefined);
  return new PromiseRejectionEvent('unhandledrejection', { promise, reason, cancelable: true });
}

/** Wraps a recorder so every member the probe touches is listed once `watch()` is called. */
function watched(recorder: Recorder) {
  const touched: PropertyKey[] = [];
  let watching = false;
  const proxy = new Proxy(recorder, {
    get(target, key, receiver) {
      if (watching) touched.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  return { recorder: proxy, touched, watch: () => (watching = true) };
}

describe('installGlobalErrorProbe', () => {
  // A real EventTarget stands in for window — the real one is never touched.
  let host: EventTarget;
  let recorder: Recorder;
  let drafts: EntryDraft[];

  beforeEach(() => {
    host = new EventTarget();
    ({ recorder, drafts } = createRecorder());
  });

  it('is named global-error', () => {
    expect(installGlobalErrorProbe(recorder, clock, host).name).toBe('global-error');
  });

  it('records an ErrorEvent with location appended', () => {
    installGlobalErrorProbe(recorder, clock, host);

    host.dispatchEvent(
      new ErrorEvent('error', { message: 'Uncaught boom', filename: 'https://app/main.js', lineno: 12, colno: 7 }),
    );

    expect(drafts).toEqual([
      { kind: 'error', source: 'window', t: 2_000, message: 'Uncaught boom (https://app/main.js:12:7)', stack: null },
    ]);
  });

  it('leaves the location off when there is no filename and falls back to the error text', () => {
    installGlobalErrorProbe(recorder, clock, host);

    host.dispatchEvent(new ErrorEvent('error', { error: 'plain string thrown' }));

    expect(drafts).toEqual([
      { kind: 'error', source: 'window', t: 2_000, message: 'plain string thrown', stack: null },
    ]);
  });

  it("uses the error's stack when present", () => {
    installGlobalErrorProbe(recorder, clock, host);
    const error = new TypeError('bad type');

    host.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: bad type', error }));

    expect(drafts).toEqual([
      {
        kind: 'error',
        source: 'window',
        t: 2_000,
        message: 'Uncaught TypeError: bad type',
        stack: error.stack ?? null,
      },
    ]);
    expect(typeof error.stack).toBe('string');
  });

  it('records a non-ErrorEvent error generically', () => {
    installGlobalErrorProbe(recorder, clock, host);

    host.dispatchEvent(new Event('error'));

    expect(drafts).toEqual([{ kind: 'error', source: 'window', t: 2_000, message: '[error event]', stack: null }]);
  });

  it('records an Error rejection reason with its stack', () => {
    installGlobalErrorProbe(recorder, clock, host);
    const error = new Error('request failed');

    host.dispatchEvent(rejection(error));

    expect(drafts).toEqual([
      { kind: 'error', source: 'unhandledrejection', t: 2_000, message: 'request failed', stack: error.stack ?? null },
    ]);
  });

  it('records string and object rejection reasons', () => {
    installGlobalErrorProbe(recorder, clock, host);
    const circular: { self?: unknown } = {};
    circular.self = circular;

    host.dispatchEvent(rejection('just a string'));
    host.dispatchEvent(rejection({ code: 42, detail: 'nope' }));
    host.dispatchEvent(rejection(undefined));
    host.dispatchEvent(rejection(circular));

    expect(drafts).toEqual([
      { kind: 'error', source: 'unhandledrejection', t: 2_000, message: 'just a string', stack: null },
      { kind: 'error', source: 'unhandledrejection', t: 2_000, message: '{"code":42,"detail":"nope"}', stack: null },
      // JSON.stringify gives no string for these, so String() takes over.
      { kind: 'error', source: 'unhandledrejection', t: 2_000, message: 'undefined', stack: null },
      { kind: 'error', source: 'unhandledrejection', t: 2_000, message: '[object Object]', stack: null },
    ]);
  });

  it('does not prevent default or stop propagation', () => {
    installGlobalErrorProbe(recorder, clock, host);
    const later = jasmine.createSpy('later listener');
    host.addEventListener('error', later);
    host.addEventListener('unhandledrejection', later);

    const events: Event[] = [new ErrorEvent('error', { message: 'x', cancelable: true }), rejection(new Error('y'))];
    for (const event of events) {
      const preventDefault = spyOn(event, 'preventDefault').and.callThrough();
      const stopPropagation = spyOn(event, 'stopPropagation').and.callThrough();
      const stopImmediatePropagation = spyOn(event, 'stopImmediatePropagation').and.callThrough();

      // dispatchEvent returns false only when a listener cancelled the event.
      expect(host.dispatchEvent(event)).toBeTrue();
      expect(event.defaultPrevented).toBeFalse();
      expect(preventDefault).not.toHaveBeenCalled();
      expect(stopPropagation).not.toHaveBeenCalled();
      expect(stopImmediatePropagation).not.toHaveBeenCalled();
    }

    expect(later.calls.allArgs()).toEqual(events.map((event) => [event]));
    expect(drafts.length).toBe(2);
  });

  it('swallows a failure while building the entry', () => {
    const throwing: Recorder = {
      ...recorder,
      record: () => {
        throw new Error('record failed');
      },
    };
    installGlobalErrorProbe(throwing, clock, host);
    const later = jasmine.createSpy('later listener');
    host.addEventListener('error', later);

    // dispatchEvent never re-throws a listener's error; the browser reports it
    // as an uncaught error instead, which Jasmine turns into a failed spec.
    // So reaching the end of this spec green is the proof nothing escaped.
    host.dispatchEvent(new ErrorEvent('error', { message: 'x' }));

    expect(later).toHaveBeenCalledTimes(1);
  });

  it('removes both listeners on dispose and records nothing after', () => {
    const add = spyOn(host, 'addEventListener').and.callThrough();
    const remove = spyOn(host, 'removeEventListener').and.callThrough();
    const probe = installGlobalErrorProbe(recorder, clock, host);

    probe.dispose();
    host.dispatchEvent(new ErrorEvent('error', { message: 'x' }));
    host.dispatchEvent(rejection('y'));

    expect(drafts).toEqual([]);
    expect(add.calls.allArgs().map(([type]) => type)).toEqual(['error', 'unhandledrejection']);
    // The same listener objects that were added are the ones removed.
    expect(remove.calls.allArgs()).toEqual(add.calls.allArgs());
  });

  it('dispose is idempotent', () => {
    const probe = installGlobalErrorProbe(recorder, clock, host);
    const remove = spyOn(host, 'removeEventListener').and.callThrough();

    probe.dispose();
    expect(() => probe.dispose()).not.toThrow();

    expect(remove).toHaveBeenCalledTimes(2);
    host.dispatchEvent(new ErrorEvent('error', { message: 'x' }));
    expect(drafts).toEqual([]);
  });

  it('drops its recorder reference on dispose', () => {
    const spy = watched(recorder);
    const add = spyOn(host, 'addEventListener').and.callThrough();
    const probe = installGlobalErrorProbe(spy.recorder, clock, host);
    host.dispatchEvent(new ErrorEvent('error', { message: 'before' }));
    expect(drafts.length).toBe(1);
    // Listeners someone else still holds (a stale reference) must not reach the recorder.
    const listeners = add.calls.allArgs().map(([, listener]) => listener as (event: Event) => void);

    probe.dispose();
    spy.watch();
    listeners[0](new ErrorEvent('error', { message: 'late' }));
    listeners[1](rejection('late'));

    expect(spy.touched).toEqual([]);
    expect(drafts.length).toBe(1);
  });
});
