/**
 * Fakes for the P4 specs: a frame scope whose frames and timers run only when
 * the spec says so, a data source the spec drives by hand, a `Storage`, and
 * views that record every call. Built on the contract types only. A `.spec.ts`
 * file, so the build never ships it.
 */
import type {
  CaptureController,
  CaptureEntry,
  CaptureStats,
  CreateView,
  ErrorEntry,
  ListId,
  LogEntry,
  PanelDataEvent,
  PanelDataSource,
  PanelState,
  PanelView,
  ViewDeps,
  ViewSettings,
} from './index';
import type { FrameDeps } from './frame';
import type { MountPanelUiOptions } from './mount-panel-ui';
import type { FrameScope } from './scheduler';
import type { SettingsStorage } from './settings';

export function logEntry(seq: number, extra: Partial<Omit<LogEntry, 'kind' | 'seq'>> = {}): LogEntry {
  return Object.freeze({ kind: 'log', seq, t: 1_000 + seq, level: 'log', args: ['message', seq], ...extra });
}

export function errorEntry(seq: number): ErrorEntry {
  return Object.freeze({ kind: 'error', seq, t: 1_000 + seq, source: 'window', message: `Boom ${seq}`, stack: null });
}

/** Frames and timers that run only on `frame()` / `tick()`. */
export class ManualScope implements FrameScope {
  readonly frames = new Map<number, FrameRequestCallback>();
  readonly timers = new Map<number, { readonly callback: () => void; readonly delayMs: number }>();
  private next = 1;

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = this.next++;
    this.frames.set(id, callback);
    return id;
  }
  cancelAnimationFrame(handle: number): void {
    this.frames.delete(handle);
  }
  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.next++;
    this.timers.set(id, { callback, delayMs });
    return id;
  }
  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }
  /** Runs the frames requested so far (not the ones they request); returns how many ran. */
  frame(): number {
    const due = Array.from(this.frames.values());
    this.frames.clear();
    due.forEach((callback) => callback(0));
    return due.length;
  }
  /** Runs the timers set so far. */
  tick(): void {
    const due = Array.from(this.timers.values());
    this.timers.clear();
    due.forEach((timer) => timer.callback());
  }
}

/** A `PanelDataSource` the spec drives; `calls` logs clear, export and capture calls. */
export class FakeSource implements PanelDataSource {
  entries: CaptureEntry[] = [];
  statsValue: CaptureStats = { recorded: 0, dropped: 0, evicted: 0, failed: 0 };
  on = true;
  readonly calls: string[] = [];
  readonly listeners = new Set<(event: PanelDataEvent) => void>();
  downloadRoot: ShadowRoot | null = null;
  copyRoot: ShadowRoot | null = null;
  readonly capture: PanelDataSource['capture'];

  constructor() {
    const isOn = (): boolean => this.on;
    this.capture = {
      get on(): boolean {
        return isOn();
      },
      start: () => this.setCapture(true),
      stop: () => this.setCapture(false),
    };
  }

