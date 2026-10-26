import {
  CAPTURE_SCHEMA_VERSION,
  CaptureEntry,
  CaptureFile,
  CaptureStats,
  ExportedEntry,
  ExportedPendingRequest,
  PendingRequest,
} from '../contract';

/** What the caller reads from the environment at export time — core reads no globals itself. */
export interface CaptureMeta {
  readonly capturedAt: string;
  readonly page: string;
  readonly userAgent: string;
}

/**
 * The file shape is schema 2 (D-36): each entry leads with `sequence` (its
 * `seq`) and `time` (its `t`, readable). `pending` (C-1) is written only when
 * something is in flight.
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
    entries: entries.map(exportEntry),
    ...(pending.length > 0 ? { pending: pending.map(exportPending) } : null),
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

/**
 * `ms` (epoch milliseconds) as the station's local wall-clock time with its
 * UTC offset: `2026-10-25T15:08:56.618+03:00`. People read the local time; the
 * offset keeps it exact (`new Date(time)` gives back `ms`). `offsetMinutes` is
 * the offset east of UTC; it defaults to the station's offset at that moment
 * (so summer time is right per entry). A non-finite `ms` gives `''`.
 */
export function localIsoTime(ms: number, offsetMinutes: number = -new Date(ms).getTimezoneOffset()): string {
  if (!Number.isFinite(ms) || !Number.isFinite(offsetMinutes)) return '';
  const at = new Date(ms + offsetMinutes * 60_000);
  const date = `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
  const time = `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}:${pad2(at.getUTCSeconds())}`;
  const millis = String(at.getUTCMilliseconds()).padStart(3, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${date}T${time}.${millis}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** `seq` → `sequence`, and `time` next to `t`; both first, so a reader sees order and time at a glance. */
function exportEntry(entry: CaptureEntry): ExportedEntry {
  const { seq, ...rest } = entry;
  return { sequence: seq, time: localIsoTime(entry.t), ...rest } as ExportedEntry;
}

function exportPending(request: PendingRequest): ExportedPendingRequest {
  return { ...request, time: localIsoTime(request.t) };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
