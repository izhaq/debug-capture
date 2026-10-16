import { createListeners, Dom, ErrorReporter, setAttr } from './dom';
import { hasModifier, rovingIndex } from './keys';

/** One chip. */
export interface ChipItem {
  readonly id: string;
  readonly label: string;
}

/** Options for `createChipGroup`. */
export interface ChipGroupOptions {
  readonly chips: readonly ChipItem[];
  /** Ids that start on; empty (the default) means "All". */
  readonly selected?: readonly string[];
  /** Names the group, e.g. "Status". */
  readonly ariaLabel: string;
  /** Text of the reset chip; default "All". */
  readonly allLabel?: string;
  /** The user changed the choice; `[]` means All. Not called by `setSelected()`. */
  readonly onChange: (selected: readonly string[]) => void;
  readonly onError?: ErrorReporter;
}

/** A chip group built by `createChipGroup`. */
export interface ChipGroupControl {
  readonly element: HTMLElement;
  /** The chips that are on, in chip order; `[]` = All. */
  readonly selected: readonly string[];
  setSelected(ids: readonly string[]): void;
  destroy(): void;
}

/**
 * Toggle chips (HLD §4.5): each chip toggles (`aria-pressed`); "All" is on
 * when none is and resets the group. ← → Home End move focus inside the
 * group (one tab stop); Enter and Space toggle natively.
 */
export function createChipGroup(dom: Dom, options: ChipGroupOptions): ChipGroupControl {
  const ids = options.chips.map((c) => c.id);
  const chip = (id: string | null, label: string): HTMLButtonElement =>
    dom.el('button', { className: 'dcp-chip', attrs: { type: 'button', 'data-chip': id ?? 'all' } }, [label]);
  const all = chip(null, options.allLabel ?? 'All');
  const chips = options.chips.map((c) => chip(c.id, c.label));
  const buttons = [all, ...chips];
  const element = dom.el(
    'div',
    { className: 'dcp-chips', attrs: { role: 'group', 'aria-label': options.ariaLabel } },
    buttons,
  );
  let on = new Set<string>();
  let focusIndex = 0;

  const render = (): void => {
    setAttr(all, 'aria-pressed', on.size === 0 ? 'true' : 'false');
    chips.forEach((button, i) => setAttr(button, 'aria-pressed', on.has(ids[i] ?? '') ? 'true' : 'false'));
    buttons.forEach((button, i) => setAttr(button, 'tabindex', i === focusIndex ? 0 : -1));
  };
  const selected = (): readonly string[] => ids.filter((id) => on.has(id));
  const setSelected = (next: readonly string[]): void => {
    on = new Set(next.filter((id) => ids.includes(id)));
    render();
  };
  setSelected(options.selected ?? []);

  const listeners = createListeners(options.onError);
  buttons.forEach((button, i) =>
    listeners.on(button, 'click', () => {
      focusIndex = i;
      const id = i === 0 ? null : ids[i - 1];
      if (id === null || id === undefined) {
        on.clear();
      } else if (!on.delete(id)) {
        on.add(id);
      }
      render();
      options.onChange(selected());
    }),
  );
  listeners.on(element, 'keydown', (event) => {
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0 || hasModifier(event)) return;
    const next = rovingIndex(event.key, current, buttons.length, 'horizontal');
    if (next === null) return;
    event.preventDefault();
    focusIndex = next;
    render();
    buttons[next]?.focus();
  });

  return {
    element,
    get selected() {
      return selected();
    },
    setSelected,
    destroy: () => listeners.removeAll(),
  };
}
