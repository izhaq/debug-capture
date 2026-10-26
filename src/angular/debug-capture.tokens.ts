import { InjectionToken } from '@angular/core';

import { CaptureSessionSource } from '..';

/**
 * The capture session main.ts creates before bootstrap, so the Angular layer
 * can reach the same recorder the global probes write to.
 *
 * Deliberately declared WITHOUT `providedIn` / `factory`: main.ts provides
 * the session at platform level (provideDebugCaptureSession), and a
 * `providedIn: 'root'` factory would be resolved by the root injector itself
 * — shadowing the platform value with its default, so the session would
 * silently never arrive.
 *
 * Inject it with `{ optional: true }`. Absent and `null` both mean "capture
 * is off". From 2.2 it may be a function returning the session, read on each
 * error (a session switched on after bootstrap, FR-BG-10).
 */
export const DEBUG_CAPTURE_SESSION = new InjectionToken<CaptureSessionSource>('DEBUG_CAPTURE_SESSION');
