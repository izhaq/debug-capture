import {
  AppMessageEntry,
  CaptureEntry,
  ErrorEntry,
  HttpEntry,
  LogEntry,
  LogLevel,
  NoteEntry,
  PendingRequest,
  WebSocketEntry,
} from '../..';

/** The three lists of the panel: Network › HTTP, Network › WebSocket messages, Console. */
export type ListId = 'http' | 'ws' | 'console';

/**
 * One row of the HTTP list: a finished request, or one still in flight
 * (`FR-HTTP-02`). Tell them apart with `isPendingRow`.
 */
export type HttpRow = HttpEntry | PendingRequest;

/** One row of the Console list: a console call, an error (`FR-CON-01`), a note (`FR-NOTE-02`) or an app message (`FR-MSG-05`). */
export type ConsoleRow = LogEntry | ErrorEntry | NoteEntry | AppMessageEntry;

/** A Console level chip: a log level, or `app` for the host's own messages (2.3, `FR-MSG-05`). */
export type ConsoleChip = LogLevel | 'app';

/** What the Console's level column shows: a log level, or `note` (never filtered by the level chips). */
export type ConsoleLevel = LogLevel | 'note';

/** The row type of each list, so `select('ws', row)` only takes a WebSocket entry. */
export interface RowOf {
  readonly http: HttpRow;
  readonly ws: WebSocketEntry;
  readonly console: ConsoleRow;
}

/** `true` for an in-flight request (it has no `kind` — only entries do). */
export function isPendingRow(row: HttpRow): row is PendingRequest {
  return !('kind' in row);
}

/**
 * A stable, unique key for a row (for `getKey` of the virtual list): the
 * entry's `seq`, or `p` + the pending id. The prefix keeps a pending id from
 * ever equalling a `seq`.
 */
export function rowKey(row: HttpRow | WebSocketEntry | ConsoleRow): string {
  return 'kind' in row ? String(row.seq) : `p${row.id}`;
}

/** The HTTP status chips (`FR-HTTP-03`). `failed` = network error, abort or timeout. */
export type HttpStatusGroup = '2xx' | '3xx' | '4xx' | '5xx' | 'failed' | 'pending';

/** WebSocket direction chips (`FR-WS-03`). */
export type WsDirection = 'sent' | 'received';

/** The HTTP list's sortable columns (§5.6, `D-18`). */
export type HttpSortKey = 'time' | 'method' | 'status' | 'name' | 'type' | 'size' | 'duration';

/**
 * A column sort on the HTTP list (`D-18`); `null` in the state = start order.
 * Not kept in settings: it resets on reload, like the search text (`D-20`).
 */
export interface HttpSort {
  readonly key: HttpSortKey;
  readonly dir: 'asc' | 'desc';
}

/**
 * Filters per list (§4.5). Chip arrays combine with OR inside a group; an
 * **empty array means "All"** (no restriction). Groups and the text combine
 * with AND. `text` is a case-insensitive "contains".
 */
export interface HttpFilter {
  /** Looks in URL, method and status. */
  readonly text: string;
  readonly status: readonly HttpStatusGroup[];
  readonly type: readonly ('xhr' | 'fetch')[];
}

export interface WsFilter {
  /** Looks in the message data. A chip that is set hides lifecycle rows (open, close, error). */
  readonly text: string;
  readonly direction: readonly WsDirection[];
  readonly data: readonly ('text' | 'binary')[];
}

export interface ConsoleFilter {
  /** Looks in the message text and the error source. */
  readonly text: string;
  /** Error entries count as `error`. `app` picks app messages, which the level chips never hide. */
  readonly levels: readonly ConsoleChip[];
}

export interface PanelFilters {
  readonly http: HttpFilter;
  readonly ws: WsFilter;
  readonly console: ConsoleFilter;
}

/** No filter at all: every row shows. Also what `clearFilters(list)` restores. */
export const EMPTY_FILTERS: PanelFilters = Object.freeze({
  http: Object.freeze({ text: '', status: Object.freeze([]), type: Object.freeze([]) }),
  ws: Object.freeze({ text: '', direction: Object.freeze([]), data: Object.freeze([]) }),
  console: Object.freeze({ text: '', levels: Object.freeze([]) }),
});

/**
 * The selected row of a list. `removed` is `true` once the row left the
 * buffer (evicted, cleared, or a pending request that ended without an
 * entry): the detail keeps showing `row` with the note "This entry was
 * removed from the buffer" (§4.4, §4.11).
 */
export interface Selected<T> {
  readonly row: T;
  readonly removed: boolean;
}

export type PanelSelection = { readonly [L in ListId]: Selected<RowOf[L]> | null };

/** The whole capture buffer, for the status bar (`FR-BAR-06`). Never frozen by pause. */
export interface BufferState {
  /** Entries in the buffer now. */
  readonly used: number;
  /** The buffer size now (C-9); `Infinity` = No limit. */
  readonly capacity: number;
  /** Entries in the buffer that are problems (`IsProblemEntry`, `D-21`). */
  readonly problems: number;
  /** As `CaptureStats`, since the last clear. */
  readonly recorded: number;
  readonly dropped: number;
  readonly evicted: number;
  readonly failed: number;
}

/**
 * Everything the panel shows, as one immutable (frozen) snapshot. A new
 * object after each change; parts that did not change keep their identity,
 * so memoised selectors and `setItems` skip work.
 */
export interface PanelState {
  /**
   * What the lists show, oldest first: the buffer, or while paused the frozen
   * view (rows that left the buffer still disappear — `D-19`).
   */
  readonly entries: readonly CaptureEntry[];
  /** In-flight requests the HTTP list shows, oldest first (frozen while paused, emptied by clear). */
  readonly pending: readonly PendingRequest[];
  readonly buffer: BufferState;
  readonly captureOn: boolean;
  /** `policy.redactedValue`, for the redaction marks. */
  readonly redactedValue: string;
  readonly paused: boolean;
  /** `Paused · N new`: entries that arrived while paused, at most `capacity`. 0 when not paused. */
  readonly newSincePause: number;
  readonly filters: PanelFilters;
  /** The HTTP list's column sort; `null` = start order (`D-18`). Filters apply on top. */
  readonly httpSort: HttpSort | null;
  readonly selection: PanelSelection;
  /** Which socket's messages the WebSocket list shows; `'all'` = every socket (`FR-WS-05`). */
  readonly wsConnection: number | 'all';
}
