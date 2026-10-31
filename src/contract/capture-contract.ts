/**
 * The whole shared vocabulary of the debug-capture layer. Every other layer
 * builds on these types; nothing here has behavior beyond a few frozen
 * constants. A change here is a change to every PR in
 * specs/4-debug-capture — update the plan with it.
 */

/**
 * Bumped on any breaking change to the exported file shape. 2 (D-36): each
 * entry's `seq` is written as `sequence`, and a readable `time` sits next to
 * `t`. Only the file changed; `CaptureEntry` in code keeps `seq`.
 */
export const CAPTURE_SCHEMA_VERSION = 2;

/** The package version (HLD `D-42`), shown in Settings › About. `npm run build` checks it equals package.json. */
export const DEBUG_CAPTURE_VERSION = '2.4.0-alpha.0';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** The console methods the console probe wraps, in a stable order. */
export const LOG_LEVELS: readonly LogLevel[] = Object.freeze(['log', 'info', 'warn', 'error', 'debug']);

/** What survives JSON.stringify unchanged — the shape stored entries use. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Header name → value. Keys are always lower-case. */
export type HeaderMap = Readonly<Record<string, string>>;

export interface CaptureEntryBase {
  /** Assigned by the recorder: 1-based, strictly increasing, never reused — not even after clear(). */
  readonly seq: number;
  /** Epoch milliseconds of the event, stamped by the probe from the injected Clock. */
  readonly t: number;
}

export interface LogEntry extends CaptureEntryBase {
  readonly kind: 'log';
  readonly level: LogLevel;
  /**
   * JSON-safe clones made at record time — never live references. Redacted,
   * frozen, and bounded per entry (see `CapturePolicy.maxBodyLength`).
   */
  readonly args: readonly JsonValue[];
}

/** One entry per completed request (load, error, abort or timeout). */
export interface HttpEntry extends CaptureEntryBase {
  readonly kind: 'http';
  readonly transport: 'xhr' | 'fetch';
  /** Upper-case. */
  readonly method: string;
  /** Absolute URL; secret query parameters redacted (see `CapturePolicy.redactJsonKeys`). */
  readonly url: string;
  /** `null` when no HTTP response arrived (network error, abort, timeout). */
  readonly status: number | null;
  readonly durationMs: number | null;
  readonly reqHeaders: HeaderMap;
  readonly resHeaders: HeaderMap;
  /** Text bodies as-is; non-text bodies as a short descriptor such as `[Blob 512 bytes]`. */
  readonly reqBody: string | null;
  readonly resBody: string | null;
  /** Response size in bytes when known. */
  readonly bytes: number | null;
  readonly error: 'abort' | 'timeout' | 'network' | null;
  /**
   * C-1 (HLD §6.5): the `PendingRequest.id` this request had while in flight,
   * so the panel can swap the pending row for the finished one. Optional:
   * v1 entries and files have none, and readers ignore unknown fields.
   */
  readonly requestId?: number;
  /**
   * C-7 (HLD §6.5): the fetch probe stopped reading the response early
   * (1,048,576 chars), so `resBody` is not the whole body. Kept as a flag
   * because a marker in the text would be cut off by `maxBodyLength`.
   * Present and `true`, or absent — never `false`.
   */
  readonly resBodyCapped?: true;
}

export type WebSocketEvent = 'open' | 'send' | 'receive' | 'close' | 'error';

/** One entry per socket event; `socketId` groups the frames of one connection. */
export interface WebSocketEntry extends CaptureEntryBase {
  readonly kind: 'ws';
  /**
   * 1-based, in creation order. The counter lives in the recorder
   * (`ProbeRecorder.nextSocketId`, C-2), so ids never restart while the
   * recorder lives — not after `clear()`, not across a controller's stop/start.
   */
  readonly socketId: number;
  /** Secret query parameters redacted, like `HttpEntry.url`. */
  readonly url: string;
  readonly event: WebSocketEvent;
  /** `send` / `receive` only; otherwise `null`. */
  readonly opcode: 'text' | 'binary' | null;
  /** Payload size in bytes (`send` / `receive`), otherwise `null`. */
  readonly bytes: number | null;
  /** Text frames as-is, binary frames base64, `close` → the reason (or `null`). */
  readonly data: string | null;
  /** `close` only: the close code. */
  readonly code: number | null;
}

