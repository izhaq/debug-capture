import type { CaptureController, DebugCaptureOptions } from '..';
import { ActivationScope, CoreModules, createHeadlessActivation, DebugActivationOptions } from './activate';

/**
 * S-17a (HLD §3.15 `FR-HL-01…05`, `D-56`): the headless activation piece —
 * the same switch-on and off as `debug-capture/activate`, with only the core
 * loaded and never a panel. The page, the storage and the load are fakes.
 */
describe('installDebugActivation — headless (FR-HL-01…05, D-56)', () => {
  let keyboard: EventTarget;
  let stored: Map<string, string>;
  let search: string;
  let loads: number;
  let created: Array<{ options: DebugCaptureOptions | undefined; controller: CaptureController }>;
  let fail: unknown;

  function fakeController(): CaptureController {
    const session = {
      active: true,
      addMessage: jasmine.createSpy('addMessage'),
    } as unknown as CaptureController['session'];
    return jasmine.createSpyObj<CaptureController>('controller', ['start', 'stop', 'onChange', 'dispose'], {
      session,
      on: true,
      shortcuts: null,
    });
  }

  /** The core alone: the headless loader has no panel entry to give. */
  function load(): Promise<CoreModules> {
    loads += 1;
    if (fail !== undefined) return Promise.reject(fail);
    return Promise.resolve({
      createCaptureController: (options?: DebugCaptureOptions) => {
        const controller = fakeController();
        created.push({ options, controller });
        return controller;
      },
    });
  }

  function scope(): ActivationScope {
    return {
      addEventListener: keyboard.addEventListener.bind(keyboard),
      removeEventListener: keyboard.removeEventListener.bind(keyboard),
      location: { search },
      localStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => void stored.set(key, value),
        removeItem: (key) => void stored.delete(key),
      },
    };
  }

  function chord(code = 'KeyA'): KeyboardEvent {
    const key = new KeyboardEvent('keydown', {
      code,
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      cancelable: true,
    });
    keyboard.dispatchEvent(key);
    return key;
  }

  const settle = () => new Promise<void>((done) => setTimeout(done, 0));

  beforeEach(() => {
    keyboard = new EventTarget();
    stored = new Map();
    search = '';
    loads = 0;
    created = [];
    fail = undefined;
  });

  it('before switch-on nothing loads; the chord loads the core once, starts capture, installs no panel', async () => {
    const capture: DebugCaptureOptions = { shortcuts: false };
    const debug = createHeadlessActivation({ capture }, { scope: scope(), load });
    await debug.ready;
    expect(loads).toBe(0);

    expect(chord().defaultPrevented).toBeTrue();
    expect(stored.get('debug-capture')).toBe('1');
    await settle();
    expect(loads).toBe(1);
    expect(created.length).toBe(1);
    expect(created[0].options).toBe(capture);
    expect(debug.controller).toBe(created[0].controller);
    expect(debug.session).toBe(created[0].controller.session);
    expect(debug.panel).toBeNull();
    expect(debug.panelError).toBeNull();
  });

  it('?debug=1 and the stored flag switch on at start; ready waits for the core (FR-BG-02)', async () => {
    search = '?debug=1';
    const byUrl = createHeadlessActivation({}, { scope: scope(), load });
    await byUrl.ready;
    expect(byUrl.controller).not.toBeNull();
    expect(byUrl.panel).toBeNull();
    expect(stored.has('debug-capture')).toBeFalse();
    byUrl.dispose();

    search = '';
    stored.set('debug-capture', '1');
    const byStore = createHeadlessActivation({}, { scope: scope(), load });
    await byStore.ready;
    expect(byStore.controller).not.toBeNull();
    expect(byStore.panel).toBeNull();
  });

  it('the chord again turns off for good: controller disposed, flag removed (FR-BG-03)', async () => {
    const debug = createHeadlessActivation({}, { scope: scope(), load });
    chord();
    await settle();
    chord();
    expect(debug.active).toBeFalse();
    expect(debug.controller).toBeNull();
    expect(created[0].controller.dispose).toHaveBeenCalledTimes(1);
    expect(stored.has('debug-capture')).toBeFalse();
  });

  it('a press while loading wins; a failed load sets loadError and keeps the flag', async () => {
    const debug = createHeadlessActivation({}, { scope: scope(), load });
    chord();
    chord();
    await settle();
    expect(created.length).toBe(0);
    expect(debug.controller).toBeNull();

    fail = new Error('chunk missing');
    chord();
    await settle();
    expect(debug.active).toBeFalse();
    expect(debug.loadError).toBe(fail);
    expect(stored.get('debug-capture')).toBe('1');
  });

  it('message() and onChange() work as with the panel (FR-MSG-02, S-16b)', async () => {
    const debug = createHeadlessActivation({}, { scope: scope(), load });
    const seen: Array<CaptureController | null> = [];
    debug.onChange((controller) => seen.push(controller));
    chord();
    await settle();
    debug.message('order-saved', { id: 7 }, 'warn');
    expect(created[0].controller.session.addMessage).toHaveBeenCalledOnceWith('order-saved', { id: 7 }, 'warn');
    chord();
    expect(seen).toEqual([created[0].controller, null]);
  });

  it('a panel option passed anyway (from JavaScript) is ignored: nothing asks for a panel', async () => {
    search = '?debug=1';
    const choose = jasmine.createSpy('panel').and.returnValue({});
    const options = { panel: choose } as unknown as DebugActivationOptions;
    const debug = createHeadlessActivation(options, { scope: scope(), load });
    await debug.ready;
    await settle();
    expect(choose).not.toHaveBeenCalled();
    expect(debug.panel).toBeNull();
    expect(debug.panelError).toBeNull();
  });

  it('a custom chord and shortcut: false work as with the panel', async () => {
    const custom = createHeadlessActivation({ shortcut: 'ctrl+alt+shift+9' }, { scope: scope(), load });
    chord('KeyA');
    expect(custom.active).toBeFalse();
    chord('Digit9');
    expect(custom.active).toBeTrue();
    custom.dispose(); // keeps the stored flag (FR-BG-03), so clear it for the next handle
    stored.clear();

    const none = createHeadlessActivation({ shortcut: false }, { scope: scope(), load });
    expect(chord().defaultPrevented).toBeFalse();
    expect(none.active).toBeFalse();
  });
});
