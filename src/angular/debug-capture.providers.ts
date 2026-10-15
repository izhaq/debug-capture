import { ErrorHandler, Provider, StaticProvider } from '@angular/core';

import { CaptureSession } from '..';
import { DebugCaptureErrorHandler } from './debug-capture.error-handler';
import { DEBUG_CAPTURE_SESSION } from './debug-capture.tokens';

/**
 * The host wiring seam — one call in the root providers plugs the Angular
 * side of debug capture in: errors Angular catches itself are recorded
 * through the session's recorder.
 *
 * Safe when capture is off: with no session (or a `null` one) the handler
 * only delegates to Angular's default ErrorHandler.
 *
 * A factory, not `useClass`: the handler has no decorator (HLD C-4), so it
 * has no Angular factory of its own. The injector calls this factory inside
 * its injection context, which is what the handler's `inject()` needs. It
 * works the same in JIT and AOT hosts and needs no Angular build step.
 */
export function provideDebugCapture(): Provider[] {
  return [{ provide: ErrorHandler, useFactory: () => new DebugCaptureErrorHandler() }];
}

/**
 * Hands the session main.ts created to Angular. Meant for the PLATFORM
 * providers — `platformBrowserDynamic([provideDebugCaptureSession(session)])`
 * — so it exists before bootstrap; hence a StaticProvider. Pass `null` when
 * capture is off.
 */
export function provideDebugCaptureSession(session: CaptureSession | null): StaticProvider {
  return { provide: DEBUG_CAPTURE_SESSION, useValue: session };
}
