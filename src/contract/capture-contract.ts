/**
 * The whole shared vocabulary of the debug-capture layer. Every other layer
 * builds on these types; nothing here has behavior beyond a few frozen
 * constants. A change here is a change to every PR in
 * specs/4-debug-capture — update the plan with it.
 */

/** Bumped on any breaking change to the exported file shape. */
export const CAPTURE_SCHEMA_VERSION = 1;

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** The console methods the console probe wraps, in a stable order. */
export const LOG_LEVELS: readonly LogLevel[] = Object.freeze(['log', 'info', 'warn', 'error', 'debug']);

/** What survives JSON.stringify unchanged — the shape stored entries use. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

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
}

export type WebSocketEvent = 'open' | 'send' | 'receive' | 'close' | 'error';

/** One entry per socket event; `socketId` groups the frames of one connection. */
export interface WebSocketEntry extends CaptureEntryBase {
  readonly kind: 'ws';
  /** 1-based per probe install, in creation order. */
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

/** Discriminated on `kind`. Switch over it with a `never` default to stay exhaustive. */
export type CaptureEntry = LogEntry | HttpEntry | WebSocketEntry | ErrorEntry;

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
  | Omit<ErrorEntry, 'seq'>;

/**
 * Every rule about what gets kept and how, in one reviewable place. Applied
 * by the recorder on the way INTO the buffer — so an exported file can never
 * hold anything the policy removed.
 */
export interface CapturePolicy {
  /** Ring-buffer size; the oldest entry is evicted beyond it. Integer ≥ 1. */
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
  readonly entries: readonly CaptureEntry[];
}

/** Chords like `ctrl+alt+shift+d`. Matched on `KeyboardEvent.code`, so keyboard layout does not matter. */
export interface ShortcutConfig {
  readonly download: string;
  readonly copy: string;
  readonly clear: string;
}

/** Three modifiers, to stay clear of browser and OS shortcuts (Ctrl+Shift+D bookmarks all tabs in Chrome). */
export const DEFAULT_SHORTCUTS: ShortcutConfig = Object.freeze({
  download: 'ctrl+alt+shift+d',
  copy: 'ctrl+alt+shift+c',
  clear: 'ctrl+alt+shift+x',
});

export interface DebugCaptureOptions {
  readonly policy?: Partial<CapturePolicy>;
  /** `false` disables keyboard shortcuts. */
  readonly shortcuts?: Partial<ShortcutConfig> | false;
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
