import type { CaptureController, CaptureEntry, IsProblemEntry, RecorderChange, Unsubscribe } from '..';
import type { MountPanelUi, PanelUiHandle } from './app';
import { DebugPanelHandle, DebugPanelOptions, DebugPanelStatus, PANEL_ELEMENT_NAME } from './api';
import { COUNT_CLASS, LAUNCHER_CLASS, LOADER_CSS, ROOT_CLASS } from './loader-styles';

/** The page the loader runs in: `window` in a host, a fake in specs (AGENTS rule 8). */
export interface LoaderScope {
  readonly document: Document;
  readonly HTMLElement: typeof HTMLElement;
  readonly CSSStyleSheet: typeof CSSStyleSheet;
  readonly customElements?: Pick<CustomElementRegistry, 'get' | 'define'>;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  getComputedStyle(element: Element): CSSStyleDeclaration;
  /** zone.js, when the host loaded it; read structurally, never imported. */
  readonly Zone?: unknown;
  /** Read once at install for the 2.1 Buffer and DBG button settings (`D-32`); a getter that may throw. */
  readonly localStorage?: Pick<Storage, 'getItem'>;
}

export interface LoaderDeps {
  readonly scope: LoaderScope;
  readonly isProblemEntry: IsProblemEntry;
  /** Loads the UI chunk (`import('./app')` in the entry). */
  readonly loadUi: () => Promise<{ readonly mountPanelUi: MountPanelUi }>;
  /** Specs only: a fresh tag per spec, because a page can never undefine one. */
  readonly elementName?: string;
}

/**
 * Shared by every copy of this loader on the page (two bundles, two
 * versions): `Symbol.for` keys, never `window` properties (ISO-15). OURS marks
 * an element class any copy defined, so a later copy reuses it instead of
 * calling `define` again (ISO-14). DISCONNECT is the one hook such a class
 * calls, so the class stays a dumb shell that works with any copy.
 */
const OURS = Symbol.for('debug-capture-panel-v2');
const DISCONNECT = Symbol.for('debug-capture-panel-v2:disconnect');
/** Set on the registered class while a handle is live, so any copy sees it even after the host removed the element. */
const LIVE = Symbol.for('debug-capture-panel-v2:live');

/**
 * Pointer, mouse, key, focus, input, clipboard and drag events that would
 * leave the panel retargeted to the host element and trip host "click
 * outside", hotkey and Escape handlers (ISO-07, research E1–E5, E9).
 */
const WALLED =
  'pointerdown pointerup pointermove pointerover pointerout pointercancel gotpointercapture lostpointercapture ' +
  'mousedown mouseup mousemove mouseover mouseout click dblclick auxclick contextmenu wheel ' +
  'touchstart touchmove touchend touchcancel keydown keyup keypress beforeinput input focusin focusout ' +
  'compositionstart compositionupdate compositionend copy cut paste ' +
  'dragstart drag dragend dragenter dragover dragleave drop';

const CLOSED = 0;
const OPENING = 1;
const OPEN = 2;
const DISPOSED = 3;

type Chord = (event: KeyboardEvent) => boolean;
type Run = <T>(work: () => T) => T;
type Popover = HTMLElement & { showPopover(): void; hidePopover(): void }; // not in TS 5.1's lib.dom yet
type Chunk = { readonly mountPanelUi: MountPanelUi };
type StatusListener = { readonly l: (status: DebugPanelStatus) => void; last: string };

export function inertHandle(): DebugPanelHandle {
  const none = (): void => undefined;
  return { open: none, close: none, isOpen: false, loadError: null, dispose: none, onStatus: () => none };
}

/**
 * The loader behind `installDebugPanel()`: one isolated host element with the
 * launcher and badge, the toggle shortcut, and the UI chunk on first open.
 * Never throws and never logs (ISO-12): a page that cannot hold the panel
 * gets an inert handle.
 */
