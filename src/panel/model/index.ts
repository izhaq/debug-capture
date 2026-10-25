/**
 * P1 panel model barrel — all of the panel's logic, pure: no DOM, no timers,
 * no globals, no packages (HLD §6.2). Views (P3) and the app (P4) only render
 * what this layer computes. Re-exports the L5 barrel, so the layers below
 * need a single import path.
 *
 * The API, in the order a panel uses it:
 * - **Data source** — `createLocalDataSource(controller, deps?)` → `PanelDataSource`
 *   (snapshot, pending, events, clear, export, copy and download into the shadow root).
 * - **Store** — `createPanelStore({ source, isProblemEntry, filters? })` → `PanelStore`:
 *   `apply(events)`, `getState()`, `subscribe(fn)`; actions `setFilter`, `clearFilters`,
 *   `select`, `clearSelection`, `moveSelection`, `selectConnection`, `setHttpSort`, `pause`, `resume`.
 *   State types: `PanelState`, `BufferState`, `PanelFilters` (+ `HttpFilter`, `WsFilter`,
 *   `ConsoleFilter`), `HttpSort`, `Selected`, `ListId`, `RowOf`, `HttpRow`, `ConsoleRow`.
 * - **Selectors** (memoised: same input → same frozen array) — `selectHttpRows` (start
 *   order or the column sort, `D-18`), `selectWsConnections`, `selectWsMessages`,
 *   `selectConsoleRows`, `selectRows(state, list)`,
 *   `selectListCounts(state, list)`. Buffer figures for the status bar: `state.buffer`.
 * - **Rows** — `isPendingRow`, `rowKey` (virtual list `getKey`).
 * - **Search** — `matchRanges` (highlight), `toggleChip` (chip click; `[]` = All).
 * - **Format** — `formatTime` / `formatClock` / `formatRelative`, `formatSize`,
 *   `formatDuration`, `httpStatusLabel` / `httpStatusText` / `httpStatusGroup`, `httpName`,
 *   `wsEventLabel`, `consoleLevel` / `consoleLevelLabel`, `consoleText`, `preview`.
 *   Labels are `{ icon, text, tone }`; map `tone` to a `--dcp-` colour.
 * - **Bodies** — `describeBody` (json / form / text / descriptor / empty, with its
 *   `truncation`), `splitTruncation`, `isRedacted`, `redactedRanges`.
 * - **cURL** — `toCurl(row, redactedValue)`, `shellQuote`.
 *
 * Usage (P4 wiring; `requestFrame` is P4's rAF scheduler):
 *
 * ```ts
 * const source = createLocalDataSource(controller);
 * const store = createPanelStore({ source, isProblemEntry });   // reads snapshot() + pending()
 * const queue: PanelDataEvent[] = [];
 * const off = source.subscribe((event) => queue.push(event));    // subscribe right after, same task
 * const flush = (): void => store.apply(queue.splice(0));        // once per frame (§6.3)
 * store.subscribe((state) => {
 *   httpList.setItems(selectHttpRows(state));                    // same array → nothing to do
 *   statusBar.show(selectListCounts(state, 'http'), state.buffer, state.captureOn);
 * });
 * store.setFilter('http', { text: 'api', status: ['5xx', 'failed'] });
 * store.moveSelection('http', 1);                                // ↓ key
 * ```
 */
export * from '../..';

export type { PanelDataEvent, PanelDataSource } from './panel-data-source';

export { createLocalDataSource } from './local-data-source';
export type { LocalDataSourceDeps } from './local-data-source';

export { createPanelStore } from './store';
export type { PanelStore, PanelStoreOptions, SelectionMove } from './store';

export { EMPTY_FILTERS, isPendingRow, rowKey } from './state';
export type {
  BufferState,
  ConsoleFilter,
  ConsoleLevel,
  ConsoleRow,
  HttpFilter,
  HttpRow,
  HttpSort,
  HttpSortKey,
  HttpStatusGroup,
  ListId,
  PanelFilters,
  PanelSelection,
  PanelState,
  RowOf,
  Selected,
  WsDirection,
  WsFilter,
} from './state';

export {
  selectConsoleRows,
  selectHttpRows,
  selectListCounts,
  selectRows,
  selectWsConnections,
  selectWsMessages,
} from './selectors';
export type { ListCounts, WsConnection } from './selectors';

export { foldCase, matchRanges, toggleChip } from './filters';
export type { TextRange } from './filters';

export {
  UNKNOWN,
  consoleLevel,
  consoleLevelLabel,
  consoleText,
  formatClock,
  formatDuration,
  formatRelative,
  formatSize,
  formatTime,
  httpName,
  httpStatusGroup,
  httpStatusLabel,
  httpStatusText,
  preview,
  wsEventLabel,
} from './format';
export type { Label, TimeFormat, Tone } from './format';

export { describeBody, isRedacted, redactedRanges, splitTruncation } from './body';
export type { BodyView, DescribeBodyOptions, FormField, Truncation } from './body';

export { shellQuote, toCurl } from './curl';
