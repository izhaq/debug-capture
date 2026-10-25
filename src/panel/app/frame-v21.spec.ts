import { mountFrame } from './frame';
import { createRig, createStage, frameOptions, logEntry, NO_CONTROLLER, Rig, Stage } from './fakes.spec';
import type { MountPanelUiOptions, PanelWarnings } from './mount-panel-ui';
import type { PanelUiHandle } from './index';

/** S-11b in the frame (S11-08, S11-10, S11-11, S11-12, S11-14): Buffer, DBG button, banners, Add note. */
describe('S-11 frame (mountFrame)', () => {
  let stage: Stage;
  let rig: Rig;

  beforeEach(() => {
    stage = createStage();
    rig = createRig();
  });
  afterEach(() => stage.remove());

  const mount = (extra: Partial<MountPanelUiOptions> = {}): PanelUiHandle =>
    mountFrame(stage.root, NO_CONTROLLER, frameOptions(stage, extra), rig.deps);
  const q = <T extends Element = HTMLElement>(selector: string): T =>
    stage.panelRoot.querySelector(selector) as unknown as T;
  const named = (name: string, within: ParentNode = stage.panelRoot): HTMLButtonElement => {
    const found = Array.from(within.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === name || b.textContent === name,
    );
    if (!found) throw new Error(`no button named ${name}`);
    return found;
  };
  const radio = (name: string, value: string): HTMLInputElement =>
    q<HTMLInputElement>(`input[name="dcp-setting-${name}"][value="${value}"]`);
  const values = (name: string): string[] =>
    Array.from(stage.panelRoot.querySelectorAll<HTMLInputElement>(`input[name="dcp-setting-${name}"]`)).map(
      (input) => `${input.value}:${(input.parentElement?.textContent ?? '').trim()}`,
    );
  const stored = (): Record<string, unknown> => JSON.parse(rig.storage.items.get('dcp-spec') ?? '{}');
  const statusText = (): string => (q('.dcp-statusbar').textContent ?? '').replace(/\s+/g, ' ');
  const banner = (kind: string): HTMLElement => q(`.dcp-banner[data-warning="${kind}"]`);
  const press = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  describe('Buffer (S11-08, FR-BUF-01…03)', () => {
    it('lists 1,000 · 5,000 · 10,000 · 50,000 · No limit with the live size checked', () => {
      mount();
      rig.scope.frame();
      expect(values('buffer')).toEqual(['1000:1,000', '5000:5,000', '10000:10,000', '50000:50,000', 'none:No limit']);
      expect(radio('buffer', '5000').checked).toBeTrue();
    });

    it('adds the policy default and the live size when they are not in the list', () => {
      rig.source.defaultCapacity = () => 2_000;
      rig.source.capacityValue = 7_500;
      mount();
      rig.scope.frame();
      expect(values('buffer').map((v) => v.split(':')[0])).toEqual([
        '1000',
        '2000',
        '5000',
        '7500',
        '10000',
        '50000',
        'none',
      ]);
      expect(radio('buffer', '7500').checked).toBeTrue();
    });

    it('a choice sets the recorder size and is stored; the status bar follows', () => {
      mount();
      rig.scope.frame();
      radio('buffer', '1000').click();
      rig.scope.frame();
      expect(rig.source.calls).toEqual(['capacity 1000']);
      expect(stored()['buffer']).toBe(1_000);
      expect(statusText()).toContain('buffer 0 / 1,000');
    });

    it('No limit: Infinity, stored as "none", the warning shows; the status bar says no limit', () => {
      mount();
      rig.scope.frame();
      const warning = q('.dcp-setting-note');
      expect(warning.hidden).toBeTrue();
      radio('buffer', 'none').click();
      rig.scope.frame();
      expect(rig.source.calls).toEqual(['capacity Infinity']);
      expect(stored()['buffer']).toBe('none');
      expect(warning.hidden).toBeFalse();
      expect(warning.textContent).toBe(
        'No limit: the page may get slow and use a lot of memory. Use it at your own risk.',
      );
      expect(statusText()).toContain('buffer 0 / no limit');
      radio('buffer', '5000').click();
      rig.scope.frame();
      expect(warning.hidden).toBeTrue();
    });
  });

  describe('DBG button (S11-10, FR-ACT-10)', () => {
    it('Show / Hide reaches the loader and is stored', () => {
      const setLauncher = jasmine.createSpy('setLauncher');
      mount({ setLauncher });
      rig.scope.frame();
      expect(radio('launcher', 'show').checked).toBeTrue();
      radio('launcher', 'hide').click();
      expect(setLauncher).toHaveBeenCalledWith(false);
      expect(stored()['launcher']).toBeFalse();
      radio('launcher', 'show').click();
      expect(setLauncher).toHaveBeenCalledWith(true);
      expect(stored()['launcher']).toBeTrue();
    });

    it('shows the loader’s current choice', () => {
      mount({ launcher: false });
      rig.scope.frame();
      expect(radio('launcher', 'hide').checked).toBeTrue();
    });

    it('code launcher: false (null here) hides the group: the host wins', () => {
      mount({ launcher: null });
      rig.scope.frame();
      expect(radio('launcher', 'show')).toBeNull();
    });
  });

  describe('warning banners (S11-11, S11-12, FR-BUF-04/05)', () => {
    let warnings: { nearFull: boolean; memoryBytes: number };
    let dismissed: string[];
    const withWarnings = (): PanelUiHandle =>
      mount({
        warnings: (): PanelWarnings => ({ ...warnings }),
        dismissWarning: (kind) => {
          dismissed.push(kind);
          if (kind === 'nearFull') warnings.nearFull = false;
          else warnings.memoryBytes = 0;
        },
      });
    beforeEach(() => {
      warnings = { nearFull: false, memoryBytes: 0 };
      dismissed = [];
    });

    it('near full: the text with N / M; Download all, Raise the limit, Dismiss', () => {
      rig.source.entries = [logEntry(1), logEntry(2)];
      rig.source.capacityValue = 2;
      withWarnings();
      rig.scope.frame();
      expect(banner('nearFull').hidden).toBeTrue();

      warnings.nearFull = true;
      rig.source.push(logEntry(3));
      rig.scope.frame();
      expect(banner('nearFull').hidden).toBeFalse();
      expect(banner('nearFull').textContent).toContain(
        'The buffer is almost full (2 / 2). The oldest entries will soon be dropped.',
      );

      named('Download all', banner('nearFull')).click();
      expect(rig.source.calls).toEqual(['download']);
      expect(rig.source.downloadRoot).toBe(stage.root);

      named('Raise the limit', banner('nearFull')).click();
      expect(q('.dcp-pop[aria-label="Settings"]').hidden).toBeFalse();
      expect(stage.root.activeElement).toBe(radio('buffer', '2'));

      named('Dismiss', banner('nearFull')).click();
      rig.scope.frame();
      expect(dismissed).toEqual(['nearFull']);
      expect(banner('nearFull').hidden).toBeTrue();
    });

    it('memory: "about N MB" in whole MB; Download all and Dismiss', () => {
      withWarnings();
      warnings.memoryBytes = 52 * 1_048_576 + 400_000;
      rig.source.push(logEntry(1));
      rig.scope.frame();
      expect(banner('memory').hidden).toBeFalse();
      expect(banner('memory').textContent).toContain('Captured data uses about 52 MB. The page may get slow.');
      named('Download all', banner('memory')).click();
      expect(rig.source.calls).toEqual(['download']);
      named('Dismiss', banner('memory')).click();
      rig.scope.frame();
      expect(dismissed).toEqual(['memory']);
      expect(banner('memory').hidden).toBeTrue();
    });

    it('a failing warnings() is counted, never thrown', () => {
      mount({
        warnings: () => {
          throw new Error('broken');
        },
      });
      expect(() => rig.scope.frame()).not.toThrow();
      expect(statusText()).toContain('panel error');
    });
  });

  describe('Add note (S11-14, FR-NOTE-01)', () => {
    const open = (): { title: HTMLInputElement; text: HTMLTextAreaElement; pop: HTMLElement } => {
      named('Note').click();
      const pop = q('.dcp-pop[aria-label="Add note"]');
      return {
        pop,
        title: pop.querySelector('input') as HTMLInputElement,
        text: pop.querySelector('textarea') as HTMLTextAreaElement,
      };
    };

    it('opens a form with Title and Text, focus in Title; Add note records it, empties and closes the form', () => {
      mount();
      const { pop, title, text } = open();
      expect(pop.hidden).toBeFalse();
      expect(stage.root.activeElement).toBe(title);
      title.value = 'Login';
      text.value = 'clicked Sign in';
      named('Add note', pop).click();
      expect(rig.source.calls).toEqual(['note Login|clicked Sign in']);
      expect(title.value).toBe('');
      expect(text.value).toBe('');
      expect(pop.hidden).toBeTrue();
    });

    it('both fields empty: nothing is added and the form stays open', () => {
      mount();
      const { pop, title } = open();
      title.value = '   ';
      named('Add note', pop).click();
      expect(rig.source.calls).toEqual([]);
      expect(pop.hidden).toBeFalse();
      expect(stage.root.activeElement).toBe(title);
    });

    it('Enter in Title and Ctrl+Enter in Text add; plain Enter in Text is a new line', () => {
      mount();
      let form = open();
      form.title.value = 'A';
      expect(press(form.title, { key: 'Enter' }).defaultPrevented).toBeTrue();
      form = open();
      form.text.value = 'line';
      expect(press(form.text, { key: 'Enter' }).defaultPrevented).toBeFalse();
      expect(press(form.text, { key: 'Enter', ctrlKey: true }).defaultPrevented).toBeTrue();
      expect(rig.source.calls).toEqual(['note A|', 'note |line']);
    });

    it('Escape closes the form, not the panel', () => {
      const onRequestClose = jasmine.createSpy('onRequestClose');
      mount({ onRequestClose });
      const { pop, title } = open();
      press(title, { key: 'Escape' });
      expect(pop.hidden).toBeTrue();
      expect(onRequestClose).not.toHaveBeenCalled();
    });
  });
});
