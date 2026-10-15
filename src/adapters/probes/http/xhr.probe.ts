import { Clock, HeaderMap, HttpEntry, Probe, Recorder } from '../../../core';
import { addHeader, describeBody, parseRawHeaders, responseBytes, toAbsoluteUrl } from './http-helpers';
import { outsideZones } from './outside-zones';

/**
 * What the XHR probe patches. Only the prototype is touched — the constructor
 * stays as it is, so `new XMLHttpRequest()` and `instanceof` behave exactly
 * as before. Angular's `HttpXhrBackend` builds a new XHR per request, so this
 * is the probe that sees the app's `HttpClient` traffic.
 */
export interface XhrHost {
  XMLHttpRequest: { prototype: XMLHttpRequest };
  location: { href: string };
}

type XhrError = HttpEntry['error'];
type HttpDraft = Omit<HttpEntry, 'seq'>;

/**
 * Per-request bookkeeping — one per `open()`, so a reused instance never mixes
 * two requests. Lives in a WeakMap, never on the app's object.
 */
interface RequestState {
  method: string;
  url: string;
  reqHeaders: Record<string, string>;
  reqBody: string | null;
  /** Clock time at `send()`; `null` until sent. */
  start: number | null;
  error: XhrError;
  /** Set once the entry is recorded, so no later event can record it again. */
  recorded: boolean;
}

type PatchedName = 'open' | 'setRequestHeader' | 'send' | 'abort';
type XhrMethod = (this: XMLHttpRequest, ...args: unknown[]) => unknown;
/** Runs before the original; the function it may return runs only after the original succeeded. */
type Hook = (xhr: XMLHttpRequest, args: unknown[]) => (() => void) | void;

const DONE = 4;

const ERROR_EVENTS: ReadonlyArray<[string, NonNullable<XhrError>]> = [
  ['abort', 'abort'],
  ['timeout', 'timeout'],
  ['error', 'network'],
];

/**
 * Records one `HttpEntry` per completed XHR (load, error, abort or timeout).
 * `host` defaults to the real global; specs pass a subclass or a fake.
 *
 * Reused instances need care: retry code calls `open()` + `send()` again from
 * inside the request's own `load` / `error` handler, and the browser then
 * fires the *first* request's `loadend` afterwards, while the instance already
 * belongs to the second one. So the request an instance is about to forget is
 * finalised in the `open()` / `abort()` wrappers, before the original resets
 * status, headers and body; and events that arrive with `readyState` OPENED to
 * LOADING are recognised as stale — a request's own terminal events always
 * fire with `readyState` DONE.
 */
