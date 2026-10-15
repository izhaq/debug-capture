import { createButton } from './button';
import { createChipGroup } from './chip-group';
import { createDom } from './dom';
import { createEmptyState } from './empty-state';
import { rovingIndex } from './keys';
import { createSearchBox, Schedule, SEARCH_DEBOUNCE_MS } from './search-box';
import { createTabs } from './tabs';
import { createThemeSheet } from './index';

const dom = createDom(document);

/** A themed `.dcp-root` inside a shadow root, as the panel mounts it. */
function mount(): { root: HTMLElement; shadow: ShadowRoot; remove(): void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [createThemeSheet(document)];
  const root = dom.el('div', { className: 'dcp-root', attrs: { 'data-theme': 'dark' } });
  shadow.appendChild(root);
  return { root, shadow, remove: () => host.remove() };
}

function key(target: Element, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** A fake `Schedule`: tasks run only when the spec says so. */
function fakeSchedule(): { schedule: Schedule; pending: () => number; delays: number[]; run(): void } {
  const tasks = new Set<() => void>();
  const delays: number[] = [];
  return {
    schedule: (task, ms) => {
      delays.push(ms);
      tasks.add(task);
      return () => tasks.delete(task);
    },
    pending: () => tasks.size,
    delays,
    run: () => {
      const all = [...tasks];
      tasks.clear();
      all.forEach((t) => t());
    },
  };
}

let mounted: ReturnType<typeof mount>;
beforeEach(() => (mounted = mount()));
afterEach(() => mounted.remove());

describe('rovingIndex', () => {
  it('wraps both ways, jumps with Home / End, ignores other keys and the other axis', () => {
    expect(rovingIndex('ArrowRight', 2, 3, 'horizontal')).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, 3, 'horizontal')).toBe(2);
    expect(rovingIndex('ArrowDown', 0, 3, 'vertical')).toBe(1);
    expect(rovingIndex('ArrowUp', 1, 3, 'vertical')).toBe(0);
    expect(rovingIndex('Home', 2, 3, 'vertical')).toBe(0);
    expect(rovingIndex('End', 0, 3, 'horizontal')).toBe(2);
    expect(rovingIndex('ArrowDown', 0, 3, 'horizontal')).toBeNull();
    expect(rovingIndex('a', 0, 3, 'horizontal')).toBeNull();
  });
});

