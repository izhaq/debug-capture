import type { CaptureEntry } from '..';

/**
 * The problem rule (`FR-ACT-04`, D-21): an error entry, an HTTP 5xx or failed
 * request, a WebSocket `error` event. Not 4xx, not `console.error`.
 *
 * TODO(wave-2 merge): delete this file and import `isProblemEntry` from '..'
 * once track 01b (C-8) is in the wave branch — one rule for the badge and the
 * panel model.
 */
export function isProblemEntry(entry: CaptureEntry): boolean {
  switch (entry.kind) {
    case 'error':
      return true;
    case 'http':
      return entry.error !== null || (entry.status !== null && entry.status >= 500);
    case 'ws':
      return entry.event === 'error';
    default:
      return false;
  }
}
