import { Clock, HeaderMap, HttpEntry, Probe, Recorder } from '../../../core';
import { describeBody, headersToMap, isTextual, responseBytes, toAbsoluteUrl } from './http-helpers';
import { outsideZones } from './outside-zones';

/** What the fetch probe patches: `host.fetch` is swapped for a wrapper. */
export interface FetchHost {
  fetch: typeof fetch;
  location: { href: string };
}

/**
 * The most text read from one response body. Textual streams can be endless
 * (`application/x-ndjson` feeds, long polls): past this, reading stops and
 * the captured text says so.
 */
const MAX_CAPTURED_BODY_CHARS = 1_048_576;
const CAP_NOTE = `…[capture stopped at ${MAX_CAPTURED_BODY_CHARS} chars]`;

/** What is known about a request when it starts. */
interface StartedRequest {
  method: string;
  url: string;
  reqHeaders: HeaderMap;
  reqBody: string | null;
  start: number;
}

/**
 * Records one `HttpEntry` per settled `fetch` (response body read, network
 * error or abort). `host` defaults to the real global; specs pass a host
 * around a bound real fetch or a fake.
 */
export function installFetchProbe(recorder: Recorder, clock: Clock, host: FetchHost = globalThis): Probe {
  const original = host.fetch;
  /** Dropped on dispose: a wrapper left in someone else's chain must not keep the buffer alive. */
  let sink: Recorder | null = recorder;

  /**
   * The original is called exactly once, with `host` as `this` and the
   * caller's arguments. The caller gets a promise that settles exactly like
   * the original one — the very same `Response` or the very same error. It is
   * a promise chained on the original (not the original itself) so that a
   * rejection the app never handles is still reported as unhandled.
   */
  const wrapper = function (...args: Parameters<typeof fetch>): Promise<Response> {
    const started = sink ? attempt(() => startRequest(args)) : null;
    const pending = original.apply(host, args);
    if (started === null) return pending;
    try {
      return pending.then(
        (response) => {
          safely(() => onResponse(started, response));
          return response;
        },
        (error: unknown) => {
          safely(() => onFailure(started, error));
          throw error;
        },
      );
    } catch {
      // Not a real promise (someone else's patched fetch): hand it back untouched.
      return pending;
    }
  };

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
    return { method, url, reqHeaders, reqBody, start: clock.now() };
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
          record(started, { status, resHeaders, resBody: text, error: null }, complete ? text : null),
        // The body failed mid-read (the caller aborted, or the connection
        // dropped): the request did not succeed, whatever its status said.
        (error: unknown) => record(started, { status, resHeaders, resBody: null, error: errorKind(error) }),
      ),
    );
  }

  function onFailure(started: StartedRequest, error: unknown): void {
    record(started, { status: null, resHeaders: {}, resBody: null, error: errorKind(error) });
  }

  /** `fullText` is the whole body as read — it sizes `bytes` when there is no `content-length`. */
  function record(
    started: StartedRequest,
    outcome: Pick<HttpEntry, 'status' | 'resHeaders' | 'resBody' | 'error'>,
    fullText: string | null = outcome.resBody,
  ): void {
    if (!sink) return;
    const target = sink;
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
      }),
    );
  }

  host.fetch = wrapper;

  return {
    name: 'fetch',
    dispose(): void {
      if (!sink) return;
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
