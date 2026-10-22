import { CaptureEntry, LogEntry } from '../../ui';
import { cleanup, error, http, log, stage } from './fakes.spec';

/** S-07 Console view - the list (S07-01, S07-02, S07-08, S07-09; FR-CON-01...03, FR-BAR-02, 4.8, 5.6). */
describe('S-07 Console view: the list', () => {
  afterEach(cleanup);

  const tone = (cell: HTMLElement): string =>
    /dcp-tone-(\w+)/.exec(cell.querySelector('[class*="dcp-tone-"]')?.className ?? '')?.[1] ?? 'none';

  it('S07-01: no header row; level, time, source, message and the more mark at fixed widths; follow button beside the grid', () => {
    const s = stage({ entries: [log(1)] });
    expect(s.all('[role="columnheader"]')).toEqual([]);
    expect(s.q('.dcp-vlist').style.getPropertyValue('--dcp-vlist-cols')).toBe('72px 104px 144px minmax(0, 1fr) 24px');
    expect(s.q('.dcp-vlist').getAttribute('aria-label')).toBe('Console messages');
    expect(s.rowEl(0).getAttribute('aria-rowindex')).toBe('1');
    // NFR-I18N-01: every data cell is bidi-isolated.
    expect(s.rowEl(0).querySelectorAll('[dir="auto"]').length).toBe(5);
    // C3-5: the button lives outside the grid, in the list pane that places it.
    expect(s.q('.dcp-vlist__follow').parentElement?.classList).toContain('dcp-list-pane');
  });

  it('S07-01, FR-CON-01: console calls and errors in seq order; other entries are not rows', () => {
    const s = stage({
      entries: [log(1, 'info', ['ready']), http(2), error(3, { message: 'boom' }), log(4, 'warn', ['careful'])],
    });
    expect(s.rows().map((r) => r[3])).toEqual(['ready', 'boom', 'careful']);
    s.apply({ type: 'entry', entry: log(5, 'debug', ['later']) }, { type: 'entry', entry: http(6) });
    expect(s.rows().map((r) => r[3])).toEqual(['ready', 'boom', 'careful', 'later']);
    expect(s.reported).toEqual([]);
  });

  it('S07-01, 5.6, NFR-A11Y-01: each level has its icon, word and colour; errors and warnings tint the row', () => {
    const s = stage({
      entries: [log(1, 'error'), log(2, 'warn'), log(3, 'info'), log(4, 'log'), log(5, 'debug'), error(6)],
    });
    const cells = s.cells(0);
    expect(cells.map((c) => c.textContent)).toEqual(['error', 'warn', 'info', 'log', 'debug', 'error']);
    expect(cells.map((c) => c.querySelector('svg')?.getAttribute('data-icon'))).toEqual([
      'error',
      'warning',
      'info',
      'log',
      'debug',
      'error',
    ]);
    expect(cells.map(tone)).toEqual(['error', 'warning', 'info', 'text', 'muted', 'error']);
    const tint = (row: HTMLElement): string =>
      row.classList.contains('dcp-row--error') ? 'error' : row.classList.contains('dcp-row--warn') ? 'warn' : 'none';
    expect(s.rowEls().map(tint)).toEqual(['error', 'warn', 'none', 'none', 'none', 'error']);
  });

  it('S07-02, FR-CON-03: an error shows its source as v1 stores it; a console call shows none', () => {
    const sources = ['window', 'unhandledrejection', 'angular', 'react', 'capture'] as const;
    const s = stage({ entries: [...sources.map((source, i) => error(i + 1, { source })), log(6)], height: 400 });
    expect(s.cells(2).map((c) => c.textContent)).toEqual([...sources, '']);
    expect(s.cells(0).map((c) => c.textContent)).toEqual(['error', 'error', 'error', 'error', 'error', 'log']);
  });

  it('S07-01, FR-CON-02: one fixed-height line per row: breaks become spaces, objects compact JSON, long text cut', () => {
    const s = stage({
      entries: [
        log(1, 'log', ['a\n  b', { id: 7, rows: [1, 2] }, 3, null]),
        log(2, 'log', ['x'.repeat(300)]),
        error(3, { message: 'Error: one\ntwo' }),
      ],
    });
    expect(s.cells(3).map((c) => c.textContent)).toEqual([
      'a b {"id":7,"rows":[1,2]} 3 null',
      `${'x'.repeat(200)}\u2026`,
      'Error: one two',
    ]);
    expect(s.rowEls().map((r) => r.offsetHeight)).toEqual([22, 22, 22]);
  });

  it('S07-01, 4.8: the more mark means the detail shows more: an object argument, a cut or multi-line message, a stack', () => {
    const s = stage({
      entries: [
        log(1, 'log', ['short']),
        log(2, 'log', ['user', { id: 1 }]),
        log(3, 'log', ['x'.repeat(201)]),
        log(4, 'log', ['two\nlines']),
        error(5, { stack: null }),
        error(6, { stack: 'Error: e\n    at f (app.js:1:1)' }),
        log(7, 'log', [[1, 2]]),
      ],
    });
    const marks = s.cells(4).map((c) => c.querySelector('[data-icon="chevron-right"]'));
    expect(marks.map((m) => m !== null)).toEqual([false, true, true, true, false, true, true]);
    expect(marks[1]?.getAttribute('aria-label')).toBe('More in the detail');
  });

  it('S07-01, 4.10: time as clock or relative; settings re-render the rows at the new height', () => {
    const t = Date.UTC(2026, 9, 15, 14, 2, 15, 601);
    const entries: CaptureEntry[] = [
      { ...log(1), t },
      { ...error(2), t: t + 5 },
    ];
    const s = stage({ entries });
    expect(s.cells(1).map((c) => c.textContent)).toEqual(['14:02:15.601', '14:02:15.606']);

    s.view.applySettings({ time: { mode: 'relative', origin: t }, rowHeight: 26, dock: 'bottom' });

    expect(s.cells(1).map((c) => c.textContent)).toEqual(['+0.000 s', '+0.005 s']);
    expect(s.rowEl(1).style.top).toBe('26px');
  });

  it('S07-01: a click selects the row in the store; arrow keys move the selection', () => {
    const entries = [log(1), error(2), log(3)];
    const s = stage({ entries });
    s.click(s.rowEl(1));
    expect(s.store.getState().selection.console?.row).toBe(entries[1]);
    expect(s.rowEl(1).getAttribute('aria-selected')).toBe('true');
    s.key(s.q('.dcp-vlist'), 'ArrowDown');
    expect(s.store.getState().selection.console?.row).toBe(entries[2]);
    expect(s.rowEl(2).getAttribute('aria-selected')).toBe('true');
  });

  it('S07-09, FR-BAR-02: scrolled up, new console rows show on the follow button; back at the end the count resets', () => {
    const s = stage({ entries: Array.from({ length: 40 }, (_, i) => log(i + 1)) });
    const grid = s.q('.dcp-vlist');
    const follow = s.q<HTMLButtonElement>('.dcp-vlist__follow');
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll'));

    // Two console rows and one entry of another list.
    s.apply({ type: 'entry', entry: log(41) }, { type: 'entry', entry: error(42) }, { type: 'entry', entry: http(43) });
    expect(follow.hidden).toBeFalse();
    expect(follow.textContent).toBe('\u2193 2 new');

    grid.scrollTop = grid.scrollHeight;
    grid.dispatchEvent(new Event('scroll'));
    expect(follow.hidden).toBeTrue();
    s.apply({ type: 'entry', entry: log(44) });
    expect(follow.hidden).toBeTrue();

    // Scrolled up again, the count starts from there, not from the first time.
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll'));
    s.apply({ type: 'entry', entry: log(45) });
    expect(follow.textContent).toBe('\u2193 1 new');
    expect(s.reported).toEqual([]);
  });

  it('S07-08, NFR-REL-01, ISO-12: a cell that throws goes to report; the other cells and rows still render', () => {
    const bad = Object.defineProperty({ ...log(2) }, 'args', {
      get: (): never => {
        throw new Error('bad args');
      },
    }) as LogEntry;
    const s = stage({ entries: [log(1), bad, log(3)] });
    expect(s.reported.length).toBeGreaterThan(0);
    expect(s.rows().map((r) => r[0])).toEqual(['log', 'log', 'log']);
    expect(s.rows().map((r) => r[3])).toEqual(['message 1', '', 'message 3']);
  });

  it('S07-08, NFR-SEC-01, ISO-04: hostile messages and keys stay text', () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const s = stage({ entries: [log(1, 'log', [evil, { [evil]: evil }]), error(2, { message: evil })] });
    expect(s.all('img, script, iframe, a')).toEqual([]);
    expect(s.cells(3)[1]?.textContent).toBe(evil);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('destroy() removes the element; later updates and a second destroy are safe', () => {
    const s = stage({ entries: [log(1)] });
    s.view.destroy();
    expect(s.view.element.isConnected).toBeFalse();
    expect(() => {
      s.apply({ type: 'entry', entry: log(2) });
      s.view.destroy();
    }).not.toThrow();
    expect(s.reported).toEqual([]);
  });
});
