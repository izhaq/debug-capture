/**
 * What a captured string really is. v1 (`core/json-safe.ts`, `core/truncate.ts`,
 * the fetch probe) stores its markers as plain strings, so the viewer has to
 * recognise them by their exact text to show them as markers, never as data
 * (FR-COM-01, FR-HTTP-07).
 *
 * Known limit: a real string whose text is exactly a marker (say the app logs
 * `"[Circular]"`) looks the same as the marker. v1 keeps no flag to tell them
 * apart.
 */
export type JsonStringKind =
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'redacted' }
  | { readonly kind: 'placeholder'; readonly text: string }
  | { readonly kind: 'truncated'; readonly kept: string; readonly note: string; readonly chars: number };

/** `truncate()` and the fetch probe's 1 MB cap; both end the kept text. */
const TRUNCATED = /^…\[(truncated|capture stopped at) (\d+) chars\]$/;

/**
 * Every placeholder `toJsonSafe` writes. Exact patterns, anchored at both
 * ends, with no nested quantifiers: linear on any input.
 */
const PLACEHOLDERS: readonly RegExp[] = [
  // Cycle, spent budget, undefined, depth limit, bad date.
  /^\[(?:Circular|…|undefined|Object|Invalid Date)\]$/,
  // Containers past `maxArgDepth`.
  /^\[(?:Array|Map|Set)\(\d+\)\]$/,
  /^\[Function [\s\S]*\]$/,
  /^\[Thrown: [\s\S]*\]$/,
  // ArrayBuffer, DataView and every typed array.
  /^\[\w+ \d+ bytes\]$/,
  // Elements: `[HTMLDivElement div#id.a.b]`.
  /^\[\w*Element [\s\S]+\]$/,
  // Other DOM nodes: `[Text]`, `[Comment]`…
  /^\[(?:Text|Comment|CDATASection|ProcessingInstruction|DocumentType|Attr|Document|HTMLDocument|XMLDocument|DocumentFragment|ShadowRoot)\]$/,
  // Items past the first 100 of an array, map, set or object.
  /^…\d+ more$/,
  // Non-finite numbers, bigints and symbols, which JSON cannot hold.
  /^(?:NaN|Infinity|-Infinity)$/,
  /^-?\d+n$/,
  /^Symbol\([\s\S]*\)$/,
];

/** Object keys v1 itself writes: Map and Set wrappers, and the "more keys" slot. */
const PLACEHOLDER_KEYS: readonly string[] = ['[Map]', '[Set]', '…'];

export function classifyJsonString(text: string, redactedValue: string): JsonStringKind {
  if (redactedValue !== '' && text === redactedValue) {
    return { kind: 'redacted' };
  }
  const truncated = truncation(text);
  if (truncated !== undefined) {
    return truncated;
  }
  for (let i = 0; i < PLACEHOLDERS.length; i++) {
    if (PLACEHOLDERS[i].test(text)) {
      return { kind: 'placeholder', text };
    }
  }
  return { kind: 'string', text };
}

export function isPlaceholderKey(key: string): boolean {
  return PLACEHOLDER_KEYS.indexOf(key) !== -1;
}

/** Looks only at the tail, so a 1 MB body costs one `lastIndexOf`. */
function truncation(text: string): JsonStringKind | undefined {
  if (text.charCodeAt(text.length - 1) !== 0x5d /* ] */ || !text.endsWith(' chars]')) {
    return undefined;
  }
  const at = text.lastIndexOf('…[');
  if (at === -1) {
    return undefined;
  }
  const match = TRUNCATED.exec(text.slice(at));
  if (match === null) {
    return undefined;
  }
  const chars = Number(match[2]);
  const note =
    match[1] === 'truncated' ? `truncated ${group(chars)} chars` : `capture stopped at ${group(chars)} chars`;
  return { kind: 'truncated', kept: text.slice(0, at), note, chars };
}

/** `1234567` → `1,234,567`: the HLD's number style, fixed so it never depends on the host's locale. */
export function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
