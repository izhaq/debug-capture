import { HeaderMap, JsonValue } from '../contract';
import { truncate, truncateThen } from './truncate';

type JsonObject = { [key: string]: JsonValue };

/**
 * Sets `target[key]` as an own data property. Plain assignment of the key
 * `__proto__` would change the prototype instead and silently lose the value
 * (`JSON.parse` does produce such own keys).
 */
export function setJsonKey(target: JsonObject, key: string, value: JsonValue): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

/**
 * The form a secret key is compared in: lower-case, without `_` and `-`. So
 * `access_token`, `Access-Token` and `accessToken` are one key, and a policy
 * may list it in any of those spellings. See `SecretNames.matches` for the match.
 */
export function normaliseKey(key: string): string {
  const lower = key.toLowerCase();
  // Most keys have neither character: skip the regex for them.
  return lower.indexOf('_') === -1 && lower.indexOf('-') === -1 ? lower : lower.replace(/[_-]/g, '');
}

/** Decisions kept per name list before the cache starts over: bounds its memory. */
const MAX_CACHED_DECISIONS = 2000;
/** Longer keys are decided every time: caching them would hold big strings (a base64 blob) alive. */
const MAX_CACHED_KEY_LENGTH = 64;

/**
 * One policy's secret names, ready for matching. A key is secret when its
 * normalised form **ends with** a name: `password` also covers `newPassword`,
 * `confirm_password` and `userPassword`; `token` covers `oauthToken` (and
 * pagination keys such as `nextToken` — a price worth paying). `tokenCount`
 * or `passwordPolicy` do not match.
 *
 * A busy socket sends the same few keys in every frame, so each key's
 * decision is cached: one `Map` lookup instead of normalising it and
 * comparing it with every name.
 */
export class SecretNames {
  private readonly names: readonly string[];
  private readonly exact: ReadonlySet<string>;
  private readonly decided = new Map<string, boolean>();

  constructor(names: readonly string[]) {
    // An empty name (e.g. `'_'` normalised) would be a suffix of every key.
    this.exact = new Set(names.map(normaliseKey).filter((name) => name !== ''));
    this.names = Array.from(this.exact);
  }

  get empty(): boolean {
    return this.names.length === 0;
  }

  matches(key: string): boolean {
    if (this.names.length === 0) {
      return false;
    }
    if (key.length > MAX_CACHED_KEY_LENGTH) {
      return this.decide(key);
    }
    let decision = this.decided.get(key);
    if (decision === undefined) {
      decision = this.decide(key);
      if (this.decided.size >= MAX_CACHED_DECISIONS) {
        this.decided.clear();
      }
      this.decided.set(key, decision);
    }
    return decision;
  }

