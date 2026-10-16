import {
  CaptureEntry,
  CapturePolicy,
  CaptureStats,
  EntryDraft,
  EntryListener,
  HeaderMap,
  LiveRecorder,
  MAX_PENDING_REQUESTS,
  PendingDraft,
  PendingEvent,
  PendingListener,
  PendingRequest,
  ProbeRecorder,
  RecorderChange,
  RecorderChangeListener,
  Unsubscribe,
} from '../contract';
import { toJsonSafe } from './json-safe';
import {
  matchesAny,
  redactFreeText,
  redactHeaders,
  redactJsonContainer,
  redactFormParamsIn,
  redactParamsIn,
  redactStack,
  redactUserinfo,
  secretNames,
} from './redact';
import { RingBuffer } from './ring-buffer';
import { truncate, truncateThen } from './truncate';

/**
 * The one place policy is applied. Probes hand over drafts as they saw them;
 * ignore, sample, redact, truncate and evict all happen here, on the way INTO
 * the buffer — so nothing the policy removes is ever stored, let alone
 * exported.
 *
 * `record()` is the hot path (a busy WebSocket calls it many times a second):
 * every step is O(1) in the buffer size, a log call's cloning has a fixed
 * budget, a socket's URL is redacted once rather than per frame, and
 * listeners are only copied when there are any.
 *
 * Stored entries are deeply frozen — every part is frozen as it is built —
 * so a listener cannot change what a later export contains.
 *
 * v2 (HLD C-1, C-2, C-6): requests in flight are policed by the very same
 * URL and header functions as the stored entry, so the live list can never
 * show a secret the export would not; ids (entries, requests, sockets) live
 * here, so they never restart while the recorder lives.
 */
