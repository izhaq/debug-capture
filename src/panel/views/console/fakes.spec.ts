/**
 * Spec helpers for the Console view: entry builders and a stage that mounts
 * the view in a shadow root with the real theme sheet, a real store and a
 * fake data source (as S-05's stage). A `.spec.ts` file, so the build never
 * ships it. Built on the P2 barrel only (`lint:layers` rule 4).
 */
import {
  CaptureEntry,
  ConsoleFilter,
  createPanelStore,
  createThemeSheet,
  ErrorEntry,
  HttpEntry,
  JSON_VIEWER_CSS,
  JsonValue,
  LogEntry,
  LogLevel,
  PanelDataEvent,
  PanelDataSource,
  PanelStore,
  PanelView,
  ViewSettings,
  VIRTUAL_LIST_CSS,
} from '../../ui';
import { CONSOLE_VIEW_CSS, createConsoleView } from './index';

/** A console call; `t` grows with `seq`. */
export function log(seq: number, level: LogLevel = 'log', args: readonly JsonValue[] = [`message ${seq}`]): LogEntry {
  return Object.freeze({ kind: 'log', seq, t: 1_000 + seq * 10, level, args });
}

/** An error entry, as the error probes record it. */
export function error(seq: number, extra: Partial<Omit<ErrorEntry, 'kind' | 'seq'>> = {}): ErrorEntry {
  return Object.freeze({
    kind: 'error',
    seq,
    t: 1_000 + seq * 10,
    source: 'window',
    message: `TypeError: failure ${seq}`,
    stack: null,
    ...extra,
  });
}

/** Not a console row: the Console list never shows it. */
export function http(seq: number): HttpEntry {
  return Object.freeze({
    kind: 'http',
    seq,
    t: 1_000 + seq * 10,
    transport: 'fetch',
    method: 'GET',
    url: `https://app.test/api/${seq}`,
    status: 200,
    durationMs: 1,
    reqHeaders: {},
    resHeaders: {},
    reqBody: null,
    resBody: null,
    bytes: 1,
    error: null,
  });
}

export const SETTINGS: ViewSettings = { time: { mode: 'clock', utcOffsetMinutes: 0 }, rowHeight: 22, dock: 'bottom' };

/** The few `VIEW_CSS` layout rules the list needs for a height (a view folder cannot import `views/view.ts`). */
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
  /** The Console filter the store starts with (as restored from settings, `D-20`). */
  readonly filters?: Partial<ConsoleFilter>;
}

export interface Stage {
  readonly view: PanelView;
  readonly store: PanelStore;
  readonly root: ShadowRoot;
  /** Each `deps.report` call. */
  readonly reported: unknown[];
  /** Applies source events, as the frame does once per frame. */
  apply(...events: PanelDataEvent[]): void;
  /** Runs the debounce tasks waiting in the fake `schedule`. */
  runTimers(): void;
  q<T extends Element = HTMLElement>(selector: string): T;
  all<T extends Element = HTMLElement>(selector: string): T[];
  /** The rendered list rows, top to bottom. */
  rowEls(): HTMLElement[];
  rowEl(index: number): HTMLElement;
  /** Each rendered row as its cells' text. */
  rows(): string[][];
  /** The cells of one column, top to bottom. */
  cells(column: number): HTMLElement[];
  click(target: Element | null): void;
  key(target: Element | null, key: string, init?: KeyboardEventInit): KeyboardEvent;
}

const hosts: HTMLElement[] = [];
const views: { destroy(): void }[] = [];

/** Destroys every stage's view and removes its host; call in `afterEach` (views left alive slow later timing specs). */
export function cleanup(): void {
  for (const view of views.splice(0)) view.destroy();
  for (const host of hosts.splice(0)) host.remove();
}

export function stage(options: StageOptions = {}): Stage {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [createThemeSheet(document, [VIRTUAL_LIST_CSS, JSON_VIEWER_CSS, LAYOUT, CONSOLE_VIEW_CSS])];
  const panel = document.createElement('div');
  panel.className = 'dcp-root';
  panel.setAttribute('data-theme', 'dark');
  panel.style.cssText = `display:flex;flex-direction:column;width:900px;height:${options.height ?? 300}px`;
  root.appendChild(panel);

  const reported: unknown[] = [];
  const timers: (() => void)[] = [];
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
    copyText: () => Promise.resolve(true),
    capture: { on: true, start: () => undefined, stop: () => undefined },
  };
  const store = createPanelStore({
    source,
    isProblemEntry: () => false,
    filters: options.filters ? { console: options.filters } : undefined,
  });
  const view = createConsoleView({
    document,
    root,
    source,
    store,
    settings: options.settings ?? SETTINGS,
    requestFrame: () => undefined,
    schedule: (task) => {
      timers.push(task);
      return () => {
        const at = timers.indexOf(task);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    report: (problem) => reported.push(problem),
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
  const rowEls = (): HTMLElement[] =>
    all('.dcp-vlist__body > [role="row"]')
      .filter((row) => !row.hidden)
      .sort((a, b) => Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')));
  return {
    view,
    store,
    root,
    reported,
    apply: (...events) => store.apply(events),
    runTimers: () => {
      for (const task of timers.splice(0)) task();
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
    click: (target) => {
      if (target === null) throw new Error('nothing to click');
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
