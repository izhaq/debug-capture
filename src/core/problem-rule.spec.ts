import { CaptureEntry, ErrorEntry, HttpEntry, IsProblemEntry, LOG_LEVELS, LogEntry, WebSocketEntry } from '../contract';
import { isProblemEntry } from './problem-rule';

function http(status: number | null, error: HttpEntry['error'] = null): HttpEntry {
  return {
    kind: 'http',
    seq: 1,
    t: 0,
    transport: 'fetch',
    method: 'GET',
    url: 'https://example.test/api',
    status,
    durationMs: 5,
    reqHeaders: {},
    resHeaders: {},
    reqBody: null,
    resBody: null,
    bytes: null,
    error,
  };
}

function ws(event: WebSocketEntry['event'], code: number | null = null): WebSocketEntry {
  return {
    kind: 'ws',
    seq: 1,
    t: 0,
    socketId: 1,
    url: 'wss://example.test/live',
    event,
    opcode: null,
    bytes: null,
    data: null,
    code,
  };
}

function log(level: LogEntry['level']): LogEntry {
  return { kind: 'log', seq: 1, t: 0, level, args: ['boom'] };
}

function error(source: ErrorEntry['source']): ErrorEntry {
  return { kind: 'error', seq: 1, t: 0, source, message: 'boom', stack: null };
}

describe('isProblemEntry (FR-ACT-04)', () => {
  it('has the contract type IsProblemEntry', () => {
    const rule: IsProblemEntry = isProblemEntry;
    expect(rule).toBe(isProblemEntry);
  });

  it('counts every ErrorEntry, whatever its source', () => {
    const sources: ReadonlyArray<ErrorEntry['source']> = [
      'window',
      'unhandledrejection',
      'angular',
      'react',
      'capture',
    ];
    for (const source of sources) {
      expect(isProblemEntry(error(source)))
        .withContext(source)
        .toBe(true);
    }
  });

  it('counts HTTP 500, the first server error', () => {
    expect(isProblemEntry(http(500))).toBe(true);
  });

  it('counts HTTP 599, the last server error', () => {
    expect(isProblemEntry(http(599))).toBe(true);
  });

  it('does not count HTTP 499, the last client error', () => {
    expect(isProblemEntry(http(499))).toBe(false);
  });

  it('does not count 4xx', () => {
    expect(isProblemEntry(http(400))).toBe(false);
    expect(isProblemEntry(http(404))).toBe(false);
  });

  it('does not count successful or redirected HTTP', () => {
    expect(isProblemEntry(http(200))).toBe(false);
    expect(isProblemEntry(http(304))).toBe(false);
  });

  it("counts a request with no response and error 'abort'", () => {
    expect(isProblemEntry(http(null, 'abort'))).toBe(true);
  });

  it("counts 'timeout' and 'network' errors too", () => {
    expect(isProblemEntry(http(null, 'timeout'))).toBe(true);
    expect(isProblemEntry(http(null, 'network'))).toBe(true);
  });

  it('counts an error even when a status arrived', () => {
    // The rule is "status ≥ 500 OR error ≠ null": a 200 cut off mid-body is still a problem.
    expect(isProblemEntry(http(200, 'abort'))).toBe(true);
  });

  it('does not count status null with no error', () => {
    expect(isProblemEntry(http(null, null))).toBe(false);
  });

  it("counts a WebSocket 'error' event", () => {
    expect(isProblemEntry(ws('error'))).toBe(true);
  });

  it("does not count a WebSocket 'close', not even with an abnormal code", () => {
    expect(isProblemEntry(ws('close', 1006))).toBe(false);
    expect(isProblemEntry(ws('close', 1011))).toBe(false);
    expect(isProblemEntry(ws('close', 1000))).toBe(false);
  });

  it('does not count WebSocket open, send or receive', () => {
    expect(isProblemEntry(ws('open'))).toBe(false);
    expect(isProblemEntry(ws('send'))).toBe(false);
    expect(isProblemEntry(ws('receive'))).toBe(false);
  });

  it("does not count a log entry at 'error' level", () => {
    // Angular and React errors already make an ErrorEntry; counting console.error too would count twice.
    expect(isProblemEntry(log('error'))).toBe(false);
  });

  it('does not count a log entry of any level', () => {
    for (const level of LOG_LEVELS) {
      expect(isProblemEntry(log(level)))
        .withContext(level)
        .toBe(false);
    }
  });

  it('does not count an entry of a kind it does not know', () => {
    // A future entry kind must not light the badge until the rule says so.
    const future: unknown = { kind: 'storage', seq: 1, t: 0 };
    expect(isProblemEntry(future as CaptureEntry)).toBe(false);
  });
});

describe('isProblemEntry — 2.1 notes (C-10)', () => {
  it('a note is never a problem, whatever its text', () => {
    expect(isProblemEntry({ kind: 'note', seq: 1, t: 0, title: 'error 500', text: 'boom' })).toBe(false);
  });
});

describe('isProblemEntry — 2.3 app messages (C-12, FR-MSG-06)', () => {
  it('an app message is a problem only at level error', () => {
    const app = (level: 'info' | 'warn' | 'error'): CaptureEntry => ({
      kind: 'app',
      seq: 1,
      t: 0,
      type: 'payment-failed',
      level,
      data: null,
    });
    expect(isProblemEntry(app('error'))).toBe(true);
    expect(isProblemEntry(app('warn'))).toBe(false);
    expect(isProblemEntry(app('info'))).toBe(false);
  });
});
