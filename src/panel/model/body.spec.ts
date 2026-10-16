import { describeBody, isRedacted, redactedRanges, splitTruncation } from './body';

describe('body helpers (S03-12)', () => {
  it('detects JSON objects and arrays and parses them', () => {
    const body = describeBody('{"a":[1,true,null]}');
    expect(body.kind).toBe('json');
    expect((body.kind === 'json' ? body.value : null) as unknown).toEqual({ a: [1, true, null] });
    expect(describeBody(' [1, 2] ').kind).toBe('json');
    expect(describeBody('[true]').kind).toBe('json');
  });

  it('keeps JSON scalars and broken JSON as text', () => {
    expect(describeBody('42').kind).toBe('text');
    expect(describeBody('"just a string"').kind).toBe('text');
    expect(describeBody('{"a":').kind).toBe('text');
  });

  it('detects form-encoded bodies by content type or by shape, and decodes the fields', () => {
    const body = describeBody('name=J%C3%B6rg+M&tags=a&tags=b&empty=');
    expect(body.kind).toBe('form');
    expect(body.kind === 'form' ? body.fields : null).toEqual([
      { name: 'name', value: 'Jörg M' },
      { name: 'tags', value: 'a' },
      { name: 'tags', value: 'b' },
      { name: 'empty', value: '' },
    ]);
    expect(describeBody('a=1').kind).toBe('form');
    expect(describeBody('flag', { contentType: 'application/x-www-form-urlencoded; charset=UTF-8' }).kind).toBe('form');
    expect(describeBody('hello world').kind).toBe('text');
    expect(describeBody('x=1 y=2').kind).toBe('text');
  });

  it('keeps a malformed escape as written', () => {
    const body = describeBody('bad=%E0%A4%A&ok=1');
    expect(body.kind === 'form' ? body.fields : null).toEqual([
      { name: 'bad', value: '%E0%A4%A' },
      { name: 'ok', value: '1' },
    ]);
  });

  it('detects the v1 descriptors of non-text bodies', () => {
    for (const d of [
      '[FormData: a, b]',
      '[Blob 512 bytes]',
      '[Binary 12 bytes]',
      '[ReadableStream]',
      '[Document]',
      '[Request body]',
      '[arraybuffer 8 bytes]',
      '[blob 3 bytes]',
      '[document]',
    ]) {
      expect(describeBody(d).kind).withContext(d).toBe('descriptor');
    }
    expect(describeBody('[not a descriptor]').kind).toBe('text');
  });

  it('empty and null bodies are "empty"', () => {
    expect(describeBody(null)).toEqual({ kind: 'empty', text: '', truncation: null });
    expect(describeBody('').kind).toBe('empty');
  });

  it('splits off the v1 truncation markers and gives the original length when known', () => {
    expect(splitTruncation('abcd…[truncated 96 chars]')).toEqual({
      text: 'abcd',
      truncation: { kind: 'truncated', originalLength: 100 },
    });
    expect(splitTruncation('abc…[capture stopped at 1048576 chars]')).toEqual({
      text: 'abc',
      truncation: { kind: 'stopped', originalLength: null },
    });
    expect(splitTruncation('…[truncated 3 chars] in the middle')).toEqual({
      text: '…[truncated 3 chars] in the middle',
      truncation: null,
    });
  });

  it('a truncated JSON body is text with its truncation', () => {
    const body = describeBody('{"a":"xxxx…[truncated 10 chars]');
    expect(body.kind).toBe('text');
    expect(body.text).toBe('{"a":"xxxx');
    expect(body.truncation).toEqual({ kind: 'truncated', originalLength: 20 });
  });

  it('resBodyCapped wins: full length unknown', () => {
    expect(describeBody('{"a":1', { capped: true }).truncation).toEqual({ kind: 'capped', originalLength: null });
    const capped = describeBody('abc…[truncated 5 chars]', { capped: true });
    expect(capped.text).toBe('abc');
    expect(capped.truncation).toEqual({ kind: 'capped', originalLength: null });
  });

  it('redaction: exact leaves and the ranges inside text', () => {
    expect(isRedacted('[redacted]', '[redacted]')).toBe(true);
    expect(isRedacted('[redacted] ', '[redacted]')).toBe(false);
    expect(isRedacted(null, '[redacted]')).toBe(false);
    expect(redactedRanges('?token=[redacted]&key=[redacted]', '[redacted]')).toEqual([
      { start: 7, end: 17 },
      { start: 22, end: 32 },
    ]);
    expect(redactedRanges('nothing here', '[redacted]')).toEqual([]);
    expect(redactedRanges('anything', '')).toEqual([]);
  });
});
