import { createButton } from './button';
import { createDom } from './dom';
import { createThemeSheet } from './index';
import { createMenu, createPopover, PopoverControl } from './popover';

describe('menu and popover (S04-04, HLD §4.12)', () => {
  const dom = createDom(document);
  let host: HTMLElement;
  let shadow: ShadowRoot;
  let root: HTMLElement;
  let outside: HTMLButtonElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [createThemeSheet(document)];
    root = dom.el('div', { className: 'dcp-root' });
    outside = dom.el('button', null, ['elsewhere']);
    root.appendChild(outside);
    shadow.appendChild(root);
  });

  afterEach(() => host.remove());

  const active = (): Element | null => shadow.activeElement;

  function key(target: Element, name: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    return event;
  }

  function exportMenu(onSelect = jasmine.createSpy('onSelect'), onClose?: () => void): PopoverControl {
    const trigger = createButton(dom, { label: 'Export', icon: 'export', onClick: () => undefined }).element;
    const menu = createMenu(dom, {
      trigger,
      ariaLabel: 'Export',
      items: [
        { id: 'download', label: 'Download JSON', shortcut: 'Ctrl+Alt+Shift+D' },
        { id: 'copy', label: 'Copy JSON' },
        { id: 'never', label: 'Disabled', disabled: true },
        { id: 'har', label: 'HAR' },
      ],
      onSelect,
      onClose,
    });
    root.appendChild(menu.element);
    return menu;
  }

  const items = (menu: PopoverControl): HTMLButtonElement[] => Array.from(menu.popup.querySelectorAll('button'));
  const trigger = (menu: PopoverControl): HTMLElement => menu.element.firstElementChild as HTMLElement;

  it('menu: trigger has aria-haspopup / aria-expanded; popup is a named, hidden menu of menuitems', () => {
    const menu = exportMenu();

    expect(trigger(menu).getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger(menu).getAttribute('aria-expanded')).toBe('false');
    expect(menu.popup.getAttribute('role')).toBe('menu');
    expect(menu.popup.getAttribute('aria-label')).toBe('Export');
    expect(menu.popup.hidden).toBeTrue();
    expect(getComputedStyle(menu.popup).display).toBe('none');
    expect(items(menu).map((b) => b.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'menuitem', 'menuitem']);
    expect(items(menu)[0]?.querySelector('kbd')?.textContent).toBe('Ctrl+Alt+Shift+D');
    expect(menu.isOpen).toBeFalse();
  });

  it('menu: click opens and focuses the first item; ↓ ↑ Home End skip disabled items and wrap', () => {
    const menu = exportMenu();
    const [download, copy, , har] = items(menu);
    trigger(menu).click();

    expect(menu.isOpen).toBeTrue();
    expect(trigger(menu).getAttribute('aria-expanded')).toBe('true');
    expect(getComputedStyle(menu.popup).display).not.toBe('none');
    expect(getComputedStyle(menu.popup).borderTopLeftRadius).toBe('6px');
    expect(active()).toBe(download as Element);
    expect(key(download as Element, 'ArrowDown').defaultPrevented).toBeTrue();
    expect(active()).toBe(copy as Element);
    key(copy as Element, 'ArrowDown');
    expect(active()).toBe(har as Element);
    key(har as Element, 'ArrowDown');
    expect(active()).toBe(download as Element);
    key(download as Element, 'ArrowUp');
    expect(active()).toBe(har as Element);
    key(har as Element, 'Home');
    expect(active()).toBe(download as Element);
    key(download as Element, 'End');
    expect(active()).toBe(har as Element);
    expect(key(har as Element, 'x').defaultPrevented).toBeFalse();
    menu.popup.focus();
    key(menu.popup, 'ArrowUp');
    expect(active()).toBe(har as Element);
  });

  it('menu: ↓ on the trigger opens it; choosing an item closes, returns focus, then calls onSelect', () => {
    const onClose = jasmine.createSpy('onClose');
    const onSelect = jasmine.createSpy('onSelect').and.callFake(() => {
      expect(menu.isOpen).toBeFalse();
    });
    const menu = exportMenu(onSelect, onClose);
    trigger(menu).focus();
    expect(key(trigger(menu), 'ArrowDown').defaultPrevented).toBeTrue();
    expect(menu.isOpen).toBeTrue();
    expect(key(trigger(menu), 'Enter').defaultPrevented).toBeFalse();
    items(menu)[1]?.click();

    expect(onSelect).toHaveBeenCalledOnceWith('copy');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(active()).toBe(trigger(menu));
    expect(trigger(menu).getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the menu, returns focus, and stops there (the panel does not also close)', () => {
    const menu = exportMenu();
    const panelEscape = jasmine.createSpy('panelEscape');
    root.addEventListener('keydown', panelEscape);
    trigger(menu).click();
    const escape = key(items(menu)[0] as Element, 'Escape');

    expect(escape.defaultPrevented).toBeTrue();
    expect(menu.isOpen).toBeFalse();
    expect(active()).toBe(trigger(menu));
    expect(panelEscape).not.toHaveBeenCalled();
    // Closed: Escape is the panel's again.
    key(trigger(menu), 'Escape');
    expect(panelEscape).toHaveBeenCalledTimes(1);
    root.removeEventListener('keydown', panelEscape);
  });

  it('focus leaving the menu (Tab, a click elsewhere) closes it without pulling focus back', () => {
    const onClose = jasmine.createSpy('onClose');
    const menu = exportMenu(undefined, onClose);
    trigger(menu).click();
    items(menu)[1]?.focus();
    expect(menu.isOpen).toBeTrue();
    trigger(menu).focus();
    expect(menu.isOpen).toBeTrue();
    outside.focus();

    expect(menu.isOpen).toBeFalse();
    expect(active()).toBe(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
    menu.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the trigger again toggles it closed', () => {
    const menu = exportMenu();
    trigger(menu).click();
    trigger(menu).click();
    expect(menu.isOpen).toBeFalse();
    menu.toggle();
    expect(menu.isOpen).toBeTrue();
    menu.open();
    expect(menu.isOpen).toBeTrue();
  });

  it('a menu with no enabled item focuses the popup itself', () => {
    const triggerEl = dom.el('button', null, ['Copy']);
    const menu = createMenu(dom, {
      trigger: triggerEl,
      ariaLabel: 'Copy',
      items: [{ id: 'a', label: 'A', disabled: true }],
      onSelect: () => undefined,
    });
    root.appendChild(menu.element);
    menu.open();
    expect(active()).toBe(menu.popup);
    expect(key(menu.popup, 'ArrowDown').defaultPrevented).toBeFalse();
  });

  it('popover: a non-modal dialog; focus goes to its first control, Escape returns it', () => {
    const triggerEl = createButton(dom, {
      label: 'Settings',
      icon: 'settings',
      iconOnly: true,
      onClick: () => undefined,
    }).element;
    const select = dom.el('select', { attrs: { 'aria-label': 'Theme' } }, [dom.el('option', null, ['Auto'])]);
    const popover = createPopover(dom, {
      trigger: triggerEl,
      ariaLabel: 'Settings',
      content: [dom.el('h3', null, ['Settings']), select],
    });
    root.appendChild(popover.element);

    expect(triggerEl.getAttribute('aria-haspopup')).toBe('dialog');
    expect(popover.popup.getAttribute('role')).toBe('dialog');
    expect(popover.popup.getAttribute('aria-modal')).toBe('false');
    triggerEl.click();
    expect(active()).toBe(select);
    key(select, 'Escape');
    expect(popover.isOpen).toBeFalse();
    expect(active()).toBe(triggerEl);
  });

  it('popover without a control focuses the popup', () => {
    const triggerEl = dom.el('button', null, ['Info']);
    const popover = createPopover(dom, { trigger: triggerEl, ariaLabel: 'Info', content: ['Just text'] });
    root.appendChild(popover.element);
    popover.open();
    expect(active()).toBe(popover.popup);
    popover.close(false);
    expect(popover.isOpen).toBeFalse();
    expect(active()).not.toBe(triggerEl);
  });
});
