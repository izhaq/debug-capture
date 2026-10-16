import { JsonValue, resolvePolicy, toJsonSafe, truncate } from '../../model';
import { createJsonViewer, JsonViewer, JsonViewerOptions } from './json-viewer';
import { JSON_VIEWER_CSS } from './json-viewer.css';

const REDACTED = '[redacted]';

describe('createJsonViewer', () => {
  let host: HTMLElement;
  let viewers: JsonViewer[];

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    viewers = [];
  });

  afterEach(() => {
    viewers.forEach((v) => v.destroy());
    host.remove();
  });

  function view(value: JsonValue, options: Partial<JsonViewerOptions> = {}): JsonViewer {
    const viewer = createJsonViewer(document, value, { ariaLabel: 'Body', redactedValue: REDACTED, ...options });
    host.appendChild(viewer.element);
    viewers.push(viewer);
    return viewer;
  }

  const items = (v: JsonViewer): HTMLElement[] =>
    Array.from(v.element.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const keyed = (v: JsonViewer, key: string): HTMLElement => {
    const found = items(v).find(
      (li) => li.querySelector(':scope > .dcp-json-line > .dcp-json-key')?.textContent === key,
    );
    if (found === undefined) {
      throw new Error(`no item with key ${key}`);
    }
    return found;
  };
  const valueOf = (li: HTMLElement): Element => li.querySelector(':scope > .dcp-json-line')!.lastElementChild!;
  const press = (target: Element, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const focused = (): string | null | undefined =>
    (document.activeElement as HTMLElement).querySelector(':scope > .dcp-json-line')?.textContent;

  describe('tree', () => {
    it('is a labelled tree with one tab stop', () => {
      const v = view({ a: 1, b: [1] });
      expect(v.element.getAttribute('role')).toBe('tree');
      expect(v.element.getAttribute('aria-label')).toBe('Body');
      expect(v.element.classList).toContain('dcp-json');
      const stops = items(v).filter((li) => li.tabIndex === 0);
      expect(stops.length).toBe(1);
      expect(stops[0]).toBe(items(v)[0]);
      expect(items(v)[1].tabIndex).toBe(-1);
    });

    it('renders each value kind with its class', () => {
      const v = view({ s: 'text', n: -1.5, t: true, f: false, z: null, p: '[Circular]' });
      expect(valueOf(keyed(v, 's')).className).toContain('dcp-json-string');
      expect(valueOf(keyed(v, 's')).textContent).toBe('"text"');
      expect(valueOf(keyed(v, 'n')).className).toContain('dcp-json-number');
      expect(valueOf(keyed(v, 'n')).textContent).toBe('-1.5');
      for (const [key, text] of [
        ['t', 'true'],
        ['f', 'false'],
        ['z', 'null'],
      ]) {
        expect(valueOf(keyed(v, key)).className)
          .withContext(key)
          .toContain('dcp-json-literal');
        expect(valueOf(keyed(v, key)).textContent)
          .withContext(key)
          .toBe(text);
      }
      expect(valueOf(keyed(v, 'p')).className).toContain('dcp-json-placeholder');
      expect(valueOf(keyed(v, 'p')).textContent).toBe('[Circular]');
      expect(keyed(v, 's').querySelector('.dcp-json-key')!.className).toBe('dcp-json-key');
    });

    it('marks strings for bidi isolation', () => {
      const v = view(['שלום abc']);
      expect(v.element.querySelector('.dcp-json-string')!.getAttribute('dir')).toBe('auto');
    });

    it('renders a primitive root as one leaf', () => {
      const v = view(42);
      expect(items(v).length).toBe(1);
      expect(items(v)[0].hasAttribute('aria-expanded')).toBeFalse();
      expect(v.element.querySelector('.dcp-json-number')!.textContent).toBe('42');
    });

    it('shows empty containers as leaves', () => {
      const v = view({ a: [], o: {} });
      expect(keyed(v, 'a').hasAttribute('aria-expanded')).toBeFalse();
      expect(valueOf(keyed(v, 'a')).textContent).toBe('[]');
      expect(valueOf(keyed(v, 'o')).textContent).toBe('{}');
    });

    it('shows a one-line preview of a collapsed container', () => {
      const v = view({ o: { a: 1, b: 'x', c: [1], d: {}, e: null, f: REDACTED } });
      const summary = keyed(v, 'o').querySelector('.dcp-json-summary')!;
      expect(summary.textContent).toBe('Object(6) {a: 1, b: "x", c: […], d: {}, e: null, f: [redacted]}');
    });

    it('cuts a long preview', () => {
      const v = view({ o: { a: 'y'.repeat(500) } });
      const text = keyed(v, 'o').querySelector('.dcp-json-summary')!.textContent!;
      expect(text.length).toBeLessThan(100);
      expect(text.endsWith('…')).toBeTrue();
    });
  });

  describe('markers', () => {
    it('shows every v1 placeholder as a placeholder', () => {
      const div = document.createElement('div');
      div.id = 'x';
      const args = toJsonSafe(
        [undefined, () => 1, new Date(Number.NaN), new Uint8Array(2), div, document.createTextNode('t'), [[1]]],
        resolvePolicy({ maxArgDepth: 1 }),
      );
      const v = view(args, { expandDepth: 2 });
      const shown = Array.from(v.element.querySelectorAll('.dcp-json-placeholder')).map((e) => e.textContent);
      expect(shown).toEqual([
        '[undefined]',
        '[Function anonymous]',
        '[Invalid Date]',
        '[Uint8Array 2 bytes]',
        '[HTMLDivElement div#x]',
        '[Text]',
        '[Array(1)]',
      ]);
      expect(v.element.querySelectorAll('.dcp-json-string').length).toBe(0);
    });

    it("styles v1's own keys as placeholders", () => {
      const v = view({ '[Map]': [[1, 2]], '…': '…3 more' });
      expect(keyed(v, '[Map]').querySelector('.dcp-json-key')!.classList).toContain('dcp-json-placeholder');
      expect(keyed(v, '…').querySelector('.dcp-json-key')!.classList).toContain('dcp-json-placeholder');
    });

    it('gives a redacted leaf the redacted badge', () => {
      const v = view({ token: REDACTED, other: '***' });
      const badge = valueOf(keyed(v, 'token'));
      expect(badge.className).toBe('dcp-badge dcp-badge--redacted');
      expect(badge.textContent).toBe('redacted');
      expect(valueOf(keyed(v, 'other')).className).toContain('dcp-json-string');
    });

    it('uses the redacted value of the options', () => {
      const v = view({ token: '***' }, { redactedValue: '***' });
      expect(valueOf(keyed(v, 'token')).className).toBe('dcp-badge dcp-badge--redacted');
    });

    it('puts the injected icon in the badge', () => {
      const icon = jasmine
        .createSpy('badgeIcon')
        .and.callFake(() => document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
      const v = view({ token: REDACTED, body: truncate('abcdef', 2) }, { badgeIcon: icon });
      expect(icon.calls.allArgs()).toEqual([['redacted'], ['truncated']]);
      expect(valueOf(keyed(v, 'token')).firstChild!.nodeName).toBe('svg');
    });

    it('keeps the badge when the icon callback throws', () => {
      const v = view(
        { token: REDACTED },
        {
          badgeIcon: () => {
            throw new Error('no icon');
          },
        },
      );
      expect(valueOf(keyed(v, 'token')).textContent).toBe('redacted');
    });

    it('gives a truncated string the truncated badge with its length', () => {
      const v = view({ body: truncate('x'.repeat(1300), 10) });
      const line = keyed(v, 'body').querySelector('.dcp-json-line')!;
      expect(line.querySelector('.dcp-json-string')!.textContent).toBe('"xxxxxxxxxx…"');
      const badge = line.querySelector('.dcp-badge--truncated')!;
      expect(badge.className).toBe('dcp-badge dcp-badge--truncated');
      expect(badge.textContent).toBe('truncated 1,290 chars');
    });

    it('marks the fetch cap note as truncated', () => {
      const v = view(['{"a":…[capture stopped at 1048576 chars]']);
      expect(v.element.querySelector('.dcp-badge--truncated')!.textContent).toBe('capture stopped at 1,048,576 chars');
    });

    it('highlights the redacted value inside other text', () => {
      const v = view([`https://x/?token=${REDACTED}&a=${REDACTED}`]);
      const string = v.element.querySelector('.dcp-json-string')!;
      const marks = string.querySelectorAll('.dcp-json-redacted');
      expect(marks.length).toBe(2);
      expect(marks[0].textContent).toBe(REDACTED);
      expect(string.textContent).toBe(`"https://x/?token=${REDACTED}&a=${REDACTED}"`);
    });

    it('highlights a redacted value that JSON escapes', () => {
      const v = view(['a "x" b'], { redactedValue: '"x"' });
      expect(v.element.querySelector('.dcp-json-redacted')!.textContent).toBe('\\"x\\"');
    });
  });

  describe('text only', () => {
    const XSS = '<img src=x onerror="window.__dcpJsonXss = 1">';

    it('never parses keys or values as HTML', () => {
      const v = view({ [XSS]: XSS, list: [XSS, `${XSS}…[truncated 9 chars]`] }, { expandDepth: 3 });
      expect(v.element.querySelector('img')).toBeNull();
      expect(keyed(v, XSS)).toBeDefined();
      expect(v.element.textContent).toContain(XSS.replace(/"/g, '\\"'));
      expect((window as unknown as Record<string, unknown>)['__dcpJsonXss']).toBeUndefined();
    });

    it('keeps the full text of a long string as text', () => {
      const v = view([XSS.repeat(50)], { longStringLimit: 10 });
      (v.element.querySelector('.dcp-json-show-all') as HTMLElement).click();
      expect(v.element.querySelector('img')).toBeNull();
      expect(v.element.querySelector('.dcp-json-string')!.textContent!.length).toBeGreaterThan(XSS.length * 50);
    });

    it('treats a redacted value with markup as text', () => {
      const v = view([`a${XSS}b`], { redactedValue: XSS });
      expect(v.element.querySelector('img')).toBeNull();
      expect(v.element.querySelectorAll('.dcp-json-redacted').length).toBe(1);
    });
  });

  describe('positions', () => {
    it('tells the real size, position and level of each item', () => {
      const big: Record<string, JsonValue> = {};
      for (let i = 0; i < 250; i++) {
        big[`k${i}`] = i === 1 ? [true] : i;
      }
      const v = view(big);
      const root = items(v)[0];
      expect([
        root.getAttribute('aria-level'),
        root.getAttribute('aria-setsize'),
        root.getAttribute('aria-posinset'),
      ]).toEqual(['1', '1', '1']);
      const second = keyed(v, 'k1');
      expect([
        second.getAttribute('aria-level'),
        second.getAttribute('aria-setsize'),
        second.getAttribute('aria-posinset'),
      ]).toEqual(['2', '250', '2']);
      second.click();
      expect([keyed(v, '0').getAttribute('aria-level'), keyed(v, '0').getAttribute('aria-setsize')]).toEqual([
        '3',
        '1',
      ]);
      (v.element.querySelector('.dcp-json-more') as HTMLElement).click();
      expect(keyed(v, 'k150').getAttribute('aria-posinset')).toBe('151');
      expect(keyed(v, 'k150').getAttribute('aria-setsize')).toBe('250');
    });

    it('does not count "Show more" as a child', () => {
      const v = view(Array.from({ length: 150 }, (_, i) => i));
      const more = v.element.querySelector('.dcp-json-more')!;
      expect(more.getAttribute('aria-level')).toBe('2');
      expect(more.hasAttribute('aria-posinset')).toBeFalse();
      expect(more.hasAttribute('aria-setsize')).toBeFalse();
      expect(items(v)[1].getAttribute('aria-setsize')).toBe('150');
    });
  });

  describe('paging', () => {
    const big = (n: number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (let i = 0; i < n; i++) {
        out[`k${i}`] = i;
      }
      return out;
    };

    it('shows the first 100 children of a 2,000-key object, then "Show 100 more"', () => {
      const v = view(big(2000));
      expect(items(v).length).toBe(1 + 100 + 1);
      const more = v.element.querySelector<HTMLElement>('.dcp-json-more')!;
      expect(more.getAttribute('role')).toBe('treeitem');
      expect(more.textContent).toBe('Show 100 more (1,900 hidden)');
      more.click();
      expect(items(v).length).toBe(1 + 200 + 1);
      expect(keyed(v, 'k199')).toBeDefined();
      expect(v.element.querySelector('.dcp-json-more')!.textContent).toBe('Show 100 more (1,800 hidden)');
    });

    it('pages arrays and ends with the remainder', () => {
      const v = view(
        Array.from({ length: 130 }, (_, i) => i),
        { pageSize: 50 },
      );
      expect(items(v).length).toBe(1 + 50 + 1);
      const more = (): HTMLElement => v.element.querySelector<HTMLElement>('.dcp-json-more')!;
      more().click();
      expect(more().textContent).toBe('Show 30 more (30 hidden)');
      more().focus();
      press(more(), 'Enter');
      expect(v.element.querySelector('.dcp-json-more')).toBeNull();
      expect(items(v).length).toBe(1 + 130);
      expect(focused()).toBe('100: 100');
    });

    it('shows a long string cut, with "Show all (N chars)"', () => {
      const text = 'a'.repeat(5000);
      const v = view({ s: text }, { longStringLimit: 100 });
      const string = keyed(v, 's').querySelector('.dcp-json-string')!;
      expect(string.textContent).toBe(`"${'a'.repeat(100)}…"`);
      const button = keyed(v, 's').querySelector<HTMLButtonElement>('.dcp-json-show-all')!;
      expect(button.textContent).toBe('Show all (5,000 chars)');
      expect(button.type).toBe('button');
      expect(button.tabIndex).toBe(-1);
      button.click();
      expect(keyed(v, 's').querySelector('.dcp-json-string')!.textContent).toBe(`"${text}"`);
      expect(keyed(v, 's').querySelector('.dcp-json-show-all')).toBeNull();
    });

    it('Enter on a long string shows all of it', () => {
      const v = view(['b'.repeat(300)], { longStringLimit: 10, expandDepth: 1 });
      const leaf = items(v)[1];
      leaf.focus();
      press(leaf, 'Enter');
      expect(leaf.querySelector('.dcp-json-string')!.textContent!.length).toBe(302);
    });

    it('cuts the kept part of a long truncated string too', () => {
      const v = view([truncate('c'.repeat(3000), 2000)], { longStringLimit: 100 });
      expect(v.element.querySelector('.dcp-json-show-all')!.textContent).toBe('Show all (2,000 chars)');
      expect(v.element.querySelector('.dcp-badge--truncated')!.textContent).toBe('truncated 1,000 chars');
    });

    it('defaults to 1,000 characters', () => {
      const v = view(['d'.repeat(1000), 'e'.repeat(1001)]);
      expect(v.element.querySelectorAll('.dcp-json-show-all').length).toBe(1);
    });
  });

  describe('expanding', () => {
    const nested = { a: { b: { c: 1 } }, x: 2 };

    it('renders children only when expanded', () => {
      const v = view(nested);
      expect(items(v).length).toBe(3);
      expect(() => keyed(v, 'b')).toThrow();
      expect(keyed(v, 'a').getAttribute('aria-expanded')).toBe('false');
      expect(keyed(v, 'a').querySelector('[role="group"]')).toBeNull();
      (keyed(v, 'a').querySelector('.dcp-json-line') as HTMLElement).click();
      expect(keyed(v, 'a').getAttribute('aria-expanded')).toBe('true');
      expect(keyed(v, 'b')).toBeDefined();
      (keyed(v, 'a').querySelector('.dcp-json-line') as HTMLElement).click();
      expect(items(v).length).toBe(3);
      expect(keyed(v, 'a').querySelector('[role="group"]')).toBeNull();
    });

    it('follows expandDepth', () => {
      expect(items(view(nested, { expandDepth: 0 })).length).toBe(1);
      expect(items(view(nested, { expandDepth: 3 })).length).toBe(5);
    });

    it('expandAll expands breadth first within the node budget', () => {
      const v = view({ a: { a1: { a2: 1 } }, b: { b1: 1 } });
      expect(v.expandAll(5)).toBeFalse();
      expect(items(v).length).toBe(5);
      expect(v.expandAll(1000)).toBeTrue();
      expect(items(v).length).toBe(6);
    });

    it('expandAll keeps the 100-child pages', () => {
      const v = view({ list: Array.from({ length: 300 }, (_, i) => i) });
      expect(v.expandAll(10_000)).toBeTrue();
      expect(items(v).length).toBe(1 + 1 + 100 + 1);
    });

    it('collapseAll removes every child', () => {
      const v = view(nested, { expandDepth: 5 });
      v.collapseAll();
      expect(items(v).length).toBe(1);
      expect(items(v)[0].getAttribute('aria-expanded')).toBe('false');
      expect(items(v)[0].tabIndex).toBe(0);
    });

    it('moves focus to the item that hid it', () => {
      const v = view(nested, { expandDepth: 5 });
      keyed(v, 'c').click();
      expect(focused()).toBe('c: 1');
      v.collapseAll();
      expect(document.activeElement).toBe(items(v)[0]);
    });

    it('does not blow the stack on deep nesting', () => {
      let deep: JsonValue = 'bottom';
      for (let i = 0; i < 50; i++) {
        deep = { [`d${i}`]: deep };
      }
      const v = view(deep, { expandDepth: 100 });
      expect(items(v).length).toBe(51);
      v.collapseAll();
      expect(v.expandAll(1000)).toBeTrue();
      expect(items(v).length).toBe(51);
      expect(v.element.querySelector('.dcp-json-string')!.textContent).toBe('"bottom"');
    });

    it('handles 5,000 levels without recursion', () => {
      let deep: JsonValue = 0;
      for (let i = 0; i < 5000; i++) {
        deep = [deep];
      }
      const v = view(deep, { expandDepth: 10_000 });
      expect(v.expandAll(20_000)).toBeTrue();
      expect(items(v).length).toBe(5001);
      v.collapseAll();
      expect(items(v).length).toBe(1);
    });

    it('caps what the initial expandDepth renders', () => {
      const wide: Record<string, JsonValue> = {};
      for (let i = 0; i < 100; i++) {
        wide[`k${i}`] = Array.from({ length: 100 }, (_, j) => j);
      }
      const v = view(wide, { expandDepth: 5 });
      expect(items(v).length).toBeLessThanOrEqual(1000);
    });
  });

  describe('keyboard', () => {
    it('→ expands, → again enters, ← goes to the parent, ← collapses', () => {
      const v = view({ a: { b: { c: 1 } } });
      const a = keyed(v, 'a');
      a.focus();
      press(a, 'ArrowRight');
      expect(a.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(a);
      press(a, 'ArrowRight');
      expect(document.activeElement).toBe(keyed(v, 'b'));
      expect(keyed(v, 'b').tabIndex).toBe(0);
      expect(a.tabIndex).toBe(-1);
      press(keyed(v, 'b'), 'ArrowLeft');
      expect(document.activeElement).toBe(a);
      press(a, 'ArrowLeft');
      expect(a.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(a);
    });

    it('Enter and Space toggle and keep the page from scrolling', () => {
      const v = view({ a: [1, 2] });
      const a = keyed(v, 'a');
      a.focus();
      const enter = press(a, 'Enter');
      expect(a.getAttribute('aria-expanded')).toBe('true');
      expect(enter.defaultPrevented).toBeTrue();
      const space = press(a, ' ');
      expect(a.getAttribute('aria-expanded')).toBe('false');
      expect(space.defaultPrevented).toBeTrue();
    });

    it('↑ ↓ Home End move between visible items', () => {
      const v = view({ a: 1, b: { c: 2 }, d: 3 }, { expandDepth: 2 });
      items(v)[0].focus();
      press(document.activeElement!, 'ArrowDown');
      expect(focused()).toBe('a: 1');
      press(document.activeElement!, 'End');
      expect(focused()).toBe('d: 3');
      press(document.activeElement!, 'ArrowUp');
      expect(focused()).toBe('c: 2');
      press(document.activeElement!, 'Home');
      expect(document.activeElement).toBe(items(v)[0]);
      press(document.activeElement!, 'ArrowUp');
      expect(document.activeElement).toBe(items(v)[0]);
    });

    it('leaves other keys alone', () => {
      const v = view({ a: 1 });
      items(v)[0].focus();
      expect(press(items(v)[0], 'Escape').defaultPrevented).toBeFalse();
      expect(press(items(v)[0], 'a').defaultPrevented).toBeFalse();
    });

    it('ignores keys with a modifier', () => {
      const v = view({ a: [1] });
      const a = keyed(v, 'a');
      a.focus();
      a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));
      expect(a.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('errors', () => {
    it('reports what a listener throws to onError and never throws to the host', () => {
      let armed = false;
      const trap = new Proxy(
        {},
        {
          ownKeys(target) {
            if (armed) {
              throw new Error('trap');
            }
            return Reflect.ownKeys(target);
          },
        },
      );
      const errors: unknown[] = [];
      const v = view({ a: { b: trap as JsonValue } }, { onError: (e) => errors.push(e) });
      armed = true;
      expect(() => (keyed(v, 'a').querySelector('.dcp-json-line') as HTMLElement).click()).not.toThrow();
      expect(errors.length).toBe(1);
      expect((errors[0] as Error).message).toBe('trap');
    });

    it('reports a failing icon and keeps the badge', () => {
      const errors: unknown[] = [];
      const v = view(
        { token: REDACTED },
        {
          badgeIcon: () => {
            throw new Error('no icon');
          },
          onError: (e) => errors.push(e),
        },
      );
      expect(valueOf(keyed(v, 'token')).textContent).toBe('redacted');
      expect(errors.map((e) => (e as Error).message)).toEqual(['no icon']);
    });

    it('survives a reporter that throws', () => {
      const v = view(
        { token: REDACTED },
        {
          badgeIcon: () => {
            throw new Error('no icon');
          },
          onError: () => {
            throw new Error('reporter');
          },
        },
      );
      expect(valueOf(keyed(v, 'token')).textContent).toBe('redacted');
    });
  });

  describe('destroy', () => {
    it('removes every listener it added and leaves the document alone', () => {
      const added: string[] = [];
      const removed: string[] = [];
      const proto = EventTarget.prototype;
      const add = proto.addEventListener;
      const remove = proto.removeEventListener;
      const addSpy = spyOn(proto, 'addEventListener').and.callFake(function (
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        added.push(type);
        add.call(this, type, listener, options);
      });
      spyOn(proto, 'removeEventListener').and.callFake(function (
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        removed.push(type);
        remove.call(this, type, listener, options);
      });
      const v = createJsonViewer(
        document,
        { a: [1, 2], s: 'x'.repeat(2000) },
        { ariaLabel: 'x', redactedValue: REDACTED },
      );
      v.expandAll(100);
      expect(added.length).toBeGreaterThan(0);
      v.destroy();
      expect(removed.sort()).toEqual(added.sort());
      for (const call of addSpy.calls.all()) {
        expect(call.object).toBe(v.element);
      }
      v.destroy();
    });

    it('stops reacting and empties the element', () => {
      const v = view({ a: [1] });
      const a = keyed(v, 'a');
      v.destroy();
      expect(v.element.childNodes.length).toBe(0);
      expect(v.element.parentNode).toBeNull();
      a.click();
      expect(a.getAttribute('aria-expanded')).toBe('false');
      expect(v.expandAll(10)).toBeFalse();
      v.collapseAll();
    });
  });

  describe('performance', () => {
    it('expands a 2,000-key object fast, rendering only 100 children', () => {
      const value: Record<string, JsonValue> = {};
      for (let i = 0; i < 2000; i++) {
        value[`key${i}`] = { n: i, s: `value ${i}`, list: [i, i + 1] };
      }
      const times: number[] = [];
      for (let run = 0; run < 9; run++) {
        const v = view(value, { expandDepth: 0 });
        const root = items(v)[0];
        root.focus();
        const start = performance.now();
        press(root, 'ArrowRight');
        times.push(performance.now() - start);
        expect(items(v).length).toBe(1 + 100 + 1);
        expect(v.element.getElementsByTagName('*').length).toBeLessThan(2000);
        v.destroy();
      }
      const median = times.sort((a, b) => a - b)[4];
      // The real guard against rendering every child is the item and element
      // count above: it fails exactly, at any speed. This limit only catches a
      // slow page. Median of 9, because single runs carry GC and JIT spikes
      // (worst single run seen: 20.6 ms). Measured median, headless Chromium
      // 141 on a loaded 4-CPU box, 3 runs: 1.2-1.7 ms. The regression
      // (rendering all 2,000 children, pageSize 2000) measured a median of
      // 17.7-21.0 ms. The limit is ~5x the measured time (room for a loaded
      // runner) and still ~2x below the regression.
      expect(median).toBeLessThan(8);
    });
  });

  it("gives inline [redacted] the redacted badge's opaque fill", () => {
    const shadowHost = document.createElement('div');
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`.dcp-root { --dcp-badge-muted-bg: #123456; --dcp-text-muted: #abcdef; }${JSON_VIEWER_CSS}`);
    shadow.adoptedStyleSheets = [sheet];
    const inner = document.createElement('div');
    inner.className = 'dcp-root';
    shadow.appendChild(inner);
    host.appendChild(shadowHost);
    const v = view([`Bearer ${REDACTED}`]);
    inner.appendChild(v.element);
    const mark = getComputedStyle(v.element.querySelector('.dcp-json-redacted')!);
    expect(mark.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(mark.color).toBe('rgb(171, 205, 239)');
  });

  it('exports CSS that uses only the json tokens and px', () => {
    expect(JSON_VIEWER_CSS).toContain('var(--dcp-json-key)');
    expect(JSON_VIEWER_CSS).toContain('var(--dcp-json-string)');
    expect(JSON_VIEWER_CSS).toContain('var(--dcp-json-number)');
    expect(JSON_VIEWER_CSS).toContain('var(--dcp-json-literal)');
    expect(JSON_VIEWER_CSS).toContain('.dcp-json-placeholder');
    // `%` needs no `\b` after it: a word boundary never follows a `%`.
    expect(JSON_VIEWER_CSS).not.toMatch(/\d(?:r?em|vh|vw)\b|\d%|@import|@font-face|@property|!important/);
    // color-mix() needs Chromium 111+; the theme's precomputed fill works from 90.
    expect(JSON_VIEWER_CSS).not.toContain('color-mix(');
    for (const used of JSON_VIEWER_CSS.match(/--dcp-[\w-]+/g) ?? []) {
      expect(used).toMatch(/^--dcp-(json-(key|string|number|literal)|text|text-muted|accent|bg-hover|badge-muted-bg)$/);
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(JSON_VIEWER_CSS);
    expect(sheet.cssRules.length).toBeGreaterThan(5);
  });
});
