import { CAPTURE_SCHEMA_VERSION, CaptureEntry, CaptureFile, CaptureStats, PendingRequest } from '../contract';

/** What the caller reads from the environment at export time — core reads no globals itself. */
export interface CaptureMeta {
  readonly capturedAt: string;
  readonly page: string;
  readonly userAgent: string;
}

/**
 * `pending` (C-1) is written only when something is in flight, so a file
 * with none is byte-for-byte the v1 shape.
 */
export function buildCaptureFile(
  entries: readonly CaptureEntry[],
  stats: CaptureStats,
  meta: CaptureMeta,
  pending: readonly PendingRequest[] = [],
): CaptureFile {
  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    capturedAt: meta.capturedAt,
    page: meta.page,
    userAgent: meta.userAgent,
    // Copies, so a recorder that keeps recording cannot change a built file.
    stats: { ...stats },
    entries: entries.slice(),
    ...(pending.length > 0 ? { pending: pending.slice() } : null),
  };
}

/** Indented, because a developer reads this file by hand on another machine. */
export function serializeCaptureFile(file: CaptureFile): string {
  return JSON.stringify(file, null, 2);
}

/** `debug-capture-YYYYMMDD-HHmmss.json` in local time — the time on the operator's wall clock. */
export function defaultCaptureFileName(at: Date): string {
  const date = `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}`;
  const time = `${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
  return `debug-capture-${date}-${time}.json`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
