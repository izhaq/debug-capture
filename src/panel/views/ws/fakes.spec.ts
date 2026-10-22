/**
 * Spec helpers for the WebSocket view: entry builders and a stage that mounts
 * the view in a shadow root with the real theme sheet, a real store and a
 * fake data source. A `.spec.ts` file, so the build never ships it. Built on
 * the P2 barrel only: a view folder may import nothing else (`lint:layers` rule 4).
 */
import {
  CaptureEntry,
  createPanelStore,
  createThemeSheet,
  JSON_VIEWER_CSS,
  LogEntry,
  PanelDataEvent,
  PanelDataSource,
  PanelStore,
  PanelView,
  ViewSettings,
  VIRTUAL_LIST_CSS,
  WebSocketEntry,
  WsFilter,
} from '../../ui';
import { createWsView, WS_VIEW_CSS } from './index';

/** A WebSocket entry; `t` grows with `seq`. Default: a text frame received on socket 1. */
export function ws(seq: number, extra: Partial<Omit<WebSocketEntry, 'kind' | 'seq'>> = {}): WebSocketEntry {
  return Object.freeze({
    kind: 'ws',
    seq,
    t: 1_000 + seq * 10,
    socketId: 1,
    url: `wss://app.test/live/${extra.socketId ?? 1}`,
    event: 'receive',
    opcode: 'text',
    bytes: 5,
    data: 'hello',
    code: null,
    ...extra,
  });
}

const LIFECYCLE = { opcode: null, bytes: null, data: null, code: null } as const;

export const opened = (seq: number, socketId = 1): WebSocketEntry => ws(seq, { ...LIFECYCLE, socketId, event: 'open' });

export const closed = (
  seq: number,
  socketId = 1,
  code: number | null = 1000,
  reason: string | null = 'done',
): WebSocketEntry => ws(seq, { ...LIFECYCLE, socketId, event: 'close', code, data: reason });

export const failed = (seq: number, socketId = 1): WebSocketEntry =>
  ws(seq, { ...LIFECYCLE, socketId, event: 'error' });

export function log(seq: number): LogEntry {
  return Object.freeze({ kind: 'log', seq, t: 1_000 + seq * 10, level: 'log', args: ['x'] });
}

export const SETTINGS: ViewSettings = { time: { mode: 'clock', utcOffsetMinutes: 0 }, rowHeight: 22, dock: 'bottom' };

/**
 * The layout `VIEW_CSS` gives the shared view chrome. A view folder cannot
 * import `views/view.ts` (rule 4), so the stage restates the few rules the
 * lists need to get a height; `views/view.spec.ts` checks the real ones.
 */
const LAYOUT =
  '.dcp-view,.dcp-list-pane{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}' +
  '.dcp-list-pane{position:relative}' +
  '.dcp-detail{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}' +
  '.dcp-detail-body{flex:1 1 auto;min-height:0;overflow:auto}';

export interface StageOptions {
  readonly entries?: readonly CaptureEntry[];
  readonly settings?: ViewSettings;
  /** Panel height in px; default 300. */
  readonly height?: number;
  /** What `copyText` resolves to; default `true`. */
  readonly copyResult?: boolean | 'reject';
  /** The WebSocket filter the store starts with (as restored from settings, `D-20`). */
  readonly filters?: Partial<WsFilter>;
}

export interface Stage {
  readonly view: PanelView;
  readonly store: PanelStore;
  readonly root: ShadowRoot;
  /** Each `source.copyText` call. */
  readonly copied: { readonly text: string; readonly root: ShadowRoot }[];
  /** Each `deps.report` call. */
  readonly reported: unknown[];
  /** Applies source events, as the frame does once per frame. */
  apply(...events: PanelDataEvent[]): void;
  /** Runs the debounce tasks waiting in the fake `schedule`. */
  runTimers(): void;
  q<T extends Element = HTMLElement>(selector: string): T;
  all<T extends Element = HTMLElement>(selector: string): T[];
  /** The rendered message rows, top to bottom. */
  rowEls(): HTMLElement[];
  rowEl(index: number): HTMLElement;
  /** Each rendered message row as its cells' text. */
  rows(): string[][];
  /** The cells of one message column, top to bottom. */
  cells(column: number): HTMLElement[];
  /** The rendered connection rows, top to bottom. */
  connEls(): HTMLElement[];
  connEl(index: number): HTMLElement;
  /** Each rendered connection row as the text of its lines. */
  conns(): string[][];
  click(target: Element | null): void;
  key(target: Element | null, key: string, init?: KeyboardEventInit): KeyboardEvent;
}