export function createDebugPanel(
  controller: CaptureController | null,
  options: DebugPanelOptions = {},
  deps: LoaderDeps,
): DebugPanelHandle {
  if (controller === null) return inertHandle();
  const inRoot = rootZone(deps.scope.Zone);
  try {
    return inRoot(() => build(controller, options, deps, inRoot));
  } catch {
    return inertHandle();
  }
}

function build(controller: CaptureController, options: DebugPanelOptions, deps: LoaderDeps, inRoot: Run) {
  const { scope } = deps;
  const doc = scope.document;
  const html = doc.documentElement;
  const name = deps.elementName ?? PANEL_ELEMENT_NAME;
  // One panel per page (research rule 14): a second install, from this copy
  // or another, stays inert rather than stacking a second launcher.
  if (Array.from(html.children).some((child) => child.localName === name)) return inertHandle();
  if (!define(scope, name)) return inertHandle();
  const registered = (scope.customElements?.get(name) ?? {}) as unknown as Record<symbol, unknown>;
  if (registered[LIVE] === true) return inertHandle();

  const sheet = new scope.CSSStyleSheet();
  sheet.replaceSync(LOADER_CSS);
  const host = doc.createElement(name) as Popover;
  // Set once, before mount; the host element never changes again (ISO-15).
  host.setAttribute('popover', 'manual');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [sheet];

  const toggleChord = options.shortcut === false ? null : parseChord(options.shortcut ?? 'ctrl+alt+shift+p');
  const recorder = controller.session.recorder;
  const storageKey = options.storageKey ?? 'debug-capture:panel';

  // 2.1: the two settings that must hold before the first open (FR-BUF-01, FR-ACT-10, D-32).
  // Best effort: blocked storage or a broken value gives the defaults.
  let saved: { buffer?: unknown; launcher?: unknown } = {};
  try {
    if (storageKey !== false) saved = JSON.parse(scope.localStorage?.getItem(storageKey) ?? '{}') ?? {};
  } catch {
    // Defaults.
  }
  const buffer = saved.buffer;
  if (buffer === 'none' || (Number.isSafeInteger(buffer) && (buffer as number) >= 1)) {
    recorder.setCapacity(buffer === 'none' ? Infinity : (buffer as number));
  }
  // 2.2 (D-41): 'hidden' shows the button only when Settings stored Show.
  let showLauncher = options.launcher === 'hidden' ? saved.launcher === true : saved.launcher !== false;
  const limit = (value: unknown, fallback: number, max: number): number =>
    typeof value === 'number' && value > 0 && value <= max ? value : fallback;
  const nearFullAt = limit(options.nearFullAt, 0.9, 1);
  const memoryStep = limit(options.memoryStep, 26214400, Infinity);
  /** The banners' dismissed state lives here: it must outlive a close and reopen (FR-BUF-04, 05). */
  let fullDismissed = false;
  let memoryDismissed = 0;
  const statusListeners: StatusListener[] = [];
  let statusFrame: number | null = null;

  let state = CLOSED;
  let loadError: unknown = null;
  let ui: PanelUiHandle | null = null;
  let root: HTMLElement | null = null;
  let chunk: Chunk | null = null;
  let returnTo: HTMLElement | null = null;
  let attempt = 0;
  let quiet = false;
  let count = 0;
  let shown = 0;
  let frame: number | null = null;
  let launcher: HTMLButtonElement | null = null;
  let countNode: HTMLElement | null = null;
  const unsubscribe: Unsubscribe[] = [];

  /** Every callback: in the root zone (ISO-09), and never throws into the host or our own recorder (ISO-12). */
  const guard =
    <A extends unknown[]>(work: (...args: A) => void) =>
    (...args: A): void =>
      inRoot(() => {
        try {
          work(...args);
        } catch {
          // Swallowed on purpose — see above.
        }
      });

  /** Appends to `<html>`, after `<body>`, and shows in the top layer (ISO-01). */
  const mount = (): void => {
    if (host.parentNode !== html) {
      quiet = true;
      try {
        html.appendChild(host);
      } finally {
        quiet = false;
      }
    }
    try {
      host.showPopover();
    } catch {
      // Already showing.
    }
  };

  const render = (): void => {
    shown = count;
    if (launcher === null || countNode === null) return;
    countNode.textContent = count > 0 ? String(count) : '';
    countNode.hidden = count === 0;
    launcher.setAttribute(
      'aria-label',
      count > 0
        ? `DBG ${count}: open debug panel, ${count} new problem${count === 1 ? '' : 's'}`
        : 'DBG: open debug panel',
    );
  };

  const paint = guard(() => {
    frame = null;
    // The host removed us while the launcher had news: bring it back (ISO-20).
    if (host.parentNode !== html) mount();
    render();
  });

  /** One frame at most, and only when the number changed (NFR-PERF-01, D-07). */
  const schedule = (): void => {
    if (frame === null && count !== shown) frame = inRoot(() => scope.requestAnimationFrame(paint));
  };

  const close = (): void => {
    if (state !== OPENING && state !== OPEN) return;
    state = CLOSED;
    const mounted = ui;
    ui = null;
    try {
      mounted?.unmount();
    } catch {
      // The UI's failure must not keep the panel open.
    }
    if (root) {
      root.hidden = true;
      root.inert = true;
    }
    if (launcher) launcher.hidden = !showLauncher;
    count = 0;
    render();
    statusChanged();
    // Return focus only if it is still ours or was lost with our nodes —
    // never pull it away from where the user has moved it since (ISO-16).
    const active = deepActiveElement(doc);
    const target = returnTo;
    returnTo = null;
    if (target?.isConnected && (active === null || active === doc.body || active === host || shadow.contains(active))) {
      target.focus({ preventScroll: true });
    }
  };

  const show = (loaded: Chunk, byUser: boolean): void => {
    chunk = loaded;
    if (root === null) {
      root = doc.createElement('div');
      root.className = ROOT_CLASS;
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'false');
      root.setAttribute('aria-label', 'Debug panel');
      root.lang = 'en';
      root.dir = 'ltr';
      root.tabIndex = -1;
      // A wheel or scroll key the panel cannot use would scroll the host page
      // (research L9): `overscroll-behavior` does nothing on a box with no overflow.
      const panelRoot = root;
      panelRoot.addEventListener(
        'wheel',
        guard((event: Event) => {
          const wheel = event as WheelEvent;
          if (!canScroll(scope, wheel, panelRoot, wheel.deltaX, wheel.deltaY)) wheel.preventDefault();
        }),
        { passive: false },
      );
      panelRoot.addEventListener(
        'keydown',
        guard((event: Event) => {
          const key = event as KeyboardEvent;
          const way = SCROLL_KEYS[key.key];
          const target = key.composedPath()[0] as HTMLElement;
          // Ctrl+Home / Ctrl+End scroll the page too. Buttons, links and
          // summaries use only Space; every other scroll key would bubble up.
          if (
            !way ||
            key.defaultPrevented ||
            (key.ctrlKey && key.key !== 'Home' && key.key !== 'End') ||
            key.altKey ||
            key.metaKey ||
            target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
            (key.key === ' ' && /^(BUTTON|A|SUMMARY)$/.test(target.tagName))
          ) {
            return;
          }
          const dy = key.key === ' ' && key.shiftKey ? -1 : way[1];
          if (!canScroll(scope, key, panelRoot, way[0], dy)) key.preventDefault();
        }),
      );
      shadow.append(root);
    }
    root.hidden = false;
    root.inert = false;
    const mounted = loaded.mountPanelUi(shadow, controller, {
      document: doc,
      panelRoot: root,
      storageKey: options.storageKey ?? 'debug-capture:panel',
      defaultDock: options.defaultDock ?? 'bottom',
      onRequestClose: guard(close),
      launcher: launcher ? showLauncher : null,
      shortcuts: {
        toggle: options.shortcut === false ? false : (options.shortcut ?? 'ctrl+alt+shift+p'),
        activation: options.activation ?? false,
      },
      setLauncher: guard((show: boolean) => {
        // Hidden while open anyway; close() applies it.
        showLauncher = show;
      }),
      warnings: () => {
        const now = status();
        if (!now.nearFull) fullDismissed = false;
        if (now.memoryStep < memoryDismissed) memoryDismissed = now.memoryStep;
        return {
          nearFull: now.nearFull && !fullDismissed,
          memoryBytes: now.memoryStep > memoryDismissed ? now.bytes : 0,
        };
      },
      dismissWarning: guard((kind: string) => {
        if (kind === 'nearFull') fullDismissed = true;
        else memoryDismissed = status().memoryStep;
      }),
    });
    if (state !== OPENING) {
      // The UI asked to close while it mounted.
      mounted.unmount();
      return;
    }
    ui = mounted;
    state = OPEN;
    // A slow chunk: if the user has moved on to the host page meanwhile, leave their focus alone (ISO-16).
    const active = deepActiveElement(doc);
    if (byUser && (active === returnTo || active === doc.body || active === null || shadow.contains(active))) {
      root.focus({ preventScroll: true });
    }
  };

  /** `byUser`: the launcher or the shortcut. Only then does focus move in (ISO-16). */
  const open = (byUser: boolean): void => {
    if (state !== CLOSED) return;
    state = OPENING;
    loadError = null;
    statusChanged();
    mount();
    returnTo = deepActiveElement(doc);
    count = 0;
    if (launcher) launcher.hidden = true;
    const mine = ++attempt;
    const showIfStillWanted = (loaded: Chunk): void => {
      if (state === OPENING && mine === attempt) show(loaded, byUser);
    };
    const fail = (error: unknown): void => {
      if (state !== OPENING || mine !== attempt) return;
      loadError = error;
      close();
    };
    if (chunk !== null) {
      try {
        showIfStillWanted(chunk);
      } catch (error) {
        fail(error);
      }
      return;
    }
    // A failed load leaves `chunk` empty, so the next open tries again.
    new Promise<Chunk>((resolve) => resolve(deps.loadUi()))
      .then((loaded) => inRoot(() => showIfStillWanted(loaded)))
      .catch(guard(fail));
  };

  // The event wall (ISO-07): bubble phase, on the host element itself, so it
  // also catches events aimed at the host's own box (research E7). Never a
  // capture-phase guard: that would silence the panel's own listeners (D-16).
  const wall = (event: Event): void => {
    if (!isPassingChord(event, toggleChord)) event.stopPropagation();
  };
  for (const type of WALLED.split(' ')) host.addEventListener(type, wall, { passive: true });

  const onKey = guard((event: Event) => {
    const key = event as KeyboardEvent;
    if (toggleChord === null || !toggleChord(key)) return;
    key.preventDefault();
    if (!key.repeat) (state === CLOSED ? open : close)(true);
  });
  if (toggleChord) doc.addEventListener('keydown', onKey);

  // D-15: a fullscreen element enters the top layer above us; shown again, we
  // are on top of it. Hide + show in one task: nothing renders in between, and
  // focus stays where it was. Not when the host removed us (ISO-20).
  const raise = guard(() => {
    if (!host.isConnected) return;
    host.hidePopover();
    mount();
  });
  doc.addEventListener('fullscreenchange', raise);

  /** `DebugPanelStatus` now (FR-STAT-01). */
  const status = (): DebugPanelStatus => {
    const now = recorder.usage();
    return {
      open: state === OPENING || state === OPEN,
      capture: controller.on,
      entries: now.entries,
      capacity: now.capacity,
      problems: now.problems,
      nearFull: now.entries >= now.capacity * nearFullAt,
      bytes: now.bytes,
      memoryStep: Math.floor(now.bytes / memoryStep),
    };
  };
  /** Only what changed for this listener; its error is its own (ISO-12). */
  const tell = (listener: StatusListener, now: DebugPanelStatus): void => {
    const text = JSON.stringify(now) + now.capacity;
    if (text === listener.last) return;
    listener.last = text;
    try {
      listener.l(now);
    } catch {
      // The host's bug stays the host's.
    }
  };
  const sendStatus = guard(() => {
    statusFrame = null;
    const now = status();
    statusListeners.slice().forEach((listener) => tell(listener, now));
  });
  /** At most one frame, and none while nobody listens (NFR-PERF-01). */
  function statusChanged(): void {
    if (statusListeners.length > 0 && statusFrame === null) {
      statusFrame = inRoot(() => scope.requestAnimationFrame(sendStatus));
    }
  }
  let entriesHeard = false;
  /** Per entry only for the badge or a status listener (`launcher: false` alone costs nothing per entry). */
  const hearEntries = (): void => {
    if (entriesHeard) return;
    entriesHeard = true;
    unsubscribe.push(
      recorder.onEntry(
        guard((entry: CaptureEntry) => {
          if (launcher && state === CLOSED && deps.isProblemEntry(entry)) {
            count++;
            schedule();
          }
          statusChanged();
        }),
      ),
    );
  };
  unsubscribe.push(
    recorder.onChange(
      guard((change: RecorderChange) => {
        // A clear or a new size re-arms the near-full banner (FR-BUF-04).
        if (change.type !== 'stats') fullDismissed = false;
        if (change.type === 'cleared') {
          count = 0;
          schedule();
        }
        statusChanged();
      }),
    ),
    controller.onChange(guard(statusChanged)),
  );

  if (options.launcher !== false) {
    launcher = doc.createElement('button');
    launcher.type = 'button';
    launcher.className = LAUNCHER_CLASS;
    launcher.lang = 'en';
    launcher.dir = 'ltr';
    countNode = doc.createElement('span');
    countNode.className = COUNT_CLASS;
    launcher.append('DBG', countNode);
    launcher.addEventListener(
      'click',
      guard(() => open(true)),
    );
    launcher.hidden = !showLauncher;
    shadow.append(launcher);
    render();
    hearEntries();
  }

  const dispose = (): void => {
    if (state === DISPOSED) return;
    close();
    state = DISPOSED;
    unsubscribe.forEach((stop) => stop());
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('fullscreenchange', raise);
    if (frame !== null) scope.cancelAnimationFrame(frame);
    if (statusFrame !== null) scope.cancelAnimationFrame(statusFrame);
    statusListeners.length = 0;
    quiet = true;
    registered[LIVE] = false;
    host.remove();
  };

  // ISO-20: the host cleared the page. Clean up now; the next open (or the
  // next badge change) mounts again. No MutationObserver fight.
  (host as unknown as Record<symbol, unknown>)[DISCONNECT] = guard(() => {
    if (!quiet) close();
  });
  mount();

  registered[LIVE] = true;
  const handle: DebugPanelHandle = {
    open: guard(() => open(false)),
    close: guard(close),
    get isOpen() {
      return state === OPENING || state === OPEN;
    },
    get loadError() {
      return loadError;
    },
    dispose: guard(dispose),
    onStatus(l) {
      const listener: StatusListener = { l, last: '' };
      if (state !== DISPOSED) {
        statusListeners.push(listener);
        hearEntries();
        guard(() => tell(listener, status()))();
      }
      return () => {
        const at = statusListeners.indexOf(listener);
        if (at >= 0) statusListeners.splice(at, 1);
      };
    },
  };
  return handle;
}

