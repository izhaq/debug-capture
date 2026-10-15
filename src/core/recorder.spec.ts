import {
  CaptureEntry,
  CapturePolicy,
  DEFAULT_CAPTURE_POLICY,
  EntryDraft,
  ErrorEntry,
  HttpEntry,
  LogEntry,
  WebSocketEntry,
} from '../contract';
import { resolvePolicy } from './policy';
import { createRecorder } from './recorder';

type HttpDraft = Omit<HttpEntry, 'seq'>;
type WsDraft = Omit<WebSocketEntry, 'seq'>;

function httpDraft(overrides: Partial<HttpDraft> = {}): HttpDraft {
  return {
    kind: 'http',
    t: 1,
    transport: 'xhr',
    method: 'get',
    url: 'http://localhost/api/items',
    status: 200,
    durationMs: 5,
    reqHeaders: {},
    resHeaders: {},
    reqBody: null,
    resBody: null,
    bytes: 0,
    error: null,
    ...overrides,
  };
}

function wsDraft(overrides: Partial<WsDraft> = {}): WsDraft {
  return {
    kind: 'ws',
    t: 1,
    socketId: 1,
    url: 'ws://localhost/stream',
    event: 'receive',
    opcode: 'text',
    bytes: 2,
    data: '{}',
    code: null,
    ...overrides,
  };
}

function logDraft(...args: unknown[]): EntryDraft {
  return { kind: 'log', t: 1, level: 'log', args };
}

/** `unknown`, because Jasmine's `Expected<T>` recursion blows up on the recursive `JsonValue` type. */
function argsOf(entry: CaptureEntry): readonly unknown[] {
  return (entry as LogEntry).args;
}

function recorderWith(overrides: Partial<CapturePolicy> = {}): ReturnType<typeof createRecorder> {
  return createRecorder(resolvePolicy(overrides));
}

