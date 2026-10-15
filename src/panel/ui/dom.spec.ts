import { createDom, createListeners, report, SafeSvgTag, SafeTag, setAttr, setStyle, UnsafeDomError } from './dom';

describe('safe element builder (S04-01, NFR-SEC-01, ISO-04)', () => {
  const dom = createDom(document);

  describe('strings are text, never markup', () => {
    const payloads = [
      '<img src=x onerror="window.__dcpPwned=1">',
      '<script>window.__dcpPwned=1</script>',
      '<svg onload="window.__dcpPwned=1"></svg>',
      '&lt;b&gt;bold&lt;/b&gt;',
    ];
    for (const payload of payloads) {
      it(`keeps ${JSON.stringify(payload)} as one text node`, () => {
        const host = dom.el('div', null, [payload]);
        document.body.appendChild(host);
        try {
          expect(host.childNodes.length).toBe(1);
          expect(host.firstChild?.nodeType).toBe(Node.TEXT_NODE);
          expect(host.textContent).toBe(payload);
          expect(host.querySelector('*')).toBeNull();
          expect((window as unknown as Record<string, unknown>)['__dcpPwned']).toBeUndefined();
        } finally {
          host.remove();
        }
      });
    }

    it('text() and append() make text nodes too; numbers become text; null/undefined/false are skipped', () => {
      const node = dom.text('<b>x</b>');
      const host = dom.el('span');
      dom.append(host, [node, 42, null, undefined, false, dom.el('em', null, ['ok'])]);

      expect(node.nodeType).toBe(Node.TEXT_NODE);
      expect(host.childNodes.length).toBe(3);
      expect(host.textContent).toBe('<b>x</b>42ok');
      expect(host.querySelector('b')).toBeNull();
    });

    it('refuses a child that is neither a node nor text', () => {
      const fake = { nodeName: 'IMG', outerHTML: '<img>' } as unknown as Node;
      expect(() => dom.el('div', null, [fake])).toThrowError(UnsafeDomError, /child must be a node/);
    });
  });

  describe('tags', () => {
    const forbidden = [
      'script',
      'iframe',
      'object',
      'embed',
      'style',
      'link',
      'meta',
      'base',
      'a',
      'img',
      'form',
      'template',
    ];
    for (const tag of forbidden) {
      it(`refuses <${tag}>`, () => {
        expect(() => dom.el(tag as SafeTag)).toThrowError(UnsafeDomError, /not allowed/);
      });
    }
    for (const tag of ['script', 'a', 'use', 'foreignObject', 'animate', 'set', 'image', 'style']) {
      it(`refuses SVG <${tag}>`, () => {
        expect(() => dom.svg(tag as SafeSvgTag)).toThrowError(UnsafeDomError, /not allowed/);
      });
    }

    it('makes allowed HTML and SVG elements in the right namespace, with class, attributes and style', () => {
      const div = dom.el('div', {
        className: 'dcp-a dcp-b',
        attrs: { role: 'group', 'aria-label': 'x', hidden: true },
        style: { 'min-width': '10px', '--dcp-x': '3px' },
      });
      const path = dom.svg('path', { d: 'M0 0h1', 'stroke-width': 1.5 });
      const svg = dom.svg('svg', { viewBox: '0 0 16 16' }, [path]);

      expect(div.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      expect(div.className).toBe('dcp-a dcp-b');
      expect(div.getAttribute('role')).toBe('group');
      expect(div.getAttribute('hidden')).toBe('');
      expect(div.style.minWidth).toBe('10px');
      expect(div.style.getPropertyValue('--dcp-x').trim()).toBe('3px');
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(path.getAttribute('stroke-width')).toBe('1.5');
      expect(svg.firstChild).toBe(path);
    });
  });

  describe('attributes', () => {
    const forbiddenNames = [
      'onclick',
      'onerror',
      'ONLOAD',
      'onPointerDown',
      'href',
      'HREF',
      'xlink:href',
      'src',
      'srcset',
      'srcdoc',
      'style',
      'action',
      'formaction',
      'poster',
      'background',
      'ping',
      'data',
      'xmlns',
      'is',
      'a b',
      '1x',
      '',
      'x"y',
    ];
    for (const name of forbiddenNames) {
      it(`refuses attribute ${JSON.stringify(name)}`, () => {
        const el = dom.el('div');
        expect(() => setAttr(el, name, 'x')).toThrowError(UnsafeDomError);
        expect(() => dom.el('div', { attrs: { [name]: 'x' } })).toThrowError(UnsafeDomError);
        expect(() => dom.svg('path', { [name]: 'x' })).toThrowError(UnsafeDomError);
        expect(el.attributes.length).toBe(0);
      });
    }

    const scriptUrls = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '\u0000javascript:x',
      'vbscript:msgbox(1)',
    ];
    for (const value of scriptUrls) {
      it(`refuses the value ${JSON.stringify(value)} in any attribute`, () => {
        const el = dom.el('div');
        expect(() => setAttr(el, 'title', value)).toThrowError(UnsafeDomError, /script URL/);
        expect(() => setAttr(el, 'data-x', value)).toThrowError(UnsafeDomError, /script URL/);
        expect(el.hasAttribute('title')).toBeFalse();
      });
    }

    it('allows text that merely mentions javascript: after the start', () => {
      const el = dom.el('div', { attrs: { title: 'see https://x.test/?q=javascript:1' } });
      expect(el.title).toBe('see https://x.test/?q=javascript:1');
    });

    it('true sets an empty attribute; false, null and undefined remove it; numbers become text', () => {
      const el = dom.el('button', { attrs: { disabled: true, tabindex: -1 } });
      expect(el.disabled).toBeTrue();
      expect(el.getAttribute('tabindex')).toBe('-1');
      setAttr(el, 'disabled', false);
      setAttr(el, 'tabindex', null);
      setAttr(el, 'title', undefined);
      expect(el.hasAttribute('disabled')).toBeFalse();
      expect(el.hasAttribute('tabindex')).toBeFalse();
      expect(el.hasAttribute('title')).toBeFalse();
    });
  });

  describe('styles', () => {
    const forbiddenValues = [
      'url(https://x.test/a.png)',
      'URL (x)',
      'image-set("a.png" 1x)',
      'image("a.png")',
      'expression(alert(1))',
      'javascript:alert(1)',
      '\\75 rl(x)',
      '@import "x"',
    ];
    for (const value of forbiddenValues) {
      it(`refuses the style value ${JSON.stringify(value)}`, () => {
        const el = dom.el('div');
        expect(() => setStyle(el, 'background-image', value)).toThrowError(UnsafeDomError, /value/);
        expect(() => dom.el('div', { style: { background: value } })).toThrowError(UnsafeDomError);
        expect(el.getAttribute('style')).toBeNull();
      });
    }
    for (const name of ['cssText', 'background image', 'Width', '-x', '']) {
      it(`refuses the style name ${JSON.stringify(name)}`, () => {
        expect(() => setStyle(dom.el('div'), name, '1px')).toThrowError(UnsafeDomError, /property/);
      });
    }

    it('sets and removes one property through the CSSOM', () => {
      const el = dom.el('div');
      setStyle(el, 'flex', '0 0 300px');
      expect(el.style.flexBasis).toBe('300px');
      setStyle(el, 'flex', null);
      expect(el.style.flexBasis).toBe('');
    });
  });

  describe('listeners', () => {
    it('adds, removes one, removes all, and counts', () => {
      const el = dom.el('button');
      const listeners = createListeners();
      const a = jasmine.createSpy('a');
      const b = jasmine.createSpy('b');
      const removeA = listeners.on(el, 'click', a);
      listeners.on(el, 'click', b);
      el.click();
      removeA();
      removeA();
      el.click();

      expect(listeners.count).toBe(1);
      listeners.removeAll();
      el.click();

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(2);
      expect(listeners.count).toBe(0);
    });

    it('catches what a handler throws and hands it to the reporter (ISO-12)', () => {
      const el = dom.el('button');
      const onError = jasmine.createSpy('onError');
      const boom = new Error('boom');
      createListeners(onError).on(el, 'click', () => {
        throw boom;
      });
      createListeners().on(el, 'click', () => {
        throw boom;
      });

      expect(() => el.click()).not.toThrow();
      expect(onError).toHaveBeenCalledOnceWith(boom);
    });

    it('report() swallows a reporter that throws', () => {
      expect(() =>
        report(() => {
          throw new Error('reporter');
        }, 'x'),
      ).not.toThrow();
      expect(() => report(undefined, 'x')).not.toThrow();
    });
  });

  it('UnsafeDomError is an Error with its own name', () => {
    const error = new UnsafeDomError('x');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UnsafeDomError');
  });
});
