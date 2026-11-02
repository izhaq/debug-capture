import { Clock, EntryOrigin, HeaderMap, HttpEntry, MockResponse, Probe, ProbeRecorder, Recorder } from '../../../core';
import { addHeader, describeBody, MockBox, parseRawHeaders, responseBytes, toAbsoluteUrl } from './http-helpers';
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
/** A v1 `Recorder` still works: the pending side is used only when it is there (C-1). */
type Sink = Recorder & Partial<ProbeRecorder>;

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
  /** The recorder's pending id from `send()` (C-1); `null` when none or already ended. */
  id: number | null;
  /** `open()`'s third argument: a synchronous request is answered inside `send()`. */
  async: boolean;
  /** C-13: answered by a mock. */
  origin?: EntryOrigin;
}

type PatchedName = 'open' | 'setRequestHeader' | 'send' | 'abort';
type XhrMethod = (this: XMLHttpRequest, ...args: unknown[]) => unknown;
/**
 * What a hook, run before the original, leaves for this one call: `after`
 * runs only when the original succeeded, `failed` only when it threw (before
 * the same error is rethrown).
 */
interface Steps {
  after?: () => void;
  failed?: () => void;
  /** C-13: the original is not called (a mock answers instead). */
  skip?: boolean;
}
type Hook = (xhr: XMLHttpRequest, args: unknown[]) => Steps | void;

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
export function installXhrProbe(
  recorder: Sink,
  clock: Clock,
  host: XhrHost = globalThis,
  mocks: MockBox = { resolver: null },
): Probe {
  /** C-13: instances a mock is answering, with the way to stop it before it does. */
  const mocked = new WeakMap<XMLHttpRequest, () => void>();
  /** C-13: instances whose state a mock answer shadows — the only ones `unmock` touches. */
  const shadowed = new WeakSet<XMLHttpRequest>();
  const proto = host.XMLHttpRequest.prototype as unknown as Record<PatchedName, XhrMethod>;
  const states = new WeakMap<XMLHttpRequest, RequestState>();
  /** Instances that already carry our listeners — attached once, reused across `open()` calls. */
  const listening = new WeakSet<XMLHttpRequest>();
  /** Dropped on dispose: wrappers left in someone else's chain must not keep the buffer alive. */
  let sink: Sink | null = recorder;
  /** Requests sent and not yet recorded, by pending id: dispose() ends them (C-1). */
  const inFlight = new Map<number, RequestState>();

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

  /** Records the draft; `record()` ends the pending request through the draft's `requestId`. */
  function emit(state: RequestState, draft: HttpDraft): void {
    state.recorded = true;
    const id = state.id;
    state.id = null;
    if (id !== null) inFlight.delete(id);
    if (sink) sink.record(draft);
  }

  /**
   * Records the request, or — when its entry cannot be built (a host that
   * throws while being read) — at least ends it, so its pending row does not
   * stay forever and no later event records it.
   */
  function finish(state: RequestState, build: () => HttpDraft): void {
    const draft = attempt(build);
    if (draft) {
      emit(state, draft);
    } else {
      state.recorded = true;
      endPending(state);
    }
  }

  /** The request will never be recorded: take it off the pending list. */
  function endPending(state: RequestState): void {
    const id = state.id;
    if (id === null) return;
    state.id = null;
    inFlight.delete(id);
    safely(() => sink?.endPending?.(id));
  }

  /**
   * `open()` is about to reset the instance. Called before the original; the
   * entry is recorded only if the original then succeeds — an invalid
   * `open()` throws without touching the request in flight.
   */
  function onOpen(xhr: XMLHttpRequest, args: unknown[]): Steps {
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
    // A mock still answering this instance stops, and the instance is native again.
    mocked.get(xhr)?.();
    if (shadowed.delete(xhr)) unmock(xhr);
    const after = (): void => {
      if (replaced && draft) emit(replaced, draft);
      // Its entry could not be built: it still must not stay pending forever.
      else if (replaced) endPending(replaced);
      states.set(xhr, {
        method: String(args[0]).toUpperCase(),
        url: toAbsoluteUrl(String(args[1]), host.location.href),
        reqHeaders: {},
        reqBody: null,
        start: null,
        error: null,
        recorded: false,
        id: null,
        async: args.length < 3 || Boolean(args[2]),
      });
    };
    return { after };
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
    const stop = mocked.get(xhr);
    if (stop) {
      // The browser never sent it, so its abort() fires nothing: fire what a real abort does.
      stop();
      fireAbort(xhr);
      return;
    }
    if (xhr.readyState === DONE) finish(state, () => entryOf(xhr, state, state.error ?? failureGuess(xhr, state)));
    else state.error = 'abort';
  }

  function onSetRequestHeader(xhr: XMLHttpRequest, name: unknown, value: unknown): void {
    const state = states.get(xhr);
    if (state) addHeader(state.reqHeaders, String(name), String(value));
  }

  function onSend(xhr: XMLHttpRequest, body: unknown): Steps | void {
    const state = states.get(xhr);
    // Opened before install, or a second send() (which the original rejects):
    // nothing to stamp — and nothing of the live request to end if it throws.
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
    // Last, so a recorder that throws here costs the request only its pending row.
    const id = sink?.startPending?.({
      t: state.start,
      transport: 'xhr',
      method: state.method,
      url: state.url,
      reqHeaders: state.reqHeaders,
    });
    if (typeof id === 'number') {
      state.id = id;
      inFlight.set(id, state);
    }
    // C-13: a mock answers instead of the network (FR-RPL-07).
    const mock = attempt(() => mocks.resolver?.({ method: state.method, url: state.url }) ?? null);
    if (mock) {
      state.origin = 'mock';
      answer(xhr, state, mock);
      return { skip: true };
    }
    // This send() threw — a synchronous request that failed: no event will
    // report it, so the request it started is not pending any more.
    return { failed: () => endPending(state) };
  }

  /**
   * Plays a response on the instance as the browser would (C-13, D-54): own
   * getters shadow the prototype's state, then `loadstart`, ready states 2–4,
   * `load` and `loadend` fire — asynchronously, in the caller's zone, unless
   * the request is synchronous. The probe's own listeners record it.
   */
  function answer(xhr: XMLHttpRequest, state: RequestState, mock: MockResponse): void {
    let readyState = 1;
    let live = true;
    const headers: Record<string, string> = {};
    for (const name of Object.keys(mock.headers)) headers[name.toLowerCase()] = String(mock.headers[name]);
    const raw = Object.keys(headers)
      .map((name) => `${name}: ${headers[name]}\r\n`)
      .join('');
    const text = (): boolean => xhr.responseType === '' || xhr.responseType === 'text';
    const getter = (name: string, get: () => unknown): void =>
      void Object.defineProperty(xhr, name, { configurable: true, get });
    getter('readyState', () => readyState);
    getter('status', () => (readyState < 2 ? 0 : mock.status));
    getter('statusText', () => (readyState < 2 ? '' : (mock.statusText ?? '')));
    getter('responseURL', () => state.url);
    getter('responseText', () => {
      // As the browser: reading responseText of a non-text type throws.
      if (!text()) throw new DOMException('responseText needs responseType "" or "text"', 'InvalidStateError');
      return readyState < 3 ? '' : mock.body;
    });
    getter('response', () => {
      if (text()) return readyState < 3 ? '' : mock.body;
      if (readyState < 4) return null;
      return xhr.responseType === 'json' ? attempt(() => JSON.parse(mock.body) as unknown) : null;
    });
    getter(
      'getResponseHeader',
      () => (name: string) => (readyState < 2 ? null : (headers[String(name).toLowerCase()] ?? null)),
    );
    getter('getAllResponseHeaders', () => () => (readyState < 2 ? '' : raw));
    mocked.set(xhr, () => (live = false));
    shadowed.add(xhr);
    const play = (): void => {
      if (!live) return;
      mocked.delete(xhr);
      fire(xhr, 'loadstart');
      for (const next of [2, 3, 4]) {
        readyState = next;
        xhr.dispatchEvent(new Event('readystatechange'));
      }
      fire(xhr, 'load');
      fire(xhr, 'loadend');
    };
    if (state.async) void Promise.resolve().then(play);
    else play();
  }

  /** A mocked request aborted before its answer: what the browser fires for an abort. */
  function fireAbort(xhr: XMLHttpRequest): void {
    own(xhr, 'readyState', 4);
    own(xhr, 'status', 0);
    xhr.dispatchEvent(new Event('readystatechange'));
    fire(xhr, 'abort');
    fire(xhr, 'loadend');
    shadowed.delete(xhr);
    unmock(xhr);
  }

  function markError(xhr: XMLHttpRequest, error: NonNullable<XhrError>): void {
    if (isStale(xhr)) return;
    const state = unrecorded(xhr);
    if (state && state.error === null) state.error = error;
  }

  function onLoadEnd(xhr: XMLHttpRequest): void {
    if (isStale(xhr)) return;
    const state = unrecorded(xhr);
    if (state) finish(state, () => entryOf(xhr, state, state.error));
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
      // The pending id, set on the fresh draft: `record()` ends the row with it (C-1).
      ...(state.id === null ? null : { requestId: state.id }),
      ...(state.origin ? { origin: state.origin } : null),
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
    patch(proto, 'setRequestHeader', (xhr, args) => ({ after: () => onSetRequestHeader(xhr, args[0], args[1]) })),
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
      const steps = sink ? attempt(() => hook(this, args)) : null;
      if (steps?.skip) return undefined;
      let result: unknown;
      try {
        result = original.apply(this, args);
      } catch (error) {
        const failed = steps?.failed;
        if (failed) safely(failed);
        throw error;
      }
      const after = steps?.after;
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
      // Cut off: these will never be recorded, so no listener may keep their rows (C-1).
      for (const state of Array.from(inFlight.values())) endPending(state);
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

/** The names a mock answer shadows on the instance (C-13). */
const MOCKED = [
  'readyState',
  'status',
  'statusText',
  'responseURL',
  'responseText',
  'response',
  'getResponseHeader',
  'getAllResponseHeaders',
];

/** A fixed own value on the instance, shadowing the prototype's getter. */
function own(xhr: XMLHttpRequest, name: string, value: unknown): void {
  Object.defineProperty(xhr, name, { configurable: true, value });
}

/** The instance's own state, from the browser again. */
function unmock(xhr: XMLHttpRequest): void {
  for (const name of MOCKED) delete (xhr as unknown as Record<string, unknown>)[name];
}

function fire(xhr: XMLHttpRequest, type: string): void {
  xhr.dispatchEvent(typeof ProgressEvent === 'undefined' ? new Event(type) : new ProgressEvent(type));
}
