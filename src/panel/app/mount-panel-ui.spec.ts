import type { CaptureController, CaptureEntry, ControlledCaptureSession, LiveRecorder } from './index';
import { DEFAULT_CAPTURE_POLICY, mountPanelUi } from './index';

/** The smallest real-shaped controller: an empty recorder that counts its listeners. */
function emptyController(): { controller: CaptureController; listeners: () => number } {
  const sets = [new Set<unknown>(), new Set<unknown>(), new Set<unknown>(), new Set<unknown>()];
  const add =
    (set: Set<unknown>) =>
    (listener: unknown): (() => void) => {
      set.add(listener);
      return () => set.delete(listener);
    };
  const recorder = {
    record: () => undefined,
    snapshot: (): readonly CaptureEntry[] => [],
    clear: () => undefined,
    stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
    pending: () => [],
    onEntry: add(sets[0] as Set<unknown>),
    onPending: add(sets[1] as Set<unknown>),
    onChange: add(sets[2] as Set<unknown>),
  } as unknown as LiveRecorder;
  const session = {
    recorder,
    policy: DEFAULT_CAPTURE_POLICY,
    clock: { now: () => 0 },
    active: true,
    toJson: () => '{}',
    download: () => undefined,
    copy: async () => false,
    clear: () => undefined,
    dispose: () => undefined,
  } as unknown as ControlledCaptureSession;
  const controller: CaptureController = {
    session,
    on: true,
    start: () => undefined,
    stop: () => undefined,
    onChange: add(sets[3] as Set<unknown>) as CaptureController['onChange'],
  };
  return { controller, listeners: () => sets.reduce((n, set) => n + set.size, 0) };
}

describe('mountPanelUi (P4 entry, real window)', () => {
  let host: HTMLElement;
  let shadow: ShadowRoot;
  let panelRoot: HTMLElement;
  let onRequestClose: jasmine.Spy<() => void>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    // The loader's panel root (S02-10), handed over as `panelRoot` (S02-09, C3-2).
    panelRoot = document.createElement('div');
    panelRoot.className = 'dcp-root';
    panelRoot.tabIndex = -1;
    shadow.appendChild(panelRoot);
    onRequestClose = jasmine.createSpy('onRequestClose');
  });

  afterEach(() => host.remove());

  const mount = (controller: CaptureController) =>
    mountPanelUi(shadow, controller, { document, panelRoot, storageKey: false, defaultDock: 'bottom', onRequestClose });

  it('builds the frame in the panelRoot it is given, never in one found by class (C3-2), and renders on a real frame', async () => {
    const decoy = document.createElement('div');
    decoy.className = 'dcp-root';
    shadow.insertBefore(decoy, panelRoot);
    const ui = mount(emptyController().controller);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(decoy.childNodes.length).toBe(0);
    expect(panelRoot.querySelector('.dcp-frame')).not.toBeNull();
    expect(panelRoot.querySelector('.dcp-statusbar')?.textContent).toContain('buffer 0 / 5,000');
    ui.unmount();
  });

  it('asks the loader to close from the close button and Escape; unmount leaves only the loader’s root', () => {
    const { controller, listeners } = emptyController();
    const ui = mount(controller);
    expect(listeners()).toBe(4);

    (panelRoot.querySelector('button[aria-label="Close debug panel"]') as HTMLButtonElement).click();
    panelRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ui.unmount();
    panelRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(onRequestClose).toHaveBeenCalledTimes(2);
    expect(panelRoot.childNodes.length).toBe(0);
    expect(Array.from(shadow.childNodes)).toEqual([panelRoot]);
    expect(listeners()).toBe(0);
  });
});
