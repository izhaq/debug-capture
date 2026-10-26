import type { CaptureController, CaptureSession, DebugCaptureOptions } from '..';
import type { DebugPanelHandle, DebugPanelOptions } from '../panel';

/** `localStorage[DEBUG_STORAGE_KEY] === '1'`: switched on for every page load in this browser (the key 2.0 already read). */
export const DEBUG_STORAGE_KEY = 'debug-capture';

/** Options for `installDebugActivation()` (HLD §6.4). Every field is optional. */
export interface DebugActivationOptions {
  /** The activation chord, matched on `KeyboardEvent.code`. Default `'ctrl+alt+shift+a'`; `false` binds none. */
  readonly shortcut?: string | false;
  /** Where the chord remembers "on" (`'1'`). Default `'debug-capture'`; `false` remembers nothing. */
  readonly storageKey?: string | false;
  /** Passed to `createCaptureController()`. */
  readonly capture?: DebugCaptureOptions;
  /** Passed to `installDebugPanel()` (`launcher` defaults to `'hidden'` here, `D-41`); `false` starts capture with no panel. */
  readonly panel?: DebugPanelOptions | false;
}

/** What `installDebugActivation()` returns (HLD §6.4). */
export interface DebugActivationHandle {
  /** `true` from switch-on (also while loading) until it is turned off. */
  readonly active: boolean;
  /** The capture session once loaded, else `null`. The seams take `() => handle.session` (`FR-BG-10`). */
  readonly session: CaptureSession | null;
  readonly controller: CaptureController | null;
  readonly panel: DebugPanelHandle | null;
  /** Why the last switch-on failed (the code did not load, or threw); `null` when it did not. */
  readonly loadError: unknown;
  /** Resolves when the start-time switch-on (`?debug=1` or the stored flag) has loaded or failed; never rejects. */
  readonly ready: Promise<void>;
  /** As the chord: on, and remembered. */
  activate(): void;
  /** As the chord again: off for good, the stored flag removed. */
  deactivate(): void;
  /** Removes the key listener and turns off; the stored flag stays. */
  dispose(): void;
}

/** What a switch-on loads: the core and the panel entry. */
export interface ActivationModules {
  createCaptureController(options?: DebugCaptureOptions): CaptureController;
  installDebugPanel(controller: CaptureController | null, options?: DebugPanelOptions): DebugPanelHandle;
}

/** The page, as far as this piece reads it. */
export interface ActivationScope {
  addEventListener(type: 'keydown', listener: (event: Event) => void): void;
  removeEventListener(type: 'keydown', listener: (event: Event) => void): void;
  readonly location?: { readonly search: string };
  /** A getter that may throw (blocked site data). */
  readonly localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** zone.js, when the host loaded it; read structurally, never imported. */
  readonly Zone?: unknown;
}

export interface ActivationDeps {
  readonly scope: ActivationScope;
  /** `import()` of the core and the panel entry (in `index.ts`). */
  readonly load: () => Promise<ActivationModules>;
}

type Run = <T>(work: () => T) => T;

/**
 * The activation piece (`FR-BG-01…03`, `D-40`, `D-45`): the only code a
 * station runs before the tool is switched on — one `keydown` listener and one
 * read of the flags. Everything else comes by `import()` when it is switched
 * on. Never throws and never logs (ISO-12): a page it cannot listen on gets
 * an inert handle.
 */
export function createActivation(options: DebugActivationOptions = {}, deps: ActivationDeps): DebugActivationHandle {
  try {
    return build(options, deps);
  } catch {
    const none = (): void => undefined;
    return {
      active: false,
      session: null,
      controller: null,
      panel: null,
      loadError: null,
      ready: Promise.resolve(),
      activate: none,
      deactivate: none,
      dispose: none,
    };
  }
}

