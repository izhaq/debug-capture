import {
  BufferUsage,
  CaptureController,
  CaptureEntry,
  ControlledCaptureSession,
  DEFAULT_CAPTURE_POLICY,
  EntryListener,
  isProblemEntry,
  LiveRecorder,
  RecorderChangeListener,
  Unsubscribe,
} from '..';
import type { MountPanelUi, MountPanelUiOptions, PanelUiHandle } from './app';
import { DebugPanelHandle, DebugPanelOptions, DebugPanelStatus } from './api';
import { createDebugPanel, LoaderDeps, LoaderScope } from './loader';

// ---------------------------------------------------------------------------
// Fakes. The loader gets its page through `LoaderScope`; specs pass the real
// Karma document (real Shadow DOM, focus and events) with fake frames and a
// fresh element name per spec, and never patch `window` (AGENTS rule 8).
// ---------------------------------------------------------------------------

class FakeRecorder implements LiveRecorder {
  readonly entryListeners = new Set<EntryListener>();
  readonly changeListeners = new Set<RecorderChangeListener>();
  record(): void {
    // The loader never records.
  }
  snapshot(): readonly CaptureEntry[] {
    return [];
  }
  clear(): void {
    this.changeListeners.forEach((l) => l({ type: 'cleared' }));
  }
  stats() {
    return { recorded: 0, dropped: 0, evicted: 0, failed: 0 };
  }
  onEntry(listener: EntryListener): Unsubscribe {
    this.entryListeners.add(listener);
    return () => this.entryListeners.delete(listener);
  }
  onChange(listener: RecorderChangeListener): Unsubscribe {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }
  pending() {
    return [];
  }
  onPending(): Unsubscribe {
    return () => undefined;
  }
  usageValue: BufferUsage = { entries: 0, capacity: 5000, bytes: 0, problems: 0 };
  readonly capacityCalls: number[] = [];
  usage(): BufferUsage {
    return { ...this.usageValue };
  }
  setCapacity(capacity: number): void {
    this.capacityCalls.push(capacity);
    this.usageValue = { ...this.usageValue, capacity };
    this.changeListeners.forEach((l) => l({ type: 'capacity' }));
  }
  emit(entry: CaptureEntry): void {
    this.entryListeners.forEach((l) => l(entry));
  }
  statsChanged(): void {
    this.changeListeners.forEach((l) => l({ type: 'stats' }));
  }
}

function fakeController(recorder: FakeRecorder): CaptureController & { setOn(next: boolean): void } {
  const session: ControlledCaptureSession = {
    recorder,
    policy: DEFAULT_CAPTURE_POLICY,
    clock: { now: () => 0 },
    active: true,
    toJson: () => '{}',
    download: () => undefined,
    copy: async () => true,
    clear: () => recorder.clear(),
    addNote: () => undefined,
    dispose: () => undefined,
  };
  const listeners = new Set<(on: boolean) => void>();
  let on = true;
  const controller: CaptureController & { setOn(next: boolean): void } = {
    session,
    get on() {
      return on;
    },
    start: () => undefined,
    stop: () => undefined,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOn(next) {
      on = next;
      listeners.forEach((l) => l(next));
    },
    shortcuts: null,
    dispose: () => undefined,
  };
  return controller;
}

let seq = 0;
const at = { seq: 0, t: 0 };
const entries = {
  error: (): CaptureEntry => ({ ...at, seq: ++seq, kind: 'error', source: 'window', message: 'x', stack: null }),
  http: (status: number | null, error: 'abort' | 'timeout' | 'network' | null = null): CaptureEntry => ({
    ...at,
    seq: ++seq,
    kind: 'http',
    transport: 'fetch',
    method: 'GET',
    url: 'http://h/x',
    status,
    durationMs: 1,
    reqHeaders: {},
    resHeaders: {},
    reqBody: null,
    resBody: null,
    bytes: null,
    error,
  }),
  ws: (event: 'send' | 'error'): CaptureEntry => ({
    ...at,
    seq: ++seq,
    kind: 'ws',
    socketId: 1,
    url: 'ws://h',
    event,
    opcode: null,
    bytes: null,
    data: null,
    code: null,
  }),
  log: (level: 'error' | 'log'): CaptureEntry => ({ ...at, seq: ++seq, kind: 'log', level, args: ['x'] }),
};

let names = 0;
const uniqueName = (): string => `dcp-spec-panel-${++names}-${Math.random().toString(36).slice(2, 8)}`;

interface FakeUi {
  readonly mount: jasmine.Spy<MountPanelUi>;
  readonly unmount: jasmine.Spy<() => void>;
  lastOptions(): MountPanelUiOptions;
}

/** A UI chunk stand-in: one focusable button inside the panel root. */
function fakeUi(): FakeUi {
  const unmount = jasmine.createSpy<() => void>('unmount');
  const mount = jasmine.createSpy<MountPanelUi>('mountPanelUi').and.callFake((root, _controller, options) => {
    const button = options.document.createElement('button');
    button.className = 'fake-ui';
    button.textContent = 'inside';
    (root.querySelector('.dcp-root') ?? root).appendChild(button);
    return {
      unmount: unmount.and.callFake(() => button.remove()),
    } satisfies PanelUiHandle;
  });
  return { mount, unmount, lastOptions: () => mount.calls.mostRecent().args[2] };
}

interface Harness {
  readonly handle: DebugPanelHandle;
  readonly recorder: FakeRecorder;
  readonly controller: CaptureController & { setOn(next: boolean): void };
  readonly ui: FakeUi;
  readonly loadUi: jasmine.Spy<LoaderDeps['loadUi']>;
  readonly frames: FrameRequestCallback[];
  readonly cancelled: number[];
  readonly name: string;
  host(): HTMLElement | null;
  shadow(): ShadowRoot;
  launcher(): HTMLButtonElement | null;
  root(): HTMLElement | null;
  flushFrames(): void;
}

const harnesses: Harness[] = [];

function install(
  options: DebugPanelOptions = {},
  overrides: { scope?: Partial<LoaderScope>; deps?: Partial<LoaderDeps> } = {},
): Harness {
  const recorder = new FakeRecorder();
  const controller = fakeController(recorder);
  const ui = fakeUi();
  const frames: FrameRequestCallback[] = [];
  const cancelled: number[] = [];
  const name = overrides.deps?.elementName ?? uniqueName();
  const scope: LoaderScope = {
    document,
    HTMLElement,
    CSSStyleSheet,
    customElements,
    requestAnimationFrame: (cb) => frames.push(cb),
    cancelAnimationFrame: (id) => cancelled.push(id),
    getComputedStyle: (el) => getComputedStyle(el),
    ...overrides.scope,
  };
  const loadUi = jasmine.createSpy<LoaderDeps['loadUi']>('loadUi').and.callFake(async () => ({
    mountPanelUi: ui.mount,
  }));
  const handle = createDebugPanel(controller, options, {
    scope,
    isProblemEntry,
    loadUi,
    elementName: name,
    ...overrides.deps,
  });
  const host = (): HTMLElement | null =>
    Array.from(document.documentElement.children).find((c): c is HTMLElement => c.localName === name) ?? null;
  const harness: Harness = {
    handle,
    recorder,
    controller,
    ui,
    loadUi,
    frames,
    cancelled,
    name,
    host,
    shadow: () => host()?.shadowRoot as ShadowRoot,
    launcher: () => host()?.shadowRoot?.querySelector<HTMLButtonElement>('.dcp-launcher') ?? null,
    root: () => host()?.shadowRoot?.querySelector<HTMLElement>('.dcp-root') ?? null,
    flushFrames: () => frames.splice(0).forEach((cb) => cb(0)),
  };
  harnesses.push(harness);
  return harness;
}

