import { cleanup, closed, failed, log, opened, stage, ws } from './fakes.spec';

/** S-06 WebSocket view — connections and messages (S06-01…03, S06-05, S06-09, S06-10; FR-WS-01, 02, 05, FR-BAR-02). */
describe('S-06 WebSocket view: the lists', () => {
  afterEach(cleanup);

  it('S06-01, FR-WS-01: connections newest first; state by icon and word (error > closed > open), ↑ ↓ counts, opened time', () => {
    const s = stage({
      entries: [
        opened(1, 1),
        ws(2, { socketId: 1, event: 'send' }),
        ws(3, { socketId: 1 }),
        // Browsers fire `error` then `close`: still error.
        failed(4, 1),
        closed(5, 1, 1006, null),
        opened(6, 2),
        closed(7, 2),
        opened(8, 3),
        ws(9, { socketId: 3 }),
      ],
    });
    expect(s.conns()).toEqual([
      ['open #3 wss://app.test/live/3', ' 0  1 · 00:00:01.080'],
      ['closed #2 wss://app.test/live/2', ' 0  0 · 00:00:01.060'],
      ['error #1 wss://app.test/live/1', ' 1  1 · 00:00:01.010'],
      ['All connections'],
    ]);
    const state = (i: number): string[] => {
      const word = s.connEl(i).querySelector('.dcp-ws-dir');
      return [
        word?.querySelector('svg')?.getAttribute('data-icon') ?? '',
        /dcp-tone-(\w+)/.exec(word?.className ?? '')?.[1] ?? '',
      ];
    };
    expect([0, 1, 2].map(state)).toEqual([
      ['opened', 'success'],
      ['off', 'muted'],
      ['error', 'error'],
    ]);
    // The counts' arrows are named, so the numbers are not bare.
    const arrows = s.connEl(0).querySelectorAll('svg[role="img"]');
    expect(Array.from(arrows, (a) => a.getAttribute('aria-label'))).toEqual(['sent', 'received']);
    expect(s.connEl(0).children[0]?.getAttribute('title')).toBe('wss://app.test/live/3');
    expect(s.q('.dcp-ws-conns .dcp-vlist').getAttribute('aria-label')).toBe('Connections');
  });

  it('S06-01, FR-WS-01: opened time is `—` once the open entry has left the buffer', () => {
    const s = stage({ entries: [ws(5, { socketId: 4, event: 'send' })] });
    expect(s.conns()[0]).toEqual(['open #4 wss://app.test/live/4', ' 1  0 · —']);
  });

  it('S06-02, FR-WS-05: "All connections" is chosen first, with a Socket column; a click shows one socket', () => {
    const s = stage({
      entries: [opened(1, 1), opened(2, 2), ws(3, { socketId: 1, data: 'a' }), ws(4, { socketId: 2, data: 'b' })],
    });
    expect(s.connEl(2).getAttribute('aria-selected')).toBe('true');
    expect(s.all('.dcp-list-pane [role="columnheader"]').map((h) => h.textContent)).toEqual([
      'Dir',
      'Time',
      'Socket',
      'Size',
      'Data',
    ]);
    expect(s.cells(2).map((c) => c.textContent)).toEqual(['#1', '#2', '#1', '#2']);

    s.click(s.connEl(1));
    expect(s.store.getState().wsConnection).toBe(1);
    expect(s.connEl(1).getAttribute('aria-selected')).toBe('true');
    expect(s.connEl(2).getAttribute('aria-selected')).toBe('false');
    // One socket: same columns, its rows only.
    expect(s.all('.dcp-list-pane [role="columnheader"]').length).toBe(5);
    expect(s.rows().map((r) => `${r[2]} ${r[4]}`)).toEqual(['#1 ', '#1 a']);

    s.click(s.connEl(2));
    expect(s.store.getState().wsConnection).toBe('all');
    expect(s.rows().length).toBe(4);
    expect(s.reported).toEqual([]);
  });

  it('S06-02: the chosen connection stays chosen after Clear; its new messages show again', () => {
    const s = stage({ entries: [opened(1, 1), opened(2, 2), ws(3, { socketId: 2 })] });
    s.click(s.connEl(1));
    s.apply({ type: 'cleared' });

    expect(s.store.getState().wsConnection).toBe(1);
    expect(s.q('.dcp-ws-conns').hidden).toBeTrue();
    expect(getComputedStyle(s.q('.dcp-ws-conns')).display).toBe('none');

    s.apply(
      { type: 'entry', entry: ws(10, { socketId: 2, data: 'other' }) },
      { type: 'entry', entry: ws(11, { socketId: 1, data: 'mine' }) },
    );
    expect(s.q('.dcp-ws-conns').hidden).toBeFalse();
    expect(s.conns().map((c) => c[0])).toEqual([
      'open #2 wss://app.test/live/2',
      'open #1 wss://app.test/live/1',
      'All connections',
    ]);
    expect(s.connEl(1).getAttribute('aria-selected')).toBe('true');
    expect(s.rows().map((r) => r[4])).toEqual(['mine']);
  });

  it('S06-03, FR-WS-02, §5.6: direction and lifecycle rows show an icon and a word, then time, size and a one-line preview', () => {
    const s = stage({
      entries: [
        opened(1),
        ws(2, { event: 'send', data: '{"a":\n  1}', bytes: 9 }),
        ws(3, { bytes: 3_200 }),
        ws(4, { opcode: 'binary', data: 'AAEC', bytes: 3 }),
        // A Blob v1 could not read: the frame happened, its bytes are unknown.
        ws(5, { opcode: 'binary', data: null, bytes: 512 }),
        failed(6),
        closed(7, 1, 1000, 'bye'),
      ],
    });
    expect(s.rows()).toEqual([
      ['opened', '00:00:01.010', '#1', '', ''],
      ['sent', '00:00:01.020', '#1', '9 B', '{"a": 1}'],
      ['received', '00:00:01.030', '#1', '3.2 kB', 'hello'],
      ['received', '00:00:01.040', '#1', '3 B', '[Binary 3 bytes]'],
      ['received', '00:00:01.050', '#1', '512 B', '[Blob 512 bytes]'],
      ['error', '00:00:01.060', '#1', '', ''],
      ['closed', '00:00:01.070', '#1', '', '1000 "bye"'],
    ]);
    const dir = s.cells(0).map((c) => {
      const word = c.querySelector('.dcp-ws-dir');
      return `${word?.querySelector('svg')?.getAttribute('data-icon') ?? ''}/${/dcp-tone-(\w+)/.exec(word?.className ?? '')?.[1] ?? ''}`;
    });
    expect(dir).toEqual([
      'opened/muted',
      'sent/success',
      'received/info',
      'received/info',
      'received/info',
      'error/error',
      'closed/muted',
    ]);
    expect(s.q('.dcp-list-pane .dcp-vlist').getAttribute('aria-label')).toBe('Messages');
  });

  it('S06-03: a click on a message selects it in the store', () => {
    const entries = [ws(1), ws(2)];
    const s = stage({ entries });
    s.click(s.rowEl(1));
    expect(s.store.getState().selection.ws?.row).toBe(entries[1]);
    expect(s.rowEl(1).getAttribute('aria-selected')).toBe('true');
  });

  it('S06-05, FR-COM-04: no socket yet says so; a filter that matches nothing offers Clear filters', () => {
    const none = stage();
    const empty = none.all('.dcp-empty').filter((e) => !e.hidden);
    expect(empty.map((e) => e.textContent)).toEqual(['No WebSocket connections yet.']);
    expect(none.q('.dcp-list-pane .dcp-vlist').hidden).toBeTrue();
    expect(none.q('.dcp-ws-conns').hidden).toBeTrue();

    const s = stage({ entries: [ws(1, { data: 'abc' })], filters: { text: 'zzz' } });
    const shown = s.all('.dcp-empty').filter((e) => !e.hidden);
    expect(shown.length).toBe(1);
    expect(shown[0]?.querySelector('.dcp-empty__message')?.textContent).toBe('No entries match the filter.');
    s.click(shown[0]?.querySelector('button') ?? null);
    expect(s.store.getState().filters.ws.text).toBe('');
    expect(s.rows().map((r) => r[4])).toEqual(['abc']);
    expect(s.all('.dcp-empty').every((e) => e.hidden)).toBeTrue();
  });

  it('S06-10, FR-BAR-02: scrolled up, new messages of this list show on "↓ N new"; back at the end the count resets', () => {
    const s = stage({ entries: Array.from({ length: 40 }, (_, i) => ws(i + 1)) });
    const grid = s.q('.dcp-list-pane .dcp-vlist');
    const follow = s.q<HTMLButtonElement>('.dcp-vlist__follow');
    expect(follow.parentElement?.classList).toContain('dcp-list-pane');
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll'));

    s.apply(
      { type: 'entry', entry: ws(41) },
      { type: 'entry', entry: ws(42, { socketId: 2 }) },
      // Not a row of this list.
      { type: 'entry', entry: log(43) },
    );
    expect(follow.hidden).toBeFalse();
    expect(follow.textContent).toBe('↓ 2 new');

    grid.scrollTop = grid.scrollHeight;
    grid.dispatchEvent(new Event('scroll'));
    expect(follow.hidden).toBeTrue();
    s.apply({ type: 'entry', entry: ws(44) });
    expect(follow.hidden).toBeTrue();

    // Scrolled up again, the count starts from there, not from the first time.
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll'));
    s.apply({ type: 'entry', entry: ws(45) });
    expect(follow.textContent).toBe('↓ 1 new');
    expect(s.reported).toEqual([]);
  });

  it('S06-09, NFR-SEC-01, ISO-18: hostile frame data stays text; every cell is dir="auto"', () => {
    const data = '<img src=x onerror="alert(1)">\u202Eevil';
    const s = stage({ entries: [ws(1, { data, url: 'wss://h/<b>x</b>' })] });
    expect(s.rows()[0]?.[4]).toBe(data);
    expect(s.conns()[0]?.[0]).toBe('open #1 wss://h/<b>x</b>');
    expect(s.root.querySelector('img, b')).toBeNull();
    expect(s.rowEl(0).querySelectorAll('[dir="auto"]').length).toBe(5);
  });

  it('S06-09, NFR-PERF-04: 5,000 messages on 500 sockets keep the view under 2,000 nodes', () => {
    // Both lists are virtual: 500 connections drawn as plain rows would be ~5,000 nodes on their own.
    const entries = Array.from({ length: 5_000 }, (_, i) => ws(i + 1, { socketId: (i % 500) + 1 }));
    const s = stage({ entries });
    expect(s.rows().length).toBeGreaterThan(0);
    expect(s.conns().length).toBeGreaterThan(0);
    expect(s.root.querySelectorAll('*').length).toBeLessThan(2_000);
  });

  it('S06-09, NFR-REL-01, ISO-12: a cell that throws goes to report; the other cells and rows still render', () => {
    const bad = Object.defineProperty({ ...ws(2) }, 'data', {
      get: (): string => {
        throw new Error('bad data');
      },
    });
    const s = stage({ entries: [ws(1), bad, ws(3)] });
    expect(s.reported.length).toBeGreaterThan(0);
    expect(s.rows().map((r) => r[0])).toEqual(['received', 'received', 'received']);
    expect(s.rows().map((r) => r[4])).toEqual(['hello', '', 'hello']);
  });

  it('§4.10: settings re-render the time and the row height; docked right the connections go on top', () => {
    const s = stage({ entries: [opened(1), ws(2)] });
    s.view.applySettings({ time: { mode: 'relative', origin: 1_010 }, rowHeight: 26, dock: 'right' });

    expect(s.rows().map((r) => r[1])).toEqual(['+0.000 s', '+0.010 s']);
    expect(s.rowEl(1).style.top).toBe('26px');
    expect(s.connEl(1).style.top).toBe('52px');
    expect(s.conns()[0]?.[1]).toBe(' 0  1 · +0.000 s');
    expect(s.view.element.classList).toContain('dcp-ws--right');
    expect(getComputedStyle(s.q('.dcp-ws-main')).flexDirection).toBe('column');

    s.view.applySettings({ time: { mode: 'relative', origin: 1_010 }, rowHeight: 26, dock: 'bottom' });
    expect(getComputedStyle(s.q('.dcp-ws-main')).flexDirection).toBe('row');
    expect(getComputedStyle(s.q('.dcp-ws-conns')).width).toBe('280px');
  });

  it('destroy() removes the element; later updates and a second destroy are safe', () => {
    const s = stage({ entries: [ws(1)] });
    s.view.destroy();
    expect(s.view.element.isConnected).toBeFalse();
    expect(() => {
      s.apply({ type: 'entry', entry: ws(2) });
      s.view.destroy();
    }).not.toThrow();
    expect(s.reported).toEqual([]);
  });
});