export interface ErrorEntry extends CaptureEntryBase {
  readonly kind: 'error';
  /**
   * `capture` = the debug-capture layer reporting its own failure (e.g. a probe that would not install).
   * `react` = errors React handled itself (root error callbacks or an error
   * boundary), with React's component stack appended to `stack`.
   */
  readonly source: 'window' | 'unhandledrejection' | 'angular' | 'react' | 'capture';
  readonly message: string;
  readonly stack: string | null;
}

/**
 * 2.1 (HLD C-10, `D-33`): a note the user (Add note) or the host
 * (`session.addNote`) wrote at that moment. Policed like an error message:
 * redacted and truncated. Never a problem. A reader that does not know the
 * kind skips it, so `schemaVersion` stays 1.
 */
export interface NoteEntry extends CaptureEntryBase {
  readonly kind: 'note';
  readonly title: string;
  readonly text: string;
}

/** 2.3 (`C-12`, `FR-MSG-01`): how loud an app message is; `error` makes it a problem (`FR-MSG-06`). */
export type AppMessageLevel = 'info' | 'warn' | 'error';

export const APP_MESSAGE_LEVELS: readonly AppMessageLevel[] = Object.freeze(['info', 'warn', 'error']);

/** 2.3 (`C-12`): a message the host app sent itself (`session.addMessage`). */
export interface AppMessageEntry extends CaptureEntryBase {
  readonly kind: 'app';
  /** The host's short name for it, e.g. `order-saved`. Redacted and cut like a note title. */
  readonly type: string;
  readonly level: AppMessageLevel;
  /** A JSON-safe, redacted clone made at record time, like `LogEntry.args`. */
  readonly data: JsonValue;
}

/** Discriminated on `kind`. Switch over it with a `never` default to stay exhaustive. */
export type CaptureEntry = LogEntry | HttpEntry | WebSocketEntry | ErrorEntry | NoteEntry | AppMessageEntry;

export type CaptureKind = CaptureEntry['kind'];

/**
 * What a probe hands to the recorder: an entry without `seq` (the recorder
 * assigns it). Log arguments are still raw here — the recorder turns them
 * into JSON-safe values.
 */
export type EntryDraft =
  | (Omit<LogEntry, 'seq' | 'args'> & { readonly args: readonly unknown[] })
  | Omit<HttpEntry, 'seq'>
  | Omit<WebSocketEntry, 'seq'>
  | Omit<ErrorEntry, 'seq'>
  | Omit<NoteEntry, 'seq'>
  | (Omit<AppMessageEntry, 'seq' | 'data'> & { readonly data: unknown });

/**
 * Every rule about what gets kept and how, in one reviewable place. Applied
 * by the recorder on the way INTO the buffer — so an exported file can never
 * hold anything the policy removed.
 */
