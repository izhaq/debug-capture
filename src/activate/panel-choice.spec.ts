import type { CaptureController, DebugCaptureOptions } from '..';
import type { DebugPanelHandle, DebugPanelOptions } from '../panel';
import { ActivationModules, ActivationScope, createActivation, DebugActivationOptions } from './activate';

/**
 * S-17a (HLD §3.15 `FR-HL-08…10`, `D-57`): the `panel` option as a function —
 * a backend feature flag. Capture starts first and `ready` does not wait for
 * the answer; `false` never loads the panel; anything else that is not an
 * object fails closed. The page, the storage and the load are fakes.
 */
describe('installDebugActivation — panel from a function (FR-HL-08…10, D-57)', () => {
  let keyboard: EventTarget;
  let search: string;
  /** One entry per load: whether it asked for the panel entry too. */
  let loads: boolean[];
  let created: CaptureController[];
  let panels: Array<{ options: DebugPanelOptions | undefined; handle: DebugPanelHandle }>;
  let panelFails: unknown;

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

  const core = {
    createCaptureController: (_options?: DebugCaptureOptions): CaptureController => {
      const controller = fakeController();
      created.push(controller);
      return controller;
    },
  };
  const installDebugPanel: ActivationModules['installDebugPanel'] = (_controller, options) => {
    if (panelFails !== undefined) throw panelFails;
    const handle = jasmine.createSpyObj<DebugPanelHandle>('panel', ['open', 'close', 'dispose', 'onStatus']);
    panels.push({ options, handle });
    return handle;
  };

  function load(withPanel: boolean): Promise<ActivationModules> {
    loads.push(withPanel);
    return Promise.resolve(withPanel ? { ...core, installDebugPanel } : core);
  }

  function scope(): ActivationScope {
    return {
      addEventListener: keyboard.addEventListener.bind(keyboard),
      removeEventListener: keyboard.removeEventListener.bind(keyboard),
      location: { search },
    };
  }

  const start = (panel: DebugActivationOptions['panel']) => createActivation({ panel }, { scope: scope(), load });

  /** A promise the spec settles by hand. */
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }

  const settle = () => new Promise<void>((done) => setTimeout(done, 0));

  const press = () =>
    keyboard.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true, altKey: true, shiftKey: true, cancelable: true }),
    );

  beforeEach(() => {
    keyboard = new EventTarget();
    search = '?debug=1';
    loads = [];
    created = [];
    panels = [];
    panelFails = undefined;
  });

  it('ready resolves once capture is on, before the function answers; the panel follows the answer', async () => {
    const answer = deferred<DebugPanelOptions | false>();
    const choose = jasmine.createSpy('panel').and.returnValue(answer.promise);
    const debug = start(choose);

    await debug.ready;
    expect(created.length).toBe(1);
    expect(debug.controller).toBe(created[0]);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(debug.panel).toBeNull();
    expect(loads).toEqual([false]);

    answer.resolve({ defaultDock: 'right' });
    await settle();
    expect(loads).toEqual([false, true]);
    expect(panels.length).toBe(1);
    expect(panels[0].options?.defaultDock).toBe('right');
    expect(panels[0].options?.launcher).toBeTrue(); // D-41: ?debug=1 shows the DBG button
    expect(panels[0].options?.activation).toBe('ctrl+alt+shift+a');
    expect(debug.panel).toBe(panels[0].handle);
    expect(debug.panelError).toBeNull();
  });

  it('false: the panel entry is never loaded and no panel is installed; capture stays on', async () => {
    const debug = start(() => Promise.resolve(false));
    await debug.ready;
    await settle();

    expect(loads).toEqual([false]);
    expect(panels.length).toBe(0);
    expect(debug.panel).toBeNull();
    expect(debug.active).toBeTrue();
    expect(debug.controller).not.toBeNull();
    expect(debug.panelError).toBeNull();
  });

  it('a plain (not a promise) answer works too', async () => {
    const debug = start(() => ({}));
    await debug.ready;
    await settle();
    expect(panels.length).toBe(1);
    expect(debug.panel).toBe(panels[0].handle);
  });

  it('the function runs after the controller is created and the onChange listeners are told', async () => {
    const order: string[] = [];
    const debug = createActivation(
      {
        panel: () => {
          order.push(`panel (controllers: ${created.length})`);
          return false;
        },
      },
      { scope: scope(), load },
    );
    debug.onChange((controller) => order.push(controller ? 'onChange' : 'onChange null'));
    await debug.ready;
    await settle();
    expect(order).toEqual(['onChange', 'panel (controllers: 1)']);
  });

  it('fails closed: a throw, a rejection or a value that is neither false nor an object gives no panel', async () => {
    const boom = new Error('flag service down');
    const cases: Array<[string, () => unknown]> = [
      [
        'throws',
        () => {
          throw boom;
        },
      ],
      ['rejects', () => Promise.reject(boom)],
      ['true', () => true],
      ['null', () => null],
      ['a string', () => 'yes'],
      ['undefined', () => undefined],
    ];
    for (const [name, choose] of cases) {
      panels = [];
      created = [];
      const debug = start(choose as DebugActivationOptions['panel']);
      await debug.ready;
      await settle();
      expect(panels.length).withContext(name).toBe(0);
      expect(debug.panel).withContext(name).toBeNull();
      expect(debug.active).withContext(name).toBeTrue();
      expect(debug.controller).withContext(name).toBe(created[0]);
      expect(debug.panelError).withContext(name).not.toBeNull();
      expect(debug.loadError).withContext(name).toBeNull();
      if (name === 'throws' || name === 'rejects') expect(debug.panelError).withContext(name).toBe(boom);
      debug.dispose();
    }
  });

  it('a panel that fails to install: capture stays on, panelError set', async () => {
    panelFails = new Error('no custom elements');
    const debug = start(() => ({}));
    await debug.ready;
    await settle();
    expect(debug.active).toBeTrue();
    expect(debug.controller).not.toBeNull();
    expect(debug.panel).toBeNull();
    expect(debug.panelError).toBe(panelFails);
    expect(created[0].dispose).not.toHaveBeenCalled();
  });

  it('switched off before the answer: no panel is installed, ever', async () => {
    const answer = deferred<DebugPanelOptions | false>();
    const debug = start(() => answer.promise);
    await debug.ready;
    debug.deactivate();
    expect(debug.active).toBeFalse();

    answer.resolve({});
    await settle();
    expect(panels.length).toBe(0);
    expect(debug.panel).toBeNull();
    expect(debug.panelError).toBeNull();
  });

  it('off after the answer but before the panel entry lands: the panel is not installed', async () => {
    const panelLoad = deferred<ActivationModules>();
    const debug = createActivation(
      { panel: () => ({}) },
      {
        scope: scope(),
        load: (withPanel) => {
          loads.push(withPanel);
          return withPanel ? panelLoad.promise : Promise.resolve(core);
        },
      },
    );
    await debug.ready;
    await settle();
    expect(loads).toEqual([false, true]);
    debug.deactivate();
    panelLoad.resolve({ ...core, installDebugPanel });
    await settle();
    expect(panels.length).toBe(0);
  });

  it('is asked again at each switch-on, and the newer answer applies (not followed live)', async () => {
    search = '';
    let flag: DebugPanelOptions | false = false;
    const choose = jasmine.createSpy('panel').and.callFake(() => Promise.resolve(flag));
    const debug = start(choose);

    press();
    await settle();
    expect(choose).toHaveBeenCalledTimes(1);
    expect(debug.panel).toBeNull();

    flag = {}; // the backend changes its mind: nothing happens until the next switch-on
    await settle();
    expect(debug.panel).toBeNull();

    press(); // off
    press(); // on again
    await settle();
    expect(choose).toHaveBeenCalledTimes(2);
    expect(panels.length).toBe(1);
    expect(debug.panel).toBe(panels[0].handle);
    expect(panels[0].options?.launcher).toBe('hidden'); // D-41: the chord keeps the DBG button hidden
  });

  it('panelError is cleared by the next switch-on', async () => {
    search = '';
    let fail = true;
    const debug = start(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve(false)));
    press();
    await settle();
    expect(debug.panelError).not.toBeNull();
    press();
    fail = false;
    press();
    await settle();
    expect(debug.panelError).toBeNull();
  });

  it('a static value is unchanged: one load for core and panel, ready waits for the panel (as 2.4)', async () => {
    const debug = start({ defaultDock: 'right' });
    await debug.ready;
    expect(loads).toEqual([true]);
    expect(panels.length).toBe(1);
    expect(debug.panel).toBe(panels[0].handle);
    expect(debug.panelError).toBeNull();
  });

  it('a static false asks for the core only', async () => {
    const debug = start(false);
    await debug.ready;
    expect(loads).toEqual([false]);
    expect(panels.length).toBe(0);
    expect(debug.panel).toBeNull();
    expect(debug.active).toBeTrue();
  });

  it('a loader that has no panel entry (headless) installs none, also when asked', async () => {
    const debug = createActivation(
      { panel: {} },
      {
        scope: scope(),
        load: (withPanel) => {
          loads.push(withPanel);
          return Promise.resolve(core);
        },
      },
    );
    await debug.ready;
    expect(debug.active).toBeTrue();
    expect(debug.panel).toBeNull();
    expect(debug.loadError).toBeNull();
  });
});
