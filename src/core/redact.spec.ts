import { DEFAULT_CAPTURE_POLICY } from '../contract';
import { matchesAny, redactHeaders, redactJsonText, redactJsonValue, redactParams, redactUserinfo } from './redact';

describe('redact', () => {
  const R = '[redacted]';

  it('redacts header values case-insensitively and lower-cases keys', () => {
    const headers = { Authorization: 'Bearer abc', 'Content-Type': 'application/json', COOKIE: 'sid=1' };

    const result = redactHeaders(headers, ['authorization', 'Cookie'], R);

    expect(result).toEqual({ authorization: R, 'content-type': 'application/json', cookie: R });
    expect(result).not.toBe(headers);
    expect(headers.Authorization).toBe('Bearer abc');
  });

  it('redacts nested JSON keys at any depth, including inside arrays', () => {
    const value = {
      user: { name: 'op', Password: 'p1' },
      sessions: [{ token: 't1', id: 1 }, [{ deeper: { TOKEN: { any: 'shape' } } }]],
      secret: null,
    };

    // Typed `unknown`: Jasmine's `Expected<T>` recursion blows up on the recursive `JsonValue` type.
    const redacted: unknown = redactJsonValue(value, ['password', 'token', 'secret'], R);

    expect(redacted).toEqual({
      user: { name: 'op', Password: R },
      sessions: [{ token: R, id: 1 }, [{ deeper: { TOKEN: R } }]],
      // null carries no secret: kept, so a reader does not think one was there.
      secret: null,
    });
    // The input is not mutated.
    expect(value.user.Password).toBe('p1');
  });

  it('leaves non-JSON text untouched', () => {
    const keys = ['password'];
    expect(redactJsonText('password=s3cret', keys, R)).toBe('password=s3cret');
    expect(redactJsonText('{"password": broken', keys, R)).toBe('{"password": broken');
    expect(redactJsonText('', keys, R)).toBe('');
    expect(redactJsonText('<html>password</html>', keys, R)).toBe('<html>password</html>');
  });

  it('leaves JSON primitives untouched', () => {
    const keys = ['password'];
    expect(redactJsonText('"password"', keys, R)).toBe('"password"');
    expect(redactJsonText('42', keys, R)).toBe('42');
    expect(redactJsonText('null', keys, R)).toBe('null');
  });

  it("redacts the login request body's password", () => {
    const body = '{"username":"op","password":"s3cret","mode":"operation","position":"active"}';

    const result = redactJsonText(body, DEFAULT_CAPTURE_POLICY.redactJsonKeys, R);

    expect(result).toBe('{"username":"op","password":"[redacted]","mode":"operation","position":"active"}');
    expect(result).not.toContain('s3cret');
  });

  it('redacts JSON text with leading whitespace and inside a top-level array', () => {
    expect(redactJsonText('  \n[{"token":"t"}]', ['token'], R)).toBe('[{"token":"[redacted]"}]');
  });

  it('keeps JSON text byte-for-byte when no key matches', () => {
    const pretty = '{\n  "a": 1\n}';
    expect(redactJsonText(pretty, ['password'], R)).toBe(pretty);
  });

  it('matches keys ignoring case, _ and - on both sides', () => {
    const text = '{"access_token":"S5","refresh_token":"S6","id_token":"S7","api_key":"S8","client_secret":"S9","x":1}';

    const result = redactJsonText(text, DEFAULT_CAPTURE_POLICY.redactJsonKeys, R);

    expect(JSON.parse(result)).toEqual({
      access_token: R,
      refresh_token: R,
      id_token: R,
      api_key: R,
      client_secret: R,
      x: 1,
    });
    // Normalised on the policy side too: a key listed as `api_key` matches `apiKey` and `API-KEY`.
    expect(redactJsonText('{"apiKey":1,"API-KEY":2}', ['api_key'], R)).toBe(
      '{"apiKey":"[redacted]","API-KEY":"[redacted]"}',
    );
  });

  it('redacts JSON text that starts with a byte-order mark', () => {
    expect(redactJsonText('﻿{"password":"S12"}', ['password'], R)).toBe('{"password":"[redacted]"}');
    expect(redactJsonText('﻿{"a":1}', ['password'], R)).toBe('﻿{"a":1}');
  });

  it('redacts the value of a { name, value } pair that names a secret', () => {
    // jQuery serializeArray(), HAR headers and similar lists of named fields.
    const text = '[{"name":"username","value":"op"},{"name":"Password","value":"S"}]';

    expect(redactJsonText(text, ['password'], R)).toBe(
      '[{"name":"username","value":"op"},{"name":"Password","value":"[redacted]"}]',
    );
  });

  it('redacts secret URL query and fragment parameter values, leaving the rest byte for byte', () => {
    const keys = DEFAULT_CAPTURE_POLICY.redactJsonKeys;

    expect(redactParams('wss://h/ws?access_token=S&x=1', keys, R)).toBe('wss://h/ws?access_token=[redacted]&x=1');
    expect(redactParams('https://h/a?x=%20a+b&TOKEN=S#id_token=S2&state=1', keys, R)).toBe(
      'https://h/a?x=%20a+b&TOKEN=[redacted]#id_token=[redacted]&state=1',
    );
    expect(redactParams('https://h/a?access%5Ftoken=S', keys, R)).toBe('https://h/a?access%5Ftoken=[redacted]');
    expect(redactParams('https://h/a?tokenish=1&b', keys, R)).toBe('https://h/a?tokenish=1&b');
    expect(redactParams('https://h/plain', keys, R)).toBe('https://h/plain');
  });

  it('redacts secret parameters of a form body and of free text', () => {
    const keys = DEFAULT_CAPTURE_POLICY.redactJsonKeys;

    expect(redactParams('password=s3cret&username=op', keys, R)).toBe('password=[redacted]&username=op');
    expect(redactParams('username=op&client_secret=c', keys, R)).toBe('username=op&client_secret=[redacted]');
    expect(redactParams('GET https://h/x?token=t: 401 Unauthorized', keys, R)).toBe(
      // Over-redacts the `:` rather than risk leaking a value that contains one.
      'GET https://h/x?token=[redacted] 401 Unauthorized',
    );
    expect(redactParams('what? token is missing', keys, R)).toBe('what? token is missing');
  });

  it('truncates header values and freezes the result', () => {
    const result = redactHeaders({ Authorization: 'Bearer abc', 'X-Long': 'abcdef' }, ['authorization'], R, 4);

    expect(result).toEqual({ authorization: R, 'x-long': 'abcd…[truncated 2 chars]' });
    expect(Object.isFrozen(result)).toBeTrue();
  });

  it('redactJsonValue matches normalised keys', () => {
    const redacted: unknown = redactJsonValue({ Access_Token: 'a', ok: 1 }, ['accesstoken'], R);

    expect(redacted).toEqual({ Access_Token: R, ok: 1 });
  });

  describe('secret names match by suffix', () => {
    const keys = DEFAULT_CAPTURE_POLICY.redactJsonKeys;
    const positives = ['newPassword', 'confirm_password', 'oldPassword', 'userPassword', 'oauthToken', 'x-api-key'];
    const negatives = ['tokenCount', 'passwordPolicy', 'secretary'];

    it('matches secret names by suffix', () => {
      const body: Record<string, string> = {};
      positives.forEach((name) => (body[name] = 'S'));
      const expected: Record<string, string> = {};
      positives.forEach((name) => (expected[name] = R));

      expect(JSON.parse(redactJsonText(JSON.stringify(body), keys, R))).toEqual(expected);
      expect(redactJsonText('[{"name":"newPassword","value":"S"}]', keys, R)).toBe(
        '[{"name":"newPassword","value":"[redacted]"}]',
      );
      expect(redactParams(`https://h/a?${positives.map((n) => `${n}=S`).join('&')}`, keys, R)).toBe(
        `https://h/a?${positives.map((n) => `${n}=${R}`).join('&')}`,
      );
      expect(redactParams('confirm_password=S&user=op', keys, R)).toBe(`confirm_password=${R}&user=op`);
    });

    it('does not redact names that only start with or contain a secret name', () => {
      const body: Record<string, string> = {};
      negatives.forEach((name) => (body[name] = 'kept'));
      const text = JSON.stringify(body);

      expect(redactJsonText(text, keys, R)).toBe(text);
      const pair = '[{"name":"tokenCount","value":"kept"}]';
      expect(redactJsonText(pair, keys, R)).toBe(pair);
      const query = `https://h/a?${negatives.map((n) => `${n}=kept`).join('&')}`;
      expect(redactParams(query, keys, R)).toBe(query);
    });

    it('keeps header names exact', () => {
      expect(redactHeaders({ 'x-authorization-hint': 'kept' }, ['authorization'], R)).toEqual({
        'x-authorization-hint': 'kept',
      });
      expect(redactHeaders({ 'new-cookie': 'kept' }, ['cookie'], R)).toEqual({ 'new-cookie': 'kept' });
    });
  });

  describe('URL parameters (confirmation review)', () => {
    const keys = DEFAULT_CAPTURE_POLICY.redactJsonKeys;

    it('treats ? as a separator, so a nested URL cannot hide a parameter', () => {
      expect(redactParams('http://h/a?next=/cb?access_token=S6', keys, R)).toBe(
        `http://h/a?next=/cb?access_token=${R}`,
      );
      expect(redactParams('http://h/a?redirect=https://x/y?token=S7&z=1', keys, R)).toBe(
        `http://h/a?redirect=https://x/y?token=${R}&z=1`,
      );
      expect(redactParams('http://h/#/cb?access_token=S5', keys, R)).toBe(`http://h/#/cb?access_token=${R}`);
    });

    it('replaces a value whole when it percent-decodes to a secret parameter', () => {
      expect(redactParams('http://h/a?returnUrl=%2Fp%3Ftoken%3DS8&x=1', keys, R)).toBe(`http://h/a?returnUrl=${R}&x=1`);
      expect(redactParams('http://h/a?r=%252Fp%253Ftoken%253DS', keys, R)).toBe(`http://h/a?r=${R}`);
      const harmless = 'http://h/a?q=100%25&p=%2Fpath%3Fx%3D1';
      expect(redactParams(harmless, keys, R)).toBe(harmless);
      // A malformed escape does not stop the check.
      expect(redactParams('http://h/a?r=%3Ftoken%3DS%E', keys, R)).toBe(`http://h/a?r=${R}`);
    });

    it('matches bracketed names on any segment', () => {
      expect(redactParams('http://h/a?access_token[]=S9', keys, R)).toBe(`http://h/a?access_token[]=${R}`);
      expect(redactParams('user[password]=S&user[name]=op', keys, R)).toBe(`user[password]=${R}&user[name]=op`);
      expect(redactParams('user%5Bpassword%5D=S', keys, R)).toBe(`user%5Bpassword%5D=${R}`);
    });

    it('ends a value at quotes and angle brackets', () => {
      expect(redactParams('<a href="/x?token=S">t</a>', keys, R)).toBe(`<a href="/x?token=${R}">t</a>`);
      expect(redactParams("go('/x?token=S')", keys, R)).toBe(`go('/x?token=${R}')`);
    });

    it('redacts signatures but not OAuth codes', () => {
      expect(redactParams('http://h/a?X-Amz-Signature=S&code=C&state=x', keys, R)).toBe(
        `http://h/a?X-Amz-Signature=${R}&code=C&state=x`,
      );
    });

    it('redacts URL parameters inside JSON string values, keeping the other fields', () => {
      expect(redactJsonText('{"url":"https://h/x?token=abc","status":401,"detail":"boom"}', keys, R)).toBe(
        `{"url":"https://h/x?token=${R}","status":401,"detail":"boom"}`,
      );
      expect(redactJsonText('{"next":"https://h/x?access_token=S21"}', keys, R)).toBe(
        `{"next":"https://h/x?access_token=${R}"}`,
      );
      const plain = '{"a": "x=1"}';
      expect(redactJsonText(plain, keys, R)).toBe(plain);
    });

    it('leaves null and boolean secret values in JSON as they are', () => {
      expect(redactJsonText('{"nextToken":null,"token":false,"secret":true,"password":0}', keys, R)).toBe(
        `{"nextToken":null,"token":false,"secret":true,"password":"${R}"}`,
      );
    });

    it('stays correct past the decision cache size', () => {
      const body: Record<string, string> = {};
      for (let i = 0; i < 2500; i++) {
        body[`field${i}`] = 'x';
        body[`field${i}Token`] = 'S';
      }

      const result = JSON.parse(redactJsonText(JSON.stringify(body), keys, R)) as Record<string, string>;

      expect(result['field2499']).toBe('x');
      expect(result['field2499Token']).toBe(R);
      expect(Object.keys(result).filter((k) => result[k] === 'S')).toEqual([]);
    });
  });

  it('matchesAny is stable with global regexes', () => {
    const patterns = [/\/never/, /\/api\/stream/g];
    const url = 'http://localhost/api/stream';

    const results = [1, 2, 3, 4].map(() => matchesAny(url, patterns));

    expect(results).toEqual([true, true, true, true]);
    expect(matchesAny('http://localhost/other', patterns)).toBeFalse();
    expect(matchesAny(url, [])).toBeFalse();
    const sticky = /http/y;
    expect([1, 2, 3].map(() => matchesAny(url, [sticky]))).toEqual([true, true, true]);
  });

  it('puts a user-set replacement into a URL literally, never as a `$` pattern', () => {
    for (const replacement of ['$1', '$&', "$'", '$$']) {
      expect(redactUserinfo('https://user:secret@host/p', replacement))
        .withContext(replacement)
        .toBe(`https://${replacement}@host/p`);
    }
  });
});
