import { Clock, LOG_LEVELS, LogLevel, Probe, Recorder } from '../../../core';

/** The part of `console` this probe patches — a plain object of spies in specs. */
export type ConsoleHost = Pick<Console, LogLevel>;

type ConsoleMethod = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Wraps every `console` level so each call is recorded, then handed to the
 * original untouched. The console is where a debug tool most easily breaks
 * the app it watches, so the wrapper is built around three promises:
 *
 * - the original runs exactly once, with the same `this` and arguments, and
 *   its return value comes back — recording can never prevent or alter it;
 * - recording failures are swallowed — a broken recorder or clock must not
 *   turn a log line into an exception;
 * - calls made *while* recording (a recorder listener that logs) skip
 *   recording — otherwise one log line becomes infinite recursion.
 */
export function installConsoleProbe(recorder: Recorder, clock: Clock, host: ConsoleHost = globalThis.console): Probe {
  /** Dropped on dispose: a wrapper left in someone else's chain must not keep the buffer alive. */
  let sink: Recorder | null = recorder;
  // Shared across levels: a `log` whose listener calls `warn` is still re-entry.
  let recording = false;

  const record = (level: LogLevel, args: unknown[]): void => {
    if (!sink || recording) {
      return;
    }
    recording = true;
    try {
      sink.record({ kind: 'log', level, t: clock.now(), args });
    } catch {
      // Capture must never throw into the caller.
    } finally {
      recording = false;
    }
  };

  const patches = LOG_LEVELS.map((level) => {
    const original = host[level] as ConsoleMethod;
    const wrapper: ConsoleMethod = function (this: unknown, ...args: unknown[]): unknown {
      record(level, args);
      return original.apply(this, args);
    };
    host[level] = wrapper;
    return { level, original, wrapper };
  });

  return {
    name: 'console',
    dispose(): void {
      // Flipping this first turns every wrapper into a pass-through, which
      // covers wrappers we cannot take back below.
      sink = null;
      for (const { level, original, wrapper } of patches) {
        // Someone wrapped us after install: restoring the original would
        // silently drop their patch, so ours stays as a pass-through.
        if (host[level] === wrapper) {
          host[level] = original;
        }
      }
    },
  };
}
