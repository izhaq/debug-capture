import { createBadge } from './badge';
import { createDom } from './dom';
import { HIGHLIGHT_MAX_MARKS, highlightText } from './highlight';
import { createIcon, ICON_NAMES, IconName } from './icons';

describe('icons (S04-03)', () => {
  const dom = createDom(document);

  it('covers every icon HLD §4 and §5 name', () => {
    const needed: IconName[] = [
      // status ✓ ↪ ⚠ ✕ ◌
      'success',
      'redirect',
      'warning',
      'error',
      'pending',
      // levels ℹ • ⋯
      'info',
      'log',
      'debug',
      // WS ↑ ↓ ● ■
      'sent',
      'received',
      'opened',
      'closed',
      // badges 🔒 ✂ (◌ = pending)
      'redacted',
      'truncated',
      // toolbar ⏸ ▶ ⟲ ⇩ ⚙ ⤢ ✕
      'pause',
      'resume',
      'clear',
      'export',
      'settings',
      'maximize',
      'close',
      'search',
      'chevron-down',
      'chevron-right',
      'new',
    ];
    expect(ICON_NAMES).toEqual(jasmine.arrayContaining(needed));
  });

  for (const name of ICON_NAMES) {
    it(`"${name}" is a 14 px decorative SVG in currentColor, built from shapes only`, () => {
      const svg = createIcon(dom, name);
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('class')).toBe('dcp-icon');
      expect(svg.getAttribute('width')).toBe('14');
      expect(svg.getAttribute('height')).toBe('14');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.hasAttribute('role')).toBeFalse();
      expect(svg.children.length).toBeGreaterThan(0);
      for (const shape of Array.from(svg.children)) {
        expect(['path', 'circle', 'rect']).toContain(shape.tagName);
        const fill = shape.getAttribute('fill');
        expect(fill === null || fill === 'currentColor').toBeTrue();
      }
    });
  }

  it('a labelled icon is an image with a name, not hidden', () => {
    const svg = createIcon(dom, 'error', { label: 'Error', size: 12 });
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Error');
    expect(svg.hasAttribute('aria-hidden')).toBeFalse();
    expect(svg.getAttribute('width')).toBe('12');
  });

  it('refuses an unknown name', () => {
    expect(() => createIcon(dom, 'nope' as IconName)).toThrowError(RangeError, /Unknown icon/);
  });
});

describe('badge', () => {
  const dom = createDom(document);

  it('has the shared classes, the icon and the word (HLD §5.4)', () => {
    const redacted = createBadge(dom, 'redacted');
    const truncated = createBadge(dom, 'truncated', 'truncated 1,204 chars');
    const pending = createBadge(dom, 'pending');

    expect(redacted.className).toBe('dcp-badge dcp-badge--redacted');
    expect(redacted.textContent).toBe('redacted');
    expect(redacted.querySelector('svg')?.getAttribute('data-icon')).toBe('redacted');
    expect(truncated.className).toBe('dcp-badge dcp-badge--truncated');
    expect(truncated.textContent).toBe('truncated 1,204 chars');
    expect(truncated.querySelector('svg')?.getAttribute('data-icon')).toBe('truncated');
    expect(pending.querySelector('svg')?.getAttribute('data-icon')).toBe('pending');
  });
});

describe('highlightText (dcp-match)', () => {
  const dom = createDom(document);
  const render = (text: string, query: string): HTMLElement => {
    const cell = dom.el('span');
    cell.appendChild(highlightText(dom, text, query));
    return cell;
  };

  it('marks each case-insensitive match and keeps the rest as text', () => {
    const cell = render('GET /api/Users?user=1', 'user');
    const marks = Array.from(cell.querySelectorAll('mark'));

    expect(cell.textContent).toBe('GET /api/Users?user=1');
    expect(marks.map((m) => m.textContent)).toEqual(['User', 'user']);
    expect(marks.every((m) => m.className === 'dcp-match')).toBeTrue();
    expect(cell.childNodes.length).toBe(5);
  });

  it('never parses markup, in the text or the query', () => {
    const cell = render('<img src=x onerror=alert(1)>', '<img');
    expect(cell.querySelector('img')).toBeNull();
    expect(cell.querySelector('mark')?.textContent).toBe('<img');
    expect(cell.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('marks at most HIGHLIGHT_MAX_MARKS matches; the rest stays plain text (review S-04 #3)', () => {
    const text = 'ab'.repeat(100_000);
    const cell = render(text, 'a');
    expect(HIGHLIGHT_MAX_MARKS).toBe(100);
    expect(cell.querySelectorAll('mark').length).toBe(100);
    // 100 marks, the 99 "b"s between them, and the rest as one text node.
    expect(cell.childNodes.length).toBe(200);
    expect(cell.textContent).toBe(text);
  });

  it('an empty query, no match, or a length-changing lower case gives plain text', () => {
    expect(render('abc', '').querySelector('mark')).toBeNull();
    expect(render('abc', 'x').textContent).toBe('abc');
    const turkish = render('İstanbul', 'stan');
    expect(turkish.querySelector('mark')).toBeNull();
    expect(turkish.textContent).toBe('İstanbul');
    expect(render('aaa', 'a').querySelectorAll('mark').length).toBe(3);
  });
});
