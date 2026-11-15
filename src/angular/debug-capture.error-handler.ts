import { ErrorHandler, inject } from '@angular/core';

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
 *
 * No `@Injectable()` on purpose (HLD C-4, D-09): the package is built with
 * plain `tsc`, not the Angular compiler, so a decorated class would carry no
 * factory in an AOT host and would ask for the JIT compiler at run time.
 * provideDebugCapture() builds it with a factory instead, which runs inside
 * the injector, so the `inject()` below has an injection context.
 *
 * Built by hand, it needs one too: `new DebugCaptureErrorHandler()` in plain
 * code throws Angular's NG0203 ("inject() must be called from an injection
 * context"). Use provideDebugCapture(), or wrap the call in
 * `runInInjectionContext(injector, ...)`.
 *
 * It wraps Angular's handler instead of extending it: `extends ErrorHandler`
 * would run when the module loads, and any tool that loads angular.mjs with
 * something other than the real class (CommonJS interop in a test runner,
 * prerendering, two copies of @angular/core) would fail on the import with
 * "Class extends value … is not a constructor". Angular finds the handler by
 * its `ErrorHandler` token, not by `instanceof`, so nothing else changes.
 */
export class DebugCaptureErrorHandler implements ErrorHandler {
  private readonly session = inject(DEBUG_CAPTURE_SESSION, { optional: true });
  /** Made on the first error, so the module and the constructor never need the class. */
  private fallback: ErrorHandler | null = null;

  handleError(error: unknown): void {
    // A debug tool must never turn one error into two: any failure while
    // recording (a throwing session getter included) is swallowed and
    // Angular's handling still runs.
    try {
      const source = this.session;
      const session = typeof source === 'function' ? source() : source;
      if (session?.active) {
        session.recorder.record({
          kind: 'error',
          source: 'angular',
          t: session.clock.now(),
          ...describeError(unwrapZoneRejection(error)),
        });
      }
    } catch {
      // Intentionally ignored — see above.
    }
    if (this.fallback === null) this.fallback = new ErrorHandler();
    this.fallback.handleError(error);
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