/** `Zone.root.run` when zone.js is loaded, else a plain call (like the probes' `outsideZones`). */
function rootZone(zone: unknown): Run {
  const root = (zone as { root?: { run?: unknown } } | undefined)?.root;
  if (root && typeof root.run === 'function') {
    const zoneRoot = root as { run: Run };
    return (work) => zoneRoot.run(work);
  }
  return (work) => work();
}

/** `customElements.get` first: reuse a definition any copy of the loader made; never touch someone else's (ISO-14). */
function define(scope: LoaderScope, name: string): boolean {
  const registry = scope.customElements;
  if (!registry) return false;
  const existing = registry.get(name) as unknown as Record<symbol, unknown> | undefined;
  if (existing) return existing[OURS] === true;
  class PanelHost extends scope.HTMLElement {
    disconnectedCallback(): void {
      const hook = (this as unknown as Record<symbol, unknown>)[DISCONNECT];
      if (typeof hook === 'function') hook();
    }
  }
  (PanelHost as unknown as Record<symbol, unknown>)[OURS] = true;
  registry.define(name, PanelHost);
  return true;
}

/**
 * A deliberate copy of `install/shortcuts.ts` `parseShortcut`: P5 cannot import
 * L4 code within its loader budget, and this one also rejects a repeated modifier.
 * `'ctrl+alt+shift+p'` → an exact matcher on `KeyboardEvent.code` (layout-free,
 * like v1's shortcuts), or `null` for a chord it cannot read, so a typo binds
 * nothing instead of throwing. All four modifiers must match exactly (ISO-08).
 */
