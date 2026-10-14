import {
  describeBody,
  headersToMap,
  isTextual,
  parseRawHeaders,
  responseBytes,
  toAbsoluteUrl,
  utf8Length,
} from './http-helpers';

describe('http helpers', () => {
  describe('toAbsoluteUrl', () => {
    it('resolves relative URLs against the base', () => {
      expect(toAbsoluteUrl('/api/items?a=1', 'http://host:8080/app/page')).toBe('http://host:8080/api/items?a=1');
      expect(toAbsoluteUrl('items', 'http://host/app/page')).toBe('http://host/app/items');
    });

    it('keeps absolute URLs and accepts URL objects', () => {
      expect(toAbsoluteUrl('https://other/x', 'http://host/')).toBe('https://other/x');
      expect(toAbsoluteUrl(new URL('https://other/y'), 'http://host/')).toBe('https://other/y');
    });

    it('falls back to the raw string when the URL cannot be parsed', () => {
      expect(toAbsoluteUrl('/x', 'not a base')).toBe('/x');
    });
  });

  describe('parseRawHeaders', () => {
    it('parses the getAllResponseHeaders format with lower-case keys', () => {
      const raw = 'Content-Type: application/json\r\nX-Trace: a: b\r\ncontent-length: 7\r\n';
      expect(parseRawHeaders(raw)).toEqual({
        'content-type': 'application/json',
        'x-trace': 'a: b',
        'content-length': '7',
      });
    });

    it('returns an empty map for an empty string and skips malformed lines', () => {
      expect(parseRawHeaders('')).toEqual({});
      expect(parseRawHeaders('garbage\r\nok: 1')).toEqual({ ok: '1' });
    });
  });

  describe('headersToMap', () => {
    it('reads a Headers object', () => {
      const headers = new Headers({ 'Content-Type': 'text/plain', 'X-A': '1' });
      expect(headersToMap(headers)).toEqual({ 'content-type': 'text/plain', 'x-a': '1' });
    });

    it('reads pairs and joins duplicates', () => {
      expect(headersToMap([['X-A', '1'], ['x-a', '2'], ['B', '3']])).toEqual({ 'x-a': '1, 2', b: '3' });
    });

    it('reads a record and handles undefined', () => {
      expect(headersToMap({ Accept: 'application/json' })).toEqual({ accept: 'application/json' });
      expect(headersToMap(undefined)).toEqual({});
    });
  });

  describe('describeBody', () => {
    it('keeps strings and serializes URLSearchParams', () => {
      expect(describeBody('{"a":1}')).toBe('{"a":1}');
      expect(describeBody(new URLSearchParams({ q: 'x y', n: '1' }))).toBe('q=x+y&n=1');
    });

    it('describes FormData by its keys', () => {
      const form = new FormData();
      form.append('a', '1');
      form.append('b', new Blob(['zz']));
      form.append('a', '2');
      expect(describeBody(form)).toBe('[FormData: a, b]');
    });

    it('describes binary bodies by size', () => {
      expect(describeBody(new Blob(['hello world!']))).toBe('[Blob 12 bytes]');
      expect(describeBody(new ArrayBuffer(12))).toBe('[Binary 12 bytes]');
      expect(describeBody(new Uint16Array(6))).toBe('[Binary 12 bytes]');
    });

    it('describes streams and documents without reading them', () => {
      expect(describeBody(new ReadableStream())).toBe('[ReadableStream]');
      expect(describeBody(document.implementation.createHTMLDocument('x'))).toBe('[Document]');
    });

    it('maps null and undefined to null and anything else to a string', () => {
      expect(describeBody(null)).toBeNull();
      expect(describeBody(undefined)).toBeNull();
      expect(describeBody(42)).toBe('42');
    });
  });

  describe('isTextual', () => {
    it('accepts text, json, xml, javascript, form-urlencoded and graphql types', () => {
      expect(isTextual('text/plain; charset=utf-8')).toBeTrue();
      expect(isTextual('application/json')).toBeTrue();
      expect(isTextual('application/problem+json')).toBeTrue();
      expect(isTextual('application/xml')).toBeTrue();
      expect(isTextual('application/javascript')).toBeTrue();
      expect(isTextual('application/x-www-form-urlencoded')).toBeTrue();
      expect(isTextual('application/graphql-response+json')).toBeTrue();
      expect(isTextual('Application/JSON')).toBeTrue();
    });

    it('counts a missing content type as textual', () => {
      expect(isTextual(null)).toBeTrue();
      expect(isTextual('')).toBeTrue();
    });

    it('rejects binary types', () => {
      expect(isTextual('application/octet-stream')).toBeFalse();
      expect(isTextual('image/png')).toBeFalse();
    });

    it('isTextual rejects text/event-stream', () => {
      expect(isTextual('text/event-stream')).toBeFalse();
      expect(isTextual('text/event-stream; charset=utf-8')).toBeFalse();
    });
  });

  describe('utf8Length', () => {
    it('counts ASCII as one byte per character', () => {
      expect(utf8Length('')).toBe(0);
      expect(utf8Length('hello')).toBe(5);
    });

    it('utf8Length counts multi-byte characters', () => {
      const samples = ['é', 'שלום', '€', '😀', 'a😀b€', '\ud800'];
      for (const sample of samples) {
        expect(utf8Length(sample)).withContext(sample).toBe(new TextEncoder().encode(sample).length);
      }
    });
  });

  describe('responseBytes', () => {
    it('prefers a numeric content-length', () => {
      expect(responseBytes({ 'content-length': '120' }, 'abc')).toBe(120);
    });

    it('falls back to the UTF-8 length of a text body, else null', () => {
      expect(responseBytes({ 'content-length': 'nope' }, 'é')).toBe(2);
      expect(responseBytes({}, null)).toBeNull();
    });
  });
});