const hosts: HTMLElement[] = [];
const views: { destroy(): void }[] = [];

/** Destroys every stage's view and removes its host; call in `afterEach`. */
export function cleanup(): void {
  for (const view of views.splice(0)) view.destroy();
  for (const host of hosts.splice(0)) host.remove();
}

export function stage(options: StageOptions = {}): Stage {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [createThemeSheet(document, [VIRTUAL_LIST_CSS, JSON_VIEWER_CSS, LAYOUT, WS_VIEW_CSS])];
  const panel = document.createElement('div');
  panel.className = 'dcp-root';
  panel.setAttribute('data-theme', 'dark');
  panel.style.cssText = `display:flex;flex-direction:column;width:1000px;height:${options.height ?? 300}px`;
  root.appendChild(panel);

  const copied: { text: string; root: ShadowRoot }[] = [];
  const reported: unknown[] = [];
  const timers: (() => void)[] = [];
  const result = options.copyResult ?? true;
  const source: PanelDataSource = {
    snapshot: () => options.entries ?? [],
    pending: () => [],
    stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
    capacity: () => 5_000,
    redactedValue: () => '[redacted]',
    subscribe: () => () => undefined,
    clear: () => undefined,
    exportJson: () => '{}',
    download: () => undefined,
    copyText: (text, into) => {
      copied.push({ text, root: into });
      return result === 'reject' ? Promise.reject(new Error('copy failed')) : Promise.resolve(result);
    },
    capture: { on: true, start: () => undefined, stop: () => undefined },
  };
  const store = createPanelStore({
    source,
    isProblemEntry: () => false,
    filters: options.filters ? { ws: options.filters } : undefined,
  });
  const view = createWsView({
    document,
    root,
    source,
    store,
    settings: options.settings ?? SETTINGS,
    // The lists render scroll and `setItems` at once; only resizes wait for a frame.
    requestFrame: () => undefined,
    schedule: (task) => {
      timers.push(task);
      return () => {
        const at = timers.indexOf(task);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    report: (error) => reported.push(error),
  });
  panel.appendChild(view.element);
  views.push(view);
  // The frame renders once per frame after a change; the stage renders at once.
  store.subscribe((state) => view.update(state));
  view.update(store.getState());

  const q = <T extends Element = HTMLElement>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (found === null) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  const all = <T extends Element = HTMLElement>(selector: string): T[] =>
    Array.from(root.querySelectorAll<T>(selector));
  const rowsIn = (pane: string): HTMLElement[] =>
    all(`${pane} .dcp-vlist__body > [role="row"]`)
      .filter((row) => !row.hidden)
      .sort((a, b) => Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')));
  const nth = (rows: HTMLElement[], index: number): HTMLElement => {
    const row = rows[index];
    if (row === undefined) throw new Error(`no row ${index}`);
    return row;
  };
  const rowEls = (): HTMLElement[] => rowsIn('.dcp-list-pane');
  const connEls = (): HTMLElement[] => rowsIn('.dcp-ws-conns');
  return {
    view,
    store,
    root,
    copied,
    reported,
    apply: (...events) => store.apply(events),
    runTimers: () => {
      for (const task of timers.splice(0)) task();
    },
    q,
    all,
    rowEls,
    rowEl: (index) => nth(rowEls(), index),
    rows: () => rowEls().map((row) => Array.from(row.children, (cell) => cell.textContent ?? '')),
    cells: (column) => rowEls().map((row) => row.children[column] as HTMLElement),
    connEls,
    connEl: (index) => nth(connEls(), index),
    conns: () =>
      connEls().map((row) => {
        const cell = row.children[0];
        const lines = cell === undefined ? [] : Array.from(cell.children, (line) => line.textContent ?? '');
        return lines.length > 0 ? lines : [cell?.textContent ?? ''];
      }),
    click: (target) => {
      if (target === null) throw new Error('nothing to click');
      // A real click: `HTMLElement.click()` dispatches a trusted-shaped MouseEvent that bubbles.
      (target as HTMLElement).click();
    },
    key: (target, key, init = {}) => {
      if (target === null) throw new Error('no key target');
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...init });
      target.dispatchEvent(event);
      return event;
    },
  };
}