export function createRecorder(policy: CapturePolicy): LiveRecorder & ProbeRecorder {
  const buffer = new RingBuffer<CaptureEntry>(policy.maxEntries);
  const listeners: EntryListener[] = [];
  const pendingListeners: PendingListener[] = [];
  const changeListeners: RecorderChangeListener[] = [];
  /** Insertion order is start order, so the first key is always the oldest. */
  const inFlight = new Map<number, PendingRequest>();
  let lastRequestId = 0;
  let lastSocketId = 0;
  let lastSeq = 0;
  let recorded = 0;
  let dropped = 0;
  let evicted = 0;
  let failed = 0;

  const secrets = secretNames(policy.redactJsonKeys);
  const max = policy.maxBodyLength;
  const hidden = policy.redactedValue;
  const redactParams = (kept: string): string => redactParamsIn(kept, secrets, hidden);

  // A busy socket stores the same URL with every frame: redact it once.
  let lastUrl: string | undefined;
  let lastPolicedUrl = '';

  /**
   * The URL as stored: user info replaced whole, truncated, then secret
   * query parameters redacted. `ignoreUrls` and `redactBodyUrls` still match
   * the original.
   */
  function policedUrl(url: string): string {
    if (url !== lastUrl) {
      lastPolicedUrl = truncateThen(redactUserinfo(url, hidden), max, redactParams);
      lastUrl = url;
    }
    return lastPolicedUrl;
  }

  /** Listed header names, plus any whose name looks like a secret key (`x-access-token`). */
  function policedHeaders(headers: HeaderMap): HeaderMap {
    return redactHeaders(headers, policy.redactHeaders, hidden, max, policy.redactJsonKeys);
  }

  /** Frame text after policy: whole-body redaction wins over key redaction. */
  function policedFrame(text: string, url: string, isJsonCandidate: boolean): string {
    if (matchesAny(url, policy.redactBodyUrls)) {
      return hidden;
    }
    const json = isJsonCandidate ? redactJsonContainer(text, secrets, hidden, max) : undefined;
    return truncate(json ?? text, max);
  }

  /**
   * An HTTP body: JSON keys (and URLs inside JSON strings), or the parameters
   * of a form body. A body with no content-type counts as a possible form:
   * for a `URLSearchParams` body the browser adds the header only after the
   * probe has seen the call. Form bodies are truncated before the parameter
   * scan, so a huge one costs no more than a short one.
   */
  function policedBody(body: string | null, url: string, headers: HeaderMap): string | null {
    if (body === null) {
      return null;
    }
    if (matchesAny(url, policy.redactBodyUrls)) {
      return hidden;
    }
    const json = redactJsonContainer(body, secrets, hidden, max);
    if (json !== undefined) {
      return truncate(json, max);
    }
    const type = contentType(headers);
    const form = type === undefined || type.toLowerCase().indexOf('application/x-www-form-urlencoded') !== -1;
    return form ? truncateThen(body, max, (kept) => redactFormParamsIn(kept, secrets, hidden)) : truncate(body, max);
  }

  /** Probes lower-case header names; look in any case anyway, a missed form type would leak. */
  function contentType(headers: HeaderMap): string | undefined {
    const direct = headers['content-type'];
    if (direct !== undefined) {
      return direct;
    }
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'content-type') {
        return headers[name];
      }
    }
    return undefined;
  }

  /**
   * An error message may be a stringified object (an unhandled rejection) or
   * name a URL with a token; its stack repeats it, so the stack is redacted
   * the same way.
   */
  function policedError(message: string, stack: string | null): { message: string; stack: string | null } {
    const redacted = redactFreeText(message, secrets, hidden, max);
    if (stack === null) {
      return { message: redacted.text, stack: null };
    }
    const json = redacted.redactedJson;
    const header = json === undefined ? stack : redactStack(stack, message, json);
    return { message: redacted.text, stack: truncateThen(header, max, redactParams) };
  }

  /** Builds the stored entry field by field, so nothing a probe attached beyond the contract is kept. */
  function normalise(draft: EntryDraft, seq: number): CaptureEntry {
    switch (draft.kind) {
      case 'log':
        return {
          kind: 'log',
          seq,
          t: draft.t,
          level: draft.level,
          args: toJsonSafe(draft.args, policy),
        };
      case 'http':
        return {
          kind: 'http',
          seq,
          t: draft.t,
          transport: draft.transport,
          method: draft.method.toUpperCase(),
          url: policedUrl(draft.url),
          status: draft.status,
          durationMs: draft.durationMs,
          reqHeaders: policedHeaders(draft.reqHeaders),
          resHeaders: policedHeaders(draft.resHeaders),
          reqBody: policedBody(draft.reqBody, draft.url, draft.reqHeaders),
          resBody: policedBody(draft.resBody, draft.url, draft.resHeaders),
          bytes: draft.bytes,
          error: draft.error,
          // Only when present, so a v1 draft still stores exactly the v1 shape.
          ...(typeof draft.requestId === 'number' ? { requestId: draft.requestId } : null),
          ...(draft.resBodyCapped === true ? { resBodyCapped: true as const } : null),
        };
      case 'ws':
        return {
          kind: 'ws',
          seq,
          t: draft.t,
          socketId: draft.socketId,
          url: policedUrl(draft.url),
          event: draft.event,
          opcode: draft.opcode,
          bytes: draft.bytes,
          // Binary frames (base64) and close reasons are never JSON: truncate only.
          data: draft.data === null ? null : policedFrame(draft.data, draft.url, draft.opcode === 'text'),
          code: draft.code,
        };
      case 'error': {
        const { message, stack } = policedError(draft.message, draft.stack);
        return { kind: 'error', seq, t: draft.t, source: draft.source, message, stack };
      }
      default: {
        const unknownDraft: never = draft;
        throw new TypeError(`Unknown draft kind: ${(unknownDraft as { kind?: unknown }).kind}`);
      }
    }
  }

  /** False when the sampler rejects the draft. A throwing sampler keeps it: losing data silently is worse. */
  function sampled(draft: EntryDraft): boolean {
    const sample = policy.sample;
    if (sample === undefined) {
      return true;
    }
    try {
      return sample(draft) !== false;
    } catch {
      countFailed();
      return true;
    }
  }

  /**
   * Events raised while listeners run (a listener that records, clears or
   * starts a request) wait until the current event reached every listener:
   * each listener then sees every event in the order it happened — never a
   * request's `end` before its `start`, never a higher `seq` first.
   */
  const backlog: Array<() => void> = [];
  let delivering = false;

  function emit<T>(targets: Array<(event: T) => void>, event: T): void {
    if (targets.length === 0) {
      return;
    }
    backlog.push(() => {
      // A copy, so a listener can unsubscribe itself without making the loop skip the next one.
      for (const listener of targets.slice()) {
        try {
          listener(event);
        } catch {
          // A broken listener (e.g. a panel) must not stop capture or the other listeners.
        }
      }
    });
    if (delivering) {
      return;
    }
    delivering = true;
    try {
      for (let job = backlog.shift(); job; job = backlog.shift()) {
        job();
      }
    } finally {
      delivering = false;
    }
  }

  const STATS: RecorderChange = Object.freeze({ type: 'stats' });
  const CLEARED: RecorderChange = Object.freeze({ type: 'cleared' });

  /** `dropped` or `failed` moved: the panel's status bar reads `stats()` again (C-6). */
  function countDropped(): void {
    dropped++;
    emit(changeListeners, STATS);
  }

  function countFailed(): void {
    failed++;
    emit(changeListeners, STATS);
  }

  function endPending(id: number): void {
    if (inFlight.delete(id)) {
      emit<PendingEvent>(pendingListeners, Object.freeze({ type: 'end', id }));
    }
  }

  function subscribe<T>(targets: T[], listener: T): Unsubscribe {
    targets.push(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      const index = targets.indexOf(listener);
      if (index !== -1) {
        targets.splice(index, 1);
      }
    };
  }

  return {
    record(draft: EntryDraft): void {
      try {
        // First, whatever happens to the draft next: its request is no longer in flight (C-1).
        if (draft.kind === 'http' && draft.requestId !== undefined) {
          endPending(draft.requestId);
        }
        if ((draft.kind === 'http' || draft.kind === 'ws') && matchesAny(draft.url, policy.ignoreUrls)) {
          countDropped();
          return;
        }
        if (!sampled(draft)) {
          countDropped();
          return;
        }
        // seq is consumed only once the entry is built, so a failed draft leaves no gap.
        const entry = Object.freeze(normalise(draft, lastSeq + 1));
        lastSeq = entry.seq;
        if (buffer.push(entry) !== undefined) {
          evicted++;
        }
        recorded++;
        emit(listeners, entry);
      } catch {
        // Capture must never throw into the code it observes.
        countFailed();
      }
    },

    snapshot(): readonly CaptureEntry[] {
      return buffer.toArray();
    },

    clear(): void {
      buffer.clear();
      recorded = 0;
      dropped = 0;
      evicted = 0;
      failed = 0;
      // Oldest first, each with its `end`, so a listener drops every row before `cleared`.
      for (const id of Array.from(inFlight.keys())) {
        endPending(id);
      }
      emit(changeListeners, CLEARED);
    },

    stats(): CaptureStats {
      return { recorded, dropped, evicted, failed };
    },

    onEntry: (listener: EntryListener): Unsubscribe => subscribe(listeners, listener),

    onChange: (listener: RecorderChangeListener): Unsubscribe => subscribe(changeListeners, listener),

    onPending: (listener: PendingListener): Unsubscribe => subscribe(pendingListeners, listener),

    pending(): readonly PendingRequest[] {
      return Array.from(inFlight.values());
    },

    /**
     * Polices the start of a request with the stored entry's own code path:
     * `ignoreUrls` on the original URL, then `policedUrl` / `policedHeaders`.
     * `sample()` waits for the finished draft (C-1).
     */
    startPending(draft: PendingDraft): number | null {
      try {
        if (matchesAny(draft.url, policy.ignoreUrls)) {
          return null;
        }
        const request: PendingRequest = Object.freeze({
          id: lastRequestId + 1,
          t: draft.t,
          transport: draft.transport,
          method: draft.method.toUpperCase(),
          url: policedUrl(draft.url),
          reqHeaders: policedHeaders(draft.reqHeaders),
        });
        lastRequestId = request.id;
        inFlight.set(request.id, request);
        if (inFlight.size > MAX_PENDING_REQUESTS) {
          endPending(inFlight.keys().next().value as number);
        }
        emit<PendingEvent>(pendingListeners, Object.freeze({ type: 'start', request }));
        return request.id;
      } catch {
        // The finished draft is still recorded as in v1, just never shown as pending.
        countFailed();
        return null;
      }
    },

    endPending(id: number): void {
      endPending(id);
    },

    nextSocketId(): number {
      return ++lastSocketId;
    },
  };
}