describe('createRecorder', () => {
  it('assigns seq from 1 and never reuses it after clear', () => {
    const recorder = recorderWith();
    recorder.record(logDraft('a'));
    recorder.record(logDraft('b'));

    expect(recorder.snapshot().map((e) => e.seq)).toEqual([1, 2]);

    recorder.clear();
    recorder.record(logDraft('c'));

    expect(recorder.snapshot().map((e) => e.seq)).toEqual([3]);
  });

  it('stores a frozen entry with the draft fields', () => {
    const recorder = recorderWith();
    recorder.record({ kind: 'error', t: 7, source: 'window', message: 'm', stack: null });

    const [entry] = recorder.snapshot();
    // Cast: Jasmine's Expected<CaptureEntry> can hit TS2589 on the recursive JsonValue type,
    // depending on the order files are checked (it compiles in the v1 app, not here).
    expect(entry as unknown).toEqual({ kind: 'error', seq: 1, t: 7, source: 'window', message: 'm', stack: null });
    expect(Object.isFrozen(entry)).toBeTrue();
  });

  it('drops ignored URLs and counts them', () => {
    const recorder = recorderWith({ ignoreUrls: [/\/health/g] });

    recorder.record(httpDraft({ url: 'http://localhost/health' }));
    recorder.record(httpDraft({ url: 'http://localhost/health' }));
    recorder.record(wsDraft({ url: 'ws://localhost/health' }));
    recorder.record(httpDraft());

    expect(recorder.snapshot().map((e) => (e as HttpEntry).url)).toEqual(['http://localhost/api/items']);
    expect(recorder.stats()).toEqual({ recorded: 1, dropped: 3, evicted: 0, failed: 0 });
  });

  it('drops drafts the sampler rejects', () => {
    const seen: EntryDraft[] = [];
    const recorder = recorderWith({
      sample: (draft) => {
        seen.push(draft);
        return draft.kind !== 'ws';
      },
    });

    recorder.record(wsDraft());
    recorder.record(logDraft('kept'));

    expect(seen.length).toBe(2);
    expect(recorder.snapshot().map((e) => e.kind)).toEqual(['log']);
    expect(recorder.stats()).toEqual({ recorded: 1, dropped: 1, evicted: 0, failed: 0 });
  });

  it('keeps the draft and counts a failure when the sampler throws', () => {
    const recorder = recorderWith({
      sample: () => {
        throw new Error('buggy sampler');
      },
    });

    recorder.record(logDraft('still here'));

    expect(argsOf(recorder.snapshot()[0])).toEqual(['still here']);
    expect(recorder.stats()).toEqual({ recorded: 1, dropped: 0, evicted: 0, failed: 1 });
  });

  it('redacts headers before storing', () => {
    const recorder = recorderWith();

    recorder.record(
      httpDraft({
        reqHeaders: { Authorization: 'Bearer abc', Accept: 'application/json' },
        resHeaders: { 'Set-Cookie': 'sid=1' },
      }),
    );

    const entry = recorder.snapshot()[0] as HttpEntry;
    expect(entry.reqHeaders).toEqual({ authorization: '[redacted]', accept: 'application/json' });
    expect(entry.resHeaders).toEqual({ 'set-cookie': '[redacted]' });
    expect(entry.method).toBe('GET');
  });

  it('redacts JSON body keys before storing', () => {
    const recorder = recorderWith();

    recorder.record(
      httpDraft({
        method: 'post',
        url: 'http://localhost/api/auth/login',
        reqBody: '{"username":"op","password":"s3cret","mode":"operation","position":"active"}',
        resBody: '{"accessToken":"a.b.c","user":{"name":"op"}}',
      }),
    );
    recorder.record(wsDraft({ data: '{"type":"auth","token":"t0k"}' }));
    recorder.record(logDraft('login', { password: 's3cret', nested: [{ apiKey: 'k' }] }));

    const [http, ws, log] = recorder.snapshot() as [HttpEntry, WebSocketEntry, LogEntry];
    expect(http.reqBody).toBe('{"username":"op","password":"[redacted]","mode":"operation","position":"active"}');
    expect(http.resBody).toBe('{"accessToken":"[redacted]","user":{"name":"op"}}');
    expect(ws.data).toBe('{"type":"auth","token":"[redacted]"}');
    expect(argsOf(log)).toEqual(['login', { password: '[redacted]', nested: [{ apiKey: '[redacted]' }] }]);
    expect(JSON.stringify(recorder.snapshot())).not.toContain('s3cret');
  });

  it('replaces bodies whole for redactBodyUrls', () => {
    const recorder = recorderWith({ redactBodyUrls: [/\/secure\//] });

    recorder.record(httpDraft({ url: 'http://localhost/secure/x', reqBody: 'plain', resBody: '{"a":1}' }));
    recorder.record(wsDraft({ url: 'ws://localhost/secure/feed', opcode: 'binary', data: 'AAEC' }));
    recorder.record(httpDraft({ url: 'http://localhost/secure/y', reqBody: null }));
    recorder.record(httpDraft({ url: 'http://localhost/open', reqBody: 'plain' }));

    const [secureHttp, secureWs, emptyBody, open] = recorder.snapshot() as [
      HttpEntry,
      WebSocketEntry,
      HttpEntry,
      HttpEntry,
    ];
    expect(secureHttp.reqBody).toBe('[redacted]');
    expect(secureHttp.resBody).toBe('[redacted]');
    expect(secureWs.data).toBe('[redacted]');
    expect(emptyBody.reqBody).toBeNull();
    expect(open.reqBody).toBe('plain');
  });

  it('truncates bodies, frame data, messages and stacks', () => {
    const recorder = recorderWith({ maxBodyLength: 4 });

    recorder.record(httpDraft({ reqBody: 'abcdef', resBody: '[1,2,3]' }));
    recorder.record(wsDraft({ opcode: 'text', data: 'hello' }));
    recorder.record(wsDraft({ opcode: 'binary', data: 'QUJDREVG' }));
    recorder.record(wsDraft({ event: 'close', opcode: null, data: 'going away', code: 1001 }));
    recorder.record({ kind: 'error', t: 1, source: 'window', message: 'long message', stack: 'at a\nat b' });

    const [http, text, binary, close, error] = recorder.snapshot() as [
      HttpEntry,
      WebSocketEntry,
      WebSocketEntry,
      WebSocketEntry,
      ErrorEntry,
    ];
    expect(http.reqBody).toBe('abcd…[truncated 2 chars]');
    expect(http.resBody).toBe('[1,2…[truncated 3 chars]');
    expect(text.data).toBe('hell…[truncated 1 chars]');
    expect(binary.data).toBe('QUJD…[truncated 4 chars]');
    expect(close.data).toBe('goin…[truncated 6 chars]');
    expect(error.message).toBe('long…[truncated 8 chars]');
    expect(error.stack).toBe('at a…[truncated 5 chars]');
  });

  it('clones log args so later mutation does not change the entry', () => {
    const recorder = recorderWith();
    const live = { count: 1, list: [1] };

    recorder.record(logDraft(live, new Date(0)));
    live.count = 2;
    live.list.push(2);

    expect(argsOf(recorder.snapshot()[0])).toEqual([{ count: 1, list: [1] }, '1970-01-01T00:00:00.000Z']);
  });

  it('clones log args only down to maxArgDepth', () => {
    const recorder = recorderWith({ maxArgDepth: 1 });

    recorder.record(logDraft({ a: { b: 1 } }));

    expect(argsOf(recorder.snapshot()[0])).toEqual([{ a: '[Object]' }]);
  });

  it('evicts beyond maxEntries and counts evictions', () => {
    const recorder = recorderWith({ maxEntries: 2 });

    for (const text of ['a', 'b', 'c', 'd']) {
      recorder.record(logDraft(text));
    }

    expect(recorder.snapshot().map((e) => argsOf(e)[0])).toEqual(['c', 'd']);
    expect(recorder.stats()).toEqual({ recorded: 4, dropped: 0, evicted: 2, failed: 0 });
  });

  it('clear empties the buffer and zeroes stats', () => {
    const recorder = recorderWith({ maxEntries: 1, ignoreUrls: [/ignored/] });
    recorder.record(logDraft('a'));
    recorder.record(logDraft('b'));
    recorder.record(httpDraft({ url: 'http://ignored' }));
    recorder.record(null as unknown as EntryDraft);

    recorder.clear();

    expect(recorder.snapshot()).toEqual([]);
    expect(recorder.stats()).toEqual({ recorded: 0, dropped: 0, evicted: 0, failed: 0 });
  });

  it('returns a fresh stats object and snapshot array each call', () => {
    const recorder = recorderWith();
    recorder.record(logDraft('a'));

    expect(recorder.stats()).not.toBe(recorder.stats());
    expect(recorder.snapshot()).not.toBe(recorder.snapshot());
  });

  it('notifies listeners after storing, isolates a throwing listener', () => {
    const recorder = recorderWith();
    const seen: Array<[number, number]> = [];
    recorder.onEntry(() => {
      throw new Error('bad listener');
    });
    recorder.onEntry((entry: CaptureEntry) => seen.push([entry.seq, recorder.snapshot().length]));

    recorder.record(logDraft('a'));
    recorder.record(logDraft('b'));

    // Each listener sees the entry already in the buffer.
    expect(seen).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(recorder.stats().failed).toBe(0);
  });

  it('unsubscribe stops notifications', () => {
    const recorder = recorderWith();
    const calls: string[] = [];
    const unsubscribeSelf = recorder.onEntry(() => {
      calls.push('self');
      unsubscribeSelf();
    });
    const unsubscribeOther = recorder.onEntry(() => calls.push('other'));

    recorder.record(logDraft('a'));
    unsubscribeOther();
    unsubscribeOther();
    recorder.record(logDraft('b'));

    // The self-unsubscribing listener did not cause the next one to be skipped.
    expect(calls).toEqual(['self', 'other']);
  });

  it('never throws, counts failures', () => {
    const recorder = recorderWith();
    const hostile = {
      kind: 'log',
      t: 1,
      get level(): never {
        throw new Error('getter failed');
      },
      args: [],
    } as unknown as EntryDraft;

    expect(() => recorder.record(hostile)).not.toThrow();
    expect(() => recorder.record(null as unknown as EntryDraft)).not.toThrow();
    expect(() => recorder.record({ kind: 'nope' } as unknown as EntryDraft)).not.toThrow();

    expect(recorder.snapshot()).toEqual([]);
    expect(recorder.stats()).toEqual({ recorded: 0, dropped: 0, evicted: 0, failed: 3 });

    // A failed draft does not consume a seq.
    recorder.record(logDraft('ok'));
    expect(recorder.snapshot()[0].seq).toBe(1);
  });
  describe('review fixes', () => {
    const R = '[redacted]';

    it('bounds total work for a shared-subgraph object', () => {
      let shared: unknown = 'leaf';
      for (let d = 0; d < 4; d++) {
        const level: Record<string, unknown> = {};
        for (let i = 0; i < 40; i++) {
          level[`k${i}`] = shared;
        }
        shared = level;
      }
      const recorder = recorderWith();

      const start = performance.now();
      recorder.record(logDraft(shared));
      const elapsed = performance.now() - start;

      // Wall-clock guard against the pre-fix blow-up (490 ms), not a benchmark:
      // the limit sits several times above the cost measured on a loaded
      // 4-CPU runner (≤ 1 ms) and several times below the regression.
      expect(elapsed).toBeLessThan(100);
      expect(recorder.snapshot().length).toBe(1);
      const stored = JSON.stringify(recorder.snapshot()[0]);
      expect(stored.length).toBeLessThanOrEqual(DEFAULT_CAPTURE_POLICY.maxBodyLength + 2048);
    });

    it('shares one character budget across all args', () => {
      const recorder = recorderWith({ maxBodyLength: 10 });

      recorder.record(logDraft('a'.repeat(100_000), { s: 'b'.repeat(50_000) }));

      expect(argsOf(recorder.snapshot()[0])).toEqual(['aaaaaaaaaa…[truncated 99990 chars]', '[…]']);
    });

    it('truncates long string args', () => {
      const recorder = recorderWith({ maxBodyLength: 10 });

      recorder.record(logDraft({ s: 'b'.repeat(50_000) }));

      expect(argsOf(recorder.snapshot()[0])).toEqual([{ s: 'bbbbbbbbb…[truncated 49991 chars]' }]);
    });

    it('redacts logged Maps and JSON strings', () => {
      const recorder = recorderWith();

      recorder.record(
        logDraft('req', new Map([['authorization', 'Bearer SECRET1']]), { headers: new Map([['token', 'SECRET2']]) }),
      );
      recorder.record(logDraft(JSON.stringify({ password: 'SECRET3' })));

      const [maps, json] = recorder.snapshot();
      expect(argsOf(maps)).toEqual([
        'req',
        { '[Map]': [['authorization', R]] },
        { headers: { '[Map]': [['token', R]] } },
      ]);
      expect(argsOf(json)).toEqual(['{"password":"[redacted]"}']);
      expect(JSON.stringify(recorder.snapshot())).not.toContain('SECRET');
    });

    it('redacts JSON and URL parameters in error messages before truncating', () => {
      const recorder = recorderWith({ maxBodyLength: 100 });

      // What the global-error probe stores for an unhandled rejection of a plain object.
      recorder.record({
        kind: 'error',
        t: 1,
        source: 'unhandledrejection',
        message: JSON.stringify({ url: '/login', body: { password: 'SECRET4' }, padding: 'x'.repeat(100) }),
        stack: null,
      });
      recorder.record({
        kind: 'error',
        t: 1,
        source: 'angular',
        message: 'Http failure response for https://h/api?access_token=SECRET5: 401 Unauthorized',
        stack: null,
      });

      const [rejection, http] = recorder.snapshot() as [ErrorEntry, ErrorEntry];
      expect(rejection.message).toMatch(/^\{"url":"\/login","body":\{"password":"\[redacted\]"\}/);
      expect(http.message).toBe('Http failure response for https://h/api?access_token=[redacted] 401 Unauthorized');
      expect(JSON.stringify(recorder.snapshot())).not.toContain('SECRET');
    });

    it('redacts snake_case and newly defaulted secret keys', () => {
      const recorder = recorderWith();
      const body = {
        access_token: 'a',
        refresh_token: 'b',
        api_key: 'c',
        client_secret: 'd',
        id_token: 'e',
        private_key: 'f',
        session_id: 'g',
        sessionToken: 'h',
        csrf_token: 'i',
        xsrfToken: 'j',
        'x-api-key': 'k',
        keep: 'l',
      };

      recorder.record(httpDraft({ resBody: JSON.stringify(body) }));
      recorder.record(logDraft(body));

      const [http, log] = recorder.snapshot() as [HttpEntry, LogEntry];
      const expected: Record<string, string> = {};
      for (const key of Object.keys(body)) {
        expected[key] = key === 'keep' ? 'l' : R;
      }
      expect(JSON.parse(http.resBody ?? 'null')).toEqual(expected);
      expect(argsOf(log)).toEqual([expected]);
    });

    it('redacts default CSRF headers', () => {
      const recorder = recorderWith();

      recorder.record(httpDraft({ reqHeaders: { 'x-csrf-token': 'a', 'x-xsrf-token': 'b', accept: '*/*' } }));

      expect((recorder.snapshot()[0] as HttpEntry).reqHeaders).toEqual({
        'x-csrf-token': R,
        'x-xsrf-token': R,
        accept: '*/*',
      });
    });

    it('redacts secret URL query parameters of http and ws entries', () => {
      const recorder = recorderWith();

      const url = 'wss://h/ws?access_token=SECRET10&x=1';
      recorder.record(wsDraft({ event: 'open', opcode: null, data: null, url }));
      recorder.record(wsDraft({ url }));
      recorder.record(httpDraft({ url: 'https://h/api/items?page=2&api_key=SECRET11' }));

      const [open, frame, http] = recorder.snapshot() as [WebSocketEntry, WebSocketEntry, HttpEntry];
      expect(open.url).toBe('wss://h/ws?access_token=[redacted]&x=1');
      expect(frame.url).toBe('wss://h/ws?access_token=[redacted]&x=1');
      expect(http.url).toBe('https://h/api/items?page=2&api_key=[redacted]');
    });

    it('matches ignoreUrls and redactBodyUrls against the original URL', () => {
      const recorder = recorderWith({ ignoreUrls: [/token=drop/], redactBodyUrls: [/token=hide/] });

      recorder.record(httpDraft({ url: 'https://h/a?token=drop' }));
      recorder.record(httpDraft({ url: 'https://h/b?token=hide', resBody: 'visible?' }));

      const entries = recorder.snapshot() as HttpEntry[];
      expect(entries.length).toBe(1);
      expect(entries[0].url).toBe('https://h/b?token=[redacted]');
      expect(entries[0].resBody).toBe(R);
      expect(recorder.stats().dropped).toBe(1);
    });

    it('redacts secret parameters of form-encoded bodies', () => {
      const recorder = recorderWith();
      const form = 'username=op&password=s3cret&grant_type=password';

      recorder.record(
        httpDraft({
          method: 'post',
          reqHeaders: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          reqBody: form,
          resHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
          resBody: 'access_token=SECRET&expires_in=60',
        }),
      );
      // fetch/XHR with a URLSearchParams body: the browser adds the content-type after the probe saw the call.
      recorder.record(httpDraft({ method: 'post', reqBody: form }));
      // A declared non-form type is left alone.
      recorder.record(httpDraft({ method: 'post', reqHeaders: { 'content-type': 'text/plain' }, reqBody: form }));

      const [declared, implicit, plain] = recorder.snapshot() as [HttpEntry, HttpEntry, HttpEntry];
      expect(declared.reqBody).toBe('username=op&password=[redacted]&grant_type=password');
      expect(declared.resBody).toBe('access_token=[redacted]&expires_in=60');
      expect(implicit.reqBody).toBe('username=op&password=[redacted]&grant_type=password');
      expect(plain.reqBody).toBe(form);
    });

    it('stored entries are deeply immutable', () => {
      const recorder = recorderWith();
      const attempts: string[] = [];
      recorder.onEntry((entry) => {
        try {
          if (entry.kind === 'log') {
            (entry.args[0] as Record<string, unknown>)['password'] = 'LEAK';
          } else if (entry.kind === 'http') {
            (entry.reqHeaders as Record<string, string>)['authorization'] = 'LEAK';
          }
        } catch {
          attempts.push(entry.kind);
        }
      });

      recorder.record(logDraft({ a: 1, nested: { list: [1] } }));
      recorder.record(httpDraft({ reqHeaders: { accept: '*/*' } }));

      expect(attempts).toEqual(['log', 'http']);
      expect(JSON.stringify(recorder.snapshot())).not.toContain('LEAK');
      const [log, http] = recorder.snapshot() as [LogEntry, HttpEntry];
      expect(Object.isFrozen(log.args)).toBeTrue();
      expect(Object.isFrozen((log.args[0] as Record<string, Record<string, unknown>>)['nested']['list'])).toBeTrue();
      expect(Object.isFrozen(http.reqHeaders)).toBeTrue();
      expect(Object.isFrozen(http.resHeaders)).toBeTrue();
    });

    it('truncates very long URLs and header values', () => {
      const recorder = recorderWith({ maxBodyLength: 20 });
      const long = `https://h/${'p'.repeat(100)}`;

      recorder.record(
        httpDraft({ url: long, reqHeaders: { 'x-trace': 't'.repeat(100) }, resHeaders: { etag: 'e'.repeat(21) } }),
      );
      recorder.record(wsDraft({ url: long }));

      const [http, ws] = recorder.snapshot() as [HttpEntry, WebSocketEntry];
      expect(http.url).toBe('https://h/pppppppppp…[truncated 90 chars]');
      expect(ws.url).toBe(http.url);
      expect(http.reqHeaders['x-trace']).toBe(`${'t'.repeat(20)}…[truncated 80 chars]`);
      expect(http.resHeaders['etag']).toBe(`${'e'.repeat(20)}…[truncated 1 chars]`);
    });
  });
  describe('confirmation review fixes', () => {
    const R = '[redacted]';
    const FRAME = '    at f (https://h/main.js:1:2)';

    function errorDraft(source: ErrorEntry['source'], message: string, stack: string | null): EntryDraft {
      return { kind: 'error', t: 1, source, message, stack };
    }

    it('redacts the stack of a window error like its message', () => {
      const recorder = recorderWith();

      recorder.record(
        errorDraft(
          'window',
          'Uncaught Error: GET wss://h/ws?access_token=SECRET_A failed (https://h/main.js:1:2)',
          `Error: GET wss://h/ws?access_token=SECRET_A failed\n${FRAME}`,
        ),
      );

      const [entry] = recorder.snapshot() as [ErrorEntry];
      expect(entry.stack).toBe(`Error: GET wss://h/ws?access_token=${R} failed\n${FRAME}`);
      expect(JSON.stringify(recorder.snapshot())).not.toContain('SECRET');
    });

    it('redacts the stack of an unhandled rejection whose message is JSON', () => {
      const recorder = recorderWith();

      const message = '{"password":"SECRET_B"}';
      recorder.record(errorDraft('unhandledrejection', message, `Error: ${message}\n${FRAME}`));

      const [entry] = recorder.snapshot() as [ErrorEntry];
      expect(entry.message).toBe('{"password":"[redacted]"}');
      expect(entry.stack).toBe(`Error: {"password":"[redacted]"}\n${FRAME}`);
    });

    it('keeps only the frames of a stack that does not repeat a redacted message verbatim', () => {
      const recorder = recorderWith();

      recorder.record(errorDraft('angular', '{"password":"SECRET_X"}', `Error: reformatted SECRET_X\n${FRAME}`));

      expect((recorder.snapshot()[0] as ErrorEntry).stack).toBe(FRAME);
    });

    it('keeps the other fields of JSON that holds a URL', () => {
      const recorder = recorderWith();
      const json = '{"url":"https://h/x?token=abc","status":401,"detail":"boom"}';
      const redacted = '{"url":"https://h/x?token=[redacted]","status":401,"detail":"boom"}';

      recorder.record(logDraft(json));
      recorder.record(errorDraft('unhandledrejection', json, null));
      recorder.record(httpDraft({ resBody: json }));
      recorder.record(wsDraft({ data: '{"next":"https://h/x?access_token=S21"}' }));

      const [log, error, http, ws] = recorder.snapshot() as [LogEntry, ErrorEntry, HttpEntry, WebSocketEntry];
      expect(argsOf(log)).toEqual([redacted]);
      expect(error.message).toBe(redacted);
      expect(http.resBody).toBe(redacted);
      expect(ws.data).toBe(`{"next":"https://h/x?access_token=${R}"}`);
    });

    it('redacts nested, encoded and bracketed URL parameters', () => {
      const recorder = recorderWith();
      const urls: Array<[string, string]> = [
        ['http://h/a?next=/cb?access_token=S6', `http://h/a?next=/cb?access_token=${R}`],
        ['http://h/a?redirect=https://x/y?token=S7&z=1', `http://h/a?redirect=https://x/y?token=${R}&z=1`],
        ['http://h/a?returnUrl=%2Fp%3Ftoken%3DS8', `http://h/a?returnUrl=${R}`],
        ['http://h/a?access_token[]=S9', `http://h/a?access_token[]=${R}`],
        ['http://h/a?X-Amz-Signature=S13&X-Amz-Date=1', `http://h/a?X-Amz-Signature=${R}&X-Amz-Date=1`],
      ];

      urls.forEach(([url]) => recorder.record(wsDraft({ event: 'open', opcode: null, data: null, url })));

      expect(recorder.snapshot().map((e) => (e as WebSocketEntry).url)).toEqual(urls.map(([, stored]) => stored));
    });

    it("redacts the reviewer's adversarial URLs, except names the policy does not list", () => {
      const recorder = recorderWith();
      const urls = [
        'http://h/a?%61ccess_token=S1',
        'http://h/a?token=S2&token=S3',
        'http://h/cb#access_token=S4&state=x',
        'http://h/#/cb?access_token=S5',
        'http://h/a?next=/cb?access_token=S6',
        'http://h/a?redirect=https://x/y?token=S7&z=1',
        'http://h/a?returnUrl=%2Fp%3Ftoken%3DS8',
        'http://h/a?access_token[]=S9',
        'http://h/a?access%5Ftoken=S10',
        'http://h/a?Access.Token=S11',
        'http://h/a?code=S12&state=x',
        'http://h/a?X-Amz-Signature=S13&X-Amz-Security-Token=S14',
        'http://h/a?auth=S15&jwt=S16&key=S17',
        'http://h/a?q=1&&access_token=S18',
        'http://h/a/access_token=S19/next',
        'http://h/a?x=1=2&access_token=S20',
      ];

      urls.forEach((url, i) => recorder.record(wsDraft({ socketId: i, event: 'open', opcode: null, data: null, url })));

      const stored = recorder
        .snapshot()
        .map((e) => (e as WebSocketEntry).url)
        .join(' ');
      const kept = stored.match(/S\d+/g) ?? [];
      // `code`, `auth`, `jwt` and `key` are too generic for the defaults (documented).
      expect(kept).toEqual(['S12', 'S15', 'S16', 'S17']);
    });

    it('stack frame detection stays fast on a long line full of @', () => {
      const recorder = recorderWith();
      const line = `${'a@'.repeat(20_000)}${'x'.repeat(40_000)}`;

      const start = performance.now();
      // A JSON message the stack does not repeat verbatim: the frame-line fallback runs.
      recorder.record(errorDraft('angular', '{"password":"S"}', `Error: reformatted\n${line}\n${FRAME}`));
      const elapsed = performance.now() - start;

      // Wall-clock guard against the pre-fix blow-up (~1 s), not a benchmark:
      // the limit sits several times above the cost measured on a loaded
      // 4-CPU runner (< 1 ms) and several times below the regression.
      expect(elapsed).toBeLessThan(100);
      expect((recorder.snapshot()[0] as ErrorEntry).stack).toBe(FRAME);
    });

    it('ends a form body value only at &', () => {
      const recorder = recorderWith();
      const form = 'user=op&password=pa?ss"word&x=1';

      const reqHeaders = { 'content-type': 'application/x-www-form-urlencoded' };
      recorder.record(httpDraft({ method: 'post', reqHeaders, reqBody: form }));
      recorder.record(httpDraft({ method: 'post', reqBody: form }));

      const [declared, implicit] = recorder.snapshot() as [HttpEntry, HttpEntry];
      expect(declared.reqBody).toBe(`user=op&password=${R}&x=1`);
      expect(implicit.reqBody).toBe(`user=op&password=${R}&x=1`);
    });

    it('keeps a ? inside a URL query value unless a parameter follows it', () => {
      const recorder = recorderWith();

      recorder.record(httpDraft({ url: 'http://h/a?token=ab?cd&x=1' }));
      recorder.record(httpDraft({ url: 'http://h/a?next=/cb?access_token=S6&x=1' }));

      const [plain, nested] = recorder.snapshot() as [HttpEntry, HttpEntry];
      expect(plain.url).toBe(`http://h/a?token=${R}&x=1`);
      expect(nested.url).toBe(`http://h/a?next=/cb?access_token=${R}&x=1`);
    });

    it('param redaction of 10 MB form bodies, log args and errors completes in bounded time', () => {
      const recorder = recorderWith();
      const body = 'k=v&'.repeat(2_500_000);

      const start = performance.now();
      recorder.record(httpDraft({ method: 'post', reqBody: body }));
      recorder.record(logDraft(body));
      recorder.record(errorDraft('window', body, body));
      const elapsed = performance.now() - start;

      // Wall-clock guard against the pre-fix blow-up (~3.5 s), not a benchmark:
      // the limit sits several times above the cost measured on a loaded
      // 4-CPU runner (up to ~50 ms) and several times below the regression.
      expect(elapsed).toBeLessThan(400);
      const [http] = recorder.snapshot() as [HttpEntry];
      expect(http.reqBody).toBe(truncatedForm(body, DEFAULT_CAPTURE_POLICY.maxBodyLength));
    });

    function truncatedForm(body: string, max: number): string {
      return `${body.slice(0, max)}…[truncated ${body.length - max} chars]`;
    }

    it('redacts a parameter that truncation cuts in half', () => {
      const recorder = recorderWith({ maxBodyLength: 20 });

      recorder.record(httpDraft({ method: 'post', reqBody: 'a=1&token=SECRETSECRET' }));

      expect((recorder.snapshot()[0] as HttpEntry).reqBody).toBe(`a=1&token=${R}…[truncated 2 chars]`);
    });

    it('leaves null and boolean secret values as they are', () => {
      const recorder = recorderWith();

      recorder.record(wsDraft({ data: '{"nextToken":null,"token":false,"password":"p"}' }));

      const stored = (recorder.snapshot()[0] as WebSocketEntry).data;
      expect(stored).toBe(`{"nextToken":null,"token":false,"password":"${R}"}`);
    });

    it('redacts headers whose names look like secret keys', () => {
      const recorder = recorderWith();

      recorder.record(
        httpDraft({
          reqHeaders: {
            'x-access-token': 'S1',
            'x-refresh-token': 'S2',
            'x-amz-signature': 'S3',
            'x-request-id': 'keep',
          },
        }),
      );

      expect((recorder.snapshot()[0] as HttpEntry).reqHeaders).toEqual({
        'x-access-token': R,
        'x-refresh-token': R,
        'x-amz-signature': R,
        'x-request-id': 'keep',
      });
    });
  });
});