export interface CapturePolicy {
  /**
   * Ring-buffer size; the oldest entry is evicted beyond it. Integer ≥ 1.
   * The start size only: `LiveRecorder.setCapacity` changes it live (C-9).
   */
  readonly maxEntries: number;
  /**
   * Bodies, frame data, URLs, header values, messages and stacks longer than
   * this are truncated with a marker. Also the budget for one log entry: the
   * characters of all its strings and keys together. Integer ≥ 0.
   */
  readonly maxBodyLength: number;
  /** How deep log arguments are cloned before collapsing to a placeholder. Integer ≥ 0. */
  readonly maxArgDepth: number;
  /** Header names (case-insensitive) whose values are replaced by `redactedValue`. */
  readonly redactHeaders: readonly string[];
  /**
   * Secret names. Compared ignoring case, `_` and `-` on both sides, and a
   * key matches when it ends with a name: `accesstoken` matches
   * `access_token` and `Access-Token`, `password` matches `newPassword`
   * (and `token` matches pagination keys like `nextToken`). Their values
   * are replaced by `redactedValue` anywhere inside JSON bodies, JSON text
   * frames, logged objects and Maps, JSON in logged strings and error
   * messages, URL parameters (in URLs, form bodies, free text, stacks and
   * JSON strings), and header names that match — e.g. the `password` in
   * this app's login request. `null` and boolean values are kept.
   */
  readonly redactJsonKeys: readonly string[];
  /** Requests/sockets whose URL matches: every body / frame is replaced whole. */
  readonly redactBodyUrls: readonly RegExp[];
  readonly redactedValue: string;
  /** Requests/sockets whose URL matches are not recorded at all (counted as dropped). */
  readonly ignoreUrls: readonly RegExp[];
  /** Return `false` to drop a draft. The valve for very chatty sockets. */
  readonly sample?: (draft: EntryDraft) => boolean;
}

export const DEFAULT_CAPTURE_POLICY: CapturePolicy = Object.freeze({
  maxEntries: 5000,
  maxBodyLength: 32_768,
  maxArgDepth: 6,
  redactHeaders: Object.freeze([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'x-xsrf-token',
  ]),
  redactJsonKeys: Object.freeze([
    'password',
    'passwd',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'apikey',
    'authorization',
    'clientsecret',
    'idtoken',
    'privatekey',
    'sessionid',
    'sessiontoken',
    'csrftoken',
    'xsrftoken',
    'signature',
  ]),
  redactBodyUrls: Object.freeze([]),
  redactedValue: '[redacted]',
  ignoreUrls: Object.freeze([]),
});

/** Injected wherever time is read, so specs control it. */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

export interface CaptureStats {
  /** Entries accepted into the buffer since the last clear(). */
  readonly recorded: number;
  /** Drafts rejected by `ignoreUrls` or `sample`. */
  readonly dropped: number;
  /** Entries pushed out of the full ring buffer. */
  readonly evicted: number;
  /** Drafts that threw while being processed (swallowed — capture never throws). */
  readonly failed: number;
}

export type EntryListener = (entry: CaptureEntry) => void;
export type Unsubscribe = () => void;

export interface Recorder {
  /** Applies the policy and stores the entry. Never throws. */
  record(draft: EntryDraft): void;
  /** Oldest first. A new array each call. */
  snapshot(): readonly CaptureEntry[];
  /** Empties the buffer and zeroes the stats. `seq` keeps counting. */
  clear(): void;
  /** A fresh copy each call. */
  stats(): CaptureStats;
  /** Called after each stored entry. A throwing listener is isolated. */
  onEntry(listener: EntryListener): Unsubscribe;
}

/** One installed patch on one global. */
export interface Probe {
  readonly name: string;
  /**
   * Restores the original global. Idempotent. After dispose nothing more is
   * recorded — including from requests/sockets already in flight.
   */
  dispose(): void;
}

/** The exported file. */
export interface CaptureFile {
  readonly schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
  /** ISO-8601. */
  readonly capturedAt: string;
  /** `location.href` at export time. */
  readonly page: string;
  readonly userAgent: string;
  readonly stats: CaptureStats;
  readonly entries: readonly ExportedEntry[];
  /**
   * C-1 (HLD §6.5): requests still in flight at export time, oldest first.
   * Written only when something is in flight.
   */
  readonly pending?: readonly ExportedPendingRequest[];
}

/** Written next to `t` in the file: `t` as the station's wall clock, with its UTC offset (`2026-10-25T15:08:56.618+03:00`). */
interface ReadableTime {
  readonly time: string;
}

/**
 * A `CaptureEntry` as the file writes it (schema 2, D-36): `seq` is spelled
 * `sequence`, plus `time`. Every other field is the entry's own.
 */
