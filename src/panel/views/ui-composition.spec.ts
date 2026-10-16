import { createJsonViewer, createThemeSheet, createVirtualList, JSON_VIEWER_CSS, VIRTUAL_LIST_CSS } from './index';

/**
 * The three S-04 tracks style their own blocks, but every view will use them
 * through one sheet (`createThemeSheet(doc, [VIRTUAL_LIST_CSS, JSON_VIEWER_CSS])`).
 * These specs run the real composition, so a rule in one track can never
 * silently override another (the S-04 review found exactly that: the theme's
 * `.dcp-root :focus-visible` beat the list's own `outline: none`).
 */
describe('P2 blocks composed through the real theme sheet', () => {
  let host: HTMLElement;
  let root: ShadowRoot;
  let panel: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [createThemeSheet(document, [VIRTUAL_LIST_CSS, JSON_VIEWER_CSS])];
    panel = document.createElement('div');
    panel.className = 'dcp-root';
    panel.setAttribute('data-theme', 'dark');
    panel.style.height = '300px';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    root.appendChild(panel);
  });

  afterEach(() => host.remove());

  it('the list grid shows no second focus ring while a row is the active descendant', () => {
    const list = createVirtualList<{ id: number }>(document, {
      rowHeight: 22,
      columns: [{ key: 'id', label: '#', width: 'flex' }],
      ariaLabel: 'Requests',
      renderCell: (item, _key, cell) => {
        cell.textContent = String(item.id);
      },
      getKey: (item) => item.id,
    });
    panel.appendChild(list.element);
    list.setItems([{ id: 1 }, { id: 2 }]);
    list.select(0);
    const grid = (
      list.element.matches('[role="grid"]') ? list.element : list.element.querySelector('[role="grid"]')
    ) as HTMLElement;
    grid.focus();

    expect(grid.getAttribute('aria-activedescendant')).toBeTruthy();
    expect(getComputedStyle(grid).outlineStyle).toBe('none');
    list.destroy();
  });

  it('inline [redacted] in a JSON string gets the opaque badge background from the theme', () => {
    const viewer = createJsonViewer(
      document,
      { url: 'https://h/x?token=[redacted]&a=1' },
      {
        ariaLabel: 'Body',
        redactedValue: '[redacted]',
        expandDepth: 2,
      },
    );
    panel.appendChild(viewer.element);
    const mark = viewer.element.querySelector('.dcp-json-redacted') as HTMLElement;
    const expected = getComputedStyle(panel).getPropertyValue('--dcp-badge-muted-bg').trim();

    expect(mark).not.toBeNull();
    expect(expected).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getComputedStyle(mark).backgroundColor).toBe(hexToRgb(expected));
    viewer.destroy();
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
