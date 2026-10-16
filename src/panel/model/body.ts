import { JsonValue } from '../..';
import { TextRange } from './filters';

/**
 * How a stored string was cut (FR-HTTP-07, §4.6):
 * - `truncated` — v1's `…[truncated N chars]` (policy `maxBodyLength`); the original length is known;
 * - `stopped` — v1's fetch note `…[capture stopped at N chars]`; the full length is not known;
 * - `capped` — `HttpEntry.resBodyCapped` (C-7): over 1 MB, full length unknown.
 */
export interface Truncation {
  readonly kind: 'truncated' | 'stopped' | 'capped';
  /** Characters before the cut, when known. */
  readonly originalLength: number | null;
}

const TRUNCATED = /…\[truncated (\d+) chars\]$/;
const STOPPED = /…\[capture stopped at \d+ chars\]$/;

/**
 * Splits v1's truncation marker off the end of `text`, so the view shows the
 * kept text and a `truncated` badge instead of the marker. A marker anywhere
 * but at the end is data, not a marker.
 */
export function splitTruncation(text: string): { readonly text: string; readonly truncation: Truncation | null } {
  const truncated = TRUNCATED.exec(text);
  if (truncated !== null) {
    const kept = text.slice(0, truncated.index);
    return { text: kept, truncation: { kind: 'truncated', originalLength: kept.length + Number(truncated[1]) } };
  }
  const stopped = STOPPED.exec(text);
  if (stopped !== null) {
    return { text: text.slice(0, stopped.index), truncation: { kind: 'stopped', originalLength: null } };
  }
  return { text, truncation: null };
}

export interface FormField {
  readonly name: string;
  readonly value: string;
}

interface BodyBase {
  /** The body without its truncation marker. */
  readonly text: string;
  readonly truncation: Truncation | null;
}

/**
 * What the Payload / Response tab shows (FR-HTTP-05): a JSON tree, a form
 * table, the text as-is, or the descriptor of a non-text body.
 */
export type BodyView =
  | (BodyBase & { readonly kind: 'empty' | 'text' | 'descriptor' })
  | (BodyBase & { readonly kind: 'json'; readonly value: JsonValue })
  | (BodyBase & { readonly kind: 'form'; readonly fields: readonly FormField[] });

export interface DescribeBodyOptions {
  /** `HttpEntry.resBodyCapped` — for the response body only. */
  readonly capped?: boolean;
  /** The `content-type` header, when known; only form detection uses it. */
  readonly contentType?: string;
}

/**
 * v1's descriptors of bodies it did not read as text (`describeBody` in the
 * HTTP probes, and the XHR response types).
 */
const DESCRIPTOR =
  /^\[(?:FormData: [^\]\n]*|(?:Blob|Binary|arraybuffer|blob) \d+ bytes|ReadableStream|Document|document|Request body)\]$/;

/** `a=1&b=x%20y`: names and values without spaces, joined by `&`. */
const FORM_SHAPE = /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/;

/** Sorts a stored body into what the detail shows. JSON only for objects and arrays: a bare `42` reads better as text. */
export function describeBody(body: string | null, options: DescribeBodyOptions = {}): BodyView {
  if (body === null || body === '') return { kind: 'empty', text: '', truncation: null };
  if (DESCRIPTOR.test(body)) return { kind: 'descriptor', text: body, truncation: null };

  const split = splitTruncation(body);
  const text = split.text;
  const truncation: Truncation | null = options.capped ? { kind: 'capped', originalLength: null } : split.truncation;

  const trimmed = text.trim();
  const first = trimmed.charAt(0);
  if (first === '{' || first === '[') {
    try {
      return { kind: 'json', text, truncation, value: JSON.parse(trimmed) as JsonValue };
    } catch {
      // Not JSON (or cut short): shown as text.
    }
  }
  const isFormType = (options.contentType ?? '').toLowerCase().indexOf('application/x-www-form-urlencoded') !== -1;
  if (isFormType || FORM_SHAPE.test(text)) {
    return { kind: 'form', text, truncation, fields: parseForm(text) };
  }
  return { kind: 'text', text, truncation };
}

function parseForm(text: string): FormField[] {
  return text
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq === -1
        ? { name: decodeFormPart(pair), value: '' }
        : { name: decodeFormPart(pair.slice(0, eq)), value: decodeFormPart(pair.slice(eq + 1)) };
    });
}

/** `+` is a space in form encoding; a malformed `%` escape is kept as written rather than dropping the field. */
function decodeFormPart(part: string): string {
  const spaced = part.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** A header value or JSON leaf the recorder replaced: it gets the `redacted` badge (FR-HTTP-07). */
export function isRedacted(value: unknown, redactedValue: string): boolean {
  return value === redactedValue;
}

/** Each occurrence of `redactedValue` inside other text (`?token=[redacted]`), for highlighting. Case-sensitive: the recorder writes it verbatim. */
export function redactedRanges(text: string, redactedValue: string): readonly TextRange[] {
  if (redactedValue === '') return [];
  const ranges: TextRange[] = [];
  let from = text.indexOf(redactedValue);
  while (from !== -1) {
    ranges.push({ start: from, end: from + redactedValue.length });
    from = text.indexOf(redactedValue, from + redactedValue.length);
  }
  return ranges;
}
