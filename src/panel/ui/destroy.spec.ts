import { createButton } from './button';
import { createChipGroup } from './chip-group';
import { createDom } from './dom';
import { createEmptyState } from './empty-state';
import { createMenu, createPopover } from './popover';
import { createSearchBox } from './search-box';
import { createSplitPane } from './split-pane';
import { createTabs } from './tabs';

/**
 * S04-04: every control's `destroy()` removes every listener it added.
 * Counted with spies on `addEventListener` / `removeEventListener`: each
 * (target, type, listener, capture) added while building must be removed by
 * `destroy()`.
 */
describe('destroy() removes every listener', () => {
  const dom = createDom(document);

  interface Call {
    readonly target: EventTarget;
    readonly type: string;
    readonly listener: unknown;
    readonly capture: boolean;
  }

  function track(): { added: Call[]; removed: Call[] } {
    const added: Call[] = [];
    const removed: Call[] = [];
    const record = (into: Call[], original: typeof EventTarget.prototype.addEventListener) =>
      function (this: EventTarget, type: string, listener: unknown, options?: boolean | EventListenerOptions): void {
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        into.push({ target: this, type, listener, capture });
        original.call(this, type, listener as EventListenerOrEventListenerObject, options);
      };
    const proto = EventTarget.prototype;
    const add = record(added, proto.addEventListener);
    const remove = record(removed, proto.removeEventListener);
    spyOn(proto, 'addEventListener').and.callFake(add);
    spyOn(proto, 'removeEventListener').and.callFake(remove);
    return { added, removed };
  }

  const same = (a: Call, b: Call): boolean =>
    a.target === b.target && a.type === b.type && a.listener === b.listener && a.capture === b.capture;

  const noop = (): void => undefined;
  const controls: Record<string, () => { destroy(): void }> = {
    button: () => createButton(dom, { label: 'x', onClick: noop }),
    tabs: () => createTabs(dom, { tabs: [{ id: 'a', label: 'A' }], ariaLabel: 'x', onChange: noop }),
    'chip group': () => createChipGroup(dom, { chips: [{ id: 'a', label: 'A' }], ariaLabel: 'x', onChange: noop }),
    'search box': () => createSearchBox(dom, { ariaLabel: 'x', schedule: () => noop, onSearch: noop }),
    'split pane': () =>
      createSplitPane(dom, { direction: 'row', first: dom.el('div'), second: dom.el('div'), ariaLabel: 'x' }),
    menu: () =>
      createMenu(dom, { trigger: dom.el('button'), ariaLabel: 'x', items: [{ id: 'a', label: 'A' }], onSelect: noop }),
    popover: () => createPopover(dom, { trigger: dom.el('button'), ariaLabel: 'x', content: ['x'] }),
    'empty state with action': () => createEmptyState(dom, { message: 'x', action: { label: 'Clear', onClick: noop } }),
  };

  for (const [name, make] of Object.entries(controls)) {
    it(name, () => {
      const { added, removed } = track();
      const control = make();
      const built = added.length;

      expect(built).withContext('it listens to something').toBeGreaterThan(0);
      control.destroy();
      expect(added.length).withContext('destroy adds nothing').toBe(built);
      for (const call of added) {
        expect(removed.some((r) => same(r, call)))
          .withContext(`${call.type} removed`)
          .toBeTrue();
      }
      expect(removed.length).toBe(built);
    });
  }

  it('search box: destroy() also cancels a pending search', () => {
    const cancel = jasmine.createSpy('cancel');
    const onSearch = jasmine.createSpy('onSearch');
    const box = createSearchBox(dom, { ariaLabel: 'x', schedule: () => cancel, onSearch });
    box.input.value = 'a';
    box.input.dispatchEvent(new Event('input'));
    box.destroy();
    box.input.value = 'ab';
    box.input.dispatchEvent(new Event('input'));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onSearch).not.toHaveBeenCalled();
  });
});
