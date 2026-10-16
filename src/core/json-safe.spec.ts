import { DEFAULT_CAPTURE_POLICY } from '../contract';
import { JsonSafePolicy, MAX_CLONE_NODES, toJsonSafe as toJsonSafeTyped } from './json-safe';

/** Cloning only: no redaction, and a character budget no test here reaches. */
const PLAIN: JsonSafePolicy = {
  maxArgDepth: 6,
  maxBodyLength: 1_000_000,
  redactJsonKeys: [],
  redactedValue: '[redacted]',
};

/**
 * Jasmine's `Expected<T>` recursion blows up on the recursive `JsonValue`
 * type ("excessively deep"), so the assertions see `unknown`.
 */
const toJsonSafe = (value: unknown, maxDepth: number): unknown =>
  toJsonSafeTyped([value], { ...PLAIN, maxArgDepth: maxDepth })[0];

const cloneArgs = (args: readonly unknown[], overrides: Partial<JsonSafePolicy> = {}): readonly unknown[] =>
  toJsonSafeTyped(args, { ...PLAIN, ...overrides });

describe('toJsonSafe', () => {
  const DEPTH = 6;

  it('keeps strings, booleans, null and finite numbers as-is', () => {
    expect(toJsonSafe('text', DEPTH)).toBe('text');
    expect(toJsonSafe(true, DEPTH)).toBe(true);
    expect(toJsonSafe(false, DEPTH)).toBe(false);
    expect(toJsonSafe(null, DEPTH)).toBeNull();
    expect(toJsonSafe(42.5, DEPTH)).toBe(42.5);
    expect(toJsonSafe(0, DEPTH)).toBe(0);
  });

  it('names NaN and the infinities', () => {
    expect(toJsonSafe(Number.NaN, DEPTH)).toBe('NaN');
    expect(toJsonSafe(Number.POSITIVE_INFINITY, DEPTH)).toBe('Infinity');
    expect(toJsonSafe(Number.NEGATIVE_INFINITY, DEPTH)).toBe('-Infinity');
  });

  it('marks undefined', () => {
    expect(toJsonSafe(undefined, DEPTH)).toBe('[undefined]');
    expect(toJsonSafe({ a: undefined }, DEPTH)).toEqual({ a: '[undefined]' });
  });

  it('writes a bigint with its n suffix', () => {
    expect(toJsonSafe(123n, DEPTH)).toBe('123n');
  });

  it('describes a symbol', () => {
    expect(toJsonSafe(Symbol('desc'), DEPTH)).toBe('Symbol(desc)');
  });

  it('names a function, or calls it anonymous', () => {
    function namedFn(): void {
      // body irrelevant
    }
    expect(toJsonSafe(namedFn, DEPTH)).toBe('[Function namedFn]');
    expect(toJsonSafe([(): void => undefined][0], DEPTH)).toBe('[Function anonymous]');
  });

  it('turns an Error into name, message and stack', () => {
    const error = new TypeError('bad thing');
    expect(toJsonSafe(error, DEPTH)).toEqual({
      name: 'TypeError',
      message: 'bad thing',
      stack: error.stack ?? null,
    });

    const stackless = new Error('no stack');
    stackless.stack = undefined;
    expect(toJsonSafe(stackless, DEPTH)).toEqual({ name: 'Error', message: 'no stack', stack: null });
  });

  it('turns a Date into an ISO string, or marks it invalid', () => {
    expect(toJsonSafe(new Date(Date.UTC(2026, 9, 12, 8, 5, 3)), DEPTH)).toBe('2026-10-12T08:05:03.000Z');
    expect(toJsonSafe(new Date(Number.NaN), DEPTH)).toBe('[Invalid Date]');
  });

  it('writes a RegExp as its source with flags', () => {
    expect(toJsonSafe(/x/g, DEPTH)).toBe('/x/g');
  });

  it('clones a Map as its entries', () => {
    const key = { id: 1 };
    const map = new Map<unknown, unknown>([
      ['a', 1],
      [key, new Date(0)],
    ]);

    const result = toJsonSafe(map, DEPTH);

    expect(result).toEqual({
      '[Map]': [
        ['a', 1],
        [{ id: 1 }, '1970-01-01T00:00:00.000Z'],
      ],
    });
    key.id = 2;
    expect(result).toEqual({
      '[Map]': [
        ['a', 1],
        [{ id: 1 }, '1970-01-01T00:00:00.000Z'],
      ],
    });
  });

  it('clones a Set as its values', () => {
    expect(toJsonSafe(new Set(['a', { b: 1 }]), DEPTH)).toEqual({ '[Set]': ['a', { b: 1 }] });
  });

  it('describes binary data by type and size', () => {
    expect(toJsonSafe(new ArrayBuffer(16), DEPTH)).toBe('[ArrayBuffer 16 bytes]');
    expect(toJsonSafe(new Uint8Array(16), DEPTH)).toBe('[Uint8Array 16 bytes]');
    expect(toJsonSafe(new Float64Array(2), DEPTH)).toBe('[Float64Array 16 bytes]');
    expect(toJsonSafe(new DataView(new ArrayBuffer(4)), DEPTH)).toBe('[DataView 4 bytes]');
  });

  it('describes a DOM node instead of walking it', () => {
    const div = document.createElement('div');
    div.id = 'id';
    div.className = 'a b';

    expect(toJsonSafe(div, DEPTH)).toBe('[HTMLDivElement div#id.a.b]');
    expect(toJsonSafe(document.createElement('span'), DEPTH)).toBe('[HTMLSpanElement span]');
    expect(toJsonSafe(document.createTextNode('hi'), DEPTH)).toBe('[Text]');
  });

  it('marks a circular reference', () => {
    const node: { name: string; self?: unknown; list: unknown[] } = { name: 'n', list: [] };
    node.self = node;
    node.list.push(node);

    expect(toJsonSafe(node, DEPTH)).toEqual({ name: 'n', list: ['[Circular]'], self: '[Circular]' });
  });

  it('clones a shared but non-circular reference twice', () => {
    const shared = { v: 1 };
    expect(toJsonSafe({ a: shared, b: shared }, DEPTH)).toEqual({ a: { v: 1 }, b: { v: 1 } });
  });

  it('collapses values beyond maxDepth to a placeholder', () => {
    const value = { a: { b: [1, 2, 3], c: { d: 1 } } };

    expect(toJsonSafe(value, 0)).toBe('[Object]');
    expect(toJsonSafe([1, 2, 3], 0)).toBe('[Array(3)]');
    expect(toJsonSafe('top', 0)).toBe('top');
    expect(toJsonSafe(value, 1)).toEqual({ a: '[Object]' });
    expect(toJsonSafe(value, 2)).toEqual({ a: { b: '[Array(3)]', c: '[Object]' } });
    expect(toJsonSafe(value, 3)).toEqual(value);
  });

  it('records a throwing getter or toJSON as a thrown marker for that property', () => {
    const value = {
      ok: 1,
      get bad(): number {
        throw new Error('getter failed');
      },
      nested: {
        toJSON(): never {
          throw new Error('toJSON failed');
        },
      },
    };

    expect(toJsonSafe(value, DEPTH)).toEqual({
      ok: 1,
      bad: '[Thrown: getter failed]',
      nested: '[Thrown: toJSON failed]',
    });
  });

  it('uses toJSON when an object provides it', () => {
    const value = { toJSON: (): unknown => ({ via: 'toJSON', when: new Date(0) }) };
    expect(toJsonSafe(value, DEPTH)).toEqual({ via: 'toJSON', when: '1970-01-01T00:00:00.000Z' });

    const returnsItself = {
      a: 1,
      toJSON(): unknown {
        return this;
      },
    };
    expect(toJsonSafe(returnsItself, DEPTH)).toEqual({ a: 1, toJSON: '[Function toJSON]' });
  });

  it('caps arrays and objects at 100 items with a marker', () => {
    const array = Array.from({ length: 103 }, (_, i) => i);
    const arrayResult = toJsonSafe(array, DEPTH) as readonly unknown[];
    expect(arrayResult.length).toBe(101);
    expect(arrayResult[99]).toBe(99);
    expect(arrayResult[100]).toBe('…3 more');

    const object: Record<string, number> = {};
    for (let i = 0; i < 105; i++) {
      object[`k${i}`] = i;
    }
    const objectResult = toJsonSafe(object, DEPTH) as Readonly<Record<string, unknown>>;
    expect(Object.keys(objectResult).length).toBe(101);
    expect(objectResult['k99']).toBe(99);
    expect(objectResult['k100']).toBeUndefined();
    expect(objectResult['…']).toBe('…5 more');
  });

  it('copies own enumerable string keys only', () => {
    class Base {
      inherited = 'no';
    }
    const value = Object.create({ fromProto: 'no' }) as Record<string | symbol, unknown>;
    value['own'] = 'yes';
    value[Symbol('s')] = 'no';
    Object.defineProperty(value, 'hidden', { value: 'no', enumerable: false });

    expect(toJsonSafe(value, DEPTH)).toEqual({ own: 'yes' });
    expect(toJsonSafe(new Base(), DEPTH)).toEqual({ inherited: 'no' });
  });

  it('keeps an own __proto__ key as data', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
    const result = toJsonSafe(parsed, DEPTH) as object;

    expect(Object.keys(result)).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(JSON.stringify(result)).toBe('{"__proto__":{"polluted":true},"a":1}');
  });

  it('does not throw on a hostile object', () => {
    const fail = (): never => {
      throw new Error('trap');
    };
    const hostile = new Proxy(
      {},
      {
        get: fail,
        set: fail,
        has: fail,
        ownKeys: fail,
        getOwnPropertyDescriptor: fail,
        getPrototypeOf: fail,
        setPrototypeOf: fail,
        defineProperty: fail,
        deleteProperty: fail,
        isExtensible: fail,
        preventExtensions: fail,
      },
    );

    expect(() => toJsonSafe(hostile, DEPTH)).not.toThrow();
    expect(toJsonSafe(hostile, DEPTH)).toBe('[Thrown: trap]');
    expect(() => toJsonSafe({ inner: hostile, list: [hostile] }, DEPTH)).not.toThrow();
  });

  it('returns a value JSON.stringify accepts', () => {
    const circular: Record<string, unknown> = {};
    circular['me'] = circular;
    const everything = [
      undefined,
      Number.NaN,
      10n,
      Symbol('s'),
      () => 1,
      new Error('e'),
      new Date(0),
      /r/,
      new Map([[1, 2]]),
      new Set([1]),
      new Uint16Array(3),
      document.body,
      circular,
      { deep: { deeper: { deepest: {} } } },
    ];

    const result = toJsonSafe(everything, 2);

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  describe('budget', () => {
    it('stops after MAX_CLONE_NODES values and marks the unfinished containers', () => {
      const rows = Array.from({ length: 20 }, () => Array.from({ length: 100 }, (_, i) => i));

      const [result] = cloneArgs([rows]) as [ReadonlyArray<readonly unknown[]>];

      const numbers = result.reduce(
        (n, row) => n + (Array.isArray(row) ? row.filter((v) => typeof v === 'number').length : 0),
        0,
      );
      expect(numbers).toBeLessThan(MAX_CLONE_NODES);
      expect(numbers).toBeGreaterThan(MAX_CLONE_NODES - 30);
      expect(result[result.length - 1]).toBe('[…]');
      expect(result.length).toBeLessThan(20);
    });

    it('clones a shared-subgraph object in bounded time and size', () => {
      // 4 levels of 40 keys all pointing at one child: ~160 real objects, 2.5M paths.
      let shared: unknown = 'leaf';
      for (let d = 0; d < 4; d++) {
        const level: Record<string, unknown> = {};
        for (let i = 0; i < 40; i++) {
          level[`k${i}`] = shared;
        }
        shared = level;
      }

      const start = performance.now();
      const result = cloneArgs([shared], { maxBodyLength: DEFAULT_CAPTURE_POLICY.maxBodyLength });
      const elapsed = performance.now() - start;

      // Wall-clock guard against the pre-fix blow-up (490 ms), not a benchmark:
      // the limit sits several times above the cost measured on a loaded
      // 4-CPU runner (≤ 1 ms) and several times below the regression.
      expect(elapsed).toBeLessThan(100);
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(DEFAULT_CAPTURE_POLICY.maxBodyLength + 2048);
      expect(JSON.stringify(result)).toContain('"[…]"');
    });

    it('shares one character budget across all args', () => {
      expect(cloneArgs(['abcdef', 'ghijkl', 'x', 1], { maxBodyLength: 10 })).toEqual([
        'abcdef',
        'ghij…[truncated 2 chars]',
        '[…]',
      ]);
    });

    it('counts object keys against the character budget', () => {
      expect(cloneArgs([{ abc: 'def', ghi: 'jkl' }], { maxBodyLength: 8 })).toEqual([{ abc: 'def', '…': '[…]' }]);
    });

    it('marks values beyond the budget with [the budget marker]', () => {
      expect(cloneArgs([{ a: 'aaaa', b: { c: 1 }, d: [1, 2] }, { e: 1 }], { maxBodyLength: 5 })).toEqual([
        { a: 'aaaa', '…': '[…]' },
        '[…]',
      ]);
    });

    it('truncates long string args', () => {
      const [result] = cloneArgs(['a'.repeat(100_000)], { maxBodyLength: 10 });

      expect(result).toBe('aaaaaaaaaa…[truncated 99990 chars]');
    });

    it('truncates logged Error message and stack', () => {
      const error = new Error('m'.repeat(1000));
      error.stack = 's'.repeat(1000);

      const [result] = cloneArgs([error], { maxBodyLength: 20 }) as [{ name: string; message: string; stack: string }];

      expect(result.name).toBe('Error');
      expect(result.message).toBe(`${'m'.repeat(15)}…[truncated 985 chars]`);
      expect(result.stack).toBe('[…]');
    });

    it('charges described leaves, function names and bigints too', () => {
      expect(cloneArgs([BigInt('1'.repeat(30))], { maxBodyLength: 4 })).toEqual(['1111…[truncated 27 chars]']);
      expect(cloneArgs([new RegExp('x'.repeat(30))], { maxBodyLength: 4 })).toEqual(['/xxx…[truncated 28 chars]']);
    });
  });

  describe('redaction', () => {
    const R = '[redacted]';
    const SECRETS: Partial<JsonSafePolicy> = {
      redactJsonKeys: DEFAULT_CAPTURE_POLICY.redactJsonKeys,
      redactedValue: R,
    };

    it('redacts keys ignoring case, _ and -', () => {
      const value = { access_token: 'a', 'Refresh-Token': 'b', API_KEY: 'c', nested: [{ Password: 'd' }], ok: 1 };

      expect(cloneArgs([value], SECRETS)).toEqual([
        { access_token: R, 'Refresh-Token': R, API_KEY: R, nested: [{ Password: R }], ok: 1 },
      ]);
    });

    it('matches secret names by suffix in objects, Maps and named pairs', () => {
      const value = {
        newPassword: 'a',
        tokenCount: 3,
        headers: new Map([
          ['x-api-key', 'b'],
          ['passwordPolicy', 'kept'],
        ]),
        fields: [
          { name: 'confirm_password', value: 'c' },
          { name: 'secretary', value: 'kept' },
        ],
      };

      expect(cloneArgs([value], SECRETS)).toEqual([
        {
          newPassword: R,
          tokenCount: 3,
          headers: {
            '[Map]': [
              ['x-api-key', R],
              ['passwordPolicy', 'kept'],
            ],
          },
          fields: [
            { name: 'confirm_password', value: R },
            { name: 'secretary', value: 'kept' },
          ],
        },
      ]);
    });

    it('does not read the value of a redacted property', () => {
      let reads = 0;
      const value = {
        get password(): string {
          reads++;
          return 'secret';
        },
      };

      expect(cloneArgs([value], SECRETS)).toEqual([{ password: R }]);
      expect(reads).toBe(0);
    });

    it('redacts a logged Map entry whose string key matches', () => {
      const result = cloneArgs(
        ['req', new Map([['authorization', 'Bearer SECRET1']]), { headers: new Map([['token', ['SECRET2']]]) }],
        SECRETS,
      );

      expect(result).toEqual(['req', { '[Map]': [['authorization', R]] }, { headers: { '[Map]': [['token', R]] } }]);
    });

    it('redacts the value of a { name, value } pair that names a secret', () => {
      // Angular's HttpHeaders keeps pending set() calls as { name, value, op } until first read,
      // and HttpParams as { param, value, op }.
      const pending = [
        { name: 'Authorization', value: 'Bearer SECRET', op: 's' },
        { param: 'access_token', value: 'SECRET', op: 's' },
        { name: 'Accept', value: 'application/json', op: 's' },
      ];

      expect(cloneArgs([pending], SECRETS)).toEqual([
        [
          { name: 'Authorization', value: R, op: 's' },
          { param: 'access_token', value: R, op: 's' },
          { name: 'Accept', value: 'application/json', op: 's' },
        ],
      ]);
    });

    it('redacts JSON text inside string args and Error messages', () => {
      const error = new Error(JSON.stringify({ password: 'SECRET4' }));

      const [text, logged] = cloneArgs([JSON.stringify({ password: 'SECRET3' }), error], SECRETS) as [
        string,
        { message: string },
      ];

      expect(text).toBe('{"password":"[redacted]"}');
      expect(logged.message).toBe('{"password":"[redacted]"}');
    });

    it('redacts JSON text before truncating it', () => {
      const text = JSON.stringify({ password: 'SECRET', padding: 'x'.repeat(100) });

      const [result] = cloneArgs([text], { ...SECRETS, maxBodyLength: 30 });

      expect(result).toBe('{"password":"[redacted]","padd…[truncated 108 chars]');
    });

    it('redacts secret URL parameters inside string args', () => {
      expect(cloneArgs(['GET https://h/api?access_token=S&x=1'], SECRETS)).toEqual([
        'GET https://h/api?access_token=[redacted]&x=1',
      ]);
    });
  });

  describe('confirmation review fixes', () => {
    const R = '[redacted]';
    const SECRETS: Partial<JsonSafePolicy> = {
      redactJsonKeys: DEFAULT_CAPTURE_POLICY.redactJsonKeys,
      redactedValue: R,
    };
    const FRAME = '    at f (https://h/main.js:1:2)';

    it('redacts a logged Error stack like its message', () => {
      const url = new Error('GET wss://h/ws?access_token=SECRET_A failed');
      url.stack = `Error: GET wss://h/ws?access_token=SECRET_A failed\n${FRAME}`;
      const json = new Error('{"password":"SECRET_B"}');
      json.stack = `Error: {"password":"SECRET_B"}\n${FRAME}`;

      const [a, b] = cloneArgs([url, json], SECRETS) as Array<{ message: string; stack: string }>;

      expect(a.message).toBe(`GET wss://h/ws?access_token=${R} failed`);
      expect(a.stack).toBe(`Error: GET wss://h/ws?access_token=${R} failed\n${FRAME}`);
      expect(b.message).toBe('{"password":"[redacted]"}');
      expect(b.stack).toBe(`Error: {"password":"[redacted]"}\n${FRAME}`);
    });

    it('keeps the other fields of a logged JSON string that holds a URL', () => {
      expect(cloneArgs(['{"url":"https://h/x?token=abc","status":401,"detail":"boom"}'], SECRETS)).toEqual([
        `{"url":"https://h/x?token=${R}","status":401,"detail":"boom"}`,
      ]);
    });

    it('leaves null, boolean and undefined secret values as they are, without running getters', () => {
      let reads = 0;
      const value = {
        token: null,
        apiKey: true,
        password: undefined,
        secret: 's',
        get accessToken(): null {
          reads++;
          return null;
        },
      };

      expect(cloneArgs([value, new Map([['token', null]])], SECRETS)).toEqual([
        { token: null, apiKey: true, password: '[undefined]', secret: R, accessToken: R },
        { '[Map]': [['token', null]] },
      ]);
      expect(reads).toBe(0);
    });

    it('clones a 200k-key object shared by 100 rows in bounded time', () => {
      const dict: Record<string, number> = {};
      for (let i = 0; i < 200_000; i++) {
        dict[`id${i}`] = i;
      }
      const rows = Array.from({ length: 100 }, (_, i) => ({ i, lookup: dict }));
      const times: number[] = [];
      let result: readonly unknown[] = [];

      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        result = cloneArgs([rows], { maxBodyLength: DEFAULT_CAPTURE_POLICY.maxBodyLength });
        times.push(performance.now() - start);
      }
      const median = times.slice().sort((a, b) => a - b)[2];

      // Wall-clock guard, not a benchmark, on the MEDIAN of 5 runs: one run can
      // spike under parallel load (253 ms seen once at load average 9.3, while
      // its neighbours ran at ~40 ms). Re-measured with coverage on the shared
      // 4-CPU runner (load average 4–8, 27 runs): 35–71 ms per run, median ~42
      // ms. The regression it guards — key budget and memo reverted, so every
      // row enumerates the 200k keys again — measured 376–628 ms, median ~420
      // ms. 150 ms is ~3.5× today's median and ~2.8× below the regression's.
      expect(median)
        .withContext(`runs: ${times.map((t) => Math.round(t)).join(', ')} ms`)
        .toBeLessThan(150);
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(DEFAULT_CAPTURE_POLICY.maxBodyLength + 2048);
    });

    it('stops enumerating large objects once their keys use up the budget', () => {
      const target: Record<string, number> = {};
      for (let i = 0; i < 5000; i++) {
        target[`k${i}`] = i;
      }
      let enumerations = 0;
      const rows = Array.from({ length: 50 }, () => ({
        big: new Proxy(target, {
          ownKeys: (t): ArrayLike<string | symbol> => {
            enumerations++;
            return Reflect.ownKeys(t);
          },
        }),
      }));

      cloneArgs([rows]);

      expect(enumerations).toBeLessThanOrEqual(2);
    });

    it('reuses a clone only where it would come out the same', () => {
      const shared = { x: { y: 1 } };
      expect(cloneArgs([{ a: shared, b: { c: shared } }], { maxArgDepth: 3 })).toEqual([
        { a: { x: { y: 1 } }, b: { c: { x: '[Object]' } } },
      ]);

      const root: Record<string, unknown> = { name: 'r' };
      const child = { parent: root };
      root['child'] = child;
      expect(cloneArgs([root, child])).toEqual([
        { name: 'r', child: { parent: '[Circular]' } },
        { parent: { name: 'r', child: '[Circular]' } },
      ]);
    });

    it('still bounds a shared graph when clones are reused', () => {
      const leaf = { v: 'x'.repeat(100) };
      const rows = Array.from({ length: 1000 }, () => leaf);

      const [result] = cloneArgs([rows], { maxBodyLength: 1000 }) as [readonly unknown[]];

      expect(JSON.stringify(result).length).toBeLessThan(2000);
      expect(result[result.length - 1]).toBe('[…]');
    });
  });

  it('freezes everything it builds', () => {
    const error = new Error('e');
    const [result, map, err] = cloneArgs([{ a: { b: [1, { c: 2 }] } }, new Map([['k', { v: 1 }]]), error]) as [
      { a: { b: [number, object] } },
      { '[Map]': [[string, object]] },
      object,
    ];
    const all = cloneArgs([1]);

    expect(Object.isFrozen(all)).toBeTrue();
    expect(Object.isFrozen(result)).toBeTrue();
    expect(Object.isFrozen(result.a)).toBeTrue();
    expect(Object.isFrozen(result.a.b)).toBeTrue();
    expect(Object.isFrozen(result.a.b[1])).toBeTrue();
    expect(Object.isFrozen(map)).toBeTrue();
    expect(Object.isFrozen(map['[Map]'])).toBeTrue();
    expect(Object.isFrozen(map['[Map]'][0])).toBeTrue();
    expect(Object.isFrozen(map['[Map]'][0][1])).toBeTrue();
    expect(Object.isFrozen(err)).toBeTrue();
  });
});
