import type { CaptureController, CaptureSession, DebugCaptureOptions } from '..';
import type { DebugPanelHandle, DebugPanelOptions } from '../panel';
import { ActivationModules, ActivationScope, createActivation, DEBUG_STORAGE_KEY } from './activate';

/**
 * S-13a (HLD §3.11 `FR-BG-01…03`, `D-40`, `D-45`): the activation piece. The
 * page, the storage and the lazy load are fakes; the specs never import the
 * real core or panel, which is the point of the piece.
 */
describe('installDebugActivation — 2.2 (FR-BG-01…03)', () => {
  let keyboard: EventTarget;
  let stored: Map<string, string>;
  let search: string;
  let loads: number;
  let release: Array<() => void>;
  let fail: unknown;
  let held: boolean;
  let created: Array<{ options: DebugCaptureOptions | undefined; controller: CaptureController }>;
  let panels: Array<{ options: DebugPanelOptions | undefined; handle: DebugPanelHandle }>;

  function fakeController(): CaptureController {
    const session = { active: true } as unknown as CaptureController['session'];
    return jasmine.createSpyObj<CaptureController>('controller', ['start', 'stop', 'onChange', 'dispose'], {
      session,
      on: true,
      shortcuts: null,
    });
  }

  const modules: ActivationModules = {
    createCaptureController: (options) => {
      const controller = fakeController();
      created.push({ options, controller });
      return controller;
    },
    installDebugPanel: (_controller, options) => {
      const handle = jasmine.createSpyObj<DebugPanelHandle>('panel', ['open', 'close', 'dispose', 'onStatus']);
      panels.push({ options, handle });
      return handle;
    },
  };

  function scope(overrides: Partial<ActivationScope> = {}): ActivationScope {
    return {
      addEventListener: keyboard.addEventListener.bind(keyboard),
      removeEventListener: keyboard.removeEventListener.bind(keyboard),
      location: { search },
      localStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => void stored.set(key, value),
        removeItem: (key) => void stored.delete(key),
      },
      ...overrides,
    };
  }

  function load(): Promise<ActivationModules> {
    loads += 1;
    if (fail !== undefined) return Promise.reject(fail);
    if (!held) return Promise.resolve(modules);
    return new Promise((done) => release.push(() => done(modules)));
  }

  function chord(code = 'KeyA', extra: KeyboardEventInit = {}): KeyboardEvent {
    const key = new KeyboardEvent('keydown', {
      code,
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      cancelable: true,
      ...extra,
    });
    keyboard.dispatchEvent(key);
    return key;
  }

  /** Lets the fake load's promise chain settle. */
  const settle = () => new Promise<void>((done) => setTimeout(done, 0));

  beforeEach(() => {
    keyboard = new EventTarget();
    stored = new Map();
    search = '';
    loads = 0;
    release = [];
    fail = undefined;
    held = false;
    created = [];
    panels = [];
  });

  it('DEBUG_STORAGE_KEY is the key 2.0 already read', () => {
    expect(DEBUG_STORAGE_KEY).toBe('debug-capture');
  });

  it('before switch-on: nothing loads, nothing is created, ready resolves at once', async () => {
    const debug = createActivation({}, { scope: scope(), load });
    await debug.ready;

    expect(loads).toBe(0);
    expect(debug.active).toBeFalse();
    expect(debug.session).toBeNull();
    expect(debug.controller).toBeNull();
    expect(debug.panel).toBeNull();
  });

  it('the chord switches on: loads once, creates the controller and the panel, remembers it', async () => {
    const capture: DebugCaptureOptions = { shortcuts: false };
    const debug = createActivation({ capture, panel: { defaultDock: 'right' } }, { scope: scope(), load });

    const key = chord();
    expect(key.defaultPrevented).toBeTrue();
    expect(debug.active).toBeTrue();
    expect(stored.get('debug-capture')).toBe('1');
    await settle();

    expect(loads).toBe(1);
    expect(created.length).toBe(1);
    expect(created[0].options).toBe(capture);
    expect(debug.controller).toBe(created[0].controller);
    expect(debug.session).toBe(created[0].controller.session as CaptureSession);
    expect(panels.length).toBe(1);
    expect(panels[0].options?.defaultDock).toBe('right');
    expect(debug.panel).toBe(panels[0].handle);
    expect(panels[0].handle.open).not.toHaveBeenCalled();
  });

  it('matches all four modifiers exactly, on KeyboardEvent.code', () => {
    const debug = createActivation({}, { scope: scope(), load });
    chord('KeyA', { altKey: false });
    chord('KeyA', { metaKey: true });
    chord('KeyB');
    expect(debug.active).toBeFalse();
    chord('KeyA', { key: 'å' });
    expect(debug.active).toBeTrue();
  });

  it('a stored flag switches on at start, without writing; ready waits for the load', async () => {
    stored.set('debug-capture', '1');
    held = true;
    const debug = createActivation({}, { scope: scope(), load });
    let ready = false;
    void debug.ready.then(() => (ready = true));
    await settle();
    expect(debug.active).toBeTrue();
    expect(ready).toBeFalse();

    release.forEach((go) => go());
    await debug.ready;
    expect(created.length).toBe(1);
  });

  it('?debug=1 and ?debug=true switch on for this load only: the flag is never written (D-45)', async () => {
    for (const query of ['?debug=1', '?x=2&debug=true']) {
      search = query;
      const debug = createActivation({}, { scope: scope(), load });
      await debug.ready;
      expect(debug.active).withContext(query).toBeTrue();
      expect(stored.has('debug-capture')).withContext(query).toBeFalse();
      debug.dispose();
    }
    search = '?debug=0';
    expect(createActivation({}, { scope: scope(), load }).active).toBeFalse();
  });

  it('the chord again turns off for good: flag removed, panel and controller disposed', async () => {
    const debug = createActivation({}, { scope: scope(), load });
    chord();
    await settle();

    chord();

    expect(debug.active).toBeFalse();
    expect(stored.has('debug-capture')).toBeFalse();
    expect(panels[0].handle.dispose).toHaveBeenCalledTimes(1);
    expect(created[0].controller.dispose).toHaveBeenCalledTimes(1);
    expect(debug.session).toBeNull();
    expect(debug.panel).toBeNull();

    chord();
    await settle();
    expect(created.length).toBe(2);
    expect(debug.controller).toBe(created[1].controller);
  });

  it('the chord also turns off a page switched on by ?debug=1 (D-45)', async () => {
    search = '?debug=1';
    const debug = createActivation({}, { scope: scope(), load });
    await debug.ready;

    chord();

    expect(debug.active).toBeFalse();
    expect(created[0].controller.dispose).toHaveBeenCalled();
  });

  it('a press while loading wins: the load lands and creates nothing', async () => {
    held = true;
    const debug = createActivation({}, { scope: scope(), load });
    chord();
    chord();
    release.forEach((go) => go());
    await settle();

    expect(debug.active).toBeFalse();
    expect(created.length).toBe(0);
    expect(stored.has('debug-capture')).toBeFalse();
  });

  it('a failed load: off, loadError set, the flag kept for the next page load', async () => {
    fail = new Error('chunk 404');
    const debug = createActivation({}, { scope: scope(), load });
    chord();
    await settle();

    expect(debug.active).toBeFalse();
    expect(debug.loadError).toBe(fail);
    expect(stored.get('debug-capture')).toBe('1');

    fail = undefined;
    chord();
    await settle();
    expect(debug.active).toBeTrue();
    expect(debug.loadError).toBeNull();
  });

  it('a throwing createCaptureController counts as a failed load; ready still resolves', async () => {
    stored.set('debug-capture', '1');
    const broken = new RangeError('bad policy');
    const debug = createActivation(
      {},
      {
        scope: scope(),
        load: () =>
          Promise.resolve({
            ...modules,
            createCaptureController: () => {
              throw broken;
            },
          }),
      },
    );
    await debug.ready;
    expect(debug.active).toBeFalse();
    expect(debug.loadError).toBe(broken);
  });

  it("2.2 (D-41, FR-BG-09): the panel starts with launcher 'hidden' and gets the activation chord for About", async () => {
    const plain = createActivation({}, { scope: scope(), load });
    plain.activate();
    await settle();
    expect(panels[0].options).toEqual({ launcher: 'hidden', activation: 'ctrl+alt+shift+a' });
    plain.dispose();

    const custom = createActivation(
      { shortcut: 'ctrl+alt+shift+9', panel: { launcher: true, defaultDock: 'right' } },
      { scope: scope(), load },
    );
    custom.activate();
    await settle();
    expect(panels[1].options).toEqual({ launcher: true, defaultDock: 'right', activation: 'ctrl+alt+shift+9' });
    custom.dispose();

    const keyless = createActivation({ shortcut: false }, { scope: scope(), load });
    keyless.activate();
    await settle();
    expect(panels[2].options).toEqual({ launcher: 'hidden', activation: false });
  });

  it('?debug=1 shows the DBG button; the stored flag and the chord keep it hidden (D-41)', async () => {
    search = '?debug=1';
    stored.set('debug-capture', '1');
    const byUrl = createActivation({}, { scope: scope(), load });
    await byUrl.ready;
    expect(panels[0].options?.launcher).toBeTrue();
    // Turned off and on again by the chord in the same page: the chord's rule.
    chord();
    chord();
    await settle();
    expect(panels[1].options?.launcher).toBe('hidden');
    byUrl.dispose();

    search = '';
    const byStore = createActivation({}, { scope: scope(), load });
    await byStore.ready;
    expect(panels[2].options?.launcher).toBe('hidden');
    byStore.dispose();

    search = '?debug=true';
    const custom = createActivation({ panel: { launcher: false } }, { scope: scope(), load });
    await custom.ready;
    expect(panels[3].options?.launcher).toBeFalse();
  });

  it('panel: false starts capture with no panel', async () => {
    const debug = createActivation({ panel: false }, { scope: scope(), load });
    debug.activate();
    await settle();
    expect(created.length).toBe(1);
    expect(panels.length).toBe(0);
    expect(debug.panel).toBeNull();
  });

  it('activate() and deactivate() act as the chord; repeated calls are no-ops', async () => {
    const debug = createActivation({}, { scope: scope(), load });
    debug.activate();
    debug.activate();
    await settle();
    expect(loads).toBe(1);
    debug.deactivate();
    debug.deactivate();
    expect(created[0].controller.dispose).toHaveBeenCalledTimes(1);
    expect(stored.has('debug-capture')).toBeFalse();
  });

  it('a custom chord and storage key; shortcut: false binds nothing; storageKey: false stores nothing', async () => {
    const custom = createActivation({ shortcut: 'ctrl+alt+shift+9', storageKey: 'my-key' }, { scope: scope(), load });
    chord('KeyA');
    expect(custom.active).toBeFalse();
    chord('Digit9');
    expect(custom.active).toBeTrue();
    expect(stored.get('my-key')).toBe('1');
    custom.dispose();

    const target = jasmine.createSpyObj<ActivationScope>('scope', ['addEventListener', 'removeEventListener']);
    createActivation({ shortcut: false }, { scope: { ...scope(), ...target }, load });
    expect(target.addEventListener).not.toHaveBeenCalled();

    stored.clear();
    const memoryOnly = createActivation({ storageKey: false }, { scope: scope(), load });
    memoryOnly.activate();
    expect(stored.size).toBe(0);
    memoryOnly.dispose();
  });

  it('storage that throws counts as "not set"; the chord still works for this page', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const debug = createActivation({}, { scope: scope({ localStorage: throwing }), load });
    expect(debug.active).toBeFalse();
    chord();
    await settle();
    expect(debug.active).toBeTrue();
    chord();
    expect(debug.active).toBeFalse();
  });

  it('dispose() removes the listener and turns off, keeping the flag', async () => {
    const debug = createActivation({}, { scope: scope(), load });
    chord();
    await settle();

    debug.dispose();

    expect(debug.active).toBeFalse();
    expect(created[0].controller.dispose).toHaveBeenCalled();
    expect(stored.get('debug-capture')).toBe('1');
    expect(chord().defaultPrevented).toBeFalse();
  });

  it('listens and loads in the root zone when zone.js is there (ISO-09)', () => {
    const run = jasmine.createSpy('Zone.root.run').and.callFake((work: () => unknown) => work());
    createActivation({}, { scope: scope({ Zone: { root: { run } } }), load });
    expect(run).toHaveBeenCalled();
  });

  it('never throws: a page without addEventListener gets an inert handle', async () => {
    const odd = { ...scope(), addEventListener: undefined } as unknown as ActivationScope;
    const debug = createActivation({}, { scope: odd, load });
    expect(debug.active).toBeFalse();
    await debug.ready;
    expect(() => debug.activate()).not.toThrow();
  });
});
