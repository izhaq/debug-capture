import { errorEntry, httpEntry, logEntry, pendingRequest, wsEntry } from './fakes.spec';
import {
  consoleLevel,
  consoleLevelLabel,
  consoleText,
  formatClock,
  formatDuration,
  formatRelative,
  formatSize,
  formatTime,
  httpName,
  httpStatusGroup,
  httpStatusLabel,
  httpStatusText,
  preview,
  wsEventLabel,
  Tone,
} from './format';
import { HttpStatusGroup } from './state';

const T = Date.UTC(2026, 9, 15, 14, 3, 27, 412);

describe('format (S03-11)', () => {
  it('formatClock: HH:mm:ss.SSS in the injected UTC offset', () => {
    expect(formatClock(T, 0)).toBe('14:03:27.412');
    expect(formatClock(T, 180)).toBe('17:03:27.412');
    expect(formatClock(T, -900)).toBe('23:03:27.412');
    expect(formatClock(Date.UTC(2026, 0, 1, 0, 0, 0, 5), 0)).toBe('00:00:00.005');
    expect(formatClock(Number.NaN, 0)).toBe('—');
  });

  it('formatRelative: +s.mmm s from the origin, signed', () => {
    expect(formatRelative(T + 12_345, T)).toBe('+12.345 s');
    expect(formatRelative(T, T)).toBe('+0.000 s');
    expect(formatRelative(T - 500, T)).toBe('-0.500 s');
    expect(formatRelative(T + 3_600_007, T)).toBe('+3600.007 s');
  });

  it('formatTime picks clock or relative from one setting', () => {
    expect(formatTime(T, { mode: 'clock', utcOffsetMinutes: 0 })).toBe('14:03:27.412');
    expect(formatTime(T + 1, { mode: 'relative', origin: T })).toBe('+0.001 s');
  });

  it('formatSize: 1000-based, one decimal from 1 kB', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(412)).toBe('412 B');
    expect(formatSize(999)).toBe('999 B');
    expect(formatSize(1000)).toBe('1.0 kB');
    expect(formatSize(3_200)).toBe('3.2 kB');
    expect(formatSize(48_640)).toBe('48.6 kB');
    expect(formatSize(999_960)).toBe('1.0 MB');
    expect(formatSize(1_200_000)).toBe('1.2 MB');
    expect(formatSize(1_149_950)).toBe('1.1 MB');
    expect(formatSize(null)).toBe('—');
    expect(formatSize(-1)).toBe('—');
  });

  it('formatDuration: ms below 1 s, then seconds with two decimals', () => {
    expect(formatDuration(143)).toBe('143 ms');
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(999.6)).toBe('1.00 s');
    expect(formatDuration(2_040)).toBe('2.04 s');
    expect(formatDuration(2_045)).toBe('2.05 s');
    expect(formatDuration(null)).toBe('—');
  });

  it('HTTP status label, kind and group per §5.6', () => {
    const cases: Array<[Parameters<typeof httpStatusLabel>[0], string, string, Tone, HttpStatusGroup | null]> = [
      [httpEntry(1, { status: 200 }), '✓', '200', 'success', '2xx'],
      [httpEntry(2, { status: 304 }), '↪', '304', 'info', '3xx'],
      [httpEntry(3, { status: 404 }), '⚠', '404', 'warning', '4xx'],
      [httpEntry(4, { status: 500 }), '✕', '500', 'error', '5xx'],
      [httpEntry(5, { status: null, error: 'network' }), '✕', 'Failed', 'error', 'failed'],
      [httpEntry(6, { status: null, error: 'abort' }), '✕', 'Aborted', 'error', 'failed'],
      [httpEntry(7, { status: null, error: 'timeout' }), '✕', 'Timeout', 'error', 'failed'],
      [httpEntry(8, { status: 200, error: 'network' }), '✕', 'Failed', 'error', 'failed'],
      [pendingRequest(9), '◌', 'Pending', 'muted', 'pending'],
      [httpEntry(10, { status: 101 }), '↪', '101', 'info', null],
    ];
    for (const [row, icon, text, tone, group] of cases) {
      expect(httpStatusLabel(row)).withContext(text).toEqual({ icon, text, tone });
      expect(httpStatusGroup(row)).withContext(text).toBe(group);
    }
  });

  it('HTTP status full text for the detail', () => {
    expect(httpStatusText(httpEntry(1, { status: 200 }))).toBe('200 OK');
    expect(httpStatusText(httpEntry(1, { status: 500 }))).toBe('500 Internal Server Error');
    expect(httpStatusText(httpEntry(1, { status: 418 }))).toBe("418 I'm a Teapot");
    expect(httpStatusText(httpEntry(1, { status: 299 }))).toBe('299');
    expect(httpStatusText(httpEntry(1, { status: null, error: 'network' }))).toBe('Failed (network error)');
    expect(httpStatusText(httpEntry(1, { status: null, error: 'abort' }))).toBe('Aborted');
    expect(httpStatusText(httpEntry(1, { status: null, error: 'timeout' }))).toBe('Timeout');
    expect(httpStatusText(pendingRequest(1))).toBe('Pending');
  });

  it('httpName: last path segment + query, no host, no hash', () => {
    expect(httpName('https://app.test/api/users/42?x=1#top')).toBe('42?x=1');
    expect(httpName('https://app.test/api/users/')).toBe('users/');
    expect(httpName('https://app.test')).toBe('/');
    expect(httpName('https://app.test/?q=1')).toBe('/?q=1');
    expect(httpName('/relative/path')).toBe('path');
  });

  it('WebSocket event labels per §5.6', () => {
    expect(wsEventLabel(wsEntry(1, { event: 'send' }))).toEqual({ icon: '↑', text: 'sent', tone: 'success' });
    expect(wsEventLabel(wsEntry(1, { event: 'receive' }))).toEqual({ icon: '↓', text: 'received', tone: 'info' });
    expect(wsEventLabel(wsEntry(1, { event: 'open' }))).toEqual({ icon: '●', text: 'opened', tone: 'muted' });
    expect(wsEventLabel(wsEntry(1, { event: 'error' }))).toEqual({ icon: '✕', text: 'error', tone: 'error' });
    expect(wsEventLabel(wsEntry(1, { event: 'close', code: 1000, data: 'done' })).text).toBe('closed 1000 "done"');
    expect(wsEventLabel(wsEntry(1, { event: 'close', code: 1006, data: null })).text).toBe('closed 1006');
    expect(wsEventLabel(wsEntry(1, { event: 'close', code: null, data: 'say "hi"' })).text).toBe(
      'closed "say \\"hi\\""',
    );
  });

  it('console level, label and text', () => {
    expect(consoleLevel(logEntry(1, { level: 'warn' }))).toBe('warn');
    expect(consoleLevel(errorEntry(2))).toBe('error');
    expect(consoleLevelLabel('error')).toEqual({ icon: '✕', text: 'error', tone: 'error' });
    expect(consoleLevelLabel('warn')).toEqual({ icon: '⚠', text: 'warn', tone: 'warning' });
    expect(consoleLevelLabel('info')).toEqual({ icon: 'ℹ', text: 'info', tone: 'info' });
    expect(consoleLevelLabel('log')).toEqual({ icon: '•', text: 'log', tone: 'text' });
    expect(consoleLevelLabel('debug')).toEqual({ icon: '⋯', text: 'debug', tone: 'muted' });
    expect(consoleText(logEntry(1, { args: ['apply', { id: 7 }, [1, 2], null, 3] }))).toBe(
      'apply {"id":7} [1,2] null 3',
    );
    expect(consoleText(errorEntry(2, { message: 'TypeError: x' }))).toBe('TypeError: x');
  });

  it('preview: one line, cut with an ellipsis', () => {
    expect(preview('a\n  b\r\nc')).toBe('a b c');
    expect(preview('abcdef', 3)).toBe('abc…');
    expect(preview('abc', 3)).toBe('abc');
  });
});
