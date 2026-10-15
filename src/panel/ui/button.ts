import { createListeners, Dom, ErrorReporter, setAttr } from './dom';
import { createIcon, IconName } from './icons';

/** Options for `createButton`. */
export interface ButtonOptions {
  /** The visible text, or for an icon-only button its accessible name and tooltip. */
  readonly label: string;
  readonly icon?: IconName;
  /** Shows only the icon; the label becomes `aria-label` and `title`. */
  readonly iconOnly?: boolean;
  readonly disabled?: boolean;
  /** Extra class names (space-separated). */
  readonly className?: string;
  readonly onClick: () => void;
  /** Receives what `onClick` throws (ISO-12). */
  readonly onError?: ErrorReporter;
}

/** A button built by `createButton`. */
export interface ButtonControl {
  readonly element: HTMLButtonElement;
  setLabel(label: string): void;
  setDisabled(disabled: boolean): void;
  /** Removes the click listener. */
  destroy(): void;
}

/** A `type="button"` control (HLD §5.7); Enter and Space work natively. */
export function createButton(dom: Dom, options: ButtonOptions): ButtonControl {
  const iconOnly = options.iconOnly === true && options.icon !== undefined;
  const label = dom.el('span', null, [options.label]);
  const element = dom.el(
    'button',
    {
      className: ['dcp-btn', iconOnly ? 'dcp-btn--icon' : '', options.className ?? ''].filter(Boolean).join(' '),
      attrs: { type: 'button', disabled: options.disabled === true },
    },
    [options.icon ? createIcon(dom, options.icon) : null, iconOnly ? null : label],
  );
  const setLabel = (text: string): void => {
    if (iconOnly) {
      setAttr(element, 'aria-label', text);
      setAttr(element, 'title', text);
    } else {
      label.textContent = text;
    }
  };
  setLabel(options.label);
  const listeners = createListeners(options.onError);
  listeners.on(element, 'click', () => options.onClick());
  return {
    element,
    setLabel,
    setDisabled: (disabled) => {
      element.disabled = disabled;
    },
    destroy: () => listeners.removeAll(),
  };
}
