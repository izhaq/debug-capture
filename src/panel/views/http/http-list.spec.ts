import { cleanup, http, log, pending, stage } from './fakes.spec';

/** S-05 HTTP view — the request list (S05-01…04, S05-13, S05-15; FR-HTTP-01, FR-HTTP-02, FR-BAR-02, D-18). */
describe('S-05 HTTP view: the list', () => {
  afterEach(cleanup);

  it('S05-01: seven columns at the §5.6 widths, each header a sort button, the follow button beside the grid', () => {
    const s = stage();
    const heads = s.all('[role="columnheader"]');
    expect(heads.map((h) => h.textContent)).toEqual(['Time', 'Method', 'Status', 'Name', 'Type', 'Size', 'Duration']);
    expect(heads.every((h) => h.querySelector('button') !== null)).toBeTrue();
    expect(s.q('.dcp-vlist').style.getPropertyValue('--dcp-vlist-cols')).toBe(
      '104px 64px 88px minmax(0, 1fr) 52px 64px 72px',
    );
    expect(s.q('.dcp-vlist').getAttribute('aria-label')).toBe('Requests');
    // C3-5: the button lives outside the grid, in the list pane that places it.
    expect(s.q('.dcp-vlist__follow').parentElement?.classList).toContain('dcp-list-pane');
  });

  it('S05-01, FR-HTTP-02, D-18: start order; a pending row keeps its place and turns into the finished row', () => {
    const s = stage({
      entries: [http(1, { t: 1_000, url: 'https://h/a' }), http(2, { t: 1_030, url: 'https://h/c' })],
      pending: [pending(7, { t: 1_010, url: 'https://h/b' })],
    });
    expect(s.rows().map((r) => r[3])).toEqual(['a', 'b', 'c']);
    expect(s.rows()[1]?.[2]).toBe('Pending');

    s.click(s.rowEl(1));
    s.apply(
      { type: 'entry', entry: http(3, { t: 1_010, url: 'https://h/b', status: 201, requestId: 7 }) },
      { type: 'pending-end', id: 7 },
    );

    expect(s.rows().map((r) => r[3])).toEqual(['a', 'b', 'c']);
    expect(s.rows()[1]?.[2]).toBe('201');
    // The selection followed the request to its entry, on the same row.
    expect(s.rowEl(1).getAttribute('aria-selected')).toBe('true');
    expect(s.reported).toEqual([]);
  });

  it('S05-02, D-18: a header click sorts ascending, then descending, then back to start order, shown by aria-sort', () => {
    const s = stage({
      entries: [
        http(1, { status: 500, url: 'https://h/a' }),
        http(2, { status: 200, url: 'https://h/b' }),
        http(3, { status: 404, url: 'https://h/c' }),
      ],
    });
    s.click(s.rowEl(2));
    const head = s.header('Status');
    const button = head.querySelector('button');
    const selectedName = (): string | undefined =>
      s.rowEls().find((r) => r.getAttribute('aria-selected') === 'true')?.children[3]?.textContent ?? undefined;

    s.click(button);
    expect(head.getAttribute('aria-sort')).toBe('ascending');
    expect(s.rows().map((r) => r[2])).toEqual(['200', '404', '500']);
    expect(selectedName()).toBe('c');

    s.click(button);
    expect(head.getAttribute('aria-sort')).toBe('descending');
    expect(s.rows().map((r) => r[2])).toEqual(['500', '404', '200']);
    expect(selectedName()).toBe('c');

    s.click(button);
    expect(head.hasAttribute('aria-sort')).toBeFalse();
    expect(s.store.getState().httpSort).toBeNull();
    expect(s.rows().map((r) => r[3])).toEqual(['a', 'b', 'c']);
    expect(selectedName()).toBe('c');
  });

  it('S05-03, NFR-A11Y-01: the status cell shows the code or word, an icon and a colour — never colour alone', () => {
    const s = stage({
      entries: [
        http(1, { status: 200 }),
        http(2, { status: 304 }),
        http(3, { status: 404 }),
        http(4, { status: 500 }),
        http(5, { status: null, error: 'network' }),
        http(6, { status: null, error: 'abort' }),
        http(7, { status: 0, error: 'timeout' }),
      ],
      pending: [pending(9)],
    });
    const cells = s.cells(2);
    expect(cells.map((c) => c.textContent)).toEqual([
      '200',
      '304',
      '404',
      '500',
      'Failed',
      'Aborted',
      'Timeout',
      'Pending',
    ]);
    const tone = (cell: HTMLElement): string =>
      /dcp-tone-(\w+)/.exec(cell.querySelector('[class*="dcp-tone-"]')?.className ?? '')?.[1] ?? 'none';
    expect(cells.map(tone)).toEqual(['success', 'info', 'warning', 'error', 'error', 'error', 'error', 'none']);
    expect(cells.every((c) => c.querySelector('svg') !== null)).toBeTrue();
    expect(cells[7]?.querySelector('.dcp-badge--pending')).not.toBeNull();
  });

  it('S05-04, ISO-18: Name is the last path segment + query, the full URL is its title, cells are dir="auto"', () => {
    const url = 'https://app.test/api/v1/users/42?expand=roles#top';
    const s = stage({ entries: [http(1, { url })] });
    const name = s.cells(3)[0] as HTMLElement;
    expect(name.textContent).toBe('42?expand=roles');
    expect(name.title).toBe(url);
    expect(s.rowEl(0).querySelectorAll('[dir="auto"]').length).toBe(7);
  });

  it('S05-01, §4.10: Time, Type, Size and Duration cells; a pending row has no size or duration yet; settings re-render', () => {
    const t = Date.UTC(2026, 9, 15, 14, 3, 27, 412);
    const s = stage({
      entries: [http(1, { t, transport: 'xhr', bytes: 3_200, durationMs: 2_040 })],
      pending: [pending(2, { t: t + 5 })],
    });
    expect(s.rows()).toEqual([
      ['14:03:27.412', 'GET', '200', '1?page=1', 'xhr', '3.2 kB', '2.04 s'],
      ['14:03:27.417', 'POST', 'Pending', '2', 'xhr', '', ''],
    ]);

    s.view.applySettings({ time: { mode: 'relative', origin: t }, rowHeight: 26, dock: 'bottom' });

    expect(s.rows().map((r) => r[0])).toEqual(['+0.000 s', '+0.005 s']);
    expect(s.rowEl(1).style.top).toBe('26px');
  });

  it('S05-15, FR-BAR-02: scrolled up, new rows of this list show on "↓ N new"; back at the end the count resets', () => {
    const s = stage({
      entries: Array.from({ length: 40 }, (_, i) => http(i + 1)),
      pending: [pending(100, { t: 1_405 })],
    });
    const grid = s.q('.dcp-vlist');
    const follow = s.q<HTMLButtonElement>('.dcp-vlist__follow');
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll'));

    s.apply(
      { type: 'entry', entry: http(41, { t: 1_500 }) },
      // The request that was already pending finishes: not new.
      { type: 'entry', entry: http(42, { t: 1_405, requestId: 100 }) },
      { type: 'pending-end', id: 100 },
      { type: 'pending-start', request: pending(101, { t: 1_520 }) },
      // Not a row of this list.
      { type: 'entry', entry: log(43) },
    );
    expect(follow.hidden).toBeFalse();
    expect(follow.textContent).toBe('↓ 2 new');

    grid.scrollTop = grid.scrollHeight;
    grid.dispatchEvent(new Event('scroll'));
    expect(follow.hidden).toBeTrue();
    s.apply({ type: 'entry', entry: http(44, { t: 1_600 }) });
    expect(follow.hidden).toBeTrue();

    // Scrolled up again, the count starts from there, not from the first time.
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll'));
    s.apply({ type: 'entry', entry: http(45, { t: 1_700 }) });
    expect(follow.textContent).toBe('↓ 1 new');

    // A click on the button goes to the end and starts the count again too.
    s.click(follow);
    expect(follow.hidden).toBeTrue();
    expect(grid.scrollTop + grid.clientHeight).toBeGreaterThanOrEqual(grid.scrollHeight - 1);
    // The browser fires `scroll` a frame later; fire it now.
    grid.dispatchEvent(new Event('scroll'));
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll'));
    s.apply({ type: 'entry', entry: http(46, { t: 1_800 }) });
    expect(follow.textContent).toBe('↓ 1 new');
    expect(s.reported).toEqual([]);
  });

  it('S05-13, NFR-REL-01, ISO-12: a cell that throws goes to report; the other cells and rows still render', () => {
    const bad = Object.defineProperty({ ...http(2) }, 'url', {
      get: (): string => {
        throw new Error('bad url');
      },
    });
    const s = stage({ entries: [http(1), bad, http(3)] });
    expect(s.reported.length).toBeGreaterThan(0);
    expect(s.rows().map((r) => r[2])).toEqual(['200', '200', '200']);
    expect(s.rows().map((r) => r[3])).toEqual(['1?page=1', '', '3?page=1']);
  });

  it('destroy() removes the element; later updates and a second destroy are safe', () => {
    const s = stage({ entries: [http(1)] });
    s.view.destroy();
    expect(s.view.element.isConnected).toBeFalse();
    expect(() => {
      s.apply({ type: 'entry', entry: http(2) });
      s.view.destroy();
    }).not.toThrow();
    expect(s.reported).toEqual([]);
  });
});
