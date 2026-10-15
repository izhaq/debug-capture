import { createListeners, Dom, ErrorReporter, setAttr } from './dom';
import { rovingIndex } from './keys';

/** One tab. */
export interface TabItem {
  readonly id: string;
  readonly label: string;
}

/** Options for `createTabs`. */
export interface TabsOptions {
  readonly tabs: readonly TabItem[];
  /** The selected tab's id; the first tab if it names none. */
  readonly selected?: string;
  /** Names the tab list, e.g. "Panel sections". */
  readonly ariaLabel: string;
  /** The user picked another tab (click or keys). Not called by `select()`. */
  readonly onChange: (id: string) => void;
  readonly onError?: ErrorReporter;
}

/** A tab bar built by `createTabs`. */
export interface TabsControl {
  readonly element: HTMLElement;
  readonly selected: string;
  /** Selects a tab without calling `onChange` (e.g. Alt+1 handled by the frame). */
  select(id: string): void;
  /** Moves focus to the selected tab. */
  focus(): void;
  destroy(): void;
}

/**
 * A `tablist` (HLD §4.12): ← → move between tabs and select them, Home / End
 * jump; one tab stop (roving `tabindex`). Selection is shown by
 * `aria-selected`, which the CSS styles.
 */
export function createTabs(dom: Dom, options: TabsOptions): TabsControl {
  if (options.tabs.length === 0) throw new RangeError('createTabs needs at least one tab');
  const ids = options.tabs.map((t) => t.id);
  const buttons = options.tabs.map((tab) =>
    dom.el('button', { className: 'dcp-tab', attrs: { type: 'button', role: 'tab', 'data-tab': tab.id } }, [tab.label]),
  );
  const element = dom.el(
    'div',
    { className: 'dcp-tabs', attrs: { role: 'tablist', 'aria-label': options.ariaLabel } },
    buttons,
  );
  let selected = '';

  const select = (id: string): void => {
    const index = Math.max(0, ids.indexOf(id));
    selected = ids[index] ?? '';
    buttons.forEach((button, i) => {
      setAttr(button, 'aria-selected', i === index ? 'true' : 'false');
      setAttr(button, 'tabindex', i === index ? 0 : -1);
    });
  };
  const choose = (index: number): void => {
    const id = ids[index];
    if (id === undefined || id === selected) return;
    select(id);
    options.onChange(id);
  };
  select(options.selected ?? '');

  const listeners = createListeners(options.onError);
  buttons.forEach((button, i) => listeners.on(button, 'click', () => choose(i)));
  listeners.on(element, 'keydown', (event) => {
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = rovingIndex(event.key, current, buttons.length, 'horizontal');
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    choose(next);
  });

  return {
    element,
    get selected() {
      return selected;
    },
    select,
    focus: () => buttons[ids.indexOf(selected)]?.focus(),
    destroy: () => listeners.removeAll(),
  };
}