export function installXhrProbe(recorder: Recorder, clock: Clock, host: XhrHost = globalThis): Probe {
  const proto = host.XMLHttpRequest.prototype as unknown as Record<PatchedName, XhrMethod>;
  const states = new WeakMap<XMLHttpRequest, RequestState>();
  /** Instances that already carry our listeners — attached once, reused across `open()` calls. */
  const listening = new WeakSet<XMLHttpRequest>();
  /** Dropped on dispose: wrappers left in someone else's chain must not keep the buffer alive. */
  let sink: Recorder | null = recorder;

  /** The instance's sent request that has not been recorded yet. */
  function unrecorded(xhr: XMLHttpRequest): RequestState | null {
    const state = states.get(xhr);
    return state && state.start !== null && !state.recorded ? state : null;
  }

  /** An event of a request that `open()` has already replaced (see above). */
  function isStale(xhr: XMLHttpRequest): boolean {
    const readyState = xhr.readyState;
    return readyState > 0 && readyState < DONE;
  }

  function emit(state: RequestState, draft: HttpDraft): void {
    state.recorded = true;
    if (sink) sink.record(draft);
  }

  /**
   * `open()` is about to reset the instance. Called before the original; the
   * entry is recorded only if the original then succeeds — an invalid
   * `open()` throws without touching the request in flight.
   */
  function onOpen(xhr: XMLHttpRequest, args: unknown[]): () => void {
    const replaced = unrecorded(xhr);
    // DONE: we are inside one of its handlers and the response is still
    // readable. Otherwise it is in flight, and the original open() aborts it
    // silently — no event will ever report it. A failure here must not cost
    // the new request its bookkeeping, hence the separate guard.
    const draft = replaced
      ? attempt(() =>
          xhr.readyState === DONE
            ? entryOf(xhr, replaced, replaced.error ?? failureGuess(xhr, replaced))
            : entryOf(xhr, replaced, 'abort'),
        )
      : null;
    return () => {
      if (replaced && draft) emit(replaced, draft);
      states.set(xhr, {
        method: String(args[0]).toUpperCase(),
        url: toAbsoluteUrl(String(args[1]), host.location.href),
        reqHeaders: {},
        reqBody: null,
        start: null,
        error: null,
        recorded: false,
      });
    };
  }

  /**
   * `abort()` on a finished request fires no event but wipes its response
   * before `loadend` arrives, so it is recorded now. On a request in flight it
   * fires `abort` + `loadend` synchronously; marking it first keeps the kind
   * even when an app listener ahead of ours re-opens the instance.
   */
  function onAbort(xhr: XMLHttpRequest): void {
    const state = unrecorded(xhr);
    if (!state) return;
    if (xhr.readyState === DONE) emit(state, entryOf(xhr, state, state.error ?? failureGuess(xhr, state)));
    else state.error = 'abort';
  }

  function onSetRequestHeader(xhr: XMLHttpRequest, name: unknown, value: unknown): void {
    const state = states.get(xhr);
    if (state) addHeader(state.reqHeaders, String(name), String(value));
  }

  function onSend(xhr: XMLHttpRequest, body: unknown): void {
    const state = states.get(xhr);
    // Opened before install, or a second send() (which the original rejects): nothing to stamp.
    if (!state || state.start !== null) return;
    if (!listening.has(xhr)) {
      listening.add(xhr);
      // Outside the app's zone, so each probe callback costs the app no change detection.
      outsideZones(() => {
        for (const [type, error] of ERROR_EVENTS) {
          xhr.addEventListener(type, () => safely(() => markError(xhr, error)));
        }
        xhr.addEventListener('loadend', () => safely(() => onLoadEnd(xhr)));
      });
    }
    state.reqBody = describeBody(body);
    state.start = clock.now();
  }

  function markError(xhr: XMLHttpRequest, error: NonNullable<XhrError>): void {
    if (isStale(xhr)) return;
    const state = unrecorded(xhr);
    if (state && state.error === null) state.error = error;
  }

  function onLoadEnd(xhr: XMLHttpRequest): void {
    if (isStale(xhr)) return;
    const state = unrecorded(xhr);
    if (state) emit(state, entryOf(xhr, state, state.error));
  }

  /** The entry for `state`, from what the instance holds right now. */
  function entryOf(xhr: XMLHttpRequest, state: RequestState, error: XhrError): HttpDraft {
    const start = state.start ?? clock.now();
    const status = error !== null || xhr.status === 0 ? null : xhr.status;
    const resHeaders: HeaderMap = status === null ? {} : parseRawHeaders(xhr.getAllResponseHeaders());
    const body = status === null ? { text: null, described: null } : readResponse(xhr);
    return {
      kind: 'http',
      transport: 'xhr',
      t: start,
      method: state.method,
      url: state.url,
      status,
      durationMs: clock.now() - start,
      reqHeaders: state.reqHeaders,
      resHeaders,
      reqBody: state.reqBody,
      resBody: body.described,
      bytes: status === null ? null : responseBytes(resHeaders, body.text),
      error,
    };
  }

  /**
   * The app reset the instance from a handler that ran before our listeners
   * (they are added at `send()`, after most app listeners), so a failure's
   * kind may not have reached us yet; `abort` is already known from the
   * `abort()` wrapper. A status of 0 at DONE is then a timeout once the
   * request's `timeout` has elapsed, a network error otherwise. A non-zero
   * status is a plain response.
   */
  function failureGuess(xhr: XMLHttpRequest, state: RequestState): XhrError {
    if (xhr.status !== 0) return null;
    const limit = xhr.timeout;
    return limit > 0 && state.start !== null && clock.now() - state.start >= limit ? 'timeout' : 'network';
  }

  const patches = [
    patch(proto, 'open', (xhr, args) => onOpen(xhr, args)),
    patch(proto, 'setRequestHeader', (xhr, args) => () => onSetRequestHeader(xhr, args[0], args[1])),
    // Booked before the original, so the start time and listeners precede any
    // event a synchronous request fires inside it.
    patch(proto, 'send', (xhr, args) => onSend(xhr, args[0])),
    patch(proto, 'abort', (xhr) => onAbort(xhr)),
  ].filter(<T>(entry: T | null): entry is T => entry !== null);

  /**
   * Wraps one prototype method. The original is called exactly once with the
   * same `this` and arguments and its result returned (or its exception
   * thrown, unchanged); bookkeeping is swallowed if it throws. A method the
   * prototype lacks is left alone.
   */
  function patch(target: Record<PatchedName, XhrMethod>, name: PatchedName, hook: Hook) {
    const original = target[name];
    if (typeof original !== 'function') return null;
    const wasOwn = Object.prototype.hasOwnProperty.call(target, name);
    const wrapper: XhrMethod = function (this: XMLHttpRequest, ...args: unknown[]) {
      const after = sink ? attempt(() => hook(this, args)) : null;
      const result = original.apply(this, args);
      if (after) safely(after);
      return result;
    };
    target[name] = wrapper;
    return { name, original, wrapper, wasOwn };
  }

  return {
    name: 'xhr',
    dispose(): void {
      if (!sink) return;
      sink = null;
      for (const { name, original, wrapper, wasOwn } of patches) {
        // Someone patched on top of us: unwrapping would drop their patch, so
        // ours stays in their chain as a pass-through (`sink` is null).
        if (proto[name] !== wrapper) continue;
        if (wasOwn) proto[name] = original;
        else delete (proto as Partial<Record<PatchedName, XhrMethod>>)[name];
      }
    },
  };
}