/** Lets the UI chunk's promise settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function chord(init: KeyboardEventInit & { code: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
}
const TOGGLE = { code: 'KeyP', ctrlKey: true, altKey: true, shiftKey: true };

function pressToggle(target: EventTarget = document.body): KeyboardEvent {
  const event = chord(TOGGLE);
  target.dispatchEvent(event);
  return event;
}

/** A focusable host input, removed after each spec. */
function hostInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'spec-host-input';
  document.body.appendChild(input);
  input.focus();
  return input;
}

afterEach(() => {
  harnesses.splice(0).forEach((h) => h.handle.dispose());
  document.querySelectorAll('.spec-host-input').forEach((n) => n.remove());
});

// ---------------------------------------------------------------------------

describe('panel loader (S-02)', () => {
  describe('mount (S02-02, S02-03, ISO-01 … ISO-06, ISO-15)', () => {
    it('mounts one host element on <html> after <body>, in the top layer', () => {
      const h = install();
      const host = h.host() as HTMLElement;

      expect(host).not.toBeNull();
      expect(host.parentNode).toBe(document.documentElement);
      expect(document.body.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(host.getAttribute('popover')).toBe('manual');
      expect(host.matches(':popover-open')).toBeTrue();
      expect(host.shadowRoot?.mode).toBe('open');
    });

    it('locks the host element down with adopted, !important styles only', () => {
      const h = install();
      const host = h.host() as HTMLElement;
      const shadow = h.shadow();
      const style = getComputedStyle(host);

      expect(shadow.adoptedStyleSheets.length).toBe(1);
      expect(shadow.querySelectorAll('style, link, [style]').length).toBe(0);
      expect(Array.from(host.attributes).map((a) => a.name)).toEqual(['popover']);
      expect(style.position).toBe('fixed');
      expect(style.pointerEvents).toBe('none');
      expect(style.zIndex).toBe('2147483647');
      expect(style.contain).toBe('strict');
      expect(style.direction).toBe('ltr');
      // A host `::backdrop {}` rule must not tint the page under our top-layer element.
      expect(getComputedStyle(host, '::backdrop').display).toBe('none');
      const hostRule = shadow.adoptedStyleSheets[0].cssRules[0] as CSSStyleRule;
      expect(hostRule.selectorText).toBe(':host');
      for (const property of Array.from(hostRule.style)) {
        expect(hostRule.style.getPropertyPriority(property)).withContext(property).toBe('important');
      }
    });

    it('covers the viewport while only the launcher takes pointer events', () => {
      const h = install();
      const rect = (h.host() as HTMLElement).getBoundingClientRect();
      const launcher = h.launcher() as HTMLButtonElement;
      const box = launcher.getBoundingClientRect();

      expect(rect.left).toBe(0);
      expect(rect.top).toBe(0);
      expect(rect.width).toBe(document.documentElement.clientWidth);
      expect(getComputedStyle(launcher).pointerEvents).toBe('auto');
      expect(Math.round(box.height)).toBe(28);
      expect(Math.round(document.documentElement.clientWidth - box.right)).toBe(12);
      expect(Math.round(document.documentElement.clientHeight - box.bottom)).toBe(12);
    });

    it('never changes an attribute of the host element after mount (ISO-15)', async () => {
      const h = install();
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((r) => records.push(...r));
      observer.observe(h.host() as HTMLElement, { attributes: true });

      h.recorder.emit(entries.error());
      h.flushFrames();
      pressToggle();
      await settle();
      pressToggle();
      records.push(...observer.takeRecords());
      observer.disconnect();

      expect(records).toEqual([]);
    });

    it('makes nothing for a null controller and the handle is inert (S02-01)', () => {
      const before = document.documentElement.children.length;
      const handle = createDebugPanel(
        null,
        {},
        {
          scope: { document } as LoaderScope,
          isProblemEntry,
          loadUi: () => Promise.reject(new Error('never')),
        },
      );

      handle.open();
      handle.close();
      handle.dispose();

      expect(handle.isOpen).toBeFalse();
      expect(handle.loadError).toBeNull();
      expect(document.documentElement.children.length).toBe(before);
    });
  });

  describe('registration (S02-12, ISO-14, D-11)', () => {
    it('defines the element once and reuses its own definition on the next install', () => {
      const name = uniqueName();
      const define = jasmine
        .createSpy('define')
        .and.callFake((n: string, c: CustomElementConstructor) => customElements.define(n, c));
      const registry = { get: (n: string) => customElements.get(n), define };
      const first = install({}, { scope: { customElements: registry }, deps: { elementName: name } });
      first.handle.dispose();
      const second = install({}, { scope: { customElements: registry }, deps: { elementName: name } });

      expect(define).toHaveBeenCalledTimes(1);
      expect(second.host()).not.toBeNull();
      expect(second.launcher()).not.toBeNull();
    });

    it('stays silent and inert when someone else owns the name', () => {
      const name = uniqueName();
      customElements.define(name, class extends HTMLElement {});
      const logs = ['error', 'warn', 'log', 'info'].map((m) => spyOn(console, m as 'log'));

      const h = install({}, { deps: { elementName: name } });
      h.handle.open();

      expect(h.host()).toBeNull();
      expect(h.handle.isOpen).toBeFalse();
      logs.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    it('installs one panel per page: a second install while one is live is inert', () => {
      const name = uniqueName();
      const first = install({}, { deps: { elementName: name } });
      const second = install({}, { deps: { elementName: name } });
      second.handle.open();

      expect(Array.from(document.documentElement.children).filter((c) => c.localName === name).length).toBe(1);
      expect(second.handle.isOpen).toBeFalse();
      expect(first.recorder.entryListeners.size).toBe(1);
    });

    it('is inert, and leaves nothing behind, when the page cannot build it', () => {
      const noRegistry = install({}, { scope: { customElements: undefined } });
      const brokenSheet = install(
        {},
        {
          scope: {
            CSSStyleSheet: class {
              constructor() {
                throw new Error('no constructable sheets');
              }
            } as unknown as typeof CSSStyleSheet,
          },
        },
      );

      expect(noRegistry.host()).toBeNull();
      expect(brokenSheet.host()).toBeNull();
      expect(brokenSheet.recorder.entryListeners.size).toBe(0);
      expect(() => brokenSheet.handle.open()).not.toThrow();
    });
  });

  describe('event wall (S02-04, ISO-07, D-16)', () => {
    const WALLED = [
      'pointerdown',
      'pointerup',
      'pointermove',
      'mousedown',
      'mouseup',
      'mousemove',
      'mouseover',
      'click',
      'dblclick',
      'auxclick',
      'contextmenu',
      'wheel',
      'touchstart',
      'touchend',
      'keydown',
      'keyup',
      'keypress',
      'beforeinput',
      'input',
      'focusin',
      'focusout',
      'compositionstart',
      'compositionend',
      'copy',
      'cut',
      'paste',
      'dragstart',
      'drag',
      'dragend',
      'dragover',
      'drop',
    ];

    it('stops every walled event at the host element; host capture listeners still see it', () => {
      const h = install();
      const inner = h.launcher() as HTMLElement;
      const bubbled: string[] = [];
      const captured: string[] = [];
      const onBubble = (e: Event): number => bubbled.push(e.type);
      const onCapture = (e: Event): number => captured.push(e.type);
      for (const type of WALLED) {
        document.addEventListener(type, onBubble);
        window.addEventListener(type, onBubble);
        document.addEventListener(type, onCapture, true);
      }
      try {
        for (const type of WALLED) {
          inner.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
          // An event aimed at the host element's own box never enters the shadow root (research E7).
          (h.host() as HTMLElement).dispatchEvent(new Event(type, { bubbles: true, composed: true }));
        }
      } finally {
        for (const type of WALLED) {
          document.removeEventListener(type, onBubble);
          window.removeEventListener(type, onBubble);
          document.removeEventListener(type, onCapture, true);
        }
      }

      expect(bubbled).toEqual([]);
      expect(captured.length).toBe(WALLED.length * 2);
    });

    it('lets the global Ctrl+Alt+Shift chords through, but nothing else', () => {
      const h = install();
      const inner = h.launcher() as HTMLElement;
      const seen: string[] = [];
      const onKey = (e: Event): number => seen.push((e as KeyboardEvent).code);
      const onClick = (e: Event): number => seen.push(e.type);
      document.addEventListener('keydown', onKey);
      document.addEventListener('click', onClick);
      try {
        inner.dispatchEvent(chord({ code: 'KeyD', ctrlKey: true, altKey: true, shiftKey: true }));
        inner.dispatchEvent(chord({ code: 'KeyD', ctrlKey: true, shiftKey: true }));
        inner.dispatchEvent(chord({ code: 'KeyA' }));
        // AltGr+Shift on Windows reports Ctrl+Alt+Shift: still typing, not a chord.
        inner.dispatchEvent(
          chord({
            code: 'KeyA',
            ctrlKey: true,
            altKey: true,
            shiftKey: true,
            modifierAltGraph: true,
          } as KeyboardEventInit & { code: string }),
        );
        inner.dispatchEvent(
          new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true, altKey: true, shiftKey: true }),
        );
      } finally {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('click', onClick);
      }

      expect(seen).toEqual(['KeyD']);
    });

    it('stops a bare modifier key even while the other two chord modifiers are held', () => {
      const h = install();
      const inner = h.launcher() as HTMLElement;
      const seen: string[] = [];
      const onKey = (e: Event): number => seen.push((e as KeyboardEvent).code);
      document.addEventListener('keydown', onKey);
      try {
        for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft']) {
          inner.dispatchEvent(chord({ code, ctrlKey: true, altKey: true, shiftKey: true }));
        }
      } finally {
        document.removeEventListener('keydown', onKey);
      }

      expect(seen).toEqual([]);
    });

    it('lets a custom toggle chord through the wall, so it closes the panel from inside', async () => {
      const h = install({ shortcut: 'ctrl+shift+9' });
      h.handle.open();
      await settle();
      const inside = h.shadow().querySelector('.fake-ui') as HTMLElement;

      inside.dispatchEvent(chord({ code: 'Digit9', ctrlKey: true, shiftKey: true }));

      expect(h.handle.isOpen).toBeFalse();
    });
  });

  describe('toggle shortcut (S02-05, FR-ACT-05, ISO-08)', () => {
    it('opens and closes on the exact default chord and prevents only that', async () => {
      const h = install();

      const first = pressToggle();
      await settle();
      expect(first.defaultPrevented).toBeTrue();
      expect(h.handle.isOpen).toBeTrue();
      expect(h.ui.mount).toHaveBeenCalledTimes(1);

      const second = pressToggle();
      expect(second.defaultPrevented).toBeTrue();
      expect(h.handle.isOpen).toBeFalse();
    });

    it('ignores near misses and leaves their default alone', async () => {
      const h = install();
      const misses = [
        { code: 'KeyP', ctrlKey: true, shiftKey: true },
        { code: 'KeyP', ctrlKey: true, altKey: true, shiftKey: true, metaKey: true },
        { code: 'KeyO', ctrlKey: true, altKey: true, shiftKey: true },
        { code: 'Digit1', ctrlKey: true, altKey: true, shiftKey: true },
        { code: 'KeyP' },
      ];
      const events = misses.map((init) => {
        const event = chord(init);
        document.body.dispatchEvent(event);
        return event;
      });
      await settle();

      expect(events.map((e) => e.defaultPrevented)).toEqual(misses.map(() => false));
      expect(h.handle.isOpen).toBeFalse();
      expect(h.loadUi).not.toHaveBeenCalled();
    });

    it('takes a custom chord; a held key does not toggle again', async () => {
      const h = install({ shortcut: 'Ctrl+Alt+Shift+9' });
      document.body.dispatchEvent(chord({ code: 'Digit9', ctrlKey: true, altKey: true, shiftKey: true }));
      await settle();
      const held = chord({ code: 'Digit9', ctrlKey: true, altKey: true, shiftKey: true, repeat: true });
      document.body.dispatchEvent(held);

      expect(h.handle.isOpen).toBeTrue();
      expect(held.defaultPrevented).toBeTrue();
      expect(pressToggle().defaultPrevented).toBeFalse();
    });

    it('binds no key for `false` or a chord it cannot read', async () => {
      const off = install({ shortcut: false });
      const typo = install({ shortcut: 'ctrl+alt+shift+F12' });
      const doubled = install({ shortcut: 'ctrl+ctrl+p' });
      const noKey = install({ shortcut: 'ctrl+alt+shift' });
      const event = pressToggle();
      await settle();

      expect(event.defaultPrevented).toBeFalse();
      for (const h of [off, typo, doubled, noKey]) expect(h.handle.isOpen).toBeFalse();
    });
  });

  describe('launcher and badge (S02-08, FR-ACT-03/04, NFR-PERF-01, D-07)', () => {
    it('is a real button named DBG, bottom-right', () => {
      const h = install();
      const launcher = h.launcher() as HTMLButtonElement;

      expect(launcher.tagName).toBe('BUTTON');
      expect(launcher.type).toBe('button');
      expect(launcher.textContent).toBe('DBG');
      expect(launcher.getAttribute('aria-label')).toBe('DBG: open debug panel');
    });

    it('counts problems only, painting at most once per frame', () => {
      const h = install();
      for (const entry of [
        entries.error(),
        entries.http(500),
        entries.http(null, 'network'),
        entries.ws('error'),
        entries.http(404),
        entries.http(200),
        entries.log('error'),
        entries.ws('send'),
      ]) {
        h.recorder.emit(entry);
      }

      expect(h.frames.length).toBe(1);
      expect((h.launcher() as HTMLElement).textContent).toBe('DBG');

      h.flushFrames();
      const launcher = h.launcher() as HTMLButtonElement;
      expect(launcher.textContent).toBe('DBG4');
      expect(launcher.getAttribute('aria-label')).toBe('DBG 4: open debug panel, 4 new problems');

      h.recorder.emit(entries.error());
      expect(h.frames.length).toBe(1);
      h.flushFrames();
      expect(launcher.textContent).toBe('DBG5');
    });

    it('asks for no frame while the number does not change', () => {
      const h = install();
      h.recorder.emit(entries.http(200));
      h.recorder.emit(entries.log('error'));
      h.recorder.statsChanged();
      h.recorder.clear();

      expect(h.frames.length).toBe(0);
    });

    it('says "1 new problem" in the singular', () => {
      const h = install();
      h.recorder.emit(entries.error());
      h.flushFrames();

      expect((h.launcher() as HTMLElement).getAttribute('aria-label')).toBe('DBG 1: open debug panel, 1 new problem');
    });

    it('resets on Clear (recorder change "cleared")', () => {
      const h = install();
      h.recorder.emit(entries.error());
      h.flushFrames();
      h.recorder.clear();
      h.flushFrames();

      expect((h.launcher() as HTMLElement).textContent).toBe('DBG');
    });

    it('resets on open, is hidden while open, and counts nothing until closed', async () => {
      const h = install();
      h.recorder.emit(entries.error());
      h.flushFrames();

      h.handle.open();
      await settle();
      expect((h.launcher() as HTMLElement).hidden).toBeTrue();
      h.recorder.emit(entries.error());
      expect(h.frames.length).toBe(0);

      h.handle.close();
      const launcher = h.launcher() as HTMLElement;
      expect(launcher.hidden).toBeFalse();
      expect(launcher.textContent).toBe('DBG');
    });

    it('`launcher: false` shows no launcher and costs nothing per entry', () => {
      const h = install({ launcher: false });

      expect(h.launcher()).toBeNull();
      expect(h.recorder.entryListeners.size).toBe(0);
      // 2.1: one change listener (clear / size change re-arm the near-full banner, FR-BUF-04) — never per entry.
      expect(h.recorder.changeListeners.size).toBe(1);
    });

    it('opens from a launcher click and moves focus into the panel', async () => {
      const h = install();
      const launcher = h.launcher() as HTMLButtonElement;
      launcher.focus();
      launcher.click();
      await settle();

      expect(h.handle.isOpen).toBeTrue();
      expect(h.shadow().activeElement).toBe(h.root());

      h.handle.close();
      expect(h.shadow().activeElement).toBe(launcher);
    });

    it('survives a problem rule that throws (ISO-12)', () => {
      const h = install(
        {},
        {
          deps: {
            isProblemEntry: () => {
              throw new Error('rule');
            },
          },
        },
      );

      expect(() => h.recorder.emit(entries.error())).not.toThrow();
      expect(h.frames.length).toBe(0);
    });
  });

  describe('lazy UI chunk (S02-09, FR-ACT-02, D-10)', () => {
    it('loads nothing until the first open, then reuses the chunk', async () => {
      const h = install();
      expect(h.loadUi).not.toHaveBeenCalled();

      h.handle.open();
      await settle();
      h.handle.close();
      h.handle.open();
      h.handle.close();

      expect(h.loadUi).toHaveBeenCalledTimes(1);
      expect(h.ui.mount).toHaveBeenCalledTimes(2);
      expect(h.ui.unmount).toHaveBeenCalledTimes(2);
    });

    it('mounts into the shadow root with the controller and the resolved options', async () => {
      const h = install();
      const custom = install({ storageKey: false, defaultDock: 'right' });
      h.handle.open();
      custom.handle.open();
      await settle();

      const [root, controller, options] = h.ui.mount.calls.mostRecent().args;
      expect(root).toBe(h.shadow());
      expect(controller).toBe(h.controller);
      expect(options.document).toBe(document);
      // C3-2: the UI builds in the loader's own panel root, never one found by class.
      expect(options.panelRoot).toBe(h.root() as HTMLElement);
      expect(options.panelRoot.parentNode).toBe(h.shadow());
      expect(options.storageKey).toBe('debug-capture:panel');
      expect(options.defaultDock).toBe('bottom');
      expect(custom.ui.lastOptions().storageKey).toBeFalse();
      expect(custom.ui.lastOptions().defaultDock).toBe('right');
    });

    it('gives the panel root the dialog semantics and hides it, inert, when closed (S02-10, S02-13)', async () => {
      const h = install();
      h.handle.open();
      await settle();
      const root = h.root() as HTMLElement;

      expect(root.getAttribute('role')).toBe('dialog');
      expect(root.getAttribute('aria-modal')).toBe('false');
      expect(root.getAttribute('aria-label')).toBe('Debug panel');
      expect(root.lang).toBe('en');
      expect(root.dir).toBe('ltr');
      expect(getComputedStyle(root).direction).toBe('ltr');
      expect(root.hidden).toBeFalse();

      h.ui.lastOptions().onRequestClose();
      expect(h.handle.isOpen).toBeFalse();
      expect(root.hidden).toBeTrue();
      expect(root.inert).toBeTrue();
      expect(getComputedStyle(root).display).toBe('none');
      expect(h.shadow().querySelector('.fake-ui')).toBeNull();
    });

    it('keeps the launcher working when the chunk fails to load, and says why only on the handle', async () => {
      const failure = new Error('chunk 404');
      const logs = ['error', 'warn', 'log'].map((m) => spyOn(console, m as 'log'));
      const h = install();
      h.loadUi.and.returnValues(Promise.reject(failure), Promise.resolve({ mountPanelUi: h.ui.mount }));

      h.handle.open();
      expect(h.handle.isOpen).toBeTrue();
      await settle();

      expect(h.handle.isOpen).toBeFalse();
      expect(h.handle.loadError).toBe(failure);
      expect((h.launcher() as HTMLElement).hidden).toBeFalse();
      logs.forEach((spy) => expect(spy).not.toHaveBeenCalled());

      h.handle.open();
      await settle();
      expect(h.handle.isOpen).toBeTrue();
      expect(h.handle.loadError).toBeNull();
    });

    it('treats a loader that throws, or a UI that throws while mounting, as a failed open', async () => {
      const h = install();
      h.loadUi.and.throwError('sync');
      h.handle.open();
      await settle();
      expect(h.handle.isOpen).toBeFalse();
      expect((h.handle.loadError as Error).message).toBe('sync');

      h.loadUi.and.callFake(async () => ({ mountPanelUi: h.ui.mount }));
      h.ui.mount.and.throwError('mount');
      h.handle.open();
      await settle();
      expect(h.handle.isOpen).toBeFalse();
      expect((h.handle.loadError as Error).message).toBe('mount');
      expect((h.root() as HTMLElement).hidden).toBeTrue();
    });

    it('a close while the chunk loads wins: nothing mounts', async () => {
      const h = install();
      h.handle.open();
      h.handle.close();
      expect(h.handle.isOpen).toBeFalse();
      await settle();

      expect(h.ui.mount).not.toHaveBeenCalled();
      expect(h.handle.isOpen).toBeFalse();
      expect((h.launcher() as HTMLElement).hidden).toBeFalse();
    });

    it('a UI that asks to close while it mounts ends closed and unmounted', async () => {
      const h = install();
      const unmount = jasmine.createSpy('unmount');
      h.loadUi.and.callFake(async () => ({
        mountPanelUi: (_root: ShadowRoot, _c: CaptureController, options: MountPanelUiOptions) => {
          options.onRequestClose();
          return { unmount };
        },
      }));
      h.handle.open();
      await settle();

      expect(h.handle.isOpen).toBeFalse();
      expect(unmount).toHaveBeenCalledTimes(1);
    });

    it('a wheel over the panel never scrolls the host page; inner scrollers still scroll (ISO-13, research L9)', async () => {
      const h = install();
      h.handle.open();
      await settle();
      const root = h.root() as HTMLElement;
      const wheel = (target: Element, deltaY: number): boolean => {
        const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, composed: true });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const list = document.createElement('div');
      list.style.height = '20px';
      list.style.overflowY = 'auto';
      const tall = document.createElement('div');
      tall.style.height = '100px';
      list.appendChild(tall);
      root.appendChild(list);

      expect(wheel(root, 50)).withContext('nothing can scroll').toBeTrue();
      expect(wheel(tall, 50)).withContext('list can scroll down').toBeFalse();
      expect(wheel(tall, -50)).withContext('list is at its top').toBeTrue();
      list.scrollTop = 80;
      expect(wheel(tall, 50)).withContext('list is at its end').toBeTrue();
      expect(wheel(tall, -50)).withContext('list can scroll up').toBeFalse();
      expect(wheel(tall, 0)).withContext('no vertical delta').toBeTrue();
    });

    it('scroll keys on the panel never scroll the host page; inner scrollers and controls keep them', async () => {
      const h = install();
      h.handle.open();
      await settle();
      const root = h.root() as HTMLElement;
      const press = (target: Element, key: string, init: KeyboardEventInit = {}): boolean => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...init });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const list = document.createElement('div');
      list.style.height = '20px';
      list.style.overflow = 'auto';
      const tall = document.createElement('div');
      tall.style.height = '100px';
      tall.style.width = '5000px';
      list.appendChild(tall);
      const button = document.createElement('button');
      root.append(list, button);

      for (const key of [' ', 'PageDown', 'PageUp', 'End', 'Home', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
        expect(press(root, key)).withContext(key).toBeTrue();
      }
      expect(press(tall, 'ArrowDown')).withContext('list can scroll down').toBeFalse();
      expect(press(tall, 'ArrowRight')).withContext('list can scroll right').toBeFalse();
      expect(press(tall, ' ', { shiftKey: true }))
        .withContext('list is at its top')
        .toBeTrue();
      expect(press(button, ' ')).withContext('Space clicks a button').toBeFalse();
      expect(press(button, 'ArrowDown')).withContext('a button cannot use arrows').toBeTrue();
      expect(press(button, 'PageDown')).withContext('a button cannot use PageDown').toBeTrue();
      expect(press(root, 'End', { ctrlKey: true }))
        .withContext('Ctrl+End scrolls the page too')
        .toBeTrue();
      expect(press(root, 'ArrowDown', { ctrlKey: true }))
        .withContext('not a scroll key with Ctrl')
        .toBeFalse();
      expect(press(root, 'a')).withContext('typing').toBeFalse();
    });

    it('swallows a UI that throws on unmount (ISO-12)', async () => {
      const h = install();
      h.handle.open();
      await settle();
      h.ui.unmount.and.throwError('unmount');

      expect(() => h.handle.close()).not.toThrow();
      expect(h.handle.isOpen).toBeFalse();
    });
  });

  describe('focus (S02-10, FR-ACT-07, ISO-16)', () => {
    it('the shortcut moves focus into the panel; closing returns it to the host input', async () => {
      const h = install();
      const input = hostInput();

      pressToggle(input);
      await settle();
      expect(document.activeElement).toBe(h.host());
      expect(h.shadow().activeElement).toBe(h.root());

      pressToggle(h.root() as HTMLElement);
      expect(document.activeElement).toBe(input);
    });

    it('handle.open() never steals focus, and close() leaves focus that moved elsewhere alone', async () => {
      const h = install();
      const input = hostInput();
      h.handle.open();
      await settle();
      expect(document.activeElement).toBe(input);

      const other = hostInput();
      h.handle.close();
      expect(document.activeElement).toBe(other);
    });

    it('fullscreen: the panel is shown on top again and focus stays where it was (D-15, S08-13)', async () => {
      const h = install();
      pressToggle(hostInput());
      await settle();
      expect(h.shadow().activeElement).toBe(h.root());

      document.dispatchEvent(new Event('fullscreenchange'));
      // After the next frame: a focus fix-up from the brief hide would show by then.
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      expect((h.host() as HTMLElement).matches(':popover-open')).toBeTrue();
      expect(h.shadow().activeElement).withContext('focus inside the panel').toBe(h.root());

      pressToggle(h.root() as HTMLElement);
      const input = hostInput();
      document.dispatchEvent(new Event('fullscreenchange'));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      expect((h.host() as HTMLElement).matches(':popover-open')).toBeTrue();
      expect(document.activeElement).withContext('focus on the page').toBe(input);
    });

    it('fullscreen does not put back an element the host removed (ISO-20)', () => {
      const h = install();
      const host = h.host() as HTMLElement;
      host.remove();
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(host.isConnected).toBeFalse();
    });

    it('a slow chunk does not take focus the user moved to the host page meanwhile', async () => {
      const h = install();
      let resolve: (chunk: { mountPanelUi: typeof h.ui.mount }) => void = () => undefined;
      h.loadUi.and.returnValue(new Promise((done) => (resolve = done)));
      pressToggle(hostInput());
      const other = hostInput();
      resolve({ mountPanelUi: h.ui.mount });
      await settle();

      expect(h.handle.isOpen).toBeTrue();
      expect(document.activeElement).toBe(other);
    });

    it('does not fail when the element that had focus is gone', async () => {
      const h = install();
      const input = hostInput();
      pressToggle(input);
      await settle();
      input.remove();

      expect(() => pressToggle(h.root() as HTMLElement)).not.toThrow();
      expect(h.handle.isOpen).toBeFalse();
    });
  });

  describe('dispose (S02-11, FR-ACT-06)', () => {
    it('never opens by itself', async () => {
      const h = install();
      h.recorder.emit(entries.error());
      h.flushFrames();
      await settle();

      expect(h.handle.isOpen).toBeFalse();
      expect(h.loadUi).not.toHaveBeenCalled();
    });

    it('while open: closes, returns focus, unsubscribes, unbinds the key and removes the element', async () => {
      const h = install();
      const input = hostInput();
      pressToggle(input);
      await settle();
      h.recorder.emit(entries.error()); // not counted while open: no frame
      const handle = h.handle;

      handle.dispose();

      expect(h.ui.unmount).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);
      expect(h.recorder.entryListeners.size).toBe(0);
      expect(h.recorder.changeListeners.size).toBe(0);
      expect(h.host()).toBeNull();
      expect(handle.isOpen).toBeFalse();
      expect(pressToggle().defaultPrevented).toBeFalse();
      handle.open();
      expect(handle.isOpen).toBeFalse();
      expect(() => handle.dispose()).not.toThrow();
    });

    it('cancels a pending badge frame', () => {
      const h = install();
      h.recorder.emit(entries.error());
      h.handle.dispose();

      expect(h.cancelled).toEqual([1]);
    });
  });

  describe('removal by the host (S02-12, ISO-20)', () => {
    it('remounts on the next open after the host removed the element', async () => {
      const h = install();
      const host = h.host() as HTMLElement;
      host.remove();

      pressToggle();
      await settle();

      expect(h.host()).toBe(host);
      expect(host.matches(':popover-open')).toBeTrue();
      expect(h.handle.isOpen).toBeTrue();
    });

    it('a second install after the host removed the element stays inert until the first is disposed', () => {
      const name = uniqueName();
      const first = install({}, { deps: { elementName: name } });
      (first.host() as HTMLElement).remove();
      const second = install({}, { deps: { elementName: name } });
      second.handle.open();

      expect(second.handle.isOpen).toBeFalse();
      expect(second.recorder.entryListeners.size).toBe(0);

      first.handle.dispose();
      const third = install({}, { deps: { elementName: name } });
      expect(third.recorder.entryListeners.size).toBe(1);
    });

    it('closes cleanly when removed while open, and opens again later', async () => {
      const h = install();
      h.handle.open();
      await settle();
      (h.host() as HTMLElement).remove();

      expect(h.handle.isOpen).toBeFalse();
      expect(h.ui.unmount).toHaveBeenCalledTimes(1);

      h.handle.open();
      await settle();
      expect(h.handle.isOpen).toBeTrue();
      expect(h.host()).not.toBeNull();
    });

    it('brings the launcher back when the badge next changes', () => {
      const h = install();
      (h.host() as HTMLElement).remove();
      h.recorder.emit(entries.error());
      h.flushFrames();

      expect(h.host()).not.toBeNull();
      expect((h.launcher() as HTMLElement).textContent).toBe('DBG1');
    });

    it('moves the element back to <html> on open when the host moved it', async () => {
      const h = install();
      const host = h.host() as HTMLElement;
      document.body.appendChild(host);
      try {
        h.handle.open();
        await settle();

        expect(host.parentNode).toBe(document.documentElement);
        expect(h.handle.isOpen).toBeTrue();
      } finally {
        if (host.parentNode === document.body) host.remove();
      }
    });
  });

  describe('zone.js (S02-06, ISO-09, NFR-PERF-05)', () => {
    it('defines, listens, schedules frames and loads inside Zone.root.run', async () => {
      let depth = 0;
      const insideRoot: string[] = [];
      const outsideRoot: string[] = [];
      const note = (what: string): void => void (depth > 0 ? insideRoot : outsideRoot).push(what);
      const root = {
        run<T>(fn: () => T): T {
          depth++;
          try {
            return fn();
          } finally {
            depth--;
          }
        },
      };
      const registry = {
        get: (n: string) => customElements.get(n),
        define: (n: string, c: CustomElementConstructor) => {
          note('define');
          customElements.define(n, c);
        },
      };
      const h = install(
        {},
        {
          scope: {
            Zone: { root },
            customElements: registry,
            requestAnimationFrame: (cb) => {
              note('raf');
              return setTimeout(() => cb(0), 0) as unknown as number;
            },
          },
        },
      );
      h.loadUi.and.callFake(async () => {
        note('load');
        return { mountPanelUi: h.ui.mount };
      });
      h.ui.mount.and.callFake(() => {
        note('mount');
        return { unmount: () => note('unmount') } satisfies PanelUiHandle;
      });

      h.recorder.emit(entries.error()); // from outside any zone, like a console call from app code
      h.handle.open();
      await settle();
      h.handle.close();

      expect(outsideRoot).toEqual([]);
      expect(insideRoot).toEqual(['define', 'raf', 'load', 'mount', 'unmount']);
    });

    it('with real zone.js: nothing the loader does schedules a task in the caller’s zone', async () => {
      interface TaskLike {
        readonly type: string;
        readonly source: string;
      }
      interface ZoneLike {
        run<T>(fn: () => T): T;
        fork(spec: object): ZoneLike;
      }
      const Zone = (globalThis as unknown as { Zone: { root: ZoneLike; current: ZoneLike } }).Zone;
      const scheduled: string[] = [];
      const angular = Zone.root.fork({
        name: 'angular-like',
        onScheduleTask: (
          parent: { scheduleTask(target: unknown, task: TaskLike): TaskLike },
          _current: unknown,
          target: unknown,
          task: TaskLike,
        ) => {
          scheduled.push(`${task.type}:${task.source}`);
          return parent.scheduleTask(target, task);
        },
      });
      const name = uniqueName();
      const h = angular.run(() =>
        install(
          {},
          {
            scope: {
              Zone,
              requestAnimationFrame: (cb) => requestAnimationFrame(cb),
              cancelAnimationFrame: (id) => cancelAnimationFrame(id),
            },
            deps: { elementName: name },
          },
        ),
      );

      angular.run(() => {
        h.recorder.emit(entries.error());
        pressToggle();
      });
      await settle();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      angular.run(() => {
        (h.host() as HTMLElement).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
        pressToggle();
        h.handle.open();
        h.handle.close();
      });
      await settle();

      expect(h.ui.mount).toHaveBeenCalled();
      expect(scheduled).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// 2.1 (S-11b): settings the loader reads at install, the DBG button switch,
// the warning state and the host's status observer.
// ---------------------------------------------------------------------------

/** A `localStorage` stand-in holding `items`; `getItem` is a spy. */
function storage(items: Record<string, string> = {}): Pick<Storage, 'getItem'> & { getItem: jasmine.Spy } {
  return { getItem: jasmine.createSpy('getItem').and.callFake((key: string) => items[key] ?? null) };
}
const stored = (value: object): Record<string, string> => ({ 'debug-capture:panel': JSON.stringify(value) });
const MB = 1_048_576;

describe('panel loader — 2.1 (S-11b)', () => {
  describe('stored settings at install (S11-09, FR-BUF-01, FR-ACT-10)', () => {
    it('applies a stored buffer size before the first open; "none" is No limit', () => {
      expect(
        install({}, { scope: { localStorage: storage(stored({ buffer: 1000 })) } }).recorder.capacityCalls,
      ).toEqual([1000]);
      expect(
        install({}, { scope: { localStorage: storage(stored({ buffer: 'none' })) } }).recorder.capacityCalls,
      ).toEqual([Infinity]);
    });

    it('ignores what is not a size, broken JSON and a missing value', () => {
      for (const text of [JSON.stringify({ buffer: 0 }), JSON.stringify({ buffer: '1000' }), '{not json', '{}']) {
        const h = install({}, { scope: { localStorage: storage({ 'debug-capture:panel': text }) } });
        expect(h.recorder.capacityCalls).withContext(text).toEqual([]);
        expect(h.launcher()).withContext(text).not.toBeNull();
      }
    });

    it('reads the storageKey given; storageKey false reads nothing; a throwing storage is ignored', () => {
      const custom = storage({ mine: JSON.stringify({ buffer: 2000 }) });
      expect(install({ storageKey: 'mine' }, { scope: { localStorage: custom } }).recorder.capacityCalls).toEqual([
        2000,
      ]);
      const none = storage(stored({ buffer: 2000 }));
      expect(install({ storageKey: false }, { scope: { localStorage: none } }).recorder.capacityCalls).toEqual([]);
      expect(none.getItem).not.toHaveBeenCalled();
      const broken = {
        getItem: (): never => {
          throw new Error('blocked');
        },
      };
      const h = install({}, { scope: { localStorage: broken } });
      expect(h.launcher()).not.toBeNull();
      expect(h.handle.isOpen).toBeFalse();
    });

    it('a stored launcher false hides the DBG button at install and after a close', async () => {
      const h = install({}, { scope: { localStorage: storage(stored({ launcher: false })) } });
      expect(h.launcher()?.hidden).toBeTrue();
      pressToggle();
      await settle();
      expect(h.ui.lastOptions().launcher).toBeFalse();
      h.handle.close();
      expect(h.launcher()?.hidden).toBeTrue();
    });
  });

  describe('DBG button switch (S11-10, FR-ACT-10, D-32)', () => {
    it('setLauncher from the UI: hidden after close when Hide, shown again when Show', async () => {
      const h = install();
      pressToggle();
      await settle();
      expect(h.ui.lastOptions().launcher).toBeTrue();
      h.ui.lastOptions().setLauncher(false);
      h.handle.close();
      expect(h.launcher()?.hidden).toBeTrue();
      h.handle.open();
      await settle();
      expect(h.ui.lastOptions().launcher).toBeFalse();
      h.ui.lastOptions().setLauncher(true);
      expect(h.launcher()?.hidden).withContext('still hidden while open').toBeTrue();
      h.handle.close();
      expect(h.launcher()?.hidden).toBeFalse();
    });

    it('code launcher: false wins: no launcher, the switch gets null, a stored Show changes nothing', async () => {
      const h = install({ launcher: false }, { scope: { localStorage: storage(stored({ launcher: true })) } });
      expect(h.launcher()).toBeNull();
      pressToggle();
      await settle();
      expect(h.ui.lastOptions().launcher).toBeNull();
      h.ui.lastOptions().setLauncher(true);
      h.handle.close();
      expect(h.launcher()).toBeNull();
    });
  });

  describe("launcher: 'hidden' and the About chords — 2.2 (S13-15, S13-17, FR-BG-04, FR-BG-09, D-41)", () => {
    it("'hidden': the DBG button exists but stays hidden, also after a close, until Settings says Show", async () => {
      const h = install({ launcher: 'hidden' });
      expect(h.launcher()).not.toBeNull();
      expect(h.launcher()?.hidden).toBeTrue();
      pressToggle();
      await settle();
      expect(h.ui.lastOptions().launcher).toBeFalse();
      h.handle.close();
      expect(h.launcher()?.hidden).toBeTrue();

      h.handle.open();
      await settle();
      h.ui.lastOptions().setLauncher(true);
      h.handle.close();
      expect(h.launcher()?.hidden).toBeFalse();
    });

    it("'hidden' with a stored Show shows it; a stored Hide or nothing stored keeps it hidden", () => {
      const shown = install({ launcher: 'hidden' }, { scope: { localStorage: storage(stored({ launcher: true })) } });
      const hidden = install({ launcher: 'hidden' }, { scope: { localStorage: storage(stored({ launcher: false })) } });
      const broken = install(
        { launcher: 'hidden' },
        { scope: { localStorage: storage({ 'debug-capture:panel': '{oops' }) } },
      );
      expect(shown.launcher()?.hidden).toBeFalse();
      expect(hidden.launcher()?.hidden).toBeTrue();
      expect(broken.launcher()?.hidden).toBeTrue();
    });

    it('hands the UI the toggle and activation chords for About; false when off', async () => {
      const plain = install();
      const custom = install({ shortcut: 'ctrl+alt+shift+9', activation: 'ctrl+alt+shift+a' });
      const none = install({ shortcut: false });
      for (const h of [plain, custom, none]) h.handle.open();
      await settle();

      expect(plain.ui.lastOptions().shortcuts).toEqual({ toggle: 'ctrl+alt+shift+p', activation: false });
      expect(custom.ui.lastOptions().shortcuts).toEqual({ toggle: 'ctrl+alt+shift+9', activation: 'ctrl+alt+shift+a' });
      expect(none.ui.lastOptions().shortcuts).toEqual({ toggle: false, activation: false });
    });
  });

  describe('warnings (S11-11, S11-12, FR-BUF-04, FR-BUF-05)', () => {
    const opened = async (options: DebugPanelOptions = {}): Promise<Harness> => {
      const h = install(options);
      pressToggle();
      await settle();
      return h;
    };
    const warnings = (h: Harness) => h.ui.lastOptions().warnings();

    it('near full from 90 % of the capacity by default; never with No limit', async () => {
      const h = await opened();
      h.recorder.usageValue = { entries: 4499, capacity: 5000, bytes: 0, problems: 0 };
      expect(warnings(h).nearFull).toBeFalse();
      h.recorder.usageValue = { entries: 4500, capacity: 5000, bytes: 0, problems: 0 };
      expect(warnings(h).nearFull).toBeTrue();
      h.recorder.usageValue = { entries: 1e7, capacity: Infinity, bytes: 0, problems: 0 };
      expect(warnings(h).nearFull).toBeFalse();
    });

    it('once per crossing: dismissed stays hidden while full, back after Clear or a size change', async () => {
      const h = await opened();
      h.recorder.usageValue = { entries: 5000, capacity: 5000, bytes: 0, problems: 0 };
      h.ui.lastOptions().dismissWarning('nearFull');
      expect(warnings(h).nearFull).toBeFalse();
      h.handle.close();
      h.handle.open();
      await settle();
      expect(warnings(h).nearFull).withContext('kept across close and open').toBeFalse();

      h.recorder.clear();
      expect(warnings(h).nearFull).withContext('cleared, then full again').toBeTrue();
      h.ui.lastOptions().dismissWarning('nearFull');
      h.recorder.setCapacity(4000);
      h.recorder.usageValue = { entries: 4000, capacity: 4000, bytes: 0, problems: 0 };
      expect(warnings(h).nearFull).toBeTrue();
    });

    it('nearFullAt from the options; one outside (0, 1] gives 0.9', async () => {
      const half = await opened({ nearFullAt: 0.5 });
      half.recorder.usageValue = { entries: 50, capacity: 100, bytes: 0, problems: 0 };
      expect(warnings(half).nearFull).toBeTrue();
      half.handle.dispose();
      for (const bad of [0, 1.5, -1, Number.NaN, '0.5' as unknown as number]) {
        const h = await opened({ nearFullAt: bad });
        h.recorder.usageValue = { entries: 89, capacity: 100, bytes: 0, problems: 0 };
        expect(warnings(h).nearFull).withContext(String(bad)).toBeFalse();
        h.recorder.usageValue = { entries: 90, capacity: 100, bytes: 0, problems: 0 };
        expect(warnings(h).nearFull).withContext(String(bad)).toBeTrue();
        h.handle.dispose();
      }
    });

    it('memory: each 25 MB step once; dismissed comes back at the next step, or after falling below', async () => {
      const h = await opened();
      const at = (bytes: number): number => {
        h.recorder.usageValue = { entries: 1, capacity: 5000, bytes, problems: 0 };
        return warnings(h).memoryBytes;
      };
      expect(at(25 * MB - 1)).toBe(0);
      expect(at(30 * MB)).toBe(30 * MB);
      h.ui.lastOptions().dismissWarning('memory');
      expect(at(49 * MB)).toBe(0);
      expect(at(51 * MB)).toBe(51 * MB);
      h.ui.lastOptions().dismissWarning('memory');
      expect(at(10 * MB)).toBe(0);
      expect(at(26 * MB))
        .withContext('fell below, so the first step warns again')
        .toBe(26 * MB);
    });

    it('memoryStep from the options; a bad one gives 25 MB', async () => {
      const small = await opened({ memoryStep: 1000 });
      small.recorder.usageValue = { entries: 1, capacity: 5000, bytes: 1500, problems: 0 };
      expect(warnings(small).memoryBytes).toBe(1500);
      small.handle.dispose();
      const bad = await opened({ memoryStep: -5 });
      bad.recorder.usageValue = { entries: 1, capacity: 5000, bytes: 1500, problems: 0 };
      expect(warnings(bad).memoryBytes).toBe(0);
    });
  });

  describe('onStatus (S11-13, FR-STAT-01, D-31)', () => {
    const quiet = (): CaptureEntry => entries.log('log');

    it('calls the listener once at subscribe with the whole status', () => {
      const h = install();
      h.recorder.usageValue = { entries: 12, capacity: 5000, bytes: 3000, problems: 2 };
      const seen: DebugPanelStatus[] = [];
      h.handle.onStatus((s) => seen.push(s));
      expect(seen).toEqual([
        {
          open: false,
          capture: true,
          entries: 12,
          capacity: 5000,
          problems: 2,
          nearFull: false,
          bytes: 3000,
          memoryStep: 0,
        },
      ]);
    });

    it('then at most once per frame, and only when a field changed', () => {
      const h = install();
      const seen: DebugPanelStatus[] = [];
      h.handle.onStatus((s) => seen.push(s));
      h.recorder.usageValue = { entries: 1, capacity: 5000, bytes: 200, problems: 0 };
      h.recorder.emit(quiet());
      h.recorder.usageValue = { entries: 2, capacity: 5000, bytes: 400, problems: 0 };
      h.recorder.emit(quiet());
      expect(seen.length).withContext('not before the frame').toBe(1);
      expect(h.frames.length).toBe(1);
      h.flushFrames();
      expect(seen.length).toBe(2);
      expect(seen[1]).toEqual(jasmine.objectContaining({ entries: 2, bytes: 400 }));
      h.recorder.statsChanged();
      h.flushFrames();
      expect(seen.length).withContext('nothing changed').toBe(2);
    });

    it('follows capture on/off, open/close, a size change and the memory step', async () => {
      const h = install({ memoryStep: 100 });
      const seen: DebugPanelStatus[] = [];
      h.handle.onStatus((s) => seen.push(s));
      h.controller.setOn(false);
      h.flushFrames();
      expect(seen[seen.length - 1]?.capture).toBeFalse();
      pressToggle();
      await settle();
      h.flushFrames();
      expect(seen[seen.length - 1]?.open).toBeTrue();
      h.recorder.setCapacity(Infinity);
      h.recorder.usageValue = { ...h.recorder.usageValue, bytes: 250, entries: 9 };
      h.flushFrames();
      expect(seen[seen.length - 1]).toEqual(
        jasmine.objectContaining({ capacity: Infinity, memoryStep: 2, nearFull: false }),
      );
      h.handle.close();
      h.flushFrames();
      expect(seen[seen.length - 1]?.open).toBeFalse();
    });

    it('asks for no frame while nobody listens; unsubscribe stops it', () => {
      const h = install();
      h.recorder.emit(quiet());
      expect(h.frames.length).toBe(0);
      const listener = jasmine.createSpy('listener');
      const off = h.handle.onStatus(listener);
      off();
      off();
      h.recorder.usageValue = { entries: 5, capacity: 5000, bytes: 1, problems: 0 };
      h.recorder.emit(quiet());
      expect(h.frames.length).toBe(0);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('a throwing listener is isolated: the others still hear, nothing reaches the host', () => {
      const h = install();
      const good = jasmine.createSpy('good');
      expect(() =>
        h.handle.onStatus(() => {
          throw new Error('host bug');
        }),
      ).not.toThrow();
      h.handle.onStatus(good);
      h.recorder.usageValue = { entries: 3, capacity: 5000, bytes: 1, problems: 0 };
      h.recorder.emit(quiet());
      expect(() => h.flushFrames()).not.toThrow();
      expect(good).toHaveBeenCalledTimes(2);
    });

    it('dispose stops it and cancels a waiting frame; the inert handle never calls', () => {
      const h = install();
      const listener = jasmine.createSpy('listener');
      h.handle.onStatus(listener);
      h.recorder.usageValue = { entries: 3, capacity: 5000, bytes: 1, problems: 0 };
      h.recorder.emit(quiet());
      h.handle.dispose();
      expect(h.cancelled.length).toBeGreaterThan(0);
      h.flushFrames();
      expect(listener).toHaveBeenCalledTimes(1);

      const inert = createDebugPanel(
        null,
        {},
        { scope: {} as LoaderScope, isProblemEntry, loadUi: async () => ({ mountPanelUi: fakeUi().mount }) },
      );
      const never = jasmine.createSpy('never');
      const off = inert.onStatus(never);
      expect(typeof off).toBe('function');
      off();
      expect(never).not.toHaveBeenCalled();
    });
  });
});
