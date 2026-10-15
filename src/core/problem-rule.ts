/**
 * C-8 — the problem rule (`FR-ACT-04`). One definition, so the launcher's
 * badge, the status bar and the panel model can never disagree on what a
 * "problem" is.
 */
import { CaptureEntry, IsProblemEntry } from '../contract';

/**
 * `true` for an `ErrorEntry`, an HTTP entry with `status ≥ 500` or any
 * `error`, and a WebSocket `error` event.
 *
 * Deliberately not a problem: 4xx (often expected, e.g. a 404 lookup or a 401
 * before login), a WebSocket `close` of any code (the `error` event already
 * marks a broken socket), and log entries of any level — Angular and React
 * errors already make an `ErrorEntry`, so counting `console.error` too would
 * count them twice.
 */
export const isProblemEntry: IsProblemEntry = (entry: CaptureEntry): boolean => {
  switch (entry.kind) {
    case 'error':
      return true;
    case 'http':
      return entry.error !== null || (entry.status !== null && entry.status >= 500);
    case 'ws':
      return entry.event === 'error';
    case 'log':
      return false;
    default:
      return unknownKind(entry);
  }
};

/** Keeps the switch exhaustive at compile time; a kind added later is not a problem until the rule says so. */
function unknownKind(_entry: never): boolean {
  return false;
}
