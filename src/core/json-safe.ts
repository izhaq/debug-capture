import { CapturePolicy, JsonValue } from '../contract';
import {
  namesSecret,
  redactJsonContainer,
  redactParamsIn,
  redactStack,
  SecretNames,
  secretNames,
  setJsonKey,
} from './redact';
import { truncate, truncateThen } from './truncate';

/** Arrays, objects, maps and sets keep this many items; the rest become a count. */
const MAX_ITEMS = 100;

/**
 * Values one `toJsonSafe` call visits at most, across all its arguments. The
 * depth and item caps alone do not bound the work: a small graph whose levels
 * share one child is cloned once per path — 160 objects, millions of paths.
 */
export const MAX_CLONE_NODES = 1000;

/**
 * Listing an object's keys costs time even for the ones not kept: past
 * `MAX_ITEMS`, every this many keys cost one value of the budget. One huge
 * object still shows its first keys; the next one finds the budget spent and
 * is never listed. (`for…in` with an early exit is no cheaper: the engine
 * collects every key first.)
 */
const KEYS_PER_NODE = 10;

/** What every value becomes once the budget is spent; each unfinished container ends with one. */
const SPENT = '[…]';

/** The parts of the policy cloning uses. */
export type JsonSafePolicy = Pick<CapturePolicy, 'maxArgDepth' | 'maxBodyLength' | 'redactJsonKeys' | 'redactedValue'>;

type JsonObject = { [key: string]: JsonValue };

/** A finished clone, kept for the rest of one call along with what it cost. */
interface Reusable {
  readonly value: JsonValue;
  readonly level: number;
  readonly nodes: number;
  readonly chars: number;
}

/**
 * Turns the arguments of one `console.log` call into `JsonValue`s, redacted,
 * bounded and frozen.
 *
 * The result is a deep copy made right now: later mutation of the original
 * cannot change a stored entry, and no live reference (DOM nodes, big
 * objects) is kept alive by the buffer. Everything it builds is frozen as it
 * is built, so a listener cannot change what gets exported either.
 *
 * Redaction happens here, while cloning, rather than on the clone: a secret
 * property is never read (its getter never runs), a secret in a JSON string
 * is replaced before the string is truncated (a cut JSON string no longer
 * parses), and secrets cost none of the budget. A logged `Error`'s stack is
 * redacted like its message, since it repeats it.
 *
 * All arguments share one budget: `MAX_CLONE_NODES` values and
 * `maxBodyLength` characters of strings and keys. Past it every value becomes
 * `'[…]'` — so one log call costs bounded time and memory, whatever it was
 * given. An object met again (not a cycle) reuses its frozen clone, still
 * paying its cost, so a shared object is walked once. `maxArgDepth` counts
 * container levels: 0 keeps primitives but turns an object or array into a
 * placeholder.
 *
 * Never throws — a hostile getter, `toJSON` or Proxy becomes a
 * `[Thrown: …]` marker for that one value — so logging a weird object can
 * never break the app.
 */
export function toJsonSafe(args: readonly unknown[], policy: JsonSafePolicy): readonly JsonValue[] {
  const cloner = new Cloner(policy);
  const out: JsonValue[] = [];
  for (let i = 0; i < args.length; i++) {
    if (cloner.spent) {
      out.push(SPENT);
      break;
    }
    out.push(cloner.clone(args[i], 0, true));
  }
  return Object.freeze(out);
}

function thrown(error: unknown): string {
  let message: string;
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = 'unknown error';
  }
  return `[Thrown: ${message}]`;
}

/** `[object Uint8Array]` → `Uint8Array`. Unlike `constructor.name`, cannot be shadowed by an own property. */
function tagOf(value: object): string {
  return Object.prototype.toString.call(value).slice(8, -1);
}

class Cloner {
  /** The objects on the current path — a repeat means a cycle, not just a shared reference. */
  private readonly ancestors = new Set<object>();
  /** Finished clones, so an object shared by many paths is walked once. */
  private readonly clones = new Map<object, Reusable>();
  private readonly maxDepth: number;
  private readonly secrets: SecretNames;
  private readonly replacement: string;
  private nodesLeft = MAX_CLONE_NODES;
  private charsLeft: number;
  /** `'[Circular]'` markers so far: a clone holding one depends on its path and is not reused. */
  private circulars = 0;

  constructor(policy: JsonSafePolicy) {
    this.maxDepth = policy.maxArgDepth;
    this.secrets = secretNames(policy.redactJsonKeys);
    this.replacement = policy.redactedValue;
    this.charsLeft = policy.maxBodyLength;
  }

  get spent(): boolean {
    return this.nodesLeft <= 0 || this.charsLeft <= 0;
  }

