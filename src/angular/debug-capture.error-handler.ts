import { ErrorHandler, Injectable, inject } from '@angular/core';

import { DEBUG_CAPTURE_SESSION } from './debug-capture.tokens';

/**
 * Records the errors Angular catches itself — template, lifecycle and zone
 * task errors never reach window.onerror, and Angular's default handler only
 * console.errors them, losing the structured stack.
 *
 * Always delegates to the default handler afterwards, so the app behaves
 * exactly as without capture. The console probe also records that
 * console.error line; the duplicate is intentional and cheap — the `angular`
 * entry is the one carrying the stack.
 */
@Injectable()
export class DebugCaptureErrorHandler extends ErrorHandler {
  private readonly session = inject(DEBUG_CAPTURE_SESSION, { optional: true });

  override handleError(error: unknown): void {
    const session = this.session;
    if (session?.active) {
      // A debug tool must never turn one error into two: any failure while
      // recording is swallowed and Angular's handling still runs.
      try {
        session.recorder.record({
          kind: 'error',
          source: 'angular',
          t: session.clock.now(),
          ...describeError(unwrapZoneRejection(error)),
        });
      } catch {
        // Intentionally ignored — see above.
      }
    }
    super.handleError(error);
  }
}

/**
 * zone.js reports an unhandled promise rejection as a wrapper Error with a
 * generic "Uncaught (in promise)" message; the real cause is `rejection`.
 */
function unwrapZoneRejection(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'rejection' in error ? error.rejection : error;
}

function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message, stack: typeof error.stack === 'string' ? error.stack : null };
  }
  if (typeof error === 'string') {
    return { message: error, stack: null };
  }
  return { message: stringify(error), stack: null };
}

/** JSON first for readable objects; String() for circular values and for what JSON.stringify returns undefined on. */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
