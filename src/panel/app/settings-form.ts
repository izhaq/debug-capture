import { createListeners, Dom, ErrorReporter, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '../views';
import { groupDigits } from './status-bar';

/** The settings the form edits (HLD §4.10). `capture` is shown here but never stored. */
export interface SettingsValues {
  readonly theme: 'auto' | 'dark' | 'light';
  readonly dock: 'bottom' | 'right';
  /** Whole px, 10…20 (`FR-TXT-01`); shown by the stepper, not a radio group. */
  readonly textSize: number;
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
    // FR-TXT-01: a stepper, built by textSizeStepper(); no choices here.
    ['textSize', 'Text size', []],
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
  const listeners = createListeners(onError);
  const stepper = textSizeStepper(dom, listeners, (n) => onChange('textSize', String(n)));
  const warning = dom.el('p', { className: 'dcp-setting-note', attrs: { hidden: true } }, [NO_LIMIT_WARNING]);
  const element = dom.el(
    'div',
    { className: 'dcp-settings' },
    groups(options).map(([name, legend, choices]) =>
      dom.el('fieldset', { className: 'dcp-setting' }, [
        dom.el('legend', null, [legend]),
        ...(name === 'textSize' ? stepper.nodes : []),
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
      stepper.set(values.textSize);
    },
    focusBuffer(): void {
      inputs.find((input) => input.name === 'dcp-setting-buffer' && input.checked)?.focus();
    },
    destroy: () => listeners.removeAll(),
  };
}

interface TextSizeStepper {
  /** The buttons and the size, placed after the group's legend. */
  readonly nodes: readonly HTMLElement[];
  set(n: number): void;
}

/**
 * Text size − / the size / + / Reset (`FR-TXT-01`, `FR-TXT-02`). Native buttons,
 * so Tab, Enter, Space and `disabled` need nothing of ours; a disabled end
 * also drops out of the Tab order. A click only asks: the frame applies the
 * size and calls `set()`, so the form never shows a size the panel lacks.
 */
function textSizeStepper(
  dom: Dom,
  listeners: ReturnType<typeof createListeners>,
  ask: (n: number) => void,
): TextSizeStepper {
  let current = TEXT_SIZE_DEFAULT;
  const button = (label: string, text: string, next: () => number): HTMLButtonElement => {
    const el = dom.el('button', { className: 'dcp-btn', attrs: { type: 'button', 'aria-label': label } }, [text]);
    listeners.on(el, 'click', () => ask(next()));
    return el;
  };
  const smaller = button('Smaller text', '\u2212', () => current - 1);
  // FR-TXT-05: role status is polite, so a screen reader says the new size without moving focus.
  const value = dom.el('span', { className: 'dcp-text-size', attrs: { role: 'status', 'data-text-size-value': '' } });
  const larger = button('Larger text', '+', () => current + 1);
  const reset = button('Reset text size', 'Reset', () => TEXT_SIZE_DEFAULT);
  return {
    nodes: [smaller, value, larger, reset],
    set(n): void {
      current = n;
      value.textContent = `${n} px`;
      // A focused button that turns disabled loses focus to <body>, and the popover closes on
      // focus out (FR-TXT-05): hand focus to the button that does the opposite first.
      const root = smaller.getRootNode() as Document | ShadowRoot;
      const focused = root.activeElement;
      const atMin = n <= TEXT_SIZE_MIN;
      const atMax = n >= TEXT_SIZE_MAX;
      const atDefault = n === TEXT_SIZE_DEFAULT;
      // Move focus before disabling, so it is never on a disabled button, not even for a moment.
      if (focused === larger && atMax) smaller.focus();
      else if ((focused === smaller && atMin) || (focused === reset && atDefault)) larger.focus();
      smaller.disabled = atMin;
      larger.disabled = atMax;
      reset.disabled = atDefault;
    },
  };
}