  private decide(key: string): boolean {
    const name = normaliseKey(key);
    if (this.exact.has(name)) {
      return true;
    }
    for (let i = 0; i < this.names.length; i++) {
      const secret = this.names[i];
      if (name.length > secret.length && name.endsWith(secret)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Matchers cached per frozen array. `resolvePolicy` freezes its arrays, so on
 * the hot path (many frames per second) a matcher — and its decision cache —
 * is built once per policy instead of once per call. Unfrozen arrays could
 * change under the cache, so they get a fresh matcher every call.
 */
const secretNameCache = new WeakMap<readonly string[], SecretNames>();
const headerSets = new WeakMap<readonly string[], ReadonlySet<string>>();

export function secretNames(keys: readonly string[]): SecretNames {
  const frozen = Object.isFrozen(keys);
  let names = frozen ? secretNameCache.get(keys) : undefined;
  if (names === undefined) {
    names = new SecretNames(keys);
    if (frozen) {
      secretNameCache.set(keys, names);
    }
  }
  return names;
}

function headerSet(names: readonly string[]): ReadonlySet<string> {
  const frozen = Object.isFrozen(names);
  let set = frozen ? headerSets.get(names) : undefined;
  if (set === undefined) {
    set = new Set(names.map((name) => name.toLowerCase()));
    if (frozen) {
      headerSets.set(names, set);
    }
  }
  return set;
}

/**
 * Whether `object` is a named field such as `{ name: 'password', value: … }`
 * whose name is a secret — then its `value` is the secret. This is how
 * Angular's `HttpHeaders` (`{ name, value, op }`) and `HttpParams`
 * (`{ param, value, op }`) hold pending changes until first read, and how
 * HAR headers and jQuery's `serializeArray()` list fields.
 */
export function namesSecret(object: { readonly [key: string]: unknown }, secrets: SecretNames): boolean {
  const name = object['name'] ?? object['param'];
  return typeof name === 'string' && secrets.matches(name);
}

/**
 * What a secret value is stored as. `null` and booleans stay: they carry no
 * secret, and `"[redacted]"` in place of `nextToken: null` would make a
 * reader think a token was there.
 */
export function hiddenValue<T>(value: T, replacement: string): T | string {
  return value === null || typeof value === 'boolean' ? value : replacement;
}

/**
 * `scheme://user:password@host` → `scheme://<replacement>@host`. The whole
 * user info goes, not only the password: a token is often sent as the user
 * name (`https://<token>@host`). Done before truncation, so a cut can never
 * leave part of it behind. Only the authority is looked at — an `@` in the
 * path or query is kept; the last `@` before the path ends the user info, as
 * in the URL parser. Linear: one scan of the authority.
 */
export function redactUserinfo(url: string, replacement: string): string {
  // A function replacer: `replacement` is user-set and must not expand `$1` / `$&`.
  return url.replace(USERINFO, (_match, scheme: string) => `${scheme}${replacement}@`);
}

const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#\\]*@/i;

/**
 * A new, frozen map with lower-case keys. A header's value becomes
 * `replacement` when its name is in `names` (any case, exact) or looks like
 * a secret key from `secretKeys` (`x-access-token` ends with `accesstoken`);
 * the others are cut to `maxValueLength`.
 */
export function redactHeaders(
  headers: HeaderMap,
  names: readonly string[],
  replacement: string,
  maxValueLength = Infinity,
  secretKeys: readonly string[] = [],
): HeaderMap {
  const redacted = headerSet(names);
  const secrets = secretNames(secretKeys);
  const out: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    const name = key.toLowerCase();
    const secret = redacted.has(name) || secrets.matches(name);
    setJsonKey(out, name, secret ? replacement : truncate(headers[key], maxValueLength));
  }
  return Object.freeze(out);
}

/**
 * Replaces the value of every object key in `keys` (matched by
 * `SecretNames`, at any depth, inside arrays too) with `replacement`,
 * whatever that value was — a nested `{ token: { … } }` goes whole — except
 * `null` and booleans. The `value` of a named field that `namesSecret`
 * matches goes too, and secret URL parameters inside string values.
 *
 * Copy-on-write: unchanged branches are shared with the input, and with no
 * match at all the input itself comes back. Safe because `JsonValue` is
 * read-only, and it saves an allocation per stored entry.
 */
export function redactJsonValue(value: JsonValue, keys: readonly string[], replacement: string): JsonValue {
  const secrets = secretNames(keys);
  return secrets.empty ? value : redactIn(value, { secrets, replacement, chars: Infinity });
}

/**
 * Redacts a body or text frame that holds a JSON object or array (a leading
 * byte-order mark is allowed): secret keys, and secret URL parameters inside
 * string values (`{"next":"…?access_token=…"}`).
 *
 * Anything else — form data, HTML, a JSON string or number, broken JSON —
 * comes back unchanged. When something matched, the result is re-serialized
 * compactly; when nothing did, the original text comes back byte for byte.
 * Never throws: if redaction itself fails (e.g. JSON nested too deep for the
 * stack) the whole text is replaced, so a failure can never leak the value it
 * was meant to hide.
 *
 * `maxChars` is how much of the result will be kept. String values that
 * would land past it are not scanned for parameters, and a long one is cut —
 * so the cost of that scan is bounded however big the text.
 */
export function redactJsonText(
  text: string,
  keys: readonly string[],
  replacement: string,
  maxChars = Infinity,
): string {
  return redactJsonContainer(text, secretNames(keys), replacement, maxChars) ?? text;
}

/**
 * `redactJsonText`, but `undefined` when `text` is not a JSON object or
 * array (or does not parse) — so the caller can try another way.
 */
export function redactJsonContainer(
  text: string,
  secrets: SecretNames,
  replacement: string,
  maxChars: number,
): string | undefined {
  if (secrets.empty || !looksLikeJsonContainer(text)) {
    return undefined;
  }
  let parsed: JsonValue;
  try {
    // JSON.parse rejects a byte-order mark.
    parsed = JSON.parse(text.charCodeAt(0) === BOM ? text.slice(1) : text) as JsonValue;
  } catch {
    return undefined;
  }
  try {
    const result = redactIn(parsed, { secrets, replacement, chars: maxChars });
    return result === parsed ? text : JSON.stringify(result);
  } catch {
    return replacement;
  }
}

/**
 * `name=value` parameters in URLs and free text: a separator (`?`, `#`, `&`,
 * `;`, whitespace or the start of the text), a name, `=`, and a value. A
 * value ends at a separator, a quote or an angle bracket (`href="…"`), but
 * takes `:` and `/`, so a secret that contains them is never partly kept. A
 * `?` ends it only when a parameter follows (`?next=/cb?access_token=…`):
 * otherwise `?token=ab?cd` would keep `?cd`.
 */
const PARAM = /(^|[?#&;\s])([^=?#&;\s"'<>]+)=((?:[^?#&;\s"'<>]|\?(?![^=?#&;\s"'<>]+=))*)/g;
/**
 * Form body parameters: separated by `&` only, so a value runs to the next
 * `&` whatever it holds (`password=pa?ss"word` goes whole).
 */
const FORM_PARAM = /(^|&)([^=&]+)=([^&]*)/g;
const PARAM_SEPARATORS = /[?#&;\s"'<>]/;
/** How many times a value is percent-decoded looking for a hidden parameter. */
const MAX_DECODE_DEPTH = 3;

/**
 * Replaces the values of secret parameters with `replacement`: URL queries
 * and fragments (`wss://h/ws?access_token=…`), form bodies (`password=…&…`),
 * and URLs inside free text such as an error message.
 *
 * A name is percent-decoded and split at brackets before matching, so
 * `access%5Ftoken`, `access_token[]` and `user[password]` match. A value that
 * percent-decodes to a secret parameter (`returnUrl=%2Fp%3Ftoken%3D…`) is
 * replaced whole.
 *
 * Works on the raw string — a round trip through `URL` or `URLSearchParams`
 * would re-encode everything else. With no match the input comes back as is.
 * Its cost grows with the text: callers truncate first (`truncateThen`).
 */
export function redactParams(text: string, keys: readonly string[], replacement: string): string {
  return redactParamsIn(text, secretNames(keys), replacement);
}

export function redactParamsIn(text: string, secrets: SecretNames, replacement: string): string {
  return redactWith(PARAM, text, secrets, replacement);
}

/** `redactParamsIn` for an `application/x-www-form-urlencoded` body. */
export function redactFormParamsIn(text: string, secrets: SecretNames, replacement: string): string {
  return redactWith(FORM_PARAM, text, secrets, replacement);
}

function redactWith(pattern: RegExp, text: string, secrets: SecretNames, replacement: string): string {
  if (secrets.empty || text.indexOf('=') === -1) {
    return text;
  }
  return text.replace(pattern, (match: string, separator: string, name: string, value: string) =>
    isSecretParam(name, secrets) || hidesSecret(value, secrets, 0) ? `${separator}${name}=${replacement}` : match,
  );
}

/** Any segment of `user[password]` / `access_token[]`, after decoding. */
function isSecretParam(rawName: string, secrets: SecretNames): boolean {
  const name = /[%+]/.test(rawName) ? percentDecode(rawName.replace(/\+/g, ' ')) : rawName;
  if (name.indexOf('[') === -1) {
    return secrets.matches(name);
  }
  const segments = name.split(/[[\]]/);
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] !== '' && secrets.matches(segments[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Whether an encoded value holds a secret parameter once decoded. Decoded
 * again while escapes remain (double encoding), a few levels at most.
 */
function hidesSecret(value: string, secrets: SecretNames, depth: number): boolean {
  if (depth >= MAX_DECODE_DEPTH || value.indexOf('%') === -1) {
    return false;
  }
  const decoded = percentDecode(value);
  return decoded !== value && (holdsSecretParam(decoded, secrets) || hidesSecret(decoded, secrets, depth + 1));
}

function holdsSecretParam(text: string, secrets: SecretNames): boolean {
  const parts = text.split(PARAM_SEPARATORS);
  for (let i = 0; i < parts.length; i++) {
    const equals = parts[i].indexOf('=');
    if (equals > 0 && isSecretParam(parts[i].slice(0, equals), secrets)) {
      return true;
    }
  }
  return false;
}

/**
 * Decodes `%XX` escapes byte by byte. Unlike `decodeURIComponent` it never
 * throws, so a malformed or truncated escape elsewhere in the value cannot
 * stop the check — and the characters that matter here are all ASCII.
 */
function percentDecode(text: string): string {
  return text.replace(/%([0-9a-fA-F]{2})/g, (_match: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** A stack line that is a frame: `    at f (…)` (V8) or `f@https://…:1:2` (Firefox, Safari). */
const FRAME_LINE = /^\s+at\s|@[^@]*:\d+(:\d+)?\)?$/;
/**
 * Longer lines are never frames. Also keeps the frame check cheap on a
 * hostile stack: `@[^@]*` tries one start per `@`, each scan ends at the next.
 */
const MAX_FRAME_LINE = 500;

/**
 * An error stack starts with `${name}: ${message}` — so it repeats a secret
 * the message redaction hid. Every occurrence of the raw message is replaced
 * with the redacted one; when the stack holds the message in some other form,
 * only its frame lines are kept. URL parameters are the caller's job (after
 * truncation).
 */
export function redactStack(stack: string, rawMessage: string, redactedMessage: string): string {
  if (rawMessage === redactedMessage || rawMessage === '') {
    return stack;
  }
  const parts = stack.split(rawMessage);
  if (parts.length > 1) {
    return parts.join(redactedMessage);
  }
  return stack
    .split('\n')
    .filter((line) => line.length <= MAX_FRAME_LINE && FRAME_LINE.test(line))
    .join('\n');
}

/**
 * Free text that may hold JSON or URLs (a logged string, an error message):
 * JSON is redacted whole, then truncated; anything else is truncated, then
 * its URL parameters are redacted — so the cost is bounded by `max`.
 * `redactedJson` reports the JSON result, `undefined` when it was not JSON.
 */
export function redactFreeText(
  text: string,
  secrets: SecretNames,
  replacement: string,
  max: number,
): { readonly text: string; readonly redactedJson: string | undefined } {
  const json = redactJsonContainer(text, secrets, replacement, max);
  if (json !== undefined) {
    return { text: truncate(json, max), redactedJson: json };
  }
  const params = truncateThen(text, max, (kept) => redactParamsIn(kept, secrets, replacement));
  return { text: params, redactedJson: undefined };
}

/**
 * Whether `url` matches any pattern. Uses `String.prototype.search`, which
 * ignores and restores `lastIndex`: `RegExp.test` on a `/g` pattern resumes
 * from the last match and would alternate between true and false.
 */
export function matchesAny(url: string, patterns: readonly RegExp[]): boolean {
  for (let i = 0; i < patterns.length; i++) {
    if (url.search(patterns[i]) !== -1) {
      return true;
    }
  }
  return false;
}

const BOM = 0xfeff;

/**
 * Cheap first-character check, so a non-JSON body (or a streamed text frame)
 * never pays for a `JSON.parse` that is bound to fail or yield a primitive.
 */
export function looksLikeJsonContainer(text: string): boolean {
  for (let i = text.charCodeAt(0) === BOM ? 1 : 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // JSON whitespace: space, tab, line feed, carriage return.
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
      continue;
    }
    return c === 0x7b /* { */ || c === 0x5b; /* [ */
  }
  return false;
}

/**
 * State of one JSON walk. `chars` counts down the characters of keys and
 * string values seen so far, in serialization order: a lower bound on where
 * the next value lands in the output. Once it is spent, later values are
 * past what gets stored, and their parameter scan is skipped.
 */
interface JsonWalk {
  readonly secrets: SecretNames;
  readonly replacement: string;
  chars: number;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function redactIn(value: JsonValue, walk: JsonWalk): JsonValue {
  if (typeof value === 'string') {
    return redactLeaf(value, walk);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (isJsonArray(value)) {
    let copy: JsonValue[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const next = redactIn(item, walk);
      if (copy === undefined && next !== item) {
        copy = value.slice(0, i);
      }
      copy?.push(next);
    }
    return copy ?? value;
  }
  const object = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(object);
  let copy: JsonObject | undefined;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const item = object[key];
    walk.chars -= key.length;
    const secret = walk.secrets.matches(key) || (key === 'value' && namesSecret(object, walk.secrets));
    const next = secret ? hiddenValue(item, walk.replacement) : redactIn(item, walk);
    if (copy === undefined && next !== item) {
      copy = {};
      for (let j = 0; j < i; j++) {
        setJsonKey(copy, keys[j], object[keys[j]]);
      }
    }
    if (copy !== undefined) {
      setJsonKey(copy, key, next);
    }
  }
  return copy ?? value;
}

/** A string value: its URL parameters, scanned only as far as the output will be kept. */
function redactLeaf(text: string, walk: JsonWalk): string {
  const left = walk.chars;
  let out = text;
  if (left > 0 && text.indexOf('=') !== -1) {
    if (text.length <= left) {
      out = redactParamsIn(text, walk.secrets, walk.replacement);
    } else {
      // Past `left` nothing is stored. Cut there only when the kept part
      // changed: a shorter redaction would pull unscanned text into view.
      const kept = text.slice(0, left);
      const redacted = redactParamsIn(kept, walk.secrets, walk.replacement);
      out = redacted === kept ? text : truncateThen(text, left, () => redacted);
    }
  }
  walk.chars = left - out.length;
  return out;
}
