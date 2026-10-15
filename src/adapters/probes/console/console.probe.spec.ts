import { Clock, EntryDraft, LOG_LEVELS, LogLevel, Recorder } from '../../../core';
import { ConsoleHost, installConsoleProbe } from './console.probe';

type SpyHost = { [L in LogLevel]: jasmine.Spy<(...args: unknown[]) => unknown> };

/** A plain object of spies standing in for `console` — the real one is never patched. */
function createHost(): SpyHost {
  const host = {} as SpyHost;
  for (const level of LOG_LEVELS) {
    host[level] = jasmine.createSpy(level).and.returnValue(`${level}-result`);
  }
  return host;
}

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

const clock: Clock = { now: () => 1_000 };

/** Calls a (possibly wrapped) host method and hands back whatever it returned. */
function call(host: ConsoleHost, level: LogLevel, thisArg: unknown, ...args: unknown[]): unknown {
  const method = host[level] as (this: unknown, ...a: unknown[]) => unknown;
  return method.apply(thisArg, args);
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

describe('installConsoleProbe', () => {
  let host: SpyHost;
  let originals: SpyHost;
  let recorder: Recorder;
  let drafts: EntryDraft[];

  beforeEach(() => {
    host = createHost();
    originals = { ...host };
    ({ recorder, drafts } = createRecorder());
  });

  it('is named console', () => {
    expect(installConsoleProbe(recorder, clock, host).name).toBe('console');
  });

  it('records each level with its raw args and the clock time', () => {
    installConsoleProbe(recorder, clock, host);
    const payload = { a: 1 };

    for (const level of LOG_LEVELS) {
      call(host, level, host, `${level} message`, payload);
    }

    expect(drafts).toEqual(
      LOG_LEVELS.map((level) => ({ kind: 'log', level, t: 1_000, args: [`${level} message`, payload] })),
    );
    // Raw: the probe hands over the very same object; cloning is the recorder's job.
    const first = drafts[0];
    expect(first.kind === 'log' && first.args[1]).toBe(payload);
  });

  it('calls the original once with the same this and args', () => {
    installConsoleProbe(recorder, clock, host);
    const receiver = { name: 'receiver' };

    for (const level of LOG_LEVELS) {
      call(host, level, receiver, 'x', 2);

      expect(originals[level].calls.count()).toBe(1);
      expect(originals[level].calls.mostRecent().object).toBe(receiver);
      expect(originals[level].calls.mostRecent().args).toEqual(['x', 2]);
    }
  });

  it("returns the original's return value", () => {
    installConsoleProbe(recorder, clock, host);

    for (const level of LOG_LEVELS) {
      expect(call(host, level, host, 'x')).toBe(`${level}-result`);
    }
  });

  it('still calls the original when recording throws', () => {
    const throwing: Recorder = {
      ...recorder,
      record: () => {
        throw new Error('record failed');
      },
    };
    installConsoleProbe(throwing, clock, host);

    expect(() => call(host, 'error', host, 'boom')).not.toThrow();
    expect(originals.error).toHaveBeenCalledOnceWith('boom');
  });

  it('still calls the original when the clock throws', () => {
    const brokenClock: Clock = {
      now: () => {
        throw new Error('clock failed');
      },
    };
    installConsoleProbe(recorder, brokenClock, host);

    expect(call(host, 'warn', host, 'w')).toBe('warn-result');
    expect(originals.warn).toHaveBeenCalledOnceWith('w');
    expect(drafts).toEqual([]);
  });

  it('does not re-record console calls made while recording', () => {
    // A recorder (or one of its listeners) that logs — the classic way a
    // debug tool turns one log line into infinite recursion.
    const chatty: Recorder = {
      ...recorder,
      record: (draft) => {
        drafts.push(draft);
        call(host, 'warn', host, 'nested');
        call(host, 'log', host, 'nested again');
      },
    };
    installConsoleProbe(chatty, clock, host);

    call(host, 'log', host, 'outer');

    expect(drafts.length).toBe(1);
    expect(originals.warn).toHaveBeenCalledOnceWith('nested');
    expect(originals.log.calls.allArgs()).toEqual([['nested again'], ['outer']]);

    // The guard is released afterwards: the next top-level call records again.
    call(host, 'info', host, 'later');
    expect(drafts.length).toBe(2);
  });

  it('releases the re-entrancy guard even when recording throws', () => {
    let fail = true;
    const flaky: Recorder = {
      ...recorder,
      record: (draft) => {
        if (fail) {
          fail = false;
          throw new Error('once');
        }
        drafts.push(draft);
      },
    };
    installConsoleProbe(flaky, clock, host);

    call(host, 'log', host, 'first');
    call(host, 'log', host, 'second');

    expect(drafts.length).toBe(1);
  });

  it('restores every original on dispose', () => {
    const probe = installConsoleProbe(recorder, clock, host);
    for (const level of LOG_LEVELS) {
      expect(host[level]).not.toBe(originals[level]);
    }

    probe.dispose();

    for (const level of LOG_LEVELS) {
      expect(host[level]).toBe(originals[level]);
    }
  });

  it('dispose is idempotent', () => {
    const probe = installConsoleProbe(recorder, clock, host);

    probe.dispose();
    expect(() => probe.dispose()).not.toThrow();

    for (const level of LOG_LEVELS) {
      expect(host[level]).toBe(originals[level]);
    }
  });

  it('becomes a pass-through when wrapped again by someone else', () => {
    const probe = installConsoleProbe(recorder, clock, host);
    const ours = host.log;
    const theirs = jasmine.createSpy('theirs').and.callFake(function (this: unknown, ...args: unknown[]) {
      return ours.apply(this, args);
    });
    host.log = theirs;

    probe.dispose();

    // Their wrapper stays — unwrapping it would silently drop their patch.
    expect(host.log).toBe(theirs);
    expect(call(host, 'log', host, 'after')).toBe('log-result');
    expect(originals.log).toHaveBeenCalledOnceWith('after');
    expect(drafts).toEqual([]);
    // The untouched levels are restored as usual.
    expect(host.warn).toBe(originals.warn);
  });

  it('records nothing after dispose', () => {
    const probe = installConsoleProbe(recorder, clock, host);
    const wrapper = host.error;

    probe.dispose();
    call(host, 'error', host, 'via host');
    // Someone who grabbed the wrapper before dispose still reaches the original.
    expect(call(host, 'error', host, 'x')).toBe('error-result');
    wrapper.call(host, 'via stale reference');

    expect(drafts).toEqual([]);
    expect(originals.error.calls.allArgs()).toEqual([['via host'], ['x'], ['via stale reference']]);
  });

  it('drops its recorder reference on dispose', () => {
    const spy = watched(recorder);
    const probe = installConsoleProbe(spy.recorder, clock, host);
    call(host, 'log', host, 'before');
    expect(drafts.length).toBe(1);
    // Someone else's wrapper keeps ours alive in their chain.
    const ours = host.warn;
    host.warn = jasmine.createSpy('theirs').and.callFake(function (this: unknown, ...args: unknown[]) {
      return ours.apply(this, args);
    });

    probe.dispose();
    spy.watch();
    call(host, 'warn', host, 'through their chain');
    ours.call(host, 'stale reference');

    expect(spy.touched).toEqual([]);
    expect(drafts.length).toBe(1);
    expect(originals.warn.calls.allArgs()).toEqual([['through their chain'], ['stale reference']]);
  });
});
