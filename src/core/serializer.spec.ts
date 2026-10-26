import { CAPTURE_SCHEMA_VERSION, CaptureEntry, CaptureStats, PendingRequest } from '../contract';
import {
  buildCaptureFile,
  CaptureMeta,
  defaultCaptureFileName,
  localIsoTime,
  serializeCaptureFile,
} from './serializer';

describe('serializer', () => {
  const entries: CaptureEntry[] = [
    { kind: 'log', seq: 1, t: 10, level: 'info', args: ['hello', { n: 1 }] },
    { kind: 'error', seq: 2, t: 11, source: 'window', message: 'boom', stack: null },
  ];
  const stats: CaptureStats = { recorded: 2, dropped: 1, evicted: 0, failed: 0 };
  const meta: CaptureMeta = {
    capturedAt: '2026-10-12T08:05:03.000Z',
    page: 'http://localhost:4200/home',
    userAgent: 'test-agent',
  };

  it('builds a file with the current schema version; each entry has `sequence` and `time` (D-36)', () => {
    const file = buildCaptureFile(entries, stats, meta);

    expect(file as unknown).toEqual({
      schemaVersion: CAPTURE_SCHEMA_VERSION,
      capturedAt: meta.capturedAt,
      page: meta.page,
      userAgent: meta.userAgent,
      stats,
      entries: [
        { sequence: 1, time: localIsoTime(10), kind: 'log', t: 10, level: 'info', args: ['hello', { n: 1 }] },
        { sequence: 2, time: localIsoTime(11), kind: 'error', t: 11, source: 'window', message: 'boom', stack: null },
      ],
    });
    expect(CAPTURE_SCHEMA_VERSION).toBe(2);
  });

  it('writes `sequence` and `time` first in each entry, and no `seq` (D-36)', () => {
    const text = serializeCaptureFile(buildCaptureFile(entries, stats, meta));
    const first = (JSON.parse(text) as { entries: Record<string, unknown>[] }).entries[0] as Record<string, unknown>;

    expect(Object.keys(first).slice(0, 2)).toEqual(['sequence', 'time']);
    expect('seq' in first).toBeFalse();
    expect(text).not.toContain('"seq"');
    // The source entries are not changed.
    expect(entries[0]?.seq).toBe(1);
  });

  it('lists requests in flight as the optional pending field, and leaves it out when there are none', () => {
    const pending: PendingRequest[] = [
      { id: 3, t: 12, transport: 'xhr', method: 'GET', url: 'http://localhost/slow', reqHeaders: {} },
    ];

    const file = buildCaptureFile(entries, stats, meta, pending);
    pending.pop();

    expect(file.pending as unknown).toEqual([
      {
        id: 3,
        t: 12,
        transport: 'xhr',
        method: 'GET',
        url: 'http://localhost/slow',
        reqHeaders: {},
        time: localIsoTime(12),
      },
    ]);
    expect('pending' in buildCaptureFile(entries, stats, meta, [])).toBeFalse();
    expect('pending' in buildCaptureFile(entries, stats, meta)).toBeFalse();
  });

  it('serializes to JSON that round-trips', () => {
    const file = buildCaptureFile(entries, stats, meta);
    const text = serializeCaptureFile(file);

    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(file)));
    // 2-space indent, so a developer can read the file in any editor.
    expect(text.split('\n')[1]).toBe('  "schemaVersion": 2,');
  });

  it('formats the default file name from local time', () => {
    expect(defaultCaptureFileName(new Date(2026, 9, 12, 8, 5, 3))).toBe('debug-capture-20261012-080503.json');
    expect(defaultCaptureFileName(new Date(2027, 0, 1, 23, 59, 59))).toBe('debug-capture-20270101-235959.json');
  });

  describe('localIsoTime (D-36)', () => {
    const T = Date.UTC(2026, 9, 25, 12, 8, 56, 618);

    it('writes the local wall-clock time with its UTC offset', () => {
      expect(localIsoTime(T, 180)).toBe('2026-10-25T15:08:56.618+03:00');
      expect(localIsoTime(T, 0)).toBe('2026-10-25T12:08:56.618+00:00');
      expect(localIsoTime(T, -330)).toBe('2026-10-25T06:38:56.618-05:30');
      expect(localIsoTime(Date.UTC(2026, 11, 31, 23, 30, 0, 5), 120)).toBe('2027-01-01T01:30:00.005+02:00');
    });

    it('is exact: parsing it gives back the same moment, with the station offset too', () => {
      for (const offset of [180, 0, -330, 345]) expect(new Date(localIsoTime(T, offset)).getTime()).toBe(T);
      expect(new Date(localIsoTime(T)).getTime()).toBe(T);
      expect(localIsoTime(T)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    });

    it('gives an empty string for a time that is not a number, and never throws', () => {
      expect(localIsoTime(NaN)).toBe('');
      expect(localIsoTime(Infinity, 0)).toBe('');
      expect(localIsoTime(T, NaN)).toBe('');
    });
  });
});
