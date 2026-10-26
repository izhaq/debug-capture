import {
  CAPTURE_SCHEMA_VERSION,
  CaptureKind,
  DEFAULT_CAPTURE_POLICY,
  DEFAULT_SHORTCUTS,
  EntryDraft,
  ErrorEntry,
  LOG_LEVELS,
} from './capture-contract';

describe('capture contract', () => {
  it('CAPTURE_SCHEMA_VERSION is 2 (D-36: the file writes `sequence` and `time`)', () => {
    expect(CAPTURE_SCHEMA_VERSION).toBe(2);
  });

  it('LOG_LEVELS lists the five console methods in order', () => {
    expect(LOG_LEVELS).toEqual(['log', 'info', 'warn', 'error', 'debug']);
  });

  it('DEFAULT_CAPTURE_POLICY has the documented defaults', () => {
    expect(DEFAULT_CAPTURE_POLICY.maxEntries).toBe(5000);
    expect(DEFAULT_CAPTURE_POLICY.maxBodyLength).toBe(32_768);
    expect(DEFAULT_CAPTURE_POLICY.maxArgDepth).toBe(6);
    expect(DEFAULT_CAPTURE_POLICY.redactHeaders).toEqual([
      'authorization',
      'proxy-authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token',
      'x-csrf-token',
      'x-xsrf-token',
    ]);
    expect(DEFAULT_CAPTURE_POLICY.redactJsonKeys).toEqual([
      'password',
      'passwd',
      'secret',
      'token',
      'accesstoken',
      'refreshtoken',
      'apikey',
      'authorization',
      'clientsecret',
      'idtoken',
      'privatekey',
      'sessionid',
      'sessiontoken',
      'csrftoken',
      'xsrftoken',
      'signature',
    ]);
    expect(DEFAULT_CAPTURE_POLICY.redactBodyUrls).toEqual([]);
    expect(DEFAULT_CAPTURE_POLICY.redactedValue).toBe('[redacted]');
    expect(DEFAULT_CAPTURE_POLICY.ignoreUrls).toEqual([]);
    // No sampling by default: every draft is kept unless a policy rule drops it.
    expect(DEFAULT_CAPTURE_POLICY.sample).toBeUndefined();
    expect(Object.keys(DEFAULT_CAPTURE_POLICY).sort()).toEqual([
      'ignoreUrls',
      'maxArgDepth',
      'maxBodyLength',
      'maxEntries',
      'redactBodyUrls',
      'redactHeaders',
      'redactJsonKeys',
      'redactedValue',
    ]);
  });

  it('DEFAULT_CAPTURE_POLICY and its arrays are frozen', () => {
    expect(Object.isFrozen(DEFAULT_CAPTURE_POLICY)).toBeTrue();
    expect(Object.isFrozen(DEFAULT_CAPTURE_POLICY.redactHeaders)).toBeTrue();
    expect(Object.isFrozen(DEFAULT_CAPTURE_POLICY.redactJsonKeys)).toBeTrue();
    expect(Object.isFrozen(DEFAULT_CAPTURE_POLICY.redactBodyUrls)).toBeTrue();
    expect(Object.isFrozen(DEFAULT_CAPTURE_POLICY.ignoreUrls)).toBeTrue();
    expect(Object.isFrozen(LOG_LEVELS)).toBeTrue();
  });

  it('DEFAULT_SHORTCUTS uses three-modifier chords', () => {
    expect(DEFAULT_SHORTCUTS).toEqual({
      download: 'ctrl+alt+shift+d',
      copy: 'ctrl+alt+shift+c',
      clear: 'ctrl+alt+shift+x',
      record: 'ctrl+alt+shift+s',
      note: 'ctrl+alt+shift+m',
    });
    expect(Object.isFrozen(DEFAULT_SHORTCUTS)).toBeTrue();
    for (const chord of Object.values(DEFAULT_SHORTCUTS)) {
      const parts = chord.split('+');
      expect(parts.slice(0, 3)).toEqual(['ctrl', 'alt', 'shift']);
      expect(parts.length).toBe(4);
    }
  });

  it('EntryDraft accepts one draft of each kind', () => {
    // Mostly a compile-time guard: if a field is renamed or a kind is added
    // to the contract, this literal list or the exhaustive switch stops compiling.
    const drafts: EntryDraft[] = [
      { kind: 'log', t: 1, level: 'warn', args: ['raw', { live: new Date(0) }] },
      {
        kind: 'http',
        t: 2,
        transport: 'fetch',
        method: 'POST',
        url: 'http://localhost/api/auth/login',
        status: 200,
        durationMs: 12,
        reqHeaders: { 'content-type': 'application/json' },
        resHeaders: {},
        reqBody: '{"username":"operation"}',
        resBody: null,
        bytes: 0,
        error: null,
      },
      {
        kind: 'ws',
        t: 3,
        socketId: 1,
        url: 'ws://localhost/stream',
        event: 'receive',
        opcode: 'text',
        bytes: 2,
        data: '{}',
        code: null,
      },
      { kind: 'error', t: 4, source: 'capture', message: 'probe failed', stack: null },
    ];

    const kindOf = (draft: EntryDraft): CaptureKind => {
      switch (draft.kind) {
        case 'log':
        case 'http':
        case 'ws':
        case 'error':
        case 'note':
          return draft.kind;
        default: {
          const unreachable: never = draft;
          return unreachable;
        }
      }
    };

    expect(drafts.map(kindOf)).toEqual(['log', 'http', 'ws', 'error']);
  });

  it('ErrorEntry source includes react', () => {
    // Compile-time guard: the React adapter records errors React handled
    // itself under this source; dropping it from the union fails to compile.
    const sources: ErrorEntry['source'][] = ['window', 'unhandledrejection', 'angular', 'react', 'capture'];

    expect(sources).toContain('react');
  });
});
