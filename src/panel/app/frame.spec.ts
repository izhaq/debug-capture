import { FRAME_CSS } from './frame-css';
import { mountFrame } from './frame';
import { createRig, createStage, errorEntry, frameOptions, logEntry, NO_CONTROLLER, Rig, Stage } from './fakes.spec';
import type { MountPanelUiOptions } from './mount-panel-ui';
import { createConsoleView, createHttpView, createWsView } from './index';
import type { CreateView, PanelUiHandle } from './index';

describe('S-08 frame (mountFrame)', () => {
  let stage: Stage;
  let rig: Rig;
  let onRequestClose: jasmine.Spy<() => void>;

  beforeEach(() => {
    stage = createStage();
    rig = createRig();
    onRequestClose = jasmine.createSpy('onRequestClose');
  });
  afterEach(() => stage.remove());

  const mount = (extra: Partial<MountPanelUiOptions> = {}): PanelUiHandle =>
    mountFrame(stage.root, NO_CONTROLLER, frameOptions(stage, { onRequestClose, ...extra }), rig.deps);
  const q = <T extends Element = HTMLElement>(selector: string): T =>
    stage.panelRoot.querySelector(selector) as unknown as T;
  const named = (name: string): HTMLButtonElement => {
    const found = Array.from(stage.panelRoot.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === name || b.textContent === name,
    );
    if (!found) throw new Error(`no button named ${name}`);
    return found;
  };
  const press = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const statusParts = (): string[] =>
    Array.from(q('.dcp-statusbar').children)
      .filter((part) => !(part as HTMLElement).hidden)
      .map((part) => (part.textContent ?? '').replace(/\s+/g, ' ').trim());
  const stored = (): Record<string, unknown> => JSON.parse(rig.storage.items.get('dcp-spec') ?? '{}');
  const radio = (name: string, value: string): HTMLInputElement =>
    q<HTMLInputElement>(`input[name="dcp-setting-${name}"][value="${value}"]`);

  it('S08-01, S08-15: builds in panelRoot, appends one sheet after the loader’s; unmount undoes all of it, twice is harmless', () => {
    const ui = mount();
    rig.scope.frame();

    expect(stage.root.adoptedStyleSheets.length).toBe(2);
    expect(stage.root.adoptedStyleSheets[0]).toBe(stage.loaderSheet);
    expect(q('.dcp-frame')).not.toBeNull();
    expect(stage.panelRoot.style.height).toBe('40%');

    ui.unmount();
    ui.unmount();
    press(stage.panelRoot, { key: 'Escape' });

    expect(stage.root.adoptedStyleSheets).toEqual([stage.loaderSheet]);
    expect(stage.panelRoot.childNodes.length).toBe(0);
    expect(stage.panelRoot.getAttribute('style') ?? '').toBe('');
    expect(stage.panelRoot.getAttributeNames().sort()).toEqual(['class', 'tabindex']);
    expect(rig.source.listeners.size).toBe(0);
    expect(rig.scope.frames.size).toBe(0);
    expect(rig.scope.timers.size).toBe(0);
    expect(rig.views.logs.http?.destroyed).toBe(1);
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it('S08-02: events wait for the next frame — one frame for many events, one update, visible view only', () => {
    mount();
    rig.scope.frame();
    const http = rig.views.logs.http;
    expect(http?.updates.length).toBe(1);

    rig.source.push(logEntry(1));
    rig.source.push(logEntry(2));
    rig.source.push(errorEntry(3));
    expect(http?.updates.length).toBe(1);
    expect(rig.scope.frames.size).toBe(1);

    rig.scope.frame();
    expect(http?.updates.length).toBe(2);
    expect(http?.updates[1]?.entries.length).toBe(3);
    // Nothing new: no update.
    rig.scope.frame();
    expect(http?.updates.length).toBe(2);
    expect(rig.views.logs.ws).toBeUndefined();
    expect(rig.views.logs.console).toBeUndefined();
  });

  it('S08-02, ISO-09: the frame and the dialog timer are requested inside run (the root zone)', () => {
    const run = jasmine.createSpy('run').and.callFake(<T>(work: () => T): T => work());
    rig = createRig({ run });
    mount();
    const atMount = run.calls.count();
    rig.source.push(logEntry(1));
    rig.source.push(logEntry(2));

    expect(atMount).toBeGreaterThanOrEqual(2); // the first frame and the dialog check timer
    expect(run.calls.count()).toBe(atMount); // the frame was already requested
    rig.scope.frame();
    rig.source.push(logEntry(3));
    expect(run.calls.count()).toBe(atMount + 1);
  });

  it('S08-03: Network › HTTP first; views made on first show and kept; Alt+1 / Alt+2; the last tab is stored', () => {
    const made: string[] = [];
    const counting =
      (list: 'http' | 'ws' | 'console'): CreateView =>
      (deps) => {
        made.push(list);
        return rig.views.make[list](deps);
      };
    rig = createRig({ views: { http: counting('http'), ws: counting('ws'), console: counting('console') } });
    mount();
    expect(made).toEqual(['http']);
    expect(q('#dcp-panel-network').hidden).toBeFalse();
    expect(q('#dcp-tab-network').getAttribute('aria-selected')).toBe('true');
    expect(q('#dcp-subtab-http').getAttribute('aria-selected')).toBe('true');

    const toConsole = press(stage.panelRoot, { key: '2', code: 'Digit2', altKey: true });
    expect(toConsole.defaultPrevented).toBeTrue();
    expect(made).toEqual(['http', 'console']);
    expect(q('#dcp-panel-network').hidden).toBeTrue();
    expect(q('#dcp-panel-console').hidden).toBeFalse();
    expect(stage.root.activeElement).toBe(q('#dcp-tab-console'));
    rig.scope.frame();
    expect(rig.views.logs.console?.updates.length).toBe(1);

    press(stage.panelRoot, { key: '1', code: 'Digit1', altKey: true });
    q<HTMLButtonElement>('#dcp-subtab-ws').click();
    press(stage.panelRoot, { key: '2', code: 'Digit2', altKey: true });
    press(stage.panelRoot, { key: '1', code: 'Digit1', altKey: true });
    expect(made).toEqual(['http', 'console', 'ws']);
    expect(q('#dcp-panel-ws').hidden).toBeFalse();
    expect(q('#dcp-panel-http').hidden).toBeTrue();
    expect(stored()['tab']).toBe('ws');
  });

  it('S08-03, S08-11: opens on the stored tab', () => {
    rig.storage.items.set('dcp-spec', JSON.stringify({ tab: 'console' }));
    mount();
    expect(q('#dcp-panel-console').hidden).toBeFalse();
    expect(rig.views.logs.console).toBeDefined();
    expect(rig.views.logs.http).toBeUndefined();
  });

  it('S08-03, HLD §5.2: the Network sub-tabs sit in the shown view’s filter bar — at 160 px a Network list is as tall as the Console list', () => {
    rig = createRig({ views: { http: createHttpView, ws: createWsView, console: createConsoleView } });
    rig.storage.items.set('dcp-spec', JSON.stringify({ height: 160 }));
    mount();
    rig.scope.frame();
    const paneHeight = (list: string): number => q(`#dcp-panel-${list} .dcp-list-pane`).getBoundingClientRect().height;

    expect(q('#dcp-panel-http .dcp-filter-bar').contains(q('#dcp-subtab-http'))).toBeTrue();
    const http = paneHeight('http');
    expect(http).toBeGreaterThanOrEqual(3 * 22); // the header and two rows at Normal text

    // Arrow keys move the sub-tabs into the WebSocket view's bar; focus stays on the chosen tab.
    q('#dcp-subtab-http').focus();
    press(q('#dcp-subtab-http'), { key: 'ArrowRight' });
    rig.scope.frame();
    expect(q('#dcp-panel-ws .dcp-filter-bar').contains(q('#dcp-subtab-ws'))).toBeTrue();
    expect(stage.root.activeElement).toBe(q('#dcp-subtab-ws'));

    press(stage.panelRoot, { key: '2', code: 'Digit2', altKey: true });
    rig.scope.frame();
    expect(paneHeight('console')).toBe(http);
  });

  it('S08-07: toolbar order — Pause, Capture next to it, Clear, Export, settings, maximize, close', () => {
    mount();
    const names = Array.from(q('.dcp-toolbar').querySelectorAll(':scope > button, :scope > .dcp-popwrap > button')).map(
      (b) => b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['Pause', 'Capture', 'Clear', 'Export', 'Settings', 'Maximize panel', 'Close debug panel']);
  });

  it('S08-07, FR-BAR-01: Pause freezes the view and shows "Paused · N new"; Resume shows it all', () => {
    mount();
    rig.scope.frame();
    named('Pause').click();
    rig.scope.frame();
    rig.source.push(logEntry(1));
    rig.source.push(logEntry(2));
    rig.scope.frame();

    expect(q('.dcp-paused').hidden).toBeFalse();
    expect(q('.dcp-paused').textContent).toBe('Paused · 2 new');
    expect(rig.views.logs.http?.updates.slice(-1)[0]?.entries.length).toBe(0);

    named('Resume').click();
    rig.scope.frame();
    expect(q('.dcp-paused').hidden).toBeTrue();
    expect(rig.views.logs.http?.updates.slice(-1)[0]?.entries.length).toBe(2);
    expect(named('Pause')).toBeDefined();
  });

  it('S08-07, S08-12, FR-ACT-09: Capture switches recording off and on; the banner says so and turns it back on', () => {
    mount();
    rig.scope.frame();
    expect(named('Capture').getAttribute('aria-pressed')).toBe('true');
    expect(q('.dcp-banner').hidden).toBeTrue();

    named('Capture').click();
    rig.scope.frame();
    const banner = q('.dcp-banner');
    expect(rig.source.calls).toEqual(['stop']);
    expect(banner.hidden).toBeFalse();
    expect(banner.textContent).toContain('Capture is off — nothing new is recorded.');
    expect(named('Capture').getAttribute('aria-pressed')).toBe('false');
    expect(statusParts()).toContain('capture off');

    named('Turn on').click();
    rig.scope.frame();
    expect(rig.source.calls).toEqual(['stop', 'start']);
    expect(banner.hidden).toBeTrue();
    expect(statusParts()).toContain('capture on');
  });

  it('S08-07, FR-BAR-03/04: Clear empties the buffer; Export downloads or copies the whole buffer inside our root', async () => {
    mount();
    named('Clear').click();
    named('Export').click();
    q<HTMLButtonElement>('.dcp-menu__item[data-item="download"]').click();
    named('Export').click();
    q<HTMLButtonElement>('.dcp-menu__item[data-item="copy"]').click();
    await Promise.resolve();

    expect(rig.source.calls).toEqual(['clear', 'download', 'copy {"whole":"buffer"}']);
    expect(rig.source.downloadRoot).toBe(stage.root);
    expect(rig.source.copyRoot).toBe(stage.root);
  });

  it('S08-09: the status bar counts the visible list, problems, buffer, capture, dropped and evicted', () => {
    rig.source.entries = [logEntry(1), errorEntry(2), logEntry(3)];
    rig.source.statsValue = { recorded: 3, dropped: 0, evicted: 0, failed: 0 };
    mount();
    rig.scope.frame();
    expect(statusParts()).toEqual([
      '0 / 0 shown',
      '1 problem',
      'buffer 3 / 5,000',
      'capture on',
      'dropped 0',
      'evicted 0',
    ]);

    press(stage.panelRoot, { key: '2', code: 'Digit2', altKey: true });
    rig.source.statsValue = { recorded: 3, dropped: 1234, evicted: 0, failed: 0 };
    rig.source.emit({ type: 'stats', stats: rig.source.stats() });
    rig.source.push(errorEntry(4));
    rig.scope.frame();
    expect(statusParts()).toEqual([
      '4 / 4 shown',
      '2 problems',
      'buffer 4 / 5,000',
      'capture on',
      'dropped 1,234',
      'evicted 0',
    ]);
  });

  it('S08-09, FR-BAR-06: "N / M shown" counts entries — a Console run of three repeats is one row and 3 / 3', () => {
    rig = createRig({ views: { http: createHttpView, ws: createWsView, console: createConsoleView } });
    rig.storage.items.set('dcp-spec', JSON.stringify({ tab: 'console' }));
    rig.source.entries = [1, 2, 3].map((seq) => logEntry(seq, { args: ['same'] }));
    mount();
    rig.scope.frame();

    const rows = Array.from(
      stage.panelRoot.querySelectorAll<HTMLElement>('#dcp-panel-console .dcp-vlist__body > [role="row"]'),
    );
    expect(rows.filter((row) => !row.hidden).length).toBe(1);
    expect(statusParts()[0]).toBe('3 / 3 shown');
  });

  it('S08-10: settings reach the panel root and the views; Capture in settings is a switch, never stored', () => {
    mount();
    rig.scope.frame();
    named('Settings').click();
    const http = rig.views.logs.http;
    expect(http?.deps.settings).toEqual({
      time: { mode: 'clock', utcOffsetMinutes: 120 },
      rowHeight: 22,
      dock: 'bottom',
    });
    expect(radio('theme', 'auto').checked).toBeTrue();
    expect(radio('capture', 'on').checked).toBeTrue();

    radio('theme', 'light').click();
    radio('textSize', 'large').click();
    radio('dock', 'right').click();
    radio('time', 'relative').click();
    radio('capture', 'off').click();

    expect(stage.panelRoot.getAttribute('data-theme')).toBe('light');
    expect(stage.panelRoot.getAttribute('data-text-size')).toBe('large');
    expect(stage.panelRoot.getAttribute('data-dock')).toBe('right');
    expect(stage.panelRoot.style.width).toBe('520px');
    expect(http?.settings.slice(-1)[0]).toEqual({
      time: { mode: 'relative', origin: 1_000 },
      rowHeight: 26,
      dock: 'right',
    });
    expect(rig.source.calls).toEqual(['stop']);
    expect(stored()).toEqual(
      jasmine.objectContaining({ theme: 'light', textSize: 'large', dock: 'right', time: 'relative' }),
    );
    expect(Object.keys(stored())).not.toContain('capture');

    radio('theme', 'auto').click();
    radio('textSize', 'normal').click();
    expect(stage.panelRoot.hasAttribute('data-theme')).toBeFalse();
    expect(stage.panelRoot.hasAttribute('data-text-size')).toBeFalse();
  });

  it('S08-11, D-20: chips are stored and restored; search text never reaches storage', () => {
    mount();
    rig.scope.frame();
    const writesAtOpen = rig.storage.writes;
    rig.views.logs.http?.deps.store.setFilter('http', { text: 'Bearer secret-token', status: ['5xx'] });
    rig.scope.frame();
    const text = rig.storage.items.get('dcp-spec') ?? '';

    expect(writesAtOpen).toBe(0);
    expect(text).not.toContain('secret');
    expect((stored()['chips'] as { http: unknown }).http).toEqual({ status: ['5xx'], type: [] });
    // Search text alone changes nothing that is stored.
    rig.views.logs.http?.deps.store.setFilter('http', { text: 'other' });
    rig.scope.frame();
    expect(rig.storage.items.get('dcp-spec')).toBe(text);

    stage.remove();
    stage = createStage();
    const again = createRig({ storage: () => rig.storage });
    mountFrame(stage.root, NO_CONTROLLER, frameOptions(stage), again.deps);
    expect(again.views.logs.http?.deps.store.getState().filters.http).toEqual({ text: '', status: ['5xx'], type: [] });
  });

  it('S08-11: blocked storage or storageKey false — defaults, nothing written, nothing thrown', () => {
    rig.storage.blocked = true;
    expect(() => mount()).not.toThrow();
    named('Settings').click();
    radio('dock', 'right').click();
    expect(stage.panelRoot.getAttribute('data-dock')).toBe('right');
    expect(rig.storage.items.size).withContext('nothing written to blocked storage').toBe(0);

    stage.remove();
    stage = createStage();
    rig = createRig();
    const getter = jasmine.createSpy('storage').and.callFake(() => rig.storage);
    rig = createRig({ storage: getter });
    mount({ storageKey: false, defaultDock: 'right' });
    named('Settings').click();
    radio('theme', 'dark').click();
    expect(stage.panelRoot.getAttribute('data-dock')).toBe('right');
    expect(getter).not.toHaveBeenCalled();
  });

  it('S08-12, ISO-21: the host-dialog banner follows the check, which runs on our timer only while mounted', () => {
    rig.dialog = true;
    const ui = mount();
    const banners = stage.panelRoot.querySelectorAll<HTMLElement>('.dcp-banner');
    const dialog = banners[1] as HTMLElement;
    expect(dialog.hidden).toBeFalse();
    expect(dialog.textContent).toBe(
      'The page has a dialog open or is fullscreen. The panel can be seen but not used until it closes.',
    );
    expect(Array.from(rig.scope.timers.values()).map((t) => t.delayMs)).toEqual([500]);

    rig.dialog = false;
    rig.scope.tick();
    expect(dialog.hidden).toBeTrue();
    expect(rig.scope.timers.size).toBe(1);

    ui.unmount();
    expect(rig.scope.timers.size).toBe(0);
  });

  it('S08-14, FR-WIN-05: Escape — the view first, then our popups, then the panel; Ctrl+F focuses the view’s filter', () => {
    mount();
    const http = rig.views.logs.http;
    if (!http) throw new Error('no http view');

    http.closesOnEscape = true;
    expect(press(stage.panelRoot, { key: 'Escape' }).defaultPrevented).toBeTrue();
    expect(http.escapes).toBe(1);
    expect(onRequestClose).not.toHaveBeenCalled();

    http.closesOnEscape = false;
    named('Settings').click();
    press(stage.root.activeElement as Element, { key: 'Escape' });
    expect(q('.dcp-pop[role="dialog"]').hidden).toBeTrue();
    expect(onRequestClose).not.toHaveBeenCalled();

    press(stage.panelRoot, { key: 'Escape' });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(press(stage.panelRoot, { key: 'Escape', shiftKey: true }).defaultPrevented).toBeFalse();

    expect(press(stage.panelRoot, { key: 'Escape', isComposing: true }).defaultPrevented)
      .withContext('Escape that ends an IME composition is not ours')
      .toBeFalse();
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    const find = press(stage.panelRoot, { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(find.defaultPrevented).toBeTrue();
    expect(http.filterFocus).toBe(1);

    named('Close debug panel').click();
    expect(onRequestClose).toHaveBeenCalledTimes(2);
  });

  it('S08-16: a frame that fails every time asks for no new frame (no endless redraw)', () => {
    mount();
    rig.scope.frame();
    const http = rig.views.logs.http;
    if (!http) throw new Error('no http view');
    const store = http.deps.store as { getState: () => unknown };
    store.getState = () => {
      throw new Error('store broken');
    };
    rig.source.push(logEntry(1));
    rig.scope.frame(); // applies the entry; the store change asks for one more frame
    rig.scope.frame(); // fails again; the failure itself asks for nothing
    expect(rig.scope.frames.size).withContext('no frame asked for by the failure').toBe(0);
  });

  it('S08-16: a failing apply still lets the frame show the error count', () => {
    mount();
    rig.scope.frame();
    const http = rig.views.logs.http;
    if (!http) throw new Error('no http view');
    (http.deps.store as unknown as { apply: () => void }).apply = () => {
      throw new Error('apply failed');
    };
    rig.source.push(logEntry(1));
    rig.scope.frame();
    expect(statusParts()).toContain('panel error 1');
  });

  it('S08-12, S08-16: a dialog check that keeps failing is counted once', () => {
    rig = createRig({
      hasModalDialog: () => {
        throw new Error(':modal not supported');
      },
    });
    mount();
    for (let i = 0; i < 4; i++) rig.scope.tick();
    rig.scope.frame();
    expect(statusParts()).toContain('panel error 1');
  });

  it('NFR-PERF-03: events never pile up past the buffer while no frame runs (a background tab)', () => {
    mount();
    const http = rig.views.logs.http;
    if (!http) throw new Error('no http view');
    for (let seq = 1; seq <= rig.source.capacity() + 100; seq++) rig.source.push(logEntry(seq));
    expect(http.deps.store.getState().entries.length).withContext('applied without a frame').toBeGreaterThan(0);
  });

  it('S08-16, NFR-REL-01: a view that throws is counted as "panel error", and the frame keeps working', () => {
    const boom: CreateView = () => {
      throw new Error('view failed');
    };
    const views = rig.views;
    rig = createRig({ views: { ...views.make, http: boom } });
    mount();
    rig.scope.frame();
    expect(statusParts()).toContain('panel error 1');

    expect(press(stage.panelRoot, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented)
      .withContext('no view: the browser keeps its Find')
      .toBeFalse();

    press(stage.panelRoot, { key: '2', code: 'Digit2', altKey: true });
    const consoleLog = views.logs.console;
    if (!consoleLog) throw new Error('no console view');
    consoleLog.view.update = () => {
      throw new Error('update failed');
    };
    rig.source.push(logEntry(1));
    rig.scope.frame();
    rig.scope.frame();
    expect(statusParts()).toContain('panel error 2');
    expect(statusParts()[0]).toBe('1 / 1 shown');
  });

  it('S08-06: Maximize fills the window and toggles back', () => {
    mount();
    const button = named('Maximize panel');
    button.click();
    expect(stage.panelRoot.style.top).toBe('0px');
    expect(stage.panelRoot.style.height).toBe('auto');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Restore panel size');
    expect(q('.dcp-resize').hidden).toBeTrue();

    button.click();
    expect(stage.panelRoot.style.height).toBe('40%');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('FRAME_CSS forced colours (S09-02, §5.7)', () => {
  it('keeps the banner 2 px mark when forced colours drop the inset shadow', () => {
    const rule = FRAME_CSS.slice(FRAME_CSS.indexOf('@media (forced-colors:active)'));
    expect(rule.startsWith('@media (forced-colors:active)'))
      .withContext('the banner mark is a shadow, which forced colours discard')
      .toBeTrue();
    expect(rule).toContain('.dcp-banner{');
    expect(rule).toContain('box-shadow:none');
    expect(rule).toContain('border-inline-start:2px solid CanvasText');
  });
});