function parseChord(spec: unknown): Chord | null {
  if (typeof spec !== 'string') return null;
  const mods = new Set<string>();
  let code: string | null = null;
  for (const raw of spec.toLowerCase().split('+')) {
    const part = raw.trim();
    if (/^(ctrl|alt|shift|meta)$/.test(part)) {
      if (mods.has(part)) return null;
      mods.add(part);
    } else if (code === null && /^[a-z0-9]$/.test(part)) {
      code = (/\d/.test(part) ? 'Digit' : 'Key') + part.toUpperCase();
    } else {
      return null;
    }
  }
  const key = code;
  if (key === null) return null;
  return (e) =>
    e.code === key &&
    e.ctrlKey === mods.has('ctrl') &&
    e.altKey === mods.has('alt') &&
    e.shiftKey === mods.has('shift') &&
    e.metaKey === mods.has('meta');
}

/** The global `Ctrl+Alt+Shift+…` chords (capture's D/C/X and our toggle) cross the wall (research E8). */
function isPassingChord(event: Event, toggle: Chord | null): boolean {
  if (event.type.indexOf('key') !== 0) return false;
  const key = event as KeyboardEvent;
  // A chord needs a real key: a bare Shift with Ctrl+Alt held is still just typing.
  if (/^(Control|Alt|Shift|Meta)/.test(key.code)) return false;
  // AltGr+Shift reads as Ctrl+Alt+Shift on Windows: that is typing, not a chord.
  const chord = key.ctrlKey && key.altKey && key.shiftKey && !key.metaKey && !key.getModifierState('AltGraph');
  return chord || (toggle !== null && toggle(key));
}