export type ExportedEntry = CaptureEntry extends infer E
  ? E extends CaptureEntry
    ? Omit<E, 'seq'> & ReadableTime & { readonly sequence: number }
    : never
  : never;

/** A `PendingRequest` as the file writes it: plus `time`. */
export type ExportedPendingRequest = PendingRequest & ReadableTime;

/** Chords like `ctrl+alt+shift+d`. Matched on `KeyboardEvent.code`, so keyboard layout does not matter. */
export interface ShortcutConfig {
  readonly download: string;
  readonly copy: string;
  readonly clear: string;
  /** 2.2 (`FR-BG-05`): capture on / off. */
  readonly record: string;
  /** 2.2 (`FR-BG-07`): adds the `note` option's note. */
  readonly note: string;
}

/**
 * Three modifiers, to stay clear of browser and OS shortcuts (Ctrl+Shift+D bookmarks all tabs in Chrome).
 * Not R or N (`D-37`): with Alt missed, Ctrl+Shift+R hard-reloads and Ctrl+Shift+N opens an incognito window.
 */
export const DEFAULT_SHORTCUTS: ShortcutConfig = Object.freeze({
  download: 'ctrl+alt+shift+d',
  copy: 'ctrl+alt+shift+c',
  clear: 'ctrl+alt+shift+x',
  record: 'ctrl+alt+shift+s',
  note: 'ctrl+alt+shift+m',
});

/** 2.2 (`D-38`): the note the note chord adds. */
export interface NoteTemplate {
  readonly title?: string;
  readonly text?: string;
}

export const DEFAULT_NOTE: Required<NoteTemplate> = Object.freeze({
  title: 'Mark',
  text: 'Added with the keyboard shortcut.',
});

export interface DebugCaptureOptions {
  readonly policy?: Partial<CapturePolicy>;
  /** `false` disables keyboard shortcuts. */
  readonly shortcuts?: Partial<ShortcutConfig> | false;
  /** 2.2: the note chord's title and text; each defaults to `DEFAULT_NOTE`'s. */
  readonly note?: NoteTemplate;
}

