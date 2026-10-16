import { httpEntry, pendingRequest } from './fakes.spec';
import { shellQuote, toCurl } from './curl';

describe('toCurl (S03-13)', () => {
  it('builds a bash command: --url, method, headers, body — every value single-quoted', () => {
    const entry = httpEntry(1, {
      method: 'POST',
      url: 'https://app.test/api/items?x=1&y=2',
      reqHeaders: { 'content-type': 'application/json', accept: '*/*' },
      reqBody: '{"a":1}',
    });
    expect(toCurl(entry)).toBe(
      [
        "curl --url 'https://app.test/api/items?x=1&y=2'",
        "  -X 'POST'",
        "  -H 'content-type: application/json'",
        "  -H 'accept: */*'",
        '  --data-raw \'{"a":1}\'',
      ].join(' \\\n'),
    );
  });

  it('quotes hostile values so bash runs nothing from them', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('$(rm -rf ~)')).toBe("'$(rm -rf ~)'");
    expect(shellQuote('`id`')).toBe("'`id`'");
    expect(shellQuote('a\nb')).toBe("'a\nb'");
    expect(shellQuote('"; echo pwned; "')).toBe('\'"; echo pwned; "\'');
    expect(shellQuote('')).toBe("''");

    const entry = httpEntry(1, {
      method: 'PUT',
      url: "-o/etc/passwd' $(id) `id`",
      reqHeaders: { 'x-evil': "'; touch ~/pwned; echo '\nnext" },
      reqBody: "line1\nline2 $HOME 'q'",
    });
    const curl = toCurl(entry);
    expect(curl).toContain("--url '-o/etc/passwd'\\'' $(id) `id`'");
    expect(curl).toContain("-H 'x-evil: '\\''; touch ~/pwned; echo '\\''\nnext'");
    expect(curl).toContain("--data-raw 'line1\nline2 $HOME '\\''q'\\'''");
  });

  it('every quoted value survives a POSIX single-quote round trip', () => {
    // Undo the quoting the way a shell would: outside quotes only `\'` occurs.
    const unquote = (q: string): string => q.replace(/'\\''/g, "'").slice(1, -1);
    for (const v of ["it's", "''", "a'b'c", '$(x)', '`y`', 'a\nb', '\\', '-v']) {
      expect(unquote(shellQuote(v)))
        .withContext(v)
        .toBe(v);
      expect(shellQuote(v).slice(1, -1).split("'\\''").join('')).not.toContain("'");
    }
  });

  it('copies redacted header values as [redacted]', () => {
    const entry = httpEntry(1, { reqHeaders: { authorization: '***' } });
    expect(toCurl(entry, '***')).toContain("-H 'authorization: [redacted]'");
    expect(toCurl(httpEntry(2, { reqHeaders: { authorization: '[redacted]' } }))).toContain(
      "-H 'authorization: [redacted]'",
    );
  });

  it('leaves out a body that was not captured as text (a descriptor)', () => {
    expect(toCurl(httpEntry(1, { method: 'POST', reqBody: '[Blob 512 bytes]' }))).not.toContain('--data-raw');
    expect(toCurl(httpEntry(2, { method: 'POST', reqBody: '' }))).toContain("--data-raw ''");
  });

  it('works for a pending request (no body yet)', () => {
    expect(toCurl(pendingRequest(3, { method: 'GET', url: 'https://app.test/a' }))).toBe(
      "curl --url 'https://app.test/a' \\\n  -X 'GET'",
    );
  });
});
