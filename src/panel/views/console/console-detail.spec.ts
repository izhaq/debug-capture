import { ErrorEntry, LogEntry } from '../../ui';
import { MAX_ARG_TREES, MESSAGE_PREVIEW_CHARS } from './console-detail';
import { cleanup, error, log, SETTINGS, stage, Stage, StageOptions } from './fakes.spec';

/** S-07 Console view - the detail (S07-03, S07-07, S07-08; FR-CON-02, FR-CON-03, D-04, 4.4, 4.6, 4.12, NFR-PERF-04). */
describe('S-07 Console view: detail', () => {
  afterEach(cleanup);

  const detail = (s: Stage): HTMLElement => s.q('.dcp-console-detail');
  const body = (s: Stage): HTMLElement => s.q('.dcp-console-detail .dcp-detail-body');
  const message = (s: Stage): string => s.q('.dcp-console-detail .dcp-console-pre').textContent ?? '';
  const trees = (s: Stage): HTMLElement[] => s.all('.dcp-console-detail [role="tree"]');
  const button = (s: Stage, label: string): HTMLButtonElement | null =>
    s.all<HTMLButtonElement>('.dcp-console-detail button').find((b) => b.textContent === label) ?? null;
  /** One entry, selected. */
  const open = (entry: LogEntry | ErrorEntry, options: StageOptions = {}): Stage => {
    const s = stage({ ...options, entries: [entry, ...(options.entries ?? [])] });
    s.click(s.rowEl(0));
    return s;
  };
  const badArgs = (): LogEntry =>
    Object.defineProperty({ ...log(2) }, 'args', {
      get: (): never => {
        throw new Error('bad args');
      },
    }) as LogEntry;

  it('S07-07, FR-CON-02: a selected row opens the one-page detail beside the list; arrows move it; close and Escape close it', () => {
    const s = stage({ entries: [log(1, 'log', ['first']), log(2, 'warn', ['second'])] });
    expect(detail(s).hidden).toBeTrue();
    expect(s.view.handleEscape()).toBeFalse();

    s.click(s.rowEl(0));
    expect(detail(s).hidden).toBeFalse();
    expect(detail(s).getAttribute('aria-label')).toBe('Message detail');
    expect(s.q('.dcp-split').getAttribute('data-direction')).toBe('row');
    expect(s.all('.dcp-console-detail [role="tab"]')).withContext('one page, no sub-tabs').toEqual([]);
    expect(message(s)).toBe('first');

    s.key(s.q('.dcp-vlist'), 'ArrowDown');
    expect(message(s)).toBe('second');
    s.key(s.q('.dcp-vlist'), 'ArrowUp');
    expect(message(s)).toBe('first');

    s.click(s.q('.dcp-console-detail button[aria-label="Close detail"]'));
    expect(s.store.getState().selection.console).toBeNull();
    expect(detail(s).hidden).toBeTrue();
    expect(s.q('.dcp-split__handle').hidden).toBeTrue();
    expect(s.root.activeElement).toBe(s.q('.dcp-vlist'));

    s.click(s.rowEl(1));
    expect(s.view.handleEscape()).toBeTrue();
    expect(detail(s).hidden).toBeTrue();
    expect(s.view.handleEscape()).toBeFalse();
  });

  it('S07-07, 4.6, 4.12: docked right the detail goes below the list; Enter on a row moves focus into the detail', () => {
    const s = stage({ entries: [log(1)], settings: { ...SETTINGS, dock: 'right' } });
    expect(s.q('.dcp-split').getAttribute('data-direction')).toBe('column');
    s.click(s.rowEl(0));
    s.key(s.q('.dcp-vlist'), 'Enter');
    expect(detail(s).hidden).toBeFalse();
    expect(s.root.activeElement).toBe(body(s));

    s.view.applySettings({ ...SETTINGS, dock: 'bottom' });
    expect(s.q('.dcp-split').getAttribute('data-direction')).toBe('row');
  });

  it('S07-03, D-04: the full message, then each argument as its own JSON tree; small values open fully', () => {
    const long = 'y'.repeat(300);
    const s = open(log(1, 'info', ['user\nsaved', { id: 7, roles: ['admin', 'dev'] }, 42, long]));
    expect(message(s)).toBe(`user\nsaved {"id":7,"roles":["admin","dev"]} 42 ${long}`);
    expect(s.all('.dcp-console-detail h3').map((h) => h.textContent)).toEqual(['Message', 'Arguments (4)']);
    expect(trees(s).map((t) => t.getAttribute('aria-label'))).toEqual([
      'Argument 1',
      'Argument 2',
      'Argument 3',
      'Argument 4',
    ]);
    const object = trees(s)[1] as HTMLElement;
    expect(object.querySelectorAll('[role="treeitem"][aria-expanded="false"]').length)
      .withContext('nothing left closed')
      .toBe(0);
    expect(object.textContent).toContain('admin');
  });

  it('S07-03, FR-CON-03: the header shows the level, the time and the error source; the time follows the setting', () => {
    const t = Date.UTC(2026, 9, 15, 14, 2, 15, 601);
    const s = open({ ...error(1, { source: 'angular' }), t });
    const info = (): (string | null)[] => Array.from(s.q('.dcp-console-info').children, (c) => c.textContent);
    expect(info()).toEqual(['error', '14:02:15.601', 'angular']);
    expect(s.q('.dcp-console-info svg').getAttribute('data-icon')).toBe('error');

    s.view.applySettings({ ...SETTINGS, time: { mode: 'relative', origin: t } });
    expect(info()).toEqual(['error', '+0.000 s', 'angular']);
  });

  it('S07-03, FR-CON-03: an error stack starts collapsed and expands on click; the next row starts collapsed again', () => {
    const stack = 'TypeError: x\n    at f (app.js:1:2)\n    at g (app.js:3:4)';
    const s = stage({ entries: [error(1, { stack }), error(2, { stack: 'Error: y\n    at h (b.js:1:1)' }), error(3)] });
    s.click(s.rowEl(0));
    const toggle = button(s, 'Stack');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-controls')).toBe('dcp-console-stack');
    expect(s.q('#dcp-console-stack').hidden).toBeTrue();

    s.click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(s.q('#dcp-console-stack').hidden).toBeFalse();
    expect(s.q('#dcp-console-stack').textContent).toBe(stack);
    s.click(toggle);
    expect(s.q('#dcp-console-stack').hidden).toBeTrue();
    s.click(toggle);

    s.key(s.q('.dcp-vlist'), 'ArrowDown');
    expect(s.q('#dcp-console-stack').hidden).toBeTrue();
    expect(s.q('#dcp-console-stack').textContent).toBe('Error: y\n    at h (b.js:1:1)');

    s.key(s.q('.dcp-vlist'), 'ArrowDown');
    expect(button(s, 'Stack')).withContext('no stack, no button').toBeNull();
    expect(trees(s)).withContext('an error has no arguments').toEqual([]);
  });

  it('S07-03, FR-CON-03: a React error shows its component stack (the v1 stack section)', () => {
    const stack =
      'Error: render failed\n    at Item (app.js:9:1)\n\nReact component stack (error boundary):\n    at Item\n    at List';
    const s = open(error(1, { source: 'react', message: 'Error: render failed', stack }));
    s.click(button(s, 'Stack'));
    expect(s.q('#dcp-console-stack').textContent).toContain(
      'React component stack (error boundary):\n    at Item\n    at List',
    );
  });

  it('S07-07, 4.4: a selected entry that leaves the buffer keeps its detail with the note', () => {
    const s = open(log(1, 'log', ['kept']));
    expect(s.q('.dcp-console-removed').hidden).toBeTrue();
    s.apply({ type: 'cleared' });
    expect(detail(s).hidden).toBeFalse();
    expect(s.q('.dcp-console-removed').hidden).toBeFalse();
    expect(s.q('.dcp-console-removed').textContent).toBe('This entry was removed from the buffer.');
    expect(message(s)).toBe('kept');
    expect(s.reported).toEqual([]);
  });

  it('FR-COM-01, C-3: a redacted value inside an argument shows the redacted badge', () => {
    const s = open(log(1, 'log', [{ token: '[redacted]' }]));
    expect(s.q('.dcp-console-detail [role="tree"] .dcp-badge--redacted')).not.toBeNull();
  });

  it('S07-08, NFR-SEC-01, ISO-04: hostile messages, keys and stacks stay text in the detail', () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const s = stage({ entries: [log(1, 'log', [evil, { [evil]: evil }]), error(2, { message: evil, stack: evil })] });
    s.click(s.rowEl(0));
    expect(message(s)).toBe(`${evil} ${JSON.stringify({ [evil]: evil })}`);
    s.click(s.rowEl(1));
    s.click(button(s, 'Stack'));
    expect(s.q('#dcp-console-stack').textContent).toBe(evil);
    expect(s.all('img, script, iframe, a')).toEqual([]);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('S07-08, FR-COM-02: a long message renders its first part with "Show all (N chars)"', () => {
    const text = 'z'.repeat(MESSAGE_PREVIEW_CHARS + 50);
    const s = open(error(1, { message: text }));
    expect(message(s).length).toBe(MESSAGE_PREVIEW_CHARS);
    s.click(button(s, `Show all (${text.length} chars)`));
    expect(message(s)).toBe(text);
  });

  it('S07-08, NFR-PERF-04, D-22: 5,000 rows and a detail with 100 large arguments stay under 2,000 elements', () => {
    const big = { items: Array.from({ length: 1_000 }, (_, i) => ({ id: i, name: `n${i}` })) };
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    const args = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? big : wide));
    const entries = Array.from({ length: 5_000 }, (_, i) => log(i + 1, 'log', i === 4_999 ? args : ['x']));
    const s = stage({ entries, height: 600 });
    s.click(s.rowEls()[s.rowEls().length - 1] ?? null);
    expect(trees(s).length).toBe(MAX_ARG_TREES);
    expect(s.all('.dcp-console-detail h3').map((h) => h.textContent)).toEqual(['Message', 'Arguments (100)']);
    expect(s.root.querySelectorAll('*').length).toBeLessThan(2_000);
  });

  it('S07-08, NFR-REL-01, ISO-12: a detail that cannot render goes to report; the list keeps working', () => {
    const s = stage({ entries: [log(1), badArgs()] });
    const before = s.reported.length;
    s.click(s.rowEl(1));
    expect(s.reported.length).toBeGreaterThan(before);
    expect(detail(s).hidden).toBeFalse();
    s.key(s.q('.dcp-vlist'), 'ArrowUp');
    expect(message(s)).toBe('message 1');
  });

  it('S07-08, ISO-12: using the view writes nothing to the console, so the panel never feeds the recorder', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => spyOn(console, method));
    const s = stage({ entries: [log(1), error(2, { stack: 'Error: e\n    at f (a.js:1:1)' }), badArgs()] });
    s.click(s.rowEl(1));
    s.click(button(s, 'Stack'));
    s.click(s.rowEl(2));
    s.view.focusFilter();
    s.view.handleEscape();
    s.view.applySettings({ ...SETTINGS, dock: 'right' });
    s.view.destroy();
    expect(s.reported.length).toBeGreaterThan(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