  snapshot = (): readonly CaptureEntry[] => this.entries.slice();
  pending = (): readonly [] => [];
  stats = (): CaptureStats => ({ ...this.statsValue });
  capacityValue = 5000;
  capacity = (): number => this.capacityValue;
  defaultCapacity = (): number => 5000;
  setCapacity(capacity: number): void {
    this.calls.push(`capacity ${capacity}`);
    this.capacityValue = capacity;
    this.emit({ type: 'capacity', capacity });
  }
  addNote(title: string, text: string): void {
    this.calls.push(`note ${title}|${text}`);
  }
  redactedValue = (): string => '[redacted]';
  subscribe(listener: (event: PanelDataEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: PanelDataEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
  push(entry: CaptureEntry): void {
    this.entries.push(entry);
    this.statsValue = { ...this.statsValue, recorded: this.statsValue.recorded + 1 };
    this.emit({ type: 'entry', entry });
  }
  clear(): void {
    this.calls.push('clear');
    this.entries = [];
    this.emit({ type: 'cleared' });
  }
  exportJson(): string {
    return '{"whole":"buffer"}';
  }
  download(root: ShadowRoot): void {
    this.calls.push('download');
    this.downloadRoot = root;
  }
  copyText(text: string, root: ShadowRoot): Promise<boolean> {
    this.calls.push(`copy ${text}`);
    this.copyRoot = root;
    return Promise.resolve(true);
  }
  private setCapture(on: boolean): void {
    this.calls.push(on ? 'start' : 'stop');
    if (on === this.on) return;
    this.on = on;
    this.emit({ type: 'capture', on });
  }
}

/** A `Storage` in memory; `blocked` makes every call throw, like a sandboxed page. */
export class FakeStorage implements SettingsStorage {
  readonly items = new Map<string, string>();
  blocked = false;
  writes = 0;
  getItem(key: string): string | null {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    this.writes++;
    this.items.set(key, value);
  }
}

/** One fake view's record of what the frame did to it. */
export interface ViewLog {
  readonly deps: ViewDeps;
  readonly view: PanelView;
  readonly updates: PanelState[];
  readonly settings: ViewSettings[];
  escapes: number;
  filterFocus: number;
  destroyed: number;
  /** What `handleEscape` returns. */
  closesOnEscape: boolean;
}

/** Views that record every call; `make[list]` builds them, `logs[list]` holds what happened. */
export function fakeViews(): {
  readonly make: Record<ListId, CreateView>;
  readonly logs: Partial<Record<ListId, ViewLog>>;
} {
  const logs: Partial<Record<ListId, ViewLog>> = {};
  const factory =
    (list: ListId): CreateView =>
    (deps) => {
      const element = deps.document.createElement('div');
      element.className = 'dcp-view';
      element.setAttribute('data-fake-view', list);
      const log: ViewLog = {
        deps,
        updates: [],
        settings: [],
        escapes: 0,
        filterFocus: 0,
        destroyed: 0,
        closesOnEscape: false,
        view: {
          element,
          update: (state) => {
            log.updates.push(state);
          },
          applySettings: (settings) => {
            log.settings.push(settings);
          },
          focusFilter: () => {
            log.filterFocus++;
          },
          handleEscape: () => {
            log.escapes++;
            return log.closesOnEscape;
          },
          destroy: () => {
            log.destroyed++;
            element.remove();
          },
        },
      };
      logs[list] = log;
      return log.view;
    };
  return { make: { http: factory('http'), ws: factory('ws'), console: factory('console') }, logs };
}

/** A shadow root with a loader-like panel root, attached to the page. */
export interface Stage {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly panelRoot: HTMLElement;
  readonly loaderSheet: CSSStyleSheet;
  remove(): void;
}

export function createStage(): Stage {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const loaderSheet = new CSSStyleSheet();
  loaderSheet.replaceSync('.dcp-root{position:absolute;left:0;right:0;bottom:0;height:40%}');
  root.adoptedStyleSheets = [loaderSheet];
  const panelRoot = document.createElement('div');
  panelRoot.className = 'dcp-root';
  panelRoot.tabIndex = -1;
  root.appendChild(panelRoot);
  return { host, root, panelRoot, loaderSheet, remove: () => host.remove() };
}

/** Everything a frame spec needs, with `deps` the frame gets. */
export interface Rig {
  readonly scope: ManualScope;
  readonly source: FakeSource;
  readonly storage: FakeStorage;
  readonly views: ReturnType<typeof fakeViews>;
  readonly deps: FrameDeps;
  dialog: boolean;
  /** `now()`, moved by hand. */
  clock: number;
}

export function createRig(overrides: Partial<FrameDeps> = {}): Rig {
  const scope = new ManualScope();
  const source = new FakeSource();
  const storage = new FakeStorage();
  const views = fakeViews();
  const rig: Rig = {
    scope,
    source,
    storage,
    views,
    dialog: false,
    clock: 0,
    deps: {
      views: views.make,
      source: () => source,
      scope,
      run: (work) => work(),
      now: () => rig.clock,
      storage: () => storage,
      timeOrigin: 1_000,
      utcOffsetMinutes: 120,
      viewport: () => ({ width: 1000, height: 800 }),
      hasModalDialog: () => rig.dialog,
      dialogCheckMs: 500,
      ...overrides,
    },
  };
  return rig;
}

/** The controller the frame is given; the rig's `source` stands for it. */
export const NO_CONTROLLER = {} as CaptureController;

export function frameOptions(stage: Stage, extra: Partial<MountPanelUiOptions> = {}): MountPanelUiOptions {
  return {
    document,
    panelRoot: stage.panelRoot,
    storageKey: 'dcp-spec',
    defaultDock: 'bottom',
    onRequestClose: () => undefined,
    ...extra,
  };
}

describe('P4 spec fakes', () => {
  it('the manual scope runs only the frames and timers asked for so far, and forgets cancelled ones', () => {
    const scope = new ManualScope();
    const ran: string[] = [];
    scope.requestAnimationFrame(() => {
      ran.push('a');
      scope.requestAnimationFrame(() => ran.push('later'));
    });
    const cancelled = scope.setTimeout(() => ran.push('cancelled'), 10);
    scope.setTimeout(() => ran.push('t'), 10);
    scope.clearTimeout(cancelled);

    expect(scope.frame()).toBe(1);
    scope.tick();
    expect(ran).toEqual(['a', 't']);
    expect(scope.frames.size).toBe(1);
  });

  it('the fake source tells its listeners about entries, clear and capture, and stops after unsubscribe', () => {
    const source = new FakeSource();
    const seen: string[] = [];
    const off = source.subscribe((event) => seen.push(event.type));
    source.push(logEntry(1));
    source.capture.stop();
    source.clear();
    off();
    source.push(logEntry(2));

    expect(seen).toEqual(['entry', 'capture', 'cleared']);
    expect(source.capture.on).toBeFalse();
  });
});
