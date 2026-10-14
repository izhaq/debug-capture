import { HeaderMap } from '../../../core';

/**
 * Helpers shared by the XHR and fetch probes. Module-internal: the barrel
 * does not export them, so they never become public API.
 *
 * Every `instanceof` check is guarded with `typeof X !== 'undefined'` — the
 * probes take an injected host and must not assume every browser global
 * exists where they run.
 */

/** Absolute URL for the entry; the raw string when it cannot be resolved (never throws). */
export function toAbsoluteUrl(url: string | URL, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return String(url);
  }
}

/** Parses `getAllResponseHeaders()` output: CRLF-separated `name: value` lines. */
export function parseRawHeaders(raw: string): HeaderMap {
  const map: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    addHeader(map, line.slice(0, colon), line.slice(colon + 1));
  }
  return map;
}

/** Any `HeadersInit` shape → lower-case map, duplicates joined the way they go on the wire. */
export function headersToMap(init: HeadersInit | undefined): HeaderMap {
  const map: Record<string, string> = {};
  if (init === undefined || init === null) return map;
  if (Array.isArray(init)) {
    for (const pair of init) addHeader(map, String(pair[0]), String(pair[1]));
  } else if (typeof Headers !== 'undefined' && init instanceof Headers) {
    init.forEach((value, name) => addHeader(map, name, value));
  } else {
    const record = init as Record<string, string>;
    for (const name of Object.keys(record)) addHeader(map, name, String(record[name]));
  }
  return map;
}

/** Joins a repeated header with `', '` — what XHR and fetch both send. */
export function addHeader(map: Record<string, string>, name: string, value: string): void {
  const key = name.trim().toLowerCase();
  const clean = value.trim();
  const existing = map[key];
  map[key] = existing === undefined ? clean : `${existing}, ${clean}`;
}

/**
 * A request body as text. Only strings and URL-encoded params are kept as
 * content; everything else becomes a short descriptor, because reading a
 * stream or blob would consume or copy data the app owns.
 */
export function describeBody(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return body;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const keys: string[] = [];
    body.forEach((_value, key) => {
      if (keys.indexOf(key) === -1) keys.push(key);
    });
    return `[FormData: ${keys.join(', ')}]`;
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return `[Blob ${body.size} bytes]`;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `[Binary ${body.byteLength} bytes]`;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[ReadableStream]';
  if (typeof Document !== 'undefined' && body instanceof Document) return '[Document]';
  return String(body);
}

/**
 * Whether a response body is worth reading as text. A missing type counts as
 * text (most APIs that omit it send JSON). `text/event-stream` never ends, so
 * reading it would hold a cloned stream open forever.
 */
export function isTextual(contentType: string | null): boolean {
  if (contentType === null) return true;
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === '') return true;
  if (type === 'text/event-stream') return false;
  return (
    type.startsWith('text/') ||
    type.indexOf('json') !== -1 ||
    type.indexOf('xml') !== -1 ||
    type.indexOf('javascript') !== -1 ||
    type.indexOf('graphql') !== -1 ||
    type === 'application/x-www-form-urlencoded'
  );
}

/**
 * UTF-8 byte length, counted from UTF-16 code units so no encoder or buffer
 * is allocated per response. A lone surrogate counts as 3 bytes — it is
 * encoded as U+FFFD.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Response size: the server's `content-length` when numeric, else the size of the text we read. */
export function responseBytes(headers: HeaderMap, textBody: string | null): number | null {
  const length = (headers['content-length'] ?? '').trim();
  if (/^\d+$/.test(length)) return Number(length);
  return textBody === null ? null : utf8Length(textBody);
}