  clone(value: unknown, level: number, allowToJson: boolean): JsonValue {
    if (this.spent) {
      return SPENT;
    }
    this.nodesLeft--;
    switch (typeof value) {
      case 'string':
        return this.freeText(value);
      case 'boolean':
        return value;
      case 'number':
        return Number.isFinite(value) ? value : String(value);
      case 'undefined':
        return '[undefined]';
      case 'bigint':
        return this.text(`${value}n`);
      case 'symbol':
        return this.text(String(value));
      default:
        if (value === null) {
          return null;
        }
    }
    try {
      if (typeof value === 'function') {
        return this.text(`[Function ${(value as { name?: unknown }).name || 'anonymous'}]`);
      }
      return this.cloneObject(value as object, level, allowToJson);
    } catch (error) {
      return this.text(thrown(error));
    }
  }

  /** Charges `text` to the budget, truncated to what is left of it; `redactKept` runs on the kept part. */
  private text(text: string, redactKept?: (kept: string) => string): string {
    const left = this.charsLeft;
    if (text.length <= left) {
      this.charsLeft = left - text.length;
      return redactKept === undefined ? text : redactKept(text);
    }
    if (left <= 0) {
      return SPENT;
    }
    this.charsLeft = 0;
    return redactKept === undefined ? truncate(text, left) : truncateThen(text, left, redactKept);
  }

  private readonly redactParams = (kept: string): string => redactParamsIn(kept, this.secrets, this.replacement);

  /**
   * A string the app logged may itself be JSON, or hold a URL with a token in
   * it. JSON is redacted whole, then charged; other text is cut to the budget
   * first and only the kept part is scanned for URL parameters.
   */
  private freeText(text: string): string {
    const json = redactJsonContainer(text, this.secrets, this.replacement, this.charsLeft);
    return json === undefined ? this.text(text, this.redactParams) : this.text(json);
  }

  /** What a secret value is stored as. `null`, booleans and `undefined` carry no secret and stay. */
  private hidden(value: unknown): JsonValue {
    if (value === undefined) {
      return '[undefined]';
    }
    return value === null || typeof value === 'boolean' ? value : this.replacement;
  }

  private cloneObject(value: object, level: number, allowToJson: boolean): JsonValue {
    if (this.ancestors.has(value)) {
      this.circulars++;
      return '[Circular]';
    }
    if (value instanceof Error) {
      return this.cloneError(value);
    }
    const description = describe(value);
    if (description !== undefined) {
      return this.text(description);
    }
    if (level >= this.maxDepth) {
      return placeholder(value);
    }
    const toJson = allowToJson ? (value as { toJSON?: unknown }).toJSON : undefined;
    if (typeof toJson === 'function') {
      // Same level, and no second toJSON: one that returns a fresh object with
      // its own toJSON each time must not loop forever. Checked before `value`
      // joins the ancestors, so `toJSON() { return this; }` is not a cycle.
      return this.clone(toJson.call(value), level, false);
    }
    return this.reuse(value, level) ?? this.cloneNew(value, level);
  }

  /**
   * A clone made earlier in this call, if it would come out the same here
   * (same level, no cycle markers) and the budget can pay for it again — so
   * the output stays as bounded as if it were cloned anew.
   */
  private reuse(value: object, level: number): JsonValue | undefined {
    const done = this.clones.get(value);
    if (done === undefined || done.level !== level || done.nodes > this.nodesLeft || done.chars > this.charsLeft) {
      return undefined;
    }
    this.nodesLeft -= done.nodes;
    this.charsLeft -= done.chars;
    return done.value;
  }

  private cloneNew(value: object, level: number): JsonValue {
    const nodes = this.nodesLeft;
    const chars = this.charsLeft;
    const circulars = this.circulars;
    let clone: JsonValue;
    this.ancestors.add(value);
    try {
      clone = this.cloneContainer(value, level + 1);
    } finally {
      this.ancestors.delete(value);
    }
    // Only a clone finished within budget is whole; once spent, the budget stays spent.
    if (!this.spent && this.circulars === circulars) {
      this.clones.set(value, { value: clone, level, nodes: nodes - this.nodesLeft, chars: chars - this.charsLeft });
    }
    return clone;
  }

  /** Name, message and stack. The stack starts with the message, so it is redacted the same way. */
  private cloneError(error: Error): JsonValue {
    const name = this.text(String(error.name));
    const raw = String(error.message);
    const json = redactJsonContainer(raw, this.secrets, this.replacement, this.charsLeft);
    const message = json === undefined ? this.text(raw, this.redactParams) : this.text(json);
    const stack = error.stack;
    return Object.freeze({
      name,
      message,
      stack:
        typeof stack === 'string'
          ? this.text(json === undefined ? stack : redactStack(stack, raw, json), this.redactParams)
          : null,
    });
  }