/** Keys that scroll the focused box (or, failing that, the page), as [x, y] directions. */
const SCROLL_KEYS: Record<string, readonly [number, number] | undefined> = {
  ' ': [0, 1],
  PageDown: [0, 1],
  End: [0, 1],
  ArrowDown: [0, 1],
  PageUp: [0, -1],
  Home: [0, -1],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** Whether a box between the event's target and `root` can still scroll the `dx` / `dy` way. */
function canScroll(scope: LoaderScope, event: Event, root: HTMLElement, dx: number, dy: number): boolean {
  const can = (delta: number, overflow: string, at: number, size: number, total: number): boolean =>
    delta !== 0 && /auto|scroll/.test(overflow) && (delta > 0 ? Math.ceil(at + size) < total : at > 0);
  for (const node of event.composedPath()) {
    const el = node as HTMLElement;
    const style = scope.getComputedStyle(el);
    if (
      can(dy, style.overflowY, el.scrollTop, el.clientHeight, el.scrollHeight) ||
      can(dx, style.overflowX, el.scrollLeft, el.clientWidth, el.scrollWidth)
    ) {
      return true;
    }
    if (el === root) return false;
  }
  return false;
}

/** The focused element, looking through open shadow roots (ours included). */
function deepActiveElement(doc: Document): HTMLElement | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active as HTMLElement | null;
}
