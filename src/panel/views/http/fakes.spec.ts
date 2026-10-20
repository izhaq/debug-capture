/**
 * Spec helpers for the HTTP view: entry builders and a stage that mounts the
 * view in a shadow root with the real theme sheet, a real store and a fake
 * data source. A `.spec.ts` file, so the build never ships it. Built on the
 * P2 barrel only: a view folder may import nothing else (`lint:layers` rule 4).
 */
import {
  CaptureEntry,
  createPanelStore,
  createThemeSheet,
  HttpEntry,
  HttpFilter,
  JSON_VIEWER_CSS,
  LogEntry,
  PanelDataEvent,
  PanelDataSource,
  PanelStore,
  PanelView,
  PendingRequest,
  ViewSettings,
  VIRTUAL_LIST_CSS,
} from '../../ui';
import { createHttpView, HTTP_VIEW_CSS } from './index';

/** A finished request; `t` grows with `seq`, so start order is `seq` order unless a spec says otherwise. */
export function http(seq: number, extra: Partial<Omit<HttpEntry, 'kind' | 'seq'>> = {}): HttpEntry {
  return Object.freeze({
    kind: 'http',
    seq,
    t: 1_000 + seq * 10,
    transport: 'fetch',
    method: 'GET',
    url: `https://app.test/api/items/${seq}?page=1`,
    status: 200,
    durationMs: 12,
    reqHeaders: {},
    resHeaders: {},
    reqBody: null,
    resBody: null,
    bytes: 100,
    error: null,
    ...extra,
  });
}

export function pending(id: number, extra: Partial<Omit<PendingRequest, 'id'>> = {}): PendingRequest {
  return Object.freeze({
    id,
    t: 5_000 + id,
    transport: 'xhr',
    method: 'POST',
    url: `https://app.test/api/slow/${id}`,
    reqHeaders: {},
    ...extra,
  });
}

export function log(seq: number): LogEntry {
  return Object.freeze({ kind: 'log', seq, t: 1_000 + seq * 10, level: 'log', args: ['x'] });
}

export const SETTINGS: ViewSettings = { time: { mode: 'clock', utcOffsetMinutes: 0 }, rowHeight: 22, dock: 'bottom' };

/**
 * The layout `VIEW_CSS` gives the shared view chrome. A view folder cannot
 * import `views/view.ts` (rule 4), so the stage restates the few rules the
 * list needs to get a height; `views/view.spec.ts` checks the real ones.
 */
const LAYOUT =
  '.dcp-view,.dcp-list-pane{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}' +
  '.dcp-list-pane{position:relative}' +
  '.dcp-detail{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}' +
  '.dcp-detail-body{flex:1 1 auto;min-height:0;overflow:auto}';

export interface StageOptions {
  readonly entries?: readonly CaptureEntry[];
  readonly pending?: readonly PendingRequest[];
  readonly settings?: ViewSettings;
  /** Panel height in px; default 300. */
  readonly height?: number;
  /** What `copyText` resolves to; default `true`. */
  readonly copyResult?: boolean | 'reject';
  /** The HTTP filter the store starts with (as restored from settings, `D-20`). */
  readonly filters?: Partial<HttpFilter>;
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
  /** Runs the callbacks waiting in the fake `requestFrame`. */
  flushFrames(): void;
  q<T extends Element = HTMLElement>(selector: string): T;
  all<T extends Element = HTMLElement>(selector: string): T[];
  /** The rendered list rows, top to bottom. */
  rowEls(): HTMLElement[];
  rowEl(index: number): HTMLElement;
  /** Each rendered row as its cells' text. */
  rows(): string[][];
  /** The cells of one column, top to bottom. */
  cells(column: number): HTMLElement[];
  /** The column header cell with this label. */
  header(label: string): HTMLElement;
  click(target: Element | null): void;
  key(target: Element | null, key: string, init?: KeyboardEventInit): KeyboardEvent;
}

const hosts: HTMLElement[] = [];

/** Removes every stage's host; call in `afterEach`. */
export function cleanup(): void {
  for (const host of hosts.splice(0)) host.remove();
}

export function stage(options: StageOptions = {}): Stage {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [createThemeSheet(document, [VIRTUAL_LIST_CSS, JSON_VIEWER_CSS, LAYOUT, HTTP_VIEW_CSS])];
  const panel = document.createElement('div');
  panel.className = 'dcp-root';
  panel.setAttribute('data-theme', 'dark');
  panel.style.cssText = `display:flex;flex-direction:column;width:900px;height:${options.height ?? 300}px`;
  root.appendChild(panel);

  const copied: { text: string; root: ShadowRoot }[] = [];
  const reported: unknown[] = [];
  const timers: (() => void)[] = [];
  const frames: (() => void)[] = [];
  const result = options.copyResult ?? true;
  const source: PanelDataSource = {
    snapshot: () => options.entries ?? [],
    pending: () => options.pending ?? [],
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
    filters: options.filters ? { http: options.filters } : undefined,
  });
  const view = createHttpView({
    document,
    root,
    source,
    store,
    settings: options.settings ?? SETTINGS,
    requestFrame: (callback) => frames.push(callback),
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
  const rowEls = (): HTMLElement[] =>
    all('.dcp-vlist__body > [role="row"]')
      .filter((row) => !row.hidden)
      .sort((a, b) => Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')));
  const stageApi: Stage = {
    view,
    store,
    root,
    copied,
    reported,
    apply: (...events) => store.apply(events),
    runTimers: () => {
      for (const task of timers.splice(0)) task();
    },
    flushFrames: () => {
      for (const frame of frames.splice(0)) frame();
    },
    q,
    all,
    rowEls,
    rowEl: (index) => {
      const row = rowEls()[index];
      if (row === undefined) throw new Error(`no row ${index}`);
      return row;
    },
    rows: () => rowEls().map((row) => Array.from(row.children, (cell) => cell.textContent ?? '')),
    cells: (column) => rowEls().map((row) => row.children[column] as HTMLElement),
    header: (label) => {
      const found = all('[role="columnheader"]').find((cell) => cell.textContent === label);
      if (found === undefined) throw new Error(`no header ${label}`);
      return found;
    },
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
  return stageApi;
}
