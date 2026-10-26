import type { CaptureController } from '../views';
import { DEBUG_CAPTURE_VERSION, DEFAULT_SHORTCUTS } from '../views';
import { mountFrame } from './frame';
import { createRig, createStage, frameOptions, NO_CONTROLLER, Rig, Stage } from './fakes.spec';
import type { MountPanelUiOptions } from './mount-panel-ui';
import type { PanelUiHandle } from './index';

/** S-13b in the frame (S13-15, S13-16): About in Settings; the stored DBG choice follows the loader. */
describe('S-13 frame (mountFrame)', () => {
  let stage: Stage;
  let rig: Rig;

  beforeEach(() => {
    stage = createStage();
    rig = createRig();
  });
  afterEach(() => stage.remove());

  const mount = (controller: CaptureController, extra: Partial<MountPanelUiOptions> = {}): PanelUiHandle =>
    mountFrame(stage.root, controller, frameOptions(stage, extra), rig.deps);
  const q = <T extends Element = HTMLElement>(selector: string): T =>
    stage.panelRoot.querySelector(selector) as unknown as T;
  const stored = (): Record<string, unknown> => JSON.parse(rig.storage.items.get('dcp-spec') ?? '{}');
  const withChords = {
    shortcuts: { ...DEFAULT_SHORTCUTS, record: 'ctrl+alt+shift+r' },
  } as unknown as CaptureController;

  it('the Settings popover ends with About: the version and the chords in use (FR-BG-09)', () => {
    mount(withChords, { shortcuts: { toggle: 'ctrl+alt+shift+9', activation: 'ctrl+alt+shift+a' } });
    const popover = q('.dcp-pop[aria-label="Settings"]');
    const about = popover.querySelector('.dcp-about') as HTMLElement;

    expect(about).not.toBeNull();
    expect(popover.lastElementChild?.contains(about) || popover.contains(about)).toBeTrue();
    expect(about.textContent).toContain(`debug-capture ${DEBUG_CAPTURE_VERSION}`);
    const keys = Array.from(about.querySelectorAll('tr')).map((tr) => (tr.firstElementChild?.textContent ?? '').trim());
    expect(keys.slice(0, 7)).toEqual([
      'Ctrl+Alt+Shift+A',
      'Ctrl+Alt+Shift+9',
      'Ctrl+Alt+Shift+D',
      'Ctrl+Alt+Shift+C',
      'Ctrl+Alt+Shift+X',
      'Ctrl+Alt+Shift+R',
      'Ctrl+Alt+Shift+M',
    ]);
  });

  it('a controller without chords (shortcuts null) shows the capture chords as off', () => {
    mount(NO_CONTROLLER);
    const about = q('.dcp-about');
    const keys = Array.from(about.querySelectorAll('tr')).map((tr) => (tr.firstElementChild?.textContent ?? '').trim());
    expect(keys.slice(0, 6)).toEqual(['Ctrl+Alt+Shift+P', 'off', 'off', 'off', 'off', 'off']);
  });

  it('any settings save stores the DBG choice the loader has — a hidden button stays hidden after a reload (D-41)', () => {
    mount(NO_CONTROLLER, { launcher: false });
    q<HTMLInputElement>('input[name="dcp-setting-theme"][value="dark"]').click();
    expect(stored()['launcher']).toBeFalse();
  });

  it('…and a shown one stays shown', () => {
    rig.storage.items.set('dcp-spec', JSON.stringify({ launcher: false }));
    mount(NO_CONTROLLER, { launcher: true });
    q<HTMLInputElement>('input[name="dcp-setting-theme"][value="dark"]').click();
    expect(stored()['launcher']).toBeTrue();
  });
});
