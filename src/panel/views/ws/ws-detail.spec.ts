import { WebSocketEntry } from '../../ui';
import { cleanup, closed, failed, opened, SETTINGS, stage, Stage, StageOptions, ws } from './fakes.spec';
import { FRAME_PREVIEW_CHARS, HEX_PREVIEW_BYTES } from './ws-detail';

/** S-06 WebSocket view — the message detail (S06-06…09, S06-11; FR-WS-04, FR-WS-06, §4.4, §4.7, §4.12). */
describe('S-06 WebSocket view: detail', () => {
  afterEach(cleanup);

  const detail = (s: Stage): HTMLElement => s.q('.dcp-ws-detail');
  const body = (s: Stage): HTMLElement => s.q('.dcp-ws-detail .dcp-detail-body');
  const handle = (s: Stage): HTMLElement => s.q('.dcp-ws-main .dcp-split__handle');
  const tab = (s: Stage, label: string): void =>
    s.click(s.all('.dcp-ws-detail [role="tab"]').find((t) => t.textContent === label) ?? null);
  const kv = (s: Stage): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const tr of s.all('.dcp-ws-detail .dcp-ws-kv tr')) {
      out[tr.children[0]?.textContent ?? ''] = tr.children[1]?.textContent ?? '';
    }
    return out;
  };
  const pres = (s: Stage): string[] => s.all('.dcp-ws-detail pre').map((p) => p.textContent ?? '');
  /** The line that says what the message is: type · direction · time · size. */
  const meta = (s: Stage): string => s.q('.dcp-ws-detail p.dcp-meta').textContent ?? '';
  const tools = (s: Stage): string => s.q('.dcp-ws-detail .dcp-ws-tools').textContent ?? '';
  /** One entry, first in the list and selected, with the detail on `label`. */
  const open = (entry: WebSocketEntry, label = 'Message', options: StageOptions = {}): Stage => {
    const s = stage({ ...options, entries: [entry, ...(options.entries ?? [])] });
    s.click(s.rowEl(0));
    tab(s, label);
    return s;
  };
  const menuItem = (s: Stage, label: string): HTMLButtonElement =>
    s
      .all<HTMLButtonElement>('.dcp-ws-detail [role="menuitem"]')
      .find((b) => b.textContent === label) as HTMLButtonElement;
  const rawToggle = (s: Stage): HTMLElement =>
    s.all('.dcp-ws-detail .dcp-ws-tools button').find((b) => b.textContent === 'Raw') as HTMLElement;
  const showAll = (s: Stage, label: string): HTMLElement | null =>
    s.all('.dcp-ws-detail button').find((b) => b.textContent === label) ?? null;

  it('S06-08, FR-WS-04: a selected message opens the detail beside the list; ↓ ↑ move it; ✕ and Escape close it', () => {
    const s = stage({ entries: [ws(1, { data: 'a' }), ws(2, { data: 'b' })] });
    const grid = s.q('.dcp-list-pane .dcp-vlist');
    expect(detail(s).hidden).toBeTrue();
    expect(handle(s).hidden).toBeTrue();
    expect(s.view.handleEscape()).toBeFalse();

    s.click(s.rowEl(0));
    expect(detail(s).hidden).toBeFalse();
    expect(handle(s).hidden).toBeFalse();
    expect(s.q('.dcp-ws-main .dcp-split').getAttribute('data-direction')).toBe('row');
    expect(s.all('.dcp-ws-detail [role="tab"]').map((t) => t.textContent)).toEqual(['Message', 'Info']);
    expect(body(s).getAttribute('aria-labelledby')).toBe('dcp-ws-tab-message');
    expect(pres(s)).toEqual(['a']);

    s.key(grid, 'ArrowDown');
    expect(pres(s)).toEqual(['b']);
    s.key(grid, 'ArrowUp');
    expect(pres(s)).toEqual(['a']);

    s.click(s.q('.dcp-ws-detail button[aria-label="Close detail"]'));
    expect(s.store.getState().selection.ws).toBeNull();
    expect(detail(s).hidden).toBeTrue();
    expect(handle(s).hidden).toBeTrue();
    // Focus goes back to the list, not to the page.
    expect(s.root.activeElement).toBe(grid);

    s.click(s.rowEl(1));
    expect(s.view.handleEscape()).toBeTrue();
    expect(detail(s).hidden).toBeTrue();
    expect(s.view.handleEscape()).toBeFalse();

    // Docked right, the detail goes below the list.
    s.view.applySettings({ ...SETTINGS, dock: 'right' });
    expect(s.q('.dcp-ws-main .dcp-split').getAttribute('data-direction')).toBe('column');
    expect(s.reported).toEqual([]);
  });

  it('S06-08, §4.12: Enter on a message opens the detail and moves focus into its tabs', () => {
    const s = stage({ entries: [ws(1)] });
    const grid = s.q('.dcp-list-pane .dcp-vlist');
    s.key(grid, 'ArrowDown');
    s.key(grid, 'Enter');
    expect(detail(s).hidden).toBeFalse();
    expect(s.root.activeElement?.getAttribute('role')).toBe('tab');
    expect(s.root.activeElement?.textContent).toBe('Message');
  });

  it('S06-06, FR-WS-04: a JSON text frame shows the tree with a Raw toggle, under a line saying what it is', () => {
    const s = open(ws(1, { event: 'send', data: '{"cmd":"apply","ids":[1,2]}', bytes: 27 }));
    expect(meta(s)).toBe('Text · sent · 00:00:01.010 · 27 B');
    expect(s.q('.dcp-ws-detail [role="tree"]').getAttribute('aria-label')).toBe('Message');
    expect(rawToggle(s).getAttribute('aria-pressed')).toBe('false');

    s.click(rawToggle(s));
    expect(rawToggle(s).getAttribute('aria-pressed')).toBe('true');
    expect(pres(s)).toEqual(['{"cmd":"apply","ids":[1,2]}']);
    expect(s.all('.dcp-ws-detail [role="tree"]')).toEqual([]);
    s.click(rawToggle(s));
    expect(s.all('.dcp-ws-detail [role="tree"]').length).toBe(1);
  });

  it('S06-06, FR-COM-02: other text frames as-is; a cut one is badged; an empty one says so; a long one has "Show all"', () => {
    const shown = (entry: WebSocketEntry): [string[], string] => {
      const s = open(entry);
      const out: [string[], string] = [
        pres(s),
        s
          .all('.dcp-ws-tools')
          .map((t) => t.textContent)
          .join(''),
      ];
      cleanup();
      return out;
    };
    // Form-like text is still a message, not a form.
    expect(shown(ws(1, { data: 'a=1&b=2' }))).toEqual([['a=1&b=2'], '']);
    expect(shown(ws(1, { data: 'hell…[truncated 1 chars]' }))).toEqual([['hell'], 'truncatedoriginal 5 chars']);
    expect(shown(ws(1, { data: '{"a":1…[truncated 9 chars]' }))).toEqual([['{"a":1'], 'truncatedoriginal 15 chars']);

    const empty = open(ws(1, { data: '', bytes: 0 }));
    expect(body(empty).textContent).toBe('Text · received · 00:00:01.010 · 0 BEmpty message');
    cleanup();

    const long = 'x'.repeat(FRAME_PREVIEW_CHARS + 5);
    const s = open(ws(1, { data: long }));
    expect(pres(s)[0]?.length).toBe(FRAME_PREVIEW_CHARS);
    s.click(showAll(s, `Show all (${long.length} chars)`));
    expect(pres(s)[0]?.length).toBe(long.length);
  });

  it('S06-06, FR-WS-04: a binary frame shows its base64 and a hex view with offsets and ASCII', () => {
    const bytes = 'ABCDEFGHIJKLMNOP\x00\xff';
    const s = open(ws(1, { opcode: 'binary', data: btoa(bytes), bytes: 18 }));
    expect(meta(s)).toBe('Binary · received · 00:00:01.010 · 18 B');
    expect(s.all('.dcp-ws-detail .dcp-ws-h').map((h) => h.textContent)).toEqual(['Base64', 'Hex']);
    expect(pres(s)).toEqual([
      btoa(bytes),
      '00000000  41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50  ABCDEFGHIJKLMNOP\n' +
        `00000010  00 ff${' '.repeat(42)}  ..`,
    ]);
    expect(s.all('.dcp-ws-detail .dcp-badge')).toEqual([]);
    // Columns line up: the hex view never wraps.
    expect(getComputedStyle(s.q('.dcp-ws-hex')).whiteSpace).toBe('pre');
  });

  it('S06-06, FR-WS-04: a cut base64 tail that does not decode shows … and the note cut', () => {
    const abc = `00000000  41 42 43${' '.repeat(39)}  ABC`;
    // v1 cut "QUJDREVG" (ABCDEF) after 6 chars: "RA" alone is not whole bytes.
    const s = open(ws(1, { opcode: 'binary', data: 'QUJDRA…[truncated 2 chars]', bytes: 6 }));
    expect(pres(s)).toEqual(['QUJDRA…', `${abc}\n…`]);
    expect(tools(s)).toBe('cut3 of 6 bytes');
    cleanup();

    // Whole groups, but cut short: the bytes shown are right, the rest is missing.
    const t = open(ws(1, { opcode: 'binary', data: 'QUJD…[truncated 4 chars]', bytes: 6 }));
    expect(pres(t)).toEqual(['QUJD…', `${abc}\n…`]);
    expect(tools(t)).toBe('cut3 of 6 bytes');
    cleanup();

    // Not base64 at all (a broken or hostile entry): nothing decodes, nothing throws.
    const u = open(ws(1, { opcode: 'binary', data: '!!!!', bytes: 3 }));
    expect(pres(u)).toEqual(['!!!!…', '…']);
    expect(tools(u)).toBe('cut0 of 3 bytes');
    expect(u.reported).toEqual([]);
  });

  it('S06-09, FR-COM-02: a big binary frame shows the first part of base64 and hex, then "Show all (N bytes)"', () => {
    const raw = 'x'.repeat(HEX_PREVIEW_BYTES * 2);
    const s = open(ws(1, { opcode: 'binary', data: btoa(raw), bytes: raw.length }));
    expect(pres(s)[0]?.length).toBe(FRAME_PREVIEW_CHARS);
    expect(pres(s)[1]?.split('\n').length).toBe(HEX_PREVIEW_BYTES / 16);
    s.click(showAll(s, `Show all (${raw.length} bytes)`));
    expect(pres(s)[0]).toBe(btoa(raw));
    expect(pres(s)[1]?.split('\n').length).toBe(raw.length / 16);
  });

  it('S06-06: lifecycle rows and an unread Blob say what they are', () => {
    const text = (entry: WebSocketEntry): string => {
      const s = open(entry);
      const out = body(s).textContent ?? '';
      cleanup();
      return out;
    };
    expect(text(opened(1))).toBe('opened · 00:00:01.010');
    expect(text(closed(1, 1, 1000, 'bye'))).toBe('closed · 00:00:01.010Code1000Reasonbye');
    expect(text(closed(1, 1, null, null))).toBe('closed · 00:00:01.010Code—Reason—');
    expect(text(failed(1))).toBe('error · 00:00:01.010The browser gives no details about WebSocket errors.');
    expect(text(ws(1, { opcode: 'binary', data: null, bytes: 512 }))).toBe(
      'Binary · received · 00:00:01.010 · 512 B[Blob 512 bytes]',
    );
  });

  it('S06-07, FR-WS-04: Info — URL, socket id, state, opened / closed time, close code and reason, counts; kept live', () => {
    const s = stage({ entries: [opened(1, 2), ws(2, { socketId: 2, event: 'send' }), ws(3, { socketId: 2 })] });
    s.click(s.rowEl(1));
    tab(s, 'Info');
    expect(body(s).getAttribute('aria-labelledby')).toBe('dcp-ws-tab-info');
    expect(kv(s)).toEqual({
      URL: 'wss://app.test/live/2',
      'Socket id': '#2',
      State: 'open',
      Opened: '00:00:01.010',
      Closed: '—',
      'Close code': '—',
      'Close reason': '—',
      Messages: ' 1 sent ·  1 received',
    });
    // State by icon and word, never colour alone.
    const state = s.q('.dcp-ws-detail .dcp-ws-kv .dcp-ws-dir');
    expect(state.className).toContain('dcp-tone-success');
    expect(state.querySelector('svg')?.getAttribute('data-icon')).toBe('opened');

    s.apply({ type: 'entry', entry: closed(4, 2, 1001, 'going away') });
    expect(kv(s)).toEqual(
      jasmine.objectContaining({
        State: 'closed',
        Closed: '00:00:01.040',
        'Close code': '1001',
        'Close reason': 'going away',
      }),
    );
    s.view.applySettings({ ...SETTINGS, time: { mode: 'relative', origin: 1_010 } });
    expect(kv(s)['Opened']).toBe('+0.000 s');
    expect(s.reported).toEqual([]);
  });

  it('S06-08, §4.4: a selected message that leaves the buffer keeps its detail with the note', () => {
    const s = open(ws(1, { data: 'kept' }));
    expect(s.q('.dcp-ws-removed').hidden).toBeTrue();
    s.apply({ type: 'cleared' });
    expect(detail(s).hidden).toBeFalse();
    expect(s.q('.dcp-ws-removed').hidden).toBeFalse();
    expect(s.q('.dcp-ws-removed').textContent).toBe('This entry was removed from the buffer.');
    expect(pres(s)).toEqual(['kept']);
    // The connection left with it: what the entry itself knows stays.
    tab(s, 'Info');
    expect(kv(s)).toEqual(jasmine.objectContaining({ URL: 'wss://app.test/live/1', 'Socket id': '#1', State: '—' }));
    expect(s.reported).toEqual([]);
  });

  it('S06-11, FR-WS-06, NFR-SEC-04: Copy message (the data as stored) and Copy URL go through source.copyText', async () => {
    const s = stage({
      entries: [
        ws(1, { data: 'hi…[truncated 3 chars]' }),
        ws(2, { opcode: 'binary', data: 'AAEC', bytes: 3 }),
        closed(3, 1, 1000, 'bye'),
        opened(4),
        ws(5, { opcode: 'binary', data: null, bytes: 9 }),
      ],
    });
    const copy = (row: number, label: string): void => {
      s.click(s.rowEl(row));
      s.click(s.q('.dcp-ws-detail button[aria-haspopup="menu"]'));
      s.click(menuItem(s, label));
    };
    copy(0, 'Copy message');
    copy(1, 'Copy message');
    copy(2, 'Copy message');
    copy(2, 'Copy URL');
    expect(s.copied.map((c) => c.text)).toEqual(['hi…[truncated 3 chars]', 'AAEC', 'bye', 'wss://app.test/live/1']);
    // Into our shadow root (C-5): nothing is added to the host page.
    expect(s.copied.every((c) => c.root === s.root)).toBeTrue();

    // Nothing to copy: an open row, an unread Blob.
    s.click(s.rowEl(3));
    expect(menuItem(s, 'Copy message').disabled).toBeTrue();
    expect(menuItem(s, 'Copy URL').disabled).toBeFalse();
    s.click(s.rowEl(4));
    expect(menuItem(s, 'Copy message').disabled).toBeTrue();
    s.click(s.rowEl(0));
    expect(menuItem(s, 'Copy message').disabled).toBeFalse();
    await Promise.resolve();
    expect(s.reported).toEqual([]);
  });

  it('S06-11, ISO-12: a copy that fails goes to report, never to the page', async () => {
    const s = open(ws(1), 'Message', { copyResult: 'reject' });
    s.click(s.q('.dcp-ws-detail button[aria-haspopup="menu"]'));
    s.click(menuItem(s, 'Copy URL'));
    await new Promise((done) => setTimeout(done));
    expect(s.reported.length).toBe(1);
  });

  it('S06-11, §4.12: Escape closes the open Copy menu first, then the detail', () => {
    const s = open(ws(1));
    s.click(s.q('.dcp-ws-detail button[aria-haspopup="menu"]'));
    expect(s.q('.dcp-ws-detail [role="menu"]').hidden).toBeFalse();
    expect(s.view.handleEscape()).toBeTrue();
    expect(s.q('.dcp-ws-detail [role="menu"]').hidden).toBeTrue();
    expect(detail(s).hidden).toBeFalse();
    expect(s.view.handleEscape()).toBeTrue();
    expect(detail(s).hidden).toBeTrue();
  });

  it('S06-09, NFR-SEC-01, ISO-04, NFR-I18N-01: hostile frames stay text in the detail; data is dir="auto"', () => {
    const evil = '<img src=x onerror="window.__pwned=1">\u202Eevil';
    const s = open(ws(1, { data: evil, url: `wss://h/${evil}` }));
    expect(pres(s)).toEqual([evil]);
    expect(s.q('.dcp-ws-detail pre').getAttribute('dir')).toBe('auto');
    tab(s, 'Info');
    s.apply({ type: 'entry', entry: closed(2, 1, 4000, evil) });
    expect(kv(s)['URL']).toBe(`wss://h/${evil}`);
    expect(kv(s)['Close reason']).toBe(evil);
    expect(s.all('.dcp-ws-kv td').every((td) => td.getAttribute('dir') === 'auto')).toBeTrue();
    expect(s.all('img, script, iframe, a')).toEqual([]);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('S06-09, NFR-PERF-04: 5,000 messages and an open detail with a big JSON frame stay under 2,000 elements', () => {
    const big = JSON.stringify({ items: Array.from({ length: 5_000 }, (_, i) => ({ id: i, name: `n${i}` })) });
    const entries = Array.from({ length: 5_000 }, (_, i) => ws(i + 1, i === 4_999 ? { data: big } : {}));
    const s = stage({ entries, height: 600 });
    s.click(s.rowEls()[s.rowEls().length - 1] ?? null);
    expect(s.q('.dcp-ws-detail [role="tree"]')).not.toBeNull();
    expect(s.root.querySelectorAll('*').length).toBeLessThan(2_000);
  });

  it('destroy() with the detail open is safe and leaves nothing behind', () => {
    const s = open(ws(1, { data: '{"a":1}' }));
    s.click(s.q('.dcp-ws-detail button[aria-haspopup="menu"]'));
    s.view.destroy();
    expect(s.view.element.isConnected).toBeFalse();
    expect(() => s.apply({ type: 'entry', entry: ws(2) })).not.toThrow();
    expect(s.reported).toEqual([]);
  });
});
