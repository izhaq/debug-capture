import { createDom } from '../views';
import { createSettingsForm, SettingName, SettingsValues } from './settings-form';

/** S-15a (S15-04, FR-TXT-01, 02, 05): Settings › Text size is − / the size / + / Reset. */
describe('Settings form — text size stepper', () => {
  const dom = createDom(document);
  const values = (textSize: number): SettingsValues => ({
    theme: 'auto',
    dock: 'bottom',
    textSize,
    time: 'clock',
    buffer: '5000',
    launcher: 'show',
    capture: 'on',
  });
  let changes: Array<[SettingName, string]>;
  let host: HTMLElement;

  const make = (textSize = 12): ReturnType<typeof createSettingsForm> => {
    const form = createSettingsForm(dom, (name, value) => changes.push([name, value]), undefined, {
      buffers: [5000],
      launcher: true,
    });
    host.appendChild(form.element);
    form.set(values(textSize));
    return form;
  };
  const named = (label: string): HTMLButtonElement => {
    const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no button "${label}"`);
    return found;
  };
  const shown = (): string => (host.querySelector('[data-text-size-value]')?.textContent ?? '').trim();

  beforeEach(() => {
    changes = [];
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it('one Text size group: native buttons "Smaller text", "Larger text", "Reset text size" and the size, announced politely; no radios', () => {
    make();
    const group = named('Larger text').closest('fieldset');
    expect(group?.querySelector('legend')?.textContent).toBe('Text size');
    expect(group?.firstElementChild?.tagName).withContext('the label comes first, as in every group').toBe('LEGEND');
    expect(group?.querySelectorAll('input').length).toBe(0);
    for (const label of ['Smaller text', 'Larger text', 'Reset text size']) {
      expect(named(label).getAttribute('type')).withContext(label).toBe('button');
    }
    expect(named('Smaller text').textContent).toBe('−');
    expect(named('Larger text').textContent).toBe('+');
    expect(named('Reset text size').textContent).toBe('Reset');
    expect(shown()).toBe('12 px');
    expect(host.querySelector('[data-text-size-value]')?.getAttribute('role')).toBe('status');
  });

  it('a click asks for one px more or less, or 12 for Reset; the form waits for set() to show it', () => {
    make(15);
    named('Larger text').click();
    named('Smaller text').click();
    named('Reset text size').click();
    expect(changes).toEqual([
      ['textSize', '16'],
      ['textSize', '14'],
      ['textSize', '12'],
    ]);
    expect(shown()).toBe('15 px');
  });

  it('− is disabled at 10, + at 20, Reset at 12; set() moves the size and the disabled states without onChange', () => {
    const form = make(10);
    expect(named('Smaller text').disabled).toBeTrue();
    expect(named('Larger text').disabled).toBeFalse();
    expect(named('Reset text size').disabled).toBeFalse();

    form.set(values(20));
    expect(shown()).toBe('20 px');
    expect(named('Smaller text').disabled).toBeFalse();
    expect(named('Larger text').disabled).toBeTrue();

    form.set(values(12));
    expect(named('Reset text size').disabled).toBeTrue();
    expect(changes).toEqual([]);
  });

  it('FR-TXT-05: a focused button that becomes disabled hands focus on, so focus never falls out of the popover', () => {
    const form = make(19);
    named('Larger text').focus();
    form.set(values(20));
    expect(document.activeElement).toBe(named('Smaller text'));

    form.set(values(11));
    named('Smaller text').focus();
    form.set(values(10));
    expect(document.activeElement).toBe(named('Larger text'));

    form.set(values(13));
    named('Reset text size').focus();
    form.set(values(12));
    expect(document.activeElement).toBe(named('Larger text'));
  });

  it('the other groups are still radios that report their change', () => {
    make();
    const light = host.querySelector<HTMLInputElement>('input[name="dcp-setting-theme"][value="light"]');
    light?.click();
    expect(changes).toEqual([['theme', 'light']]);
  });
});
