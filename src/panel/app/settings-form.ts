import { createListeners, Dom, ErrorReporter } from '../views';

/** The settings the form edits (HLD §4.10). `capture` is shown here but never stored. */
export interface SettingsValues {
  readonly theme: 'auto' | 'dark' | 'light';
  readonly dock: 'bottom' | 'right';
  readonly textSize: 'small' | 'normal' | 'large';
  readonly time: 'clock' | 'relative';
  readonly capture: 'on' | 'off';
}

export type SettingName = keyof SettingsValues;

const GROUPS: ReadonlyArray<readonly [SettingName, string, ReadonlyArray<readonly [string, string]>]> = [
  [
    'theme',
    'Theme',
    [
      ['auto', 'Auto'],
      ['dark', 'Dark'],
      ['light', 'Light'],
    ],
  ],
  [
    'dock',
    'Dock',
    [
      ['bottom', 'Bottom'],
      ['right', 'Right'],
    ],
  ],
  [
    'textSize',
    'Text size',
    [
      ['small', 'Small'],
      ['normal', 'Normal'],
      ['large', 'Large'],
    ],
  ],
  [
    'time',
    'Time',
    [
      ['clock', 'Clock'],
      ['relative', 'Relative'],
    ],
  ],
  [
    'capture',
    'Capture',
    [
      ['on', 'On'],
      ['off', 'Off'],
    ],
  ],
];

export interface SettingsForm {
  readonly element: HTMLElement;
  /** Checks the radios for `values`, without calling `onChange`. */
  set(values: SettingsValues): void;
  destroy(): void;
}

/**
 * The settings form: one native radio group per setting, so arrows, Tab and
 * the checked state work without any script of ours. Group names are scoped
 * to the shadow root, so they never meet a host form.
 */
export function createSettingsForm(
  dom: Dom,
  onChange: (name: SettingName, value: string) => void,
  onError?: ErrorReporter,
): SettingsForm {
  const inputs: HTMLInputElement[] = [];
  const element = dom.el(
    'div',
    { className: 'dcp-settings' },
    GROUPS.map(([name, legend, options]) =>
      dom.el('fieldset', { className: 'dcp-setting' }, [
        dom.el('legend', null, [legend]),
        ...options.map(([value, label]) => {
          const input = dom.el('input', {
            attrs: { type: 'radio', name: `dcp-setting-${name}`, value, 'data-setting': name },
          });
          inputs.push(input);
          return dom.el('label', null, [input, label]);
        }),
      ]),
    ),
  );
  const listeners = createListeners(onError);
  listeners.on(element, 'change', (event) => {
    const input = event.target as HTMLInputElement;
    const name = input.getAttribute('data-setting') as SettingName | null;
    if (name !== null && input.checked) onChange(name, input.value);
  });
  return {
    element,
    set(values): void {
      for (const input of inputs) {
        const name = input.getAttribute('data-setting') as SettingName;
        input.checked = values[name] === input.value;
      }
    },
    destroy: () => listeners.removeAll(),
  };
}