/**
 * The response body by `responseType`. `responseText` is read only for text
 * types — for any other type the browser throws `InvalidStateError`.
 * `text` is set only when the body is the response text itself (it then
 * counts towards `bytes`).
 */
function readResponse(xhr: XMLHttpRequest): { text: string | null; described: string | null } {
  switch (xhr.responseType) {
    case '':
    case 'text':
      return { text: xhr.responseText, described: xhr.responseText };
    case 'json':
      return { text: null, described: xhr.response === null ? null : JSON.stringify(xhr.response) };
    case 'arraybuffer': {
      const buffer: unknown = xhr.response;
      return {
        text: null,
        described: buffer instanceof ArrayBuffer ? `[arraybuffer ${buffer.byteLength} bytes]` : null,
      };
    }
    case 'blob': {
      const blob: unknown = xhr.response;
      return {
        text: null,
        described: typeof Blob !== 'undefined' && blob instanceof Blob ? `[blob ${blob.size} bytes]` : null,
      };
    }
    case 'document':
      return { text: null, described: '[document]' };
    default:
      return { text: null, described: null };
  }
}

/** Capture must never break the app: any bookkeeping failure is dropped. */
function safely(work: () => void): void {
  try {
    work();
  } catch {
    // Intentionally empty — see above.
  }
}

/** Like `safely`, but keeps the result; `null` when the work threw. */
function attempt<T>(work: () => T): T | null {
  try {
    return work();
  } catch {
    return null;
  }
}
