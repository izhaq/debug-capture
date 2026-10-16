import { Child, createListeners, Dom, ErrorReporter, Listeners, setAttr } from './dom';
import { hasModifier, rovingIndex } from './keys';

/** What `createPopover` and `createMenu` return. */
export interface PopoverControl {
  /** The trigger and the popup, wrapped: put it where the trigger goes. */
  readonly element: HTMLElement;
  /** The popup itself (`.dcp-pop`). */
  readonly popup: HTMLElement;
  readonly isOpen: boolean;
  /** Opens and moves focus into the popup. */
  open(): void;
  /** Closes; with `returnFocus` (default `true`) focus goes back to the trigger. */
  close(returnFocus?: boolean): void;
  toggle(): void;
  /** Removes every listener; leaves the trigger as it was given. */
  destroy(): void;
}

/** Options shared by popovers and menus. */
export interface PopupOptions {
  /** The button that opens it (e.g. from `createButton`); it gets `aria-expanded`. */
  readonly trigger: HTMLElement;
  /** Names the popup. */
  readonly ariaLabel: string;
  /** Called after it closes, however it closed. */
  readonly onClose?: () => void;
  readonly onError?: ErrorReporter;
}

/** Options for `createPopover`. */
export interface PopoverOptions extends PopupOptions {
  /** What the popover shows (e.g. the settings form). */
  readonly content: readonly Child[];
}

/** One menu entry. */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** Shown on the right, e.g. `Ctrl+Alt+Shift+D`. */
  readonly shortcut?: string;
  readonly disabled?: boolean;
}

/** Options for `createMenu`. */
export interface MenuOptions extends PopupOptions {
  readonly items: readonly MenuItem[];
  /** An item was chosen; the menu then closes and focus returns to the trigger. */
  readonly onSelect: (id: string) => void;
}

const FOCUSABLE = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]';

interface PopupParts {
  readonly role: 'dialog' | 'menu';
  readonly haspopup: 'dialog' | 'menu';
  readonly children: readonly Child[];
  /** Where focus goes on open. */
  readonly first: (popup: HTMLElement) => HTMLElement;
  /** Extra listeners on the popup and trigger. */
  readonly wire?: (listeners: Listeners, control: PopoverControl) => void;
}

/**
 * The shared open / close logic (HLD §4.12, ISO-16): Escape closes the
 * innermost popup and returns focus (and stops there, so the panel does not
 * close too); focus leaving trigger and popup (Tab, a click elsewhere) closes
 * without moving focus back. No focus trap. All listeners sit on our own
 * nodes, never on the host's document.
 */
function createPopup(dom: Dom, options: PopupOptions, parts: PopupParts): PopoverControl {
  const { trigger } = options;
  const popup = dom.el(
    'div',
    { className: 'dcp-pop', attrs: { role: parts.role, 'aria-label': options.ariaLabel, tabindex: -1, hidden: true } },
    parts.children,
  );
  if (parts.role === 'dialog') setAttr(popup, 'aria-modal', 'false');
  const element = dom.el('span', { className: 'dcp-popwrap' }, [trigger, popup]);
  setAttr(trigger, 'aria-haspopup', parts.haspopup);
  setAttr(trigger, 'aria-expanded', 'false');
  let open = false;

  const control: PopoverControl = {
    element,
    popup,
    get isOpen() {
      return open;
    },
    open: () => {
      if (!open) {
        open = true;
        popup.hidden = false;
        setAttr(trigger, 'aria-expanded', 'true');
      }
      parts.first(popup).focus();
    },
    close: (returnFocus = true) => {
      if (!open) return;
      open = false;
      popup.hidden = true;
      setAttr(trigger, 'aria-expanded', 'false');
      if (returnFocus) trigger.focus();
      options.onClose?.();
    },
    toggle: () => (open ? control.close() : control.open()),
    destroy: () => listeners.removeAll(),
  };

  const listeners = createListeners(options.onError);
  listeners.on(trigger, 'click', () => control.toggle());
  listeners.on(element, 'keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    control.close(true);
  });
  listeners.on(element, 'focusout', (event) => {
    const next = event.relatedTarget;
    // No `instanceof Node`: the global may belong to another window or be
    // replaced by the host (ISO-22); `contains(null)` is simply false.
    if (open && !element.contains(next as Node | null)) control.close(false);
  });
  parts.wire?.(listeners, control);
  return control;
}

/** A popover (`role="dialog"`, non-modal) for forms such as Settings. */
export function createPopover(dom: Dom, options: PopoverOptions): PopoverControl {
  return createPopup(dom, options, {
    role: 'dialog',
    haspopup: 'dialog',
    children: options.content,
    first: (popup) => popup.querySelector<HTMLElement>(FOCUSABLE) ?? popup,
  });
}

/**
 * A menu (`role="menu"`, items `menuitem`) such as Export or Copy: ↑ ↓ Home
 * End move between enabled items, Enter / Space choose (native buttons),
 * ↓ on the trigger opens it.
 */
export function createMenu(dom: Dom, options: MenuOptions): PopoverControl {
  const items = options.items.map((item) =>
    dom.el(
      'button',
      {
        className: 'dcp-menu__item',
        attrs: {
          type: 'button',
          role: 'menuitem',
          tabindex: -1,
          'data-item': item.id,
          disabled: item.disabled === true,
        },
      },
      [
        dom.el('span', null, [item.label]),
        item.shortcut ? dom.el('kbd', { className: 'dcp-menu__shortcut' }, [item.shortcut]) : null,
      ],
    ),
  );
  const enabled = (): HTMLButtonElement[] => items.filter((b) => !b.disabled);
  const control = createPopup(dom, options, {
    role: 'menu',
    haspopup: 'menu',
    children: items,
    first: (popup) => enabled()[0] ?? popup,
    wire: (listeners, menu) => {
      menu.popup.classList.add('dcp-menu');
      items.forEach((button, i) =>
        listeners.on(button, 'click', () => {
          menu.close(true);
          options.onSelect(options.items[i]?.id ?? '');
        }),
      );
      listeners.on(menu.popup, 'keydown', (event) => {
        if (hasModifier(event)) return;
        const list = enabled();
        const at = list.indexOf(event.target as HTMLButtonElement);
        // From the popup itself (no item focused), ↑ goes to the last item like ↓ goes to the first.
        const next = rovingIndex(event.key, at < 0 && event.key === 'ArrowUp' ? 0 : at, list.length, 'vertical');
        if (next === null || list.length === 0) return;
        event.preventDefault();
        list[next]?.focus();
      });
      listeners.on(options.trigger, 'keydown', (event) => {
        if (event.key !== 'ArrowDown' || hasModifier(event)) return;
        event.preventDefault();
        menu.open();
      });
    },
  });
  return control;
}
