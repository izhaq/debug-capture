import {
  CONSOLE_VIEW_CSS,
  HTTP_VIEW_CSS,
  VIEW_CSS,
  WS_VIEW_CSS,
  createConsoleView,
  createHttpView,
  createPanelStore,
  createThemeSheet,
  createWsView,
} from './index';
import type { CreateView, PanelDataSource, ViewDeps, ViewSettings } from './index';

/** Just enough of a data source for a store; the stubs read nothing from it. */
function emptySource(): PanelDataSource {
  return {
    snapshot: () => [],
    pending: () => [],
    stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
    capacity: () => 100,
    defaultCapacity: () => 5000,
    setCapacity: () => undefined,
    addNote: () => undefined,
    redactedValue: () => '[redacted]',
    subscribe: () => () => undefined,
    clear: () => undefined,
    exportJson: () => '[]',
    download: () => undefined,
    copyText: () => Promise.resolve(true),
    capture: { on: true, start: () => undefined, stop: () => undefined },
  };
}

const SETTINGS: ViewSettings = { time: { mode: 'clock', utcOffsetMinutes: 0 }, rowHeight: 22, dock: 'bottom' };

describe('P3 view contract (C3-1, C3-3)', () => {
  let host: HTMLElement;
  let root: ShadowRoot;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
  });

  afterEach(() => host.remove());

  function deps(): ViewDeps {
    const source = emptySource();
    return {
      document,
      root,
      source,
      store: createPanelStore({ source, isProblemEntry: () => false }),
      settings: SETTINGS,
      requestFrame: () => undefined,
      schedule: () => () => undefined,
      report: () => undefined,
    };
  }

  const STUBS: ReadonlyArray<readonly [string, CreateView, string]> = [
    ['HTTP', createHttpView, HTTP_VIEW_CSS],
    ['WebSocket', createWsView, WS_VIEW_CSS],
    ['Console', createConsoleView, CONSOLE_VIEW_CSS],
  ];

  for (const [name, create, css] of STUBS) {
    it(`${name}: a stub the frame can mount, update and destroy before the track lands`, () => {
      const d = deps();
      const view = create(d);
      expect(view.element.classList).toContain('dcp-view');
      expect(view.element.isConnected).withContext('the frame places it').toBe(false);
      root.appendChild(view.element);
      expect(() => {
        view.update(d.store.getState());
        view.applySettings({ ...SETTINGS, rowHeight: 26, dock: 'right' });
        view.focusFilter();
      }).not.toThrow();
      expect(view.handleEscape()).toBe(false);
      view.destroy();
      expect(view.element.isConnected).toBe(false);
      expect(() => view.destroy()).not.toThrow();
      expect(typeof css).toBe('string');
    });
  }

  it('VIEW_CSS styles the shared view chrome with px and tokens only', () => {
    for (const cls of [
      'dcp-view',
      'dcp-filter-bar',
      'dcp-list-pane',
      'dcp-detail',
      'dcp-detail-header',
      'dcp-detail-body',
    ]) {
      expect(VIEW_CSS).toContain(`.${cls}{`);
    }
    // No global selectors (`html`, `body` as tags, not `dcp-detail-body`), no hex colours.
    expect(VIEW_CSS).not.toMatch(
      /@(import|font-face|property)|::part|:root|(^|[\s,{}])(html|body)\b|#[0-9a-f]{3,8}\b/im,
    );
    expect(VIEW_CSS).not.toMatch(/\d(r?em|vh|vw)\b/);
  });

  it('stylesheet contract: one UI sheet from every part, appended after the loader sheet', () => {
    const loaderSheet = new CSSStyleSheet();
    loaderSheet.replaceSync(':host{all:initial}');
    root.adoptedStyleSheets = [loaderSheet];
    const ui = createThemeSheet(document, [VIEW_CSS, HTTP_VIEW_CSS, WS_VIEW_CSS, CONSOLE_VIEW_CSS]);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, ui];

    const panel = document.createElement('div');
    panel.className = 'dcp-root';
    panel.setAttribute('data-theme', 'dark');
    panel.style.cssText = 'display:flex;flex-direction:column;height:300px';
    const view = createHttpView(deps());
    const bar = document.createElement('div');
    bar.className = 'dcp-filter-bar';
    const pane = document.createElement('div');
    pane.className = 'dcp-list-pane';
    view.element.append(bar, pane);
    panel.appendChild(view.element);
    root.appendChild(panel);

    expect(root.adoptedStyleSheets).toEqual([loaderSheet, ui]);
    expect(getComputedStyle(view.element).display).toBe('flex');
    // Filter bar: 32 px (§5.3) on --dcp-bg-elevated, dark #26282c (§5.4).
    expect(getComputedStyle(bar).height).toBe('32px');
    expect(getComputedStyle(bar).backgroundColor).toBe('rgb(38, 40, 44)');
    // The list pane anchors the list's "↓ N new" button (C3-5).
    expect(getComputedStyle(pane).position).toBe('relative');
  });
});