function build(options: DebugActivationOptions, deps: ActivationDeps): DebugActivationHandle {
  const { scope } = deps;
  const key = options.storageKey ?? DEBUG_STORAGE_KEY;
  const chord = options.shortcut === false ? false : (options.shortcut ?? 'ctrl+alt+shift+a');
  const matches = chord === false ? null : parseChord(chord);
  const inRoot = rootZone(scope.Zone);
  /** Bumped by every switch-on and off, so a load that lands after a later press is dropped. */
  let generation = 0;
  let active = false;
  let loadError: unknown = null;
  let loaded: { controller: CaptureController; panel: DebugPanelHandle | null } | null = null;

  const remember = (on: boolean): void => {
    try {
      if (key !== false) {
        if (on) scope.localStorage?.setItem(key, '1');
        else scope.localStorage?.removeItem(key);
      }
    } catch {
      // Blocked storage: on for this page only.
    }
  };

  const on = (): Promise<void> => {
    if (active) return Promise.resolve();
    active = true;
    loadError = null;
    const mine = ++generation;
    return inRoot(() =>
      deps
        .load()
        .then((modules) => {
          if (mine !== generation) return;
          const controller = modules.createCaptureController(options.capture);
          try {
            // D-41: no visible sign — the DBG button starts hidden unless the host says otherwise.
            const panel =
              options.panel === false
                ? null
                : modules.installDebugPanel(controller, { launcher: 'hidden', ...options.panel, activation: chord });
            loaded = { controller, panel };
          } catch (error) {
            controller.dispose();
            throw error;
          }
        })
        .catch((error: unknown) => {
          if (mine !== generation) return;
          active = false;
          loadError = error;
        }),
    );
  };

  const off = (): void => {
    generation += 1;
    active = false;
    const was = loaded;
    loaded = null;
    try {
      was?.panel?.dispose();
    } catch {
      // The controller still goes.
    }
    try {
      was?.controller.dispose();
    } catch {
      // Nothing left to do.
    }
  };

  const toggle = (): void => {
    remember(!active);
    if (active) off();
    else void on();
  };

  const onKeyDown = (event: Event): void => {
    try {
      if (matches && typeof (event as Partial<KeyboardEvent>).code === 'string' && matches(event as KeyboardEvent)) {
        event.preventDefault();
        toggle();
      }
    } catch {
      // Swallowed on purpose (ISO-12).
    }
  };
  if (matches) inRoot(() => scope.addEventListener('keydown', onKeyDown));

  const ready = flagged(scope, key) ? on() : Promise.resolve();

  return {
    get active(): boolean {
      return active;
    },
    get session(): CaptureSession | null {
      return loaded?.controller.session ?? null;
    },
    get controller(): CaptureController | null {
      return loaded?.controller ?? null;
    },
    get panel(): DebugPanelHandle | null {
      return loaded?.panel ?? null;
    },
    get loadError(): unknown {
      return loadError;
    },
    ready,
    activate(): void {
      remember(true);
      void on();
    },
    deactivate(): void {
      remember(false);
      off();
    },
    dispose(): void {
      if (matches) scope.removeEventListener('keydown', onKeyDown);
      off();
    },
  };
}

/** A copy of `isDebugRequested()`'s rules (`D-45`): this piece may not import the core statically. */
function flagged(scope: ActivationScope, key: string | false): boolean {
  try {
    const value = new URLSearchParams(scope.location?.search ?? '').get('debug');
    if (value === '1' || value === 'true') return true;
  } catch {
    // Not set.
  }
  try {
    return key !== false && scope.localStorage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

function rootZone(zone: unknown): Run {
  const root = (zone as { root?: { run?: unknown } } | undefined)?.root;
  if (root && typeof root.run === 'function') {
    const zoneRoot = root as { run: Run };
    return (work) => zoneRoot.run(work);
  }
  return (work) => work();
}

/**
 * A deliberate copy of the panel loader's `parseChord` (itself a copy of
 * `install/shortcuts.ts`): this piece may not import either. `null` for a
 * chord it cannot read, so a typo binds nothing. All four modifiers exact (ISO-08).
 */
function parseChord(spec: unknown): ((event: KeyboardEvent) => boolean) | null {
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
  const wanted = code;
  if (wanted === null) return null;
  return (e) =>
    e.code === wanted &&
    e.ctrlKey === mods.has('ctrl') &&
    e.altKey === mods.has('alt') &&
    e.shiftKey === mods.has('shift') &&
    e.metaKey === mods.has('meta');
}
