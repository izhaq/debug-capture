import { CAPTURE_SCHEMA_VERSION, CaptureEntry, CaptureStats } from '../contract';
import { buildCaptureFile, CaptureMeta, defaultCaptureFileName, serializeCaptureFile } from './serializer';

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

  it('builds a file with the current schema version', () => {
    const file = buildCaptureFile(entries, stats, meta);

    expect(file).toEqual({
      schemaVersion: CAPTURE_SCHEMA_VERSION,
      capturedAt: meta.capturedAt,
      page: meta.page,
      userAgent: meta.userAgent,
      stats,
      entries,
    });
  });

  it('serializes to JSON that round-trips', () => {
    const file = buildCaptureFile(entries, stats, meta);
    const text = serializeCaptureFile(file);

    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(file)));
    // 2-space indent, so a developer can read the file in any editor.
    expect(text.split('\n')[1]).toBe('  "schemaVersion": 1,');
  });

  it('formats the default file name from local time', () => {
    expect(defaultCaptureFileName(new Date(2026, 9, 12, 8, 5, 3))).toBe('debug-capture-20261012-080503.json');
    expect(defaultCaptureFileName(new Date(2027, 0, 1, 23, 59, 59))).toBe('debug-capture-20270101-235959.json');
  });
});
