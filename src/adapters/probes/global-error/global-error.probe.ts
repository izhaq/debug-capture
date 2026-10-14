import { Clock, Probe, Recorder } from '../../../core';

/** The part of `window` this probe listens on — a plain `EventTarget` in specs. */
export interface ErrorEventHost {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * Records uncaught errors and unhandled promise rejections. It only listens:
 * it never calls `preventDefault()` or stops propagation, so the browser still
 * reports the error and the app's own handlers still run exactly as before.
 *
 * Listening in the bubble phase is deliberate: failed `<img>` / `<script>`
 * loads also fire `error`, but those do not bubble to `window` — they are not
 * uncaught errors and would only add noise.
 */
export function installGlobalErrorProbe(
  recorder: Recorder,
  clock: Clock,
  host: ErrorEventHost = globalThis,
): Probe {
  /** Dropped on dispose, so a listener someone still holds cannot keep the buffer alive. */
  let sink: Recorder | null = recorder;

  const onError = (event: Event): void => {
    if (!sink) {
      return;
    }
    try {
      const { message, stack } = describeErrorEvent(event);
      sink.record({ kind: 'error', source: 'window', t: clock.now(), message, stack });
    } catch {
      // Capture must never throw — least of all from inside an error report.
    }
  };

  const onRejection = (event: Event): void => {
    if (!sink) {
      return;
    }
    try {
      const { message, stack } = describeReason('reason' in event ? event.reason : undefined);
      sink.record({ kind: 'error', source: 'unhandledrejection', t: clock.now(), message, stack });
    } catch {
      // Same rule as above.
    }
  };

  host.addEventListener('error', onError);
  host.addEventListener('unhandledrejection', onRejection);

  return {
    name: 'global-error',
    dispose(): void {
      if (!sink) {
        return;
      }
      sink = null;
      host.removeEventListener('error', onError);
      host.removeEventListener('unhandledrejection', onRejection);
    },
  };
}

interface Described {
  readonly message: string;
  readonly stack: string | null;
}

function describeErrorEvent(event: Event): Described {
  if (typeof ErrorEvent === 'undefined' || !(event instanceof ErrorEvent)) {
    return { message: '[error event]', stack: null };
  }
  const error: unknown = event.error;
  const text = event.message || String(error);
  // The location is what makes a minified production error findable.
  const message = event.filename ? `${text} (${event.filename}:${event.lineno}:${event.colno})` : text;
  return { message, stack: stackOf(error) };
}

function describeReason(reason: unknown): Described {
  if (reason instanceof Error) {
    return { message: reason.message, stack: stackOf(reason) };
  }
  if (typeof reason === 'string') {
    return { message: reason, stack: null };
  }
  return { message: stringify(reason), stack: null };
}

/** JSON first, so a rejected `{ code, detail }` stays readable; `String()` when JSON has no answer. */
function stringify(value: unknown): string {
  try {
    const json: unknown = JSON.stringify(value);
    if (typeof json === 'string') {
      return json;
    }
  } catch {
    // Circular structures and BigInt land here.
  }
  return String(value);
}

function stackOf(value: unknown): string | null {
  return typeof value === 'object' && value !== null && 'stack' in value && typeof value.stack === 'string'
    ? value.stack
    : null;
}
