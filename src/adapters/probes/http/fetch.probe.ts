import {
  Clock,
  EntryOrigin,
  HeaderMap,
  HttpEntry,
  HttpRequestDraft,
  Probe,
  ProbeRecorder,
  Recorder,
} from '../../../core';
import { describeBody, headersToMap, isTextual, MockBox, responseBytes, toAbsoluteUrl } from './http-helpers';
import { outsideZones } from './outside-zones';

/** What the fetch probe patches: `host.fetch` is swapped for a wrapper. */
export interface FetchHost {
  fetch: typeof fetch;
  location: { href: string };
  /** For mock answers (C-13); the global one when absent. */
  Response?: typeof Response;
}

/**
 * The most text read from one response body. Textual streams can be endless
 * (`application/x-ndjson` feeds, long polls): past this, reading stops and
 * the captured text says so.
 */
const MAX_CAPTURED_BODY_CHARS = 1_048_576;
const CAP_NOTE = `…[capture stopped at ${MAX_CAPTURED_BODY_CHARS} chars]`;

/** A v1 `Recorder` still works: the pending side is used only when it is there (C-1). */
type Sink = Recorder & Partial<ProbeRecorder>;

/** What is known about a request when it starts. */
interface StartedRequest {
  method: string;
  url: string;
  reqHeaders: HeaderMap;
  reqBody: string | null;
  start: number;
  /** The recorder's pending id (C-1); `null` when none or already ended. */
  id: number | null;
  /** C-13: a mock's answer or a developer's resend. */
  origin?: EntryOrigin;
}

/**
 * Records one `HttpEntry` per settled `fetch` (response body read, network
 * error or abort). `host` defaults to the real global; specs pass a host
 * around a bound real fetch or a fake.
 */
/** C-13 (2.5): the probe can also send a developer's request (`FR-RPL-03`). */
export interface FetchProbe extends Probe {
  send(draft: HttpRequestDraft): Promise<number | null>;
}