  private cloneContainer(value: object, next: number): JsonValue {
    if (Array.isArray(value)) {
      return this.cloneItems(value, next);
    }
    if (value instanceof Map) {
      const pairs: JsonValue[] = [];
      for (const [k, v] of value) {
        if (this.spent) {
          return Object.freeze({ '[Map]': Object.freeze(withSpent(pairs)) });
        }
        const key = this.clone(k, next, true);
        // A Map keyed by header or field name: Angular's HttpHeaders keeps its values this way.
        const secret = typeof k === 'string' && this.secrets.matches(k);
        const item = secret ? this.hidden(v) : this.clone(v, next, true);
        pairs.push(Object.freeze([key, item]));
        if (pairs.length === MAX_ITEMS) {
          break;
        }
      }
      return Object.freeze({ '[Map]': Object.freeze(withMore(pairs, value.size)) });
    }
    if (value instanceof Set) {
      const items: JsonValue[] = [];
      for (const v of value) {
        if (this.spent) {
          return Object.freeze({ '[Set]': Object.freeze(withSpent(items)) });
        }
        items.push(this.clone(v, next, true));
        if (items.length === MAX_ITEMS) {
          break;
        }
      }
      return Object.freeze({ '[Set]': Object.freeze(withMore(items, value.size)) });
    }
    return this.cloneProperties(value as Record<string, unknown>, next);
  }

  private cloneItems(array: readonly unknown[], next: number): JsonValue {
    const length = array.length;
    const out: JsonValue[] = [];
    for (let i = 0; i < length && i < MAX_ITEMS; i++) {
      if (this.spent) {
        return Object.freeze(withSpent(out));
      }
      out.push(this.cloneProperty(array, i, next));
    }
    return Object.freeze(withMore(out, length));
  }

  private cloneProperties(object: Record<string, unknown>, next: number): JsonValue {
    const keys = Object.keys(object);
    const out: JsonObject = {};
    const kept = Math.min(keys.length, MAX_ITEMS);
    let cut = false;
    for (let i = 0; i < kept; i++) {
      const key = keys[i];
      // A key that does not fit whole is not kept: a cut key would read as a different one.
      if (this.spent || key.length > this.charsLeft) {
        this.charsLeft = 0;
        out['…'] = SPENT;
        cut = true;
        break;
      }
      this.charsLeft -= key.length;
      const secret = this.isSecretProperty(object, key);
      setJsonKey(out, key, secret ? this.secretProperty(object, key) : this.cloneProperty(object, key, next));
    }
    if (!cut && keys.length > MAX_ITEMS) {
      out['…'] = `…${keys.length - MAX_ITEMS} more`;
    }
    if (keys.length > MAX_ITEMS) {
      // Charged after the kept keys, so one huge object still shows them.
      this.nodesLeft -= Math.floor((keys.length - MAX_ITEMS) / KEYS_PER_NODE);
    }
    return Object.freeze(out);
  }

  /** Decided from the key alone, so the secret is never read. */
  private isSecretProperty(object: Record<string, unknown>, key: string): boolean {
    if (this.secrets.matches(key)) {
      return true;
    }
    if (key !== 'value' || this.secrets.empty) {
      return false;
    }
    try {
      return namesSecret(object, this.secrets);
    } catch {
      // A name we cannot read might be a secret one.
      return true;
    }
  }

  /**
   * A secret property's stored value. Looked at through its descriptor, so a
   * getter never runs: only a plain `null`, boolean or `undefined` is kept.
   */
  private secretProperty(object: object, key: string): JsonValue {
    this.nodesLeft--;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor !== undefined && 'value' in descriptor ? this.hidden(descriptor.value) : this.replacement;
    } catch {
      return this.replacement;
    }
  }

  /** Reads one property in its own try, so one throwing getter costs only that property. */
  private cloneProperty(container: object, key: string | number, next: number): JsonValue {
    let item: unknown;
    try {
      item = (container as Record<string | number, unknown>)[key];
    } catch (error) {
      this.nodesLeft--;
      return this.text(thrown(error));
    }
    return this.clone(item, next, true);
  }
}

/**
 * A fixed description for objects that are never walked; `undefined` for the
 * others. Errors are handled by the cloner: their message may need redaction.
 */
function describe(value: object): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
  }
  if (value instanceof RegExp) {
    return String(value);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return `[${tagOf(value)} ${value.byteLength} bytes]`;
  }
  // The one DOM reference in core, guarded so the layer still runs where there is no DOM.
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return describeNode(value);
  }
  return undefined;
}

/** `[HTMLDivElement div#id.a.b]` for elements, `[Text]` for other nodes. */
function describeNode(node: Node): string {
  const tag = tagOf(node);
  if (node.nodeType !== 1) {
    return `[${tag}]`;
  }
  const element = node as Element;
  let selector = element.localName;
  if (element.id) {
    selector += `#${element.id}`;
  }
  const classes = element.classList;
  for (let i = 0; i < classes.length; i++) {
    selector += `.${classes[i]}`;
  }
  return `[${tag} ${selector}]`;
}

function placeholder(value: object): string {
  if (Array.isArray(value)) {
    return `[Array(${value.length})]`;
  }
  if (value instanceof Map) {
    return `[Map(${value.size})]`;
  }
  if (value instanceof Set) {
    return `[Set(${value.size})]`;
  }
  return '[Object]';
}

function withMore(items: JsonValue[], total: number): JsonValue[] {
  if (total > items.length) {
    items.push(`…${total - items.length} more`);
  }
  return items;
}

function withSpent(items: JsonValue[]): JsonValue[] {
  items.push(SPENT);
  return items;
}