/** What installDebugCapture() returns — the handle the app and the Angular layer hold. */
export interface CaptureSession {
  readonly recorder: Recorder;
  readonly clock: Clock;
  /** `false` after dispose(). */
  readonly active: boolean;
  /** The whole buffer as a CaptureFile, serialized. */
  toJson(): string;
  /** Saves toJson() as a file. */
  download(filename?: string): void;
  /** Copies toJson() to the clipboard. Resolves `false` instead of rejecting. */
  copy(): Promise<boolean>;
  clear(): void;
  /** Disposes every probe and shortcut. Globals are genuinely restored. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// v2 additions (HLD §6.4, §6.5). Types only and additive: v1 code keeps
// compiling and the file format keeps `schemaVersion` 1. S-01 implements them.
// ---------------------------------------------------------------------------

/**
 * C-1 — a request that has started but not finished, so the panel can show it
 * as "pending" (`FR-HTTP-02`). Policed like an `HttpEntry` at start: requests
 * matching `ignoreUrls` never appear, and the URL and headers are already
 * redacted. `sample()` does not run here — it runs once, at completion, on
 * the finished draft (v1's signature).
 */
export interface PendingRequest {
  /** Recorder-assigned; equals `HttpEntry.requestId` of the finished entry. */
  readonly id: number;
  /** Start time, epoch milliseconds (from the injected Clock). */
  readonly t: number;
  readonly transport: 'xhr' | 'fetch';
  /** Upper-case, like `HttpEntry.method`. */
  readonly method: string;
  /** Already policed: `ignoreUrls` applied, secret query parameters redacted. */
  readonly url: string;
  /** Already redacted, like `HttpEntry.reqHeaders`. */
  readonly reqHeaders: HeaderMap;
}

/**
 * C-1 — the live list changed. `end` fires when the request completes, and
 * also when it is sampled out, fails while recording, is pushed out by the
 * 200 cap, or is cut off by `stop()` / `dispose()` — so a listener never keeps
 * a row that will not finish.
 */
export type PendingEvent =
  { readonly type: 'start'; readonly request: PendingRequest } | { readonly type: 'end'; readonly id: number };

/** C-1. A throwing listener is isolated, like `EntryListener`. */
export type PendingListener = (event: PendingEvent) => void;

/**
 * C-6 — changes that are not a new entry: `cleared` after `clear()` (also from
 * v1's clear shortcut), `stats` when only `dropped` / `failed` changed
 * (`FR-BAR-03`, `FR-BAR-06`). Read the new numbers with `stats()`.
 */
export type RecorderChange =
  | { readonly type: 'cleared' }
  | { readonly type: 'stats' }
  /** C-9 (2.1): `setCapacity` changed the size; read it with `usage()`. */
  | { readonly type: 'capacity' };

/**
 * C-9 (2.1) — what the buffer holds now, kept up to date in O(1) per entry,
 * for the Buffer setting, the near-full and memory warnings and the host's
 * status observer (`FR-BUF-01…05`, `FR-STAT-01`).
 */
export interface BufferUsage {
  readonly entries: number;
  /** `Infinity` = No limit. */
  readonly capacity: number;
  /**
   * An estimate, not a measurement (the browser cannot measure given
   * objects, `D-30`): per entry `ENTRY_COST_BYTES` plus 2 B per character of
   * every string and object key in it, at any depth. Strings shared between
   * entries count each time, so it errs high.
   */
  readonly bytes: number;
  /** Entries that are problems (`IsProblemEntry`, C-8). */
  readonly problems: number;
}

/** C-9: the fixed part of the per-entry size estimate (`BufferUsage.bytes`). */
export const ENTRY_COST_BYTES = 160;

/** C-6. A throwing listener is isolated, like `EntryListener`. */
export type RecorderChangeListener = (change: RecorderChange) => void;

/**
 * The v2 recorder: a v1 `Recorder` plus the live state the panel needs.
 * S-01 makes `createRecorder()` return it. One recorder lives for the page's
 * life (C-2, D-17), so `seq`, request ids and socket ids never restart.
 */
export interface LiveRecorder extends Recorder {
  /** C-6: fires on `clear()` and on stats-only changes. */
  onChange(listener: RecorderChangeListener): Unsubscribe;
  /**
   * C-1: requests in flight, oldest first, at most 200 (the oldest is dropped
   * beyond that). A new array each call. `clear()` and `stop()` empty it.
   */
  pending(): readonly PendingRequest[];
  /** C-1: `start` / `end` of each pending request. */
  onPending(listener: PendingListener): Unsubscribe;
  /** C-9: the buffer's numbers now. A fresh object each call. */
  usage(): BufferUsage;
  /**
   * C-9: a new buffer size — an integer ≥ 1, or `Infinity` for No limit.
   * Anything else, or the current size, is ignored. A smaller size evicts
   * the oldest entries at once (counted in `evicted`); then `onChange` fires
   * `capacity`. Ids keep counting. Never throws.
   */
  setCapacity(capacity: number): void;
}

/** C-1: the most requests `LiveRecorder.pending()` holds; the oldest is dropped beyond it. */
export const MAX_PENDING_REQUESTS = 200;

/**
 * C-1 — what a probe knows when a request starts, before the recorder polices
 * it (`ignoreUrls`, URL and header redaction) and gives it an id.
 */
export type PendingDraft = Omit<PendingRequest, 'id'>;

/**
 * The write side of the v2 recorder, used only by the probes (L3). Kept apart
 * from `LiveRecorder` so the read side the panel fakes in its specs never
 * grows when probe needs change. S-01's recorder implements both.
 */
export interface ProbeRecorder extends Recorder {
  /**
   * C-1: a request started. Returns its id, or `null` when the policy ignores
   * it (then nothing is shown, and the finished draft is recorded as in v1).
   * The probe puts the id on the finished HTTP draft as `requestId`;
   * `record()` of that draft ends the pending request (completed, sampled
   * out or failed alike).
   */
  startPending(draft: PendingDraft): number | null;
  /** C-1: the request will never be recorded (cut off by dispose). Idempotent. */
  endPending(id: number): void;
  /**
   * C-2: the next WebSocket id. The counter lives in the recorder, not in a
   * probe install, so ids never restart across stop/start.
   */
  nextSocketId(): number;
}

/**
 * C-5 — where a sink puts its temporary node (the copy fallback's textarea,
 * the download link). Default: `document.body`. The panel passes its shadow
 * root, so a copy or download from the panel adds nothing to the host page
 * (`ISO-04`). S-01 adds this as the last, optional parameter of `copyText`
 * and `downloadText`.
 */
export interface SinkOptions {
  readonly root?: Pick<ParentNode, 'appendChild'>;
}

/**
 * C-2 + C-3 — the session a `CaptureController` hands out: one stable object
 * for the page's life. Still a v1 `CaptureSession`, so the Angular and React
 * seams keep working across stop/start. `active` follows `controller.on`;
 * `dispose()` acts as `controller.stop()`; `getActiveCaptureSession()`
 * returns this object.
 */
export interface ControlledCaptureSession extends CaptureSession {
  readonly recorder: LiveRecorder;
  /**
   * C-3: the resolved policy, read-only — the panel shows `maxEntries` as the
   * buffer capacity (`FR-BAR-06`) and marks values equal to `redactedValue`
   * (`FR-HTTP-07`).
   */
  readonly policy: Readonly<CapturePolicy>;
  /**
   * C-10 (2.1): records a note now, with the session clock's time — also
   * while capture is off: a note is the user's own act, not a probe's.
   * Never throws.
   */
  addNote(title: string, text?: string): void;
  /**
   * C-12 (2.3): records the host's own message — only while capture is on;
   * dropped while off (`FR-MSG-03`). `data` defaults to `null`, an unknown
   * `level` is `info`. Never throws.
   */
  addMessage(type: string, data?: unknown, level?: AppMessageLevel): void;
}

/**
 * C-2 — turns capture on and off without losing the buffer (`FR-ACT-09`).
 * It owns one recorder for the page's life: `stop()` removes probes and
 * shortcuts only; `start()` reinstalls them on the same recorder.
 */
export interface CaptureController {
  /** The same object for the controller's whole life. */
  readonly session: ControlledCaptureSession;
  /** `true` while the probes are installed. */
  readonly on: boolean;
  /** Reinstalls the probes on the same recorder. No-op when on or disposed. */
  start(): void;
  /** Removes the probes; the buffer and (2.2, `D-37`) the chords stay. No-op when off. */
  stop(): void;
  /** Called with the new `on` after each real change. */
  onChange(listener: (on: boolean) => void): Unsubscribe;
  /** 2.2 (`C-11`): the chords in use, for Settings › About; `null` with `shortcuts: false`. */
  readonly shortcuts: ShortcutConfig | null;
  /** 2.2 (`C-11`): `stop()` and unbinds the chords, for good. Idempotent. */
  dispose(): void;
}

/**
 * 2.2 (`FR-BG-10`): what the Angular and React seams take — a session, `null`
 * (capture off), or a function read on each error, for a session that starts
 * after bootstrap (`installDebugActivation`: `() => debug.session`).
 */
export type CaptureSessionSource = CaptureSession | null | (() => CaptureSession | null);

/** C-2 — `createCaptureController(options)`; installs capture at once (HLD §6.6). */
export type CreateCaptureController = (options?: DebugCaptureOptions) => CaptureController;

/**
 * C-8 — the problem rule (`FR-ACT-04`), one definition shared by the
 * loader's badge and the panel model. S-01 implements it in core and exports
 * `isProblemEntry` from L5.
 */
export type IsProblemEntry = (entry: CaptureEntry) => boolean;