export function installFetchProbe(
  recorder: Sink,
  clock: Clock,
  host: FetchHost = globalThis,
  mocks: MockBox = { resolver: null },
): FetchProbe {
  const original = host.fetch;
  /** Dropped on dispose: a wrapper left in someone else's chain must not keep the buffer alive. */
  let sink: Sink | null = recorder;
  /** Requests started and not yet recorded, by pending id: dispose() ends them (C-1). */
  const inFlight = new Map<number, StartedRequest>();

  /**
   * The original is called exactly once, with `host` as `this` and the
   * caller's arguments. The caller gets a promise that settles exactly like
   * the original one — the very same `Response` or the very same error. It is
   * a promise chained on the original (not the original itself) so that a
   * rejection the app never handles is still reported as unhandled.
   */
  const wrapper = function (...args: Parameters<typeof fetch>): Promise<Response> {
    return run(args);
  };

  /**
   * The wrapper's work. `origin` is set for a developer's resend (C-13), which
   * never meets a mock; `onStart` receives the request as booked.
   */
  function run(
    args: Parameters<typeof fetch>,
    origin?: EntryOrigin,
    onStart?: (started: StartedRequest) => void,
  ): Promise<Response> {
    const started = sink ? attempt(() => startRequest(args)) : null;
    // C-13: a mock answers the app instead of the network (FR-RPL-07).
    const mock =
      started && !origin ? attempt(() => mocks.resolver?.({ method: started.method, url: started.url }) ?? null) : null;
    if (started) {
      started.origin = mock ? 'mock' : origin;
      if (onStart) safely(() => onStart(started));
    }
    let pending: Promise<Response>;
    try {
      pending = mock
        ? // In a promise, so a status the Response constructor rejects reaches the app as a rejection.
          new Promise((resolve) => {
            const noBody = [101, 204, 205, 304].indexOf(mock.status) >= 0;
            resolve(
              new (host.Response ?? Response)(noBody ? null : mock.body, {
                status: mock.status,
                statusText: mock.statusText ?? '',
                headers: mock.headers,
              }),
            );
          })
        : original.apply(host, args);
    } catch (error) {
      // Someone else's patched fetch threw: nothing will settle this request.
      if (started) endPending(started);
      throw error;
    }
    if (started === null) return pending;
    try {
      return pending.then(
        (response) => {
          settle(started, () => onResponse(started, response));
          return response;
        },
        (error: unknown) => {
          settle(started, () => onFailure(started, error));
          throw error;
        },
      );
    } catch {
      // Not a real promise (someone else's patched fetch): hand it back untouched.
      endPending(started);
      return pending;
    }
  }

  /** Bookkeeping that fails before recording must not leave the request pending forever. */
  function settle(started: StartedRequest, work: () => void): void {
    try {
      work();
    } catch {
      endPending(started);
    }
  }

  /** The request will never be recorded: take it off the pending list. */
  function endPending(started: StartedRequest): void {
    const id = takeId(started);
    if (id !== null) safely(() => sink?.endPending?.(id));
  }

  function takeId(started: StartedRequest): number | null {
    const id = started.id;
    started.id = null;
    if (id !== null) inFlight.delete(id);
    return id;
  }

  /** What `fetch` itself does: `init` wins over the `Request`'s own method, headers and body. */
  function startRequest([input, init]: Parameters<typeof fetch>): StartedRequest {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
    const url = toAbsoluteUrl(request ? request.url : (input as string | URL), host.location.href);
    let reqHeaders: HeaderMap = {};
    if (init?.headers !== undefined) reqHeaders = headersToMap(init.headers);
    else if (request) reqHeaders = headersToMap(request.headers);
    let reqBody: string | null = null;
    if (init?.body !== undefined) reqBody = describeBody(init.body);
    // Reading the Request's stream would consume the body the original is about to send.
    else if (request && request.body !== null && request.body !== undefined) reqBody = '[Request body]';
    const started: StartedRequest = { method, url, reqHeaders, reqBody, start: clock.now(), id: null };
    // Guarded on its own: a recorder that throws here costs the request only its pending row.
    const id = attempt(() => sink?.startPending?.({ t: started.start, transport: 'fetch', method, url, reqHeaders }));
    if (typeof id === 'number') {
      started.id = id;
      inFlight.set(id, started);
    }
    return started;
  }

  /**
   * Text bodies are read from a clone, outside the chain the caller sees, so
   * the app gets its `Response` without waiting and with its body unread.
   * Binary and event-stream bodies are never read. The read runs outside the
   * app's zone: its promise callbacks are no business of change detection.
   */
  function onResponse(started: StartedRequest, response: Response): void {
    const resHeaders = headersToMap(response.headers);
    const status = response.status === 0 ? null : response.status;
    if (!isTextual(response.headers.get('content-type'))) {
      record(started, { status, resHeaders, resBody: null, error: null });
      return;
    }
    const clone = response.clone();
    outsideZones(() =>
      readCapped(clone).then(
        ({ text, complete }) =>
          record(started, { status, resHeaders, resBody: text, error: null }, complete ? text : null, !complete),
        // The body failed mid-read (the caller aborted, or the connection
        // dropped): the request did not succeed, whatever its status said.
        (error: unknown) => record(started, { status, resHeaders, resBody: null, error: errorKind(error) }),
      ),
    );
  }

  function onFailure(started: StartedRequest, error: unknown): void {
    record(started, { status: null, resHeaders: {}, resBody: null, error: errorKind(error) });
  }

  /**
   * `fullText` is the whole body as read — it sizes `bytes` when there is no
   * `content-length`. `capped`: reading stopped at the cap (C-7). The
   * draft's `requestId` ends the pending request in the recorder (C-1).
   */
  function record(
    started: StartedRequest,
    outcome: Pick<HttpEntry, 'status' | 'resHeaders' | 'resBody' | 'error'>,
    fullText: string | null = outcome.resBody,
    capped = false,
  ): void {
    if (!sink) return;
    const target = sink;
    const requestId = takeId(started);
    safely(() =>
      target.record({
        kind: 'http',
        transport: 'fetch',
        t: started.start,
        method: started.method,
        url: started.url,
        status: outcome.status,
        durationMs: clock.now() - started.start,
        reqHeaders: started.reqHeaders,
        resHeaders: outcome.resHeaders,
        reqBody: started.reqBody,
        resBody: outcome.resBody,
        bytes: outcome.status === null ? null : responseBytes(outcome.resHeaders, fullText),
        error: outcome.error,
        ...(requestId === null ? null : { requestId }),
        ...(capped ? { resBodyCapped: true as const } : null),
        ...(started.origin ? { origin: started.origin } : null),
      }),
    );
  }

  host.fetch = wrapper;

  return {
    name: 'fetch',
    send(draft): Promise<number | null> {
      if (!sink) return Promise.resolve(null);
      let id: number | null = null;
      return new Promise<Response>((resolve) => {
        const method = String(draft.method).toUpperCase();
        const init: RequestInit = { method, headers: { ...draft.headers }, credentials: 'same-origin' };
        // fetch() rejects a body on GET and HEAD.
        if (draft.body !== null && method !== 'GET' && method !== 'HEAD') init.body = draft.body;
        resolve(run([toAbsoluteUrl(draft.url, host.location.href), init], 'replay', (started) => (id = started.id)));
      }).then(
        () => id,
        // Recorded as a failed request already; the developer sees it in the list.
        () => id,
      );
    },
    dispose(): void {
      if (!sink) return;
      // Cut off: these will never be recorded, so no listener may keep their rows (C-1).
      for (const started of Array.from(inFlight.values())) endPending(started);
      sink = null;
      // Someone patched on top of us: unwrapping would drop their patch, so
      // ours stays in their chain as a pass-through (`sink` is null).
      if (host.fetch === wrapper) host.fetch = original;
    },
  };
}

/**
 * Reads a body as UTF-8 text — what `Response.text()` does — but stops after
 * `MAX_CAPTURED_BODY_CHARS` and cancels the rest. `body` is a clone's branch
 * of a tee: cancelling it leaves the app's branch, and the source, untouched.
 * Falls back to `text()` where streams are unavailable.
 */
function readCapped(response: Response): Promise<{ text: string; complete: boolean }> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function' || typeof TextDecoder === 'undefined') {
    return response.text().then((text) => ({ text, complete: true }));
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const next = (): Promise<{ text: string; complete: boolean }> =>
    reader.read().then(({ done, value }) => {
      if (done) return { text: text + decoder.decode(), complete: true };
      text += decoder.decode(value, { stream: true });
      if (text.length <= MAX_CAPTURED_BODY_CHARS) return next();
      reader.cancel().catch(() => undefined);
      return { text: text.slice(0, MAX_CAPTURED_BODY_CHARS) + CAP_NOTE, complete: false };
    });
  return next();
}

/**
 * `AbortController.abort()` rejects with an `AbortError`; `AbortSignal.timeout()`
 * with a `TimeoutError`. Everything else is a network failure.
 */
function errorKind(error: unknown): NonNullable<HttpEntry['error']> {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === 'AbortError') return 'abort';
  if (name === 'TimeoutError') return 'timeout';
  return 'network';
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
