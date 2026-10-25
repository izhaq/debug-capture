import { createListeners, Dom, ErrorReporter } from '../views';
import { groupDigits } from './status-bar';

/** The settings the form edits (HLD §4.10). `capture` is shown here but never stored. */
export interface SettingsValues {
  readonly theme: 'auto' | 'dark' | 'light';
  readonly dock: 'bottom' | 'right';
  readonly textSize: 'small' | 'normal' | 'large';
  readonly time: 'clock' | 'relative';
  /** 2.1: the buffer size as a radio value — digits, or `'none'` for No limit (`FR-BUF-01`). */
  readonly buffer: string;
  /** 2.1: "Show DBG button" (`FR-ACT-10`). */
  readonly launcher: 'show' | 'hide';
  readonly capture: 'on' | 'off';
}

export type SettingName = keyof SettingsValues;

/** What the form offers beyond the fixed groups (2.1). */
export interface SettingsFormOptions {
  /** Buffer sizes, ascending; No limit is always added last. */
  readonly buffers: readonly number[];
  /** `false` when the host passed `launcher: false`: the DBG button group is left out (`D-32`). */
  readonly launcher: boolean;
}

type Group = readonly [SettingName, string, ReadonlyArray<readonly [string, string]>];

/** `FR-BUF-03`: shown under the Buffer group while No limit is chosen. */
export const NO_LIMIT_WARNING = 'No limit: the page may get slow and use a lot of memory. Use it at your own risk.';

function groups(options: SettingsFormOptions): Group[] {
  return [
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
    ['buffer', 'Buffer', [...options.buffers.map((n) => [String(n), groupDigits(n)] as const), ['none', 'No limit']]],
    ...(options.launcher
      ? [
          [
            'launcher',
            'DBG button',
            [
              ['show', 'Show'],
              ['hide', 'Hide'],
            ],
          ] as Group,
        ]
      : []),
    [
      'capture',
      'Capture',
      [
        ['on', 'On'],
        ['off', 'Off'],
      ],
    ],
  ];
}

export interface SettingsForm {
  readonly element: HTMLElement;
  /** Checks the radios for `values`, without calling `onChange`. */
  set(values: SettingsValues): void;
  /** Focuses the checked Buffer radio ("Raise the limit", `FR-BUF-04`). */
  focusBuffer(): void;
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
  options: SettingsFormOptions = { buffers: [], launcher: true },
): SettingsForm {
  const inputs: HTMLInputElement[] = [];
  const warning = dom.el('p', { className: 'dcp-setting-note', attrs: { hidden: true } }, [NO_LIMIT_WARNING]);
  const element = dom.el(
    'div',
    { className: 'dcp-settings' },
    groups(options).map(([name, legend, choices]) =>
      dom.el('fieldset', { className: 'dcp-setting' }, [
        dom.el('legend', null, [legend]),
        ...choices.map(([value, label]) => {
          const input = dom.el('input', {
            attrs: { type: 'radio', name: `dcp-setting-${name}`, value, 'data-setting': name },
          });
          inputs.push(input);
          return dom.el('label', null, [input, label]);
        }),
        name === 'buffer' && warning,
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
      warning.hidden = values.buffer !== 'none';
    },
    focusBuffer(): void {
      inputs.find((input) => input.name === 'dcp-setting-buffer' && input.checked)?.focus();
    },
    destroy: () => listeners.removeAll(),
  };
}
