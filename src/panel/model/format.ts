import { WebSocketEntry } from '../..';
import { ConsoleLevel, ConsoleRow, HttpRow, HttpStatusGroup, isPendingRow } from './state';

/**
 * Pure formatting for cells and the detail (FR-COM-03, §5.6). Deterministic:
 * no clock, no locale, no time zone of its own — the offset comes in.
 */

/** The colour role of a label; views map it to a `--dcp-` token. */
export type Tone = 'success' | 'info' | 'warning' | 'error' | 'muted' | 'text';

/** Icon **and** text, so status is never shown by colour alone (`NFR-A11Y-01`). */
export interface Label {
  readonly icon: string;
  readonly text: string;
  readonly tone: Tone;
}

/** Shown for a value that is not known (`null`, not a number). */
export const UNKNOWN = '—';

const DAY_MS = 86_400_000;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Clock time `14:03:27.412`. `utcOffsetMinutes` is local minus UTC (for the
 * browser's zone: `-new Date(t).getTimezoneOffset()`, worked out by the
 * caller, which may read globals).
 */
export function formatClock(t: number, utcOffsetMinutes: number): string {
  const local = t + utcOffsetMinutes * 60_000;
  if (!Number.isFinite(local)) return UNKNOWN;
  const ms = ((Math.floor(local) % DAY_MS) + DAY_MS) % DAY_MS;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms % 1000, 3)}`;
}

/** Time from `origin` (capture start), `+12.345 s`. Integer arithmetic, so no float rounding surprises. */
export function formatRelative(t: number, origin: number): string {
  const diff = t - origin;
  if (!Number.isFinite(diff)) return UNKNOWN;
  const ms = Math.round(Math.abs(diff));
  return `${diff < 0 ? '-' : '+'}${Math.floor(ms / 1000)}.${pad(ms % 1000, 3)} s`;
}

/** The Time setting (§4.10): clock time, or relative to capture start. */
export type TimeFormat =
  | { readonly mode: 'clock'; readonly utcOffsetMinutes: number }
  | { readonly mode: 'relative'; readonly origin: number };

export function formatTime(t: number, format: TimeFormat): string {
  return format.mode === 'clock' ? formatClock(t, format.utcOffsetMinutes) : formatRelative(t, format.origin);
}

const SIZE_UNITS = ['kB', 'MB', 'GB', 'TB'];

/** `0 B`, `412 B`, `3.2 kB`, `1.2 MB`: 1000-based, one decimal from 1 kB. */
export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return UNKNOWN;
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  let unit = 0;
  let tenths = Math.round(bytes / 100);
  // Pick the unit after rounding, so 999,960 B is `1.0 MB`, not `1000.0 kB`.
  // Each unit rounds from `bytes` itself: rounding a rounded value twice can be off by one tenth.
  while (tenths >= 10_000 && unit < SIZE_UNITS.length - 1) {
    unit++;
    tenths = Math.round(bytes / (100 * 1000 ** unit));
  }
  return `${Math.floor(tenths / 10)}.${tenths % 10} ${SIZE_UNITS[unit]}`;
}

/** `143 ms` below one second, then `2.04 s`. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return UNKNOWN;
  const whole = Math.round(ms);
  if (whole < 1000) return `${whole} ms`;
  const hundredths = Math.round(whole / 10);
  return `${Math.floor(hundredths / 100)}.${pad(hundredths % 100, 2)} s`;
}

/** The status chip a row belongs to, or `null` (1xx and other odd codes). */
export function httpStatusGroup(row: HttpRow): HttpStatusGroup | null {
  if (isPendingRow(row)) return 'pending';
  if (row.error !== null || row.status === null) return 'failed';
  if (row.status >= 500) return '5xx';
  if (row.status >= 400) return '4xx';
  if (row.status >= 300) return '3xx';
  if (row.status >= 200) return '2xx';
  return null;
}

const FAILED_TEXT = { abort: 'Aborted', timeout: 'Timeout', network: 'Failed' } as const;

/** The Status cell (§5.6): `200`, `Failed`, `Aborted`, `Timeout`, `Pending`, with icon and tone. */
export function httpStatusLabel(row: HttpRow): Label {
  const group = httpStatusGroup(row);
  switch (group) {
    case 'pending':
      return { icon: '◌', text: 'Pending', tone: 'muted' };
    case 'failed': {
      const error = isPendingRow(row) ? null : row.error;
      return { icon: '✕', text: FAILED_TEXT[error ?? 'network'], tone: 'error' };
    }
    case '5xx':
      return { icon: '✕', text: statusCode(row), tone: 'error' };
    case '4xx':
      return { icon: '⚠', text: statusCode(row), tone: 'warning' };
    case '2xx':
      return { icon: '✓', text: statusCode(row), tone: 'success' };
    default:
      return { icon: '↪', text: statusCode(row), tone: 'info' };
  }
}

function statusCode(row: HttpRow): string {
  return isPendingRow(row) ? '' : String(row.status);
}

/** Reason phrases for the detail's full status text (RFC 9110 and common extras). */
const REASONS: Readonly<Record<number, string>> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a Teapot",
  421: 'Misdirected Request',
  422: 'Unprocessable Content',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  511: 'Network Authentication Required',
};

/** The detail's status (§4.6): `500 Internal Server Error`, `Failed (network error)`, `Aborted`, `Timeout`, `Pending`. */
export function httpStatusText(row: HttpRow): string {
  const label = httpStatusLabel(row);
  if (isPendingRow(row) || httpStatusGroup(row) !== 'failed') {
    const reason = isPendingRow(row) || row.status === null ? undefined : REASONS[row.status];
    return reason === undefined ? label.text : `${label.text} ${reason}`;
  }
  return label.text === 'Failed' ? 'Failed (network error)' : label.text;
}

/**
 * The Name column (§5.6): last path segment + query, without scheme, host
 * or hash. A path that ends in `/` keeps its last segment with the slash.
 * Parsed by hand: `URL` is a global, and a captured URL may not parse.
 */
export function httpName(url: string): string {
  let rest = url;
  const hash = rest.indexOf('#');
  if (hash !== -1) rest = rest.slice(0, hash);
  const scheme = rest.indexOf('://');
  if (scheme !== -1) {
    const pathStart = rest.indexOf('/', scheme + 3);
    const queryStart = rest.indexOf('?', scheme + 3);
    const cut = pathStart === -1 ? queryStart : queryStart === -1 ? pathStart : Math.min(pathStart, queryStart);
    rest = cut === -1 ? '/' : rest.slice(cut);
    if (rest.charAt(0) === '?') rest = `/${rest}`;
  }
  const q = rest.indexOf('?');
  const path = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? '' : rest.slice(q);
  const trimmed = path.length > 1 && path.charAt(path.length - 1) === '/' ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf('/');
  const last = trimmed.slice(slash + 1);
  if (last === '') return path + query;
  return (trimmed === path ? last : `${last}/`) + query;
}

/** The direction / lifecycle label of a WebSocket row (§5.6): `↑ sent`, `■ closed 1000 "done"`. */
export function wsEventLabel(entry: WebSocketEntry): Label {
  switch (entry.event) {
    case 'send':
      return { icon: '↑', text: 'sent', tone: 'success' };
    case 'receive':
      return { icon: '↓', text: 'received', tone: 'info' };
    case 'open':
      return { icon: '●', text: 'opened', tone: 'muted' };
    case 'error':
      return { icon: '✕', text: 'error', tone: 'error' };
    case 'close': {
      let text = 'closed';
      if (entry.code !== null) text += ` ${entry.code}`;
      // JSON quoting: a reason with quotes or a line break stays one readable token.
      if (entry.data !== null && entry.data !== '') text += ` ${JSON.stringify(entry.data)}`;
      return { icon: '■', text, tone: 'muted' };
    }
    default: {
      const unknown: never = entry.event;
      return { icon: '•', text: String(unknown), tone: 'text' };
    }
  }
}

/** Error entries are level `error` (FR-CON-01); notes are `note` (FR-NOTE-02); app messages their own level (FR-MSG-05). */
export function consoleLevel(row: ConsoleRow): ConsoleLevel {
  return row.kind === 'error' ? 'error' : row.kind === 'note' ? 'note' : row.level;
}

const LEVEL_LABELS: Readonly<Record<ConsoleLevel, Label>> = {
  note: { icon: '✎', text: 'note', tone: 'info' },
  error: { icon: '✕', text: 'error', tone: 'error' },
  warn: { icon: '⚠', text: 'warn', tone: 'warning' },
  info: { icon: 'ℹ', text: 'info', tone: 'info' },
  log: { icon: '•', text: 'log', tone: 'text' },
  debug: { icon: '⋯', text: 'debug', tone: 'muted' },
};

export function consoleLevelLabel(level: ConsoleLevel): Label {
  return LEVEL_LABELS[level];
}

/**
 * The message of a console row: string arguments as they are, the others as
 * compact JSON (they are JSON-safe clones), joined by spaces — like the
 * DevTools console line. Errors: their message.
 */
export function consoleText(row: ConsoleRow): string {
  if (row.kind === 'error') return row.message;
  if (row.kind === 'note') return row.title && row.text ? `${row.title} — ${row.text}` : row.title || row.text;
  // FR-MSG-05: the type, then the data as compact JSON (none for null).
  if (row.kind === 'app') return row.data === null ? row.type : `${row.type} ${JSON.stringify(row.data)}`;
  return row.args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}

/**
 * One line for a fixed-height row: each run of white space that holds a line
 * break becomes one space; longer than `max` → cut with `…`. Keeps the DOM
 * text small; the detail shows the whole value.
 */
export function preview(text: string, max = 200): string {
  const line = text.replace(/\s*[\r\n]\s*/g, ' ');
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