describe('button', () => {
  it('is a type=button control with icon and text that calls onClick', () => {
    const onClick = jasmine.createSpy('onClick');
    const button = createButton(dom, { label: 'Pause', icon: 'pause', onClick, className: 'dcp-x' });
    mounted.root.appendChild(button.element);
    button.element.click();
    button.setLabel('Resume');

    expect(button.element.type).toBe('button');
    expect(button.element.className).toBe('dcp-btn dcp-x');
    expect(button.element.textContent).toBe('Resume');
    expect(button.element.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(onClick).toHaveBeenCalledTimes(1);
    // HLD §5.7: 24 px tall, 1 px border, radius 4.
    const style = getComputedStyle(button.element);
    expect(style.height).toBe('24px');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderTopLeftRadius).toBe('4px');
  });

  it('icon-only: the label is the accessible name and tooltip; no text', () => {
    const button = createButton(dom, { label: 'Settings', icon: 'settings', iconOnly: true, onClick: () => undefined });
    mounted.root.appendChild(button.element);

    expect(button.element.getAttribute('aria-label')).toBe('Settings');
    expect(button.element.title).toBe('Settings');
    expect(button.element.textContent).toBe('');
    expect(button.element.classList).toContain('dcp-btn--icon');
    expect(getComputedStyle(button.element).width).toBe('24px');
    button.setLabel('Close settings');
    expect(button.element.getAttribute('aria-label')).toBe('Close settings');
  });

  it('disabled: no click, 50 % opacity', () => {
    const onClick = jasmine.createSpy('onClick');
    const button = createButton(dom, { label: 'Copy', onClick, disabled: true });
    mounted.root.appendChild(button.element);
    button.element.click();

    expect(onClick).not.toHaveBeenCalled();
    expect(getComputedStyle(button.element).opacity).toBe('0.5');
    button.setDisabled(false);
    button.element.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('an onClick that throws goes to onError, not to the page', () => {
    const onError = jasmine.createSpy('onError');
    const button = createButton(dom, {
      label: 'x',
      onClick: () => {
        throw new Error('boom');
      },
      onError,
    });
    expect(() => button.element.click()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('tabs', () => {
  const tabs = [
    { id: 'network', label: 'Network' },
    { id: 'console', label: 'Console' },
    { id: 'settings', label: 'Settings' },
  ];
  const selectedOf = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('[role="tab"]')).map(
      (t) => `${t.textContent}:${t.getAttribute('aria-selected')}:${t.getAttribute('tabindex')}`,
    );

  it('is a named tablist with one selected tab and one tab stop', () => {
    const control = createTabs(dom, { tabs, selected: 'console', ariaLabel: 'Sections', onChange: () => undefined });
    mounted.root.appendChild(control.element);

    expect(control.element.getAttribute('role')).toBe('tablist');
    expect(control.element.getAttribute('aria-label')).toBe('Sections');
    expect(control.selected).toBe('console');
    expect(selectedOf(control.element)).toEqual(['Network:false:-1', 'Console:true:0', 'Settings:false:-1']);
    const active = control.element.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(getComputedStyle(active).fontWeight).toBe('600');
  });

  it('→ ← move and select (wrapping), Home / End jump; focus follows; onChange each time', () => {
    const onChange = jasmine.createSpy('onChange');
    const control = createTabs(dom, { tabs, ariaLabel: 'Sections', onChange });
    mounted.root.appendChild(control.element);
    control.focus();
    const tabAt = (i: number): Element => control.element.children[i] as Element;

    expect(control.selected).toBe('network');
    const right = key(tabAt(0), 'ArrowRight');
    expect(right.defaultPrevented).toBeTrue();
    expect(control.selected).toBe('console');
    expect(mounted.shadow.activeElement).toBe(tabAt(1));
    key(tabAt(1), 'End');
    expect(control.selected).toBe('settings');
    key(tabAt(2), 'ArrowRight');
    expect(control.selected).toBe('network');
    key(tabAt(0), 'ArrowLeft');
    expect(control.selected).toBe('settings');
    key(tabAt(2), 'Home');
    expect(control.selected).toBe('network');
    expect(key(tabAt(0), 'a').defaultPrevented).toBeFalse();
    expect(onChange.calls.allArgs()).toEqual([['console'], ['settings'], ['network'], ['settings'], ['network']]);
  });

  it('click selects; clicking the selected tab or select() does not call onChange', () => {
    const onChange = jasmine.createSpy('onChange');
    const control = createTabs(dom, { tabs, ariaLabel: 'Sections', onChange });
    (control.element.children[2] as HTMLElement).click();
    (control.element.children[2] as HTMLElement).click();
    control.select('console');
    key(control.element, 'ArrowRight');

    expect(onChange.calls.allArgs()).toEqual([['settings']]);
    expect(control.selected).toBe('console');
  });

  it('needs at least one tab', () => {
    expect(() => createTabs(dom, { tabs: [], ariaLabel: 'x', onChange: () => undefined })).toThrowError(RangeError);
  });
});

describe('chip group', () => {
  const chips = [
    { id: 'xhr', label: 'XHR' },
    { id: 'fetch', label: 'Fetch' },
  ];
  const pressed = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('button')).map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`);

  it('is a named group; "All" is on when no chip is', () => {
    const control = createChipGroup(dom, { chips, ariaLabel: 'Type', onChange: () => undefined });
    expect(control.element.getAttribute('role')).toBe('group');
    expect(control.element.getAttribute('aria-label')).toBe('Type');
    expect(pressed(control.element)).toEqual(['All:true', 'XHR:false', 'Fetch:false']);
    expect(control.selected).toEqual([]);
  });

  it('chips toggle (OR within the group); "All" resets; onChange gets the ids in chip order', () => {
    const onChange = jasmine.createSpy('onChange');
    const control = createChipGroup(dom, { chips, ariaLabel: 'Type', onChange });
    mounted.root.appendChild(control.element);
    const [all, xhr, fetch] = Array.from(control.element.querySelectorAll('button'));
    fetch?.click();
    xhr?.click();

    expect(pressed(control.element)).toEqual(['All:false', 'XHR:true', 'Fetch:true']);
    expect(getComputedStyle(xhr as HTMLElement).backgroundColor).not.toBe(
      getComputedStyle(all as HTMLElement).backgroundColor,
    );
    fetch?.click();
    all?.click();
    expect(pressed(control.element)).toEqual(['All:true', 'XHR:false', 'Fetch:false']);
    expect(onChange.calls.allArgs()).toEqual([[['fetch']], [['xhr', 'fetch']], [['xhr']], [[]]]);
  });

  it('setSelected() sets without onChange and ignores unknown ids; the start selection is honoured', () => {
    const onChange = jasmine.createSpy('onChange');
    const control = createChipGroup(dom, { chips, selected: ['fetch'], allLabel: 'Any', ariaLabel: 'Type', onChange });
    expect(pressed(control.element)).toEqual(['Any:false', 'XHR:false', 'Fetch:true']);
    control.setSelected(['xhr', 'nope']);
    expect(control.selected).toEqual(['xhr']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('← → Home End move focus inside the group (one tab stop)', () => {
    const control = createChipGroup(dom, { chips, ariaLabel: 'Type', onChange: () => undefined });
    mounted.root.appendChild(control.element);
    const buttons = Array.from(control.element.querySelectorAll('button'));
    const stops = (): string[] => buttons.map((b) => b.getAttribute('tabindex') ?? '');
    expect(stops()).toEqual(['0', '-1', '-1']);
    buttons[0]?.focus();

    expect(key(buttons[0] as Element, 'ArrowRight').defaultPrevented).toBeTrue();
    expect(mounted.shadow.activeElement).toBe(buttons[1] as Element);
    expect(stops()).toEqual(['-1', '0', '-1']);
    key(buttons[1] as Element, 'ArrowLeft');
    key(buttons[0] as Element, 'ArrowLeft');
    expect(mounted.shadow.activeElement).toBe(buttons[2] as Element);
    key(buttons[2] as Element, 'Home');
    expect(mounted.shadow.activeElement).toBe(buttons[0] as Element);
    key(buttons[0] as Element, 'End');
    expect(mounted.shadow.activeElement).toBe(buttons[2] as Element);
    expect(key(buttons[2] as Element, 'Enter').defaultPrevented).toBeFalse();
    expect(key(control.element, 'ArrowRight').defaultPrevented).toBeFalse();
  });
});

describe('search box', () => {
  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('is a named text input (not type=search) with the search icon', () => {
    const fake = fakeSchedule();
    const box = createSearchBox(dom, {
      ariaLabel: 'Filter requests',
      placeholder: 'Filter URL',
      schedule: fake.schedule,
      onSearch: () => undefined,
    });
    expect(box.input.type).toBe('text');
    expect(box.input.getAttribute('aria-label')).toBe('Filter requests');
    expect(box.input.placeholder).toBe('Filter URL');
    expect(box.input.getAttribute('autocomplete')).toBe('off');
    expect(box.element.querySelector('svg')?.getAttribute('data-icon')).toBe('search');
  });

  it('applies 150 ms after typing stops, through the injected scheduler only', () => {
    const fake = fakeSchedule();
    const onSearch = jasmine.createSpy('onSearch');
    const box = createSearchBox(dom, { ariaLabel: 'Filter', schedule: fake.schedule, onSearch });
    type(box.input, 'g');
    type(box.input, 'ge');
    type(box.input, 'get');

    expect(fake.delays).toEqual([SEARCH_DEBOUNCE_MS, SEARCH_DEBOUNCE_MS, SEARCH_DEBOUNCE_MS]);
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
    expect(fake.pending()).toBe(1);
    expect(onSearch).not.toHaveBeenCalled();
    fake.run();
    expect(onSearch.calls.allArgs()).toEqual([['get']]);
    expect(box.value).toBe('get');
  });

  it('Enter applies at once; an unchanged text is not applied twice', () => {
    const fake = fakeSchedule();
    const onSearch = jasmine.createSpy('onSearch');
    const box = createSearchBox(dom, { ariaLabel: 'Filter', schedule: fake.schedule, delayMs: 300, onSearch });
    type(box.input, 'post');
    key(box.input, 'Enter');

    expect(fake.delays).toEqual([300]);
    expect(fake.pending()).toBe(0);
    expect(onSearch.calls.allArgs()).toEqual([['post']]);
    key(box.input, 'Enter');
    key(box.input, 'a');
    box.flush();
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('setValue() replaces the text and drops a pending search without onSearch', () => {
    const fake = fakeSchedule();
    const onSearch = jasmine.createSpy('onSearch');
    const box = createSearchBox(dom, { ariaLabel: 'Filter', value: 'x', schedule: fake.schedule, onSearch });
    mounted.root.appendChild(box.element);
    expect(box.value).toBe('x');
    type(box.input, 'xy');
    box.setValue('');
    fake.run();

    expect(onSearch).not.toHaveBeenCalled();
    expect(box.value).toBe('');
    box.focus();
    expect(mounted.shadow.activeElement).toBe(box.input);
  });

  it('errors from onSearch or a cancel go to onError', () => {
    const fake = fakeSchedule();
    const onError = jasmine.createSpy('onError');
    const box = createSearchBox(dom, {
      ariaLabel: 'Filter',
      schedule: (task, ms) => {
        fake.schedule(task, ms);
        return () => {
          throw new Error('cancel');
        };
      },
      onSearch: () => {
        throw new Error('search');
      },
      onError,
    });
    type(box.input, 'a');
    type(box.input, 'ab');
    fake.run();
    type(box.input, 'abc');
    box.flush();

    expect(onError.calls.allArgs().map(([e]) => (e as Error).message)).toEqual([
      'cancel',
      'search',
      'cancel',
      'search',
    ]);
  });
});

describe('empty / no-match block', () => {
  it('shows the message; the optional button calls back', () => {
    const onClick = jasmine.createSpy('onClick');
    const plain = createEmptyState(dom, { message: 'No requests yet.' });
    const noMatch = createEmptyState(dom, {
      message: 'No entries match the filter.',
      action: { label: 'Clear filters', onClick },
    });
    mounted.root.appendChild(noMatch.element);
    noMatch.element.querySelector('button')?.click();
    noMatch.setMessage('<b>x</b>');

    expect(plain.element.textContent).toBe('No requests yet.');
    expect(plain.element.querySelector('button')).toBeNull();
    expect(noMatch.element.querySelector('button')?.textContent).toBe('Clear filters');
    expect(noMatch.element.querySelector('b')).toBeNull();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(getComputedStyle(noMatch.element).display).toBe('flex');
    plain.destroy();
  });
});
