import { resolvePolicy, toJsonSafe, truncate } from '../../model';
import { classifyJsonString, group, isPlaceholderKey } from './json-text';

const REDACTED = '[redacted]';

describe('classifyJsonString', () => {
  it('marks a string equal to the redacted value', () => {
    expect(classifyJsonString(REDACTED, REDACTED)).toEqual({ kind: 'redacted' });
    expect(classifyJsonString('***', '***')).toEqual({ kind: 'redacted' });
  });

  it('does not mark text that only contains the redacted value', () => {
    expect(classifyJsonString(`?token=${REDACTED}`, REDACTED).kind).toBe('string');
  });

  it('never marks anything when the redacted value is empty', () => {
    expect(classifyJsonString('', '').kind).toBe('string');
  });

  it('reads the note and length from truncate()', () => {
    const cut = truncate('x'.repeat(1300), 100);
    expect(classifyJsonString(cut, REDACTED)).toEqual({
      kind: 'truncated',
      kept: 'x'.repeat(100),
      note: 'truncated 1,200 chars',
      chars: 1200,
    });
  });

  it("reads the fetch probe's 1 MB cap note", () => {
    expect(classifyJsonString('abc…[capture stopped at 1048576 chars]', REDACTED)).toEqual({
      kind: 'truncated',
      kept: 'abc',
      note: 'capture stopped at 1,048,576 chars',
      chars: 1048576,
    });
  });

  it('keeps look-alike endings as plain strings', () => {
    for (const text of ['…[truncated many chars]', 'done [12 chars]', '…[truncated 5 chars] and more', ' chars]']) {
      expect(classifyJsonString(text, REDACTED).kind).withContext(text).toBe('string');
    }
  });

  it('a truncated placeholder is shown as truncated', () => {
    expect(classifyJsonString(`[Function ${'f'.repeat(10)}…[truncated 3 chars]`, REDACTED).kind).toBe('truncated');
  });

  it('detects every placeholder toJsonSafe writes, from real values', () => {
    const policy = resolvePolicy({ maxArgDepth: 1 });
    const div = document.createElement('div');
    div.id = 'id';
    div.className = 'a b';
    const thrower = {
      get x(): never {
        throw new Error('boom');
      },
    };
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    const args: unknown[] = [
      undefined,
      () => 1,
      function named() {},
      new Date(Number.NaN),
      new Uint8Array(4),
      new ArrayBuffer(8),
      new DataView(new ArrayBuffer(2)),
      div,
      document.createTextNode('t'),
      document.createComment('c'),
      document.createDocumentFragment(),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      BigInt(12),
      Symbol('s'),
    ];
    const plain = toJsonSafe(args, policy) as readonly string[];
    const nested = toJsonSafe(
      [{ o: { a: 1 }, a: [1, 2, 3], m: new Map([[1, 2]]), s: new Set([1]), t: thrower }],
      resolvePolicy({ maxArgDepth: 2 }),
    )[0] as Record<string, Record<string, string>>;
    const deep = toJsonSafe(
      [{ o: {}, a: [], m: new Map(), s: new Set() }],
      resolvePolicy({ maxArgDepth: 1 }),
    )[0] as Record<string, string>;
    const circular = toJsonSafe([cycle], policy)[0] as Record<string, string>;
    const more = toJsonSafe([Array.from({ length: 150 }, (_, i) => i)], policy)[0] as readonly unknown[];
    const spent = toJsonSafe(['abc', 'def'], resolvePolicy({ maxBodyLength: 3 }));

    const markers = [
      ...plain,
      nested['t']['x'],
      deep['o'],
      deep['a'],
      deep['m'],
      deep['s'],
      circular['self'],
      more[100] as string,
      spent[1] as string,
    ];
    expect(markers).toEqual([
      '[undefined]',
      '[Function anonymous]',
      '[Function named]',
      '[Invalid Date]',
      '[Uint8Array 4 bytes]',
      '[ArrayBuffer 8 bytes]',
      '[DataView 2 bytes]',
      '[HTMLDivElement div#id.a.b]',
      '[Text]',
      '[Comment]',
      '[DocumentFragment]',
      'NaN',
      'Infinity',
      '-Infinity',
      '12n',
      'Symbol(s)',
      '[Thrown: boom]',
      '[Object]',
      '[Array(0)]',
      '[Map(0)]',
      '[Set(0)]',
      '[Circular]',
      '…50 more',
      '[…]',
    ]);
    for (const marker of markers) {
      expect(classifyJsonString(marker, REDACTED)).withContext(marker).toEqual({ kind: 'placeholder', text: marker });
    }
  });

  it('detects the placeholders with counts and every node kind', () => {
    for (const text of [
      '[Array(3)]',
      '[Map(12)]',
      '[Set(1)]',
      '[Float64Array 64 bytes]',
      '[SVGSVGElement svg]',
      '[HTMLElement my-widget.x]',
      '[ShadowRoot]',
      '[Thrown: unknown error]',
    ]) {
      expect(classifyJsonString(text, REDACTED).kind).withContext(text).toBe('placeholder');
    }
  });

  it('leaves ordinary strings alone', () => {
    for (const text of [
      '',
      'hello',
      '[1, 2]',
      '[Object object',
      'Object]',
      '[Array(x)]',
      '12',
      'n',
      'Symbol',
      '[Text node]',
    ]) {
      expect(classifyJsonString(text, REDACTED)).withContext(text).toEqual({ kind: 'string', text });
    }
  });

  it('known limit: a real string with a placeholder text looks like the placeholder', () => {
    expect(classifyJsonString('[Circular]', REDACTED).kind).toBe('placeholder');
  });
});

describe('isPlaceholderKey', () => {
  it('knows the keys v1 writes', () => {
    expect(['[Map]', '[Set]', '…'].map(isPlaceholderKey)).toEqual([true, true, true]);
    expect(['map', '[Object]', '...'].map(isPlaceholderKey)).toEqual([false, false, false]);
  });
});

describe('group', () => {
  it('puts commas between thousands', () => {
    expect([0, 999, 1000, 1234567].map(group)).toEqual(['0', '999', '1,000', '1,234,567']);
  });
});
