import { HttpEntry, toCurl } from '../../ui';
import { BODY_PREVIEW_CHARS } from './http-detail';
import { cleanup, http, pending, stage, Stage, StageOptions } from './fakes.spec';

/** S-05 HTTP view — the detail (S05-07…14; FR-HTTP-04…07, §4.6, §4.11, §4.12, NFR-SEC-01, NFR-PERF-04). */
describe('S-05 HTTP view: detail', () => {
  afterEach(cleanup);

  const detail = (s: Stage): HTMLElement => s.q('.dcp-http-detail');
  const body = (s: Stage): HTMLElement => s.q('.dcp-http-detail .dcp-detail-body');
  const tab = (s: Stage, label: string): void =>
    s.click(s.all('.dcp-http-detail [role="tab"]').find((t) => t.textContent === label) ?? null);
  const kv = (s: Stage): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const tr of s.all('.dcp-http-detail .dcp-http-kv tr')) {
      out[tr.children[0]?.textContent ?? ''] = tr.children[1]?.textContent ?? '';
    }
    return out;
  };
  /** One entry, selected, with the detail on `label`. */
  const open = (entry: HttpEntry, label = 'Headers', options: StageOptions = {}): Stage => {
    const s = stage({ ...options, entries: [entry, ...(options.entries ?? [])] });
    s.click(s.rowEl(0));
    tab(s, label);
    return s;
  };
  const menuItem = (s: Stage, label: string): HTMLButtonElement =>
    s
      .all<HTMLButtonElement>('.dcp-http-detail [role="menuitem"]')
      .find((b) => b.textContent === label) as HTMLButtonElement;

  it('S05-07, FR-HTTP-04: a selected row opens the detail beside the list; ↓ ↑ move it; ✕ and Escape close it', () => {
    const s = stage({ entries: [http(1, { url: 'https://h/a' }), http(2, { url: 'https://h/b' })] });
    expect(detail(s).hidden).toBeTrue();
    expect(s.view.handleEscape()).toBeFalse();

    s.click(s.rowEl(0));
    expect(detail(s).hidden).toBeFalse();
    expect(s.q('.dcp-split').getAttribute('data-direction')).toBe('row');
    expect(s.all('.dcp-http-detail [role="tab"]').map((t) => t.textContent)).toEqual([
      'Headers',
      'Payload',
      'Response',
      'Timing',
    ]);
    expect(body(s).getAttribute('aria-labelledby')).toBe('dcp-http-tab-headers');
    expect(kv(s)['URL']).toBe('https://h/a');

    s.key(s.q('.dcp-vlist'), 'ArrowDown');
    expect(kv(s)['URL']).toBe('https://h/b');
    s.key(s.q('.dcp-vlist'), 'ArrowUp');
    expect(kv(s)['URL']).toBe('https://h/a');

    s.click(s.q('.dcp-http-detail button[aria-label="Close detail"]'));
    expect(s.store.getState().selection.http).toBeNull();
    expect(detail(s).hidden).toBeTrue();
    expect(s.q('.dcp-split__handle').hidden).toBeTrue();

    s.click(s.rowEl(0));
    expect(s.view.handleEscape()).toBeTrue();
    expect(detail(s).hidden).toBeTrue();
    expect(s.view.handleEscape()).toBeFalse();

    // Docked right, the detail goes below the list.
    s.view.applySettings({ time: { mode: 'clock', utcOffsetMinutes: 0 }, rowHeight: 22, dock: 'right' });
    expect(s.q('.dcp-split').getAttribute('data-direction')).toBe('column');
  });

  it('S05-08, FR-HTTP-07: Headers — General, request and response headers as captured, redacted values badged', () => {
    const t = Date.UTC(2026, 9, 15, 14, 3, 27, 412);
    const s = open(
      http(1, {
        t,
        url: 'https://h/api/x?token=[redacted]',
        method: 'POST',
        status: 500,
        transport: 'xhr',
        durationMs: 143,
        bytes: 3_200,
        reqHeaders: { authorization: '[redacted]', 'x-trace': 'abc' },
        resHeaders: { 'content-type': 'application/json' },
      }),
    );
    expect(kv(s)).toEqual(
      jasmine.objectContaining({
        URL: 'https://h/api/x?token=[redacted]',
        Method: 'POST',
        Status: '500 Internal Server Error',
        Transport: 'XHR',
        Start: '14:03:27.412',
        Duration: '143 ms',
        Size: '3.2 kB',
        authorization: 'redacted',
        'x-trace': 'abc',
        'content-type': 'application/json',
      }),
    );
    expect(s.all('.dcp-http-h').map((h) => h.textContent)).toEqual([
      'General',
      'Request headers (2)',
      'Response headers (1)',
    ]);
    expect(s.all('.dcp-http-detail .dcp-badge--redacted').length).toBe(1);
    expect(s.q('.dcp-http-detail .dcp-http-kv mark.dcp-json-redacted').textContent).toBe('[redacted]');
    expect(s.q('.dcp-http-detail .dcp-http-status.dcp-tone-error svg')).not.toBeNull();
  });

  it('S05-09, FR-HTTP-05: JSON bodies show the tree with a Raw toggle; form bodies a table with Raw', () => {
    const s = open(
      http(1, { reqBody: 'a=1&b=x%20y', resBody: '{"user":{"name":"Ada"},"token":"[redacted]"}' }),
      'Response',
    );
    expect(s.q('.dcp-http-detail [role="tree"]').getAttribute('aria-label')).toBe('Response body');
    expect(s.q('.dcp-http-detail [role="tree"] .dcp-badge--redacted')).not.toBeNull();
    const rawToggle = (): HTMLElement =>
      s.all('.dcp-http-detail .dcp-http-tools button').find((b) => b.textContent === 'Raw') as HTMLElement;
    s.click(rawToggle());
    expect(rawToggle().getAttribute('aria-pressed')).toBe('true');
    expect(s.q('.dcp-http-detail pre').textContent).toBe('{"user":{"name":"Ada"},"token":"[redacted]"}');
    expect(s.all('.dcp-http-detail [role="tree"]')).toEqual([]);

    tab(s, 'Payload');
    expect(s.all('.dcp-http-detail .dcp-http-kv tr').map((tr) => tr.textContent)).toEqual(['a1', 'bx y']);
    s.click(rawToggle());
    expect(s.q('.dcp-http-detail pre').textContent).toBe('a=1&b=x%20y');
  });

  it('S05-09, FR-HTTP-05/07, C-7: text, descriptor, empty, truncated, stopped, capped, not captured, pending', () => {
    const show = (entry: HttpEntry, label: string): string => {
      const s = open(entry, label);
      const text = body(s).textContent ?? '';
      cleanup();
      return text;
    };
    expect(show(http(1, { resBody: 'plain ?k=[redacted]' }), 'Response')).toBe('plain ?k=[redacted]');
    expect(show(http(1, { reqBody: '[Blob 512 bytes]' }), 'Payload')).toBe('[Blob 512 bytes]');
    expect(show(http(1), 'Payload')).toBe('No request body');
    expect(show(http(1, { resBody: '' }), 'Response')).toBe('No response body');
    expect(show(http(1, { resBody: 'abc…[truncated 5 chars]' }), 'Response')).toBe('truncatedoriginal 8 charsabc');
    expect(show(http(1, { resBody: 'abc…[capture stopped at 3 chars]' }), 'Response')).toBe(
      'truncatedfull length unknownabc',
    );
    expect(show(http(1, { resBody: 'abc', resBodyCapped: true }), 'Response')).toBe(
      'truncatedover 1 MB — full length unknownabc',
    );
    expect(show(http(1, { resBody: null, resHeaders: { 'content-type': 'image/png' } }), 'Response')).toBe(
      'Body not captured (binary)',
    );
    expect(show(http(1, { resBody: null, resHeaders: { 'content-type': 'text/event-stream' } }), 'Response')).toBe(
      'Body not captured (event stream)',
    );
    expect(show(http(1, { resBody: null, status: null, error: 'network' }), 'Response')).toBe('No response body');

    const s = stage({ pending: [pending(1)] });
    s.click(s.rowEl(0));
    tab(s, 'Response');
    expect(body(s).textContent).toBe('The request is still pending.');
    tab(s, 'Payload');
    expect(body(s).textContent).toBe('No request body');
  });

  it('S05-09, FR-HTTP-07: [redacted] inside a text body is marked; a form value that is all redacted is the badge', () => {
    const s = open(http(1, { reqBody: 'a=[redacted]&b=x', resBody: 'k=[redacted]; j=[redacted]!' }), 'Response');
    expect(s.q('.dcp-http-detail pre').textContent).toBe('k=[redacted]; j=[redacted]!');
    expect(s.all('.dcp-http-detail pre mark.dcp-json-redacted').map((m) => m.textContent)).toEqual([
      '[redacted]',
      '[redacted]',
    ]);
    tab(s, 'Payload');
    expect(s.all('.dcp-http-detail .dcp-http-kv .dcp-badge--redacted').length).toBe(1);
    expect(kv(s)['b']).toBe('x');
  });

  it('S05-09, FR-COM-02: a long body shows its first part and "Show all (N chars)"', () => {
    const long = 'x'.repeat(BODY_PREVIEW_CHARS + 5);
    const s = open(http(1, { resBody: long }), 'Response');
    expect(s.q('.dcp-http-detail pre').textContent?.length).toBe(BODY_PREVIEW_CHARS);
    const more = s.all('.dcp-http-detail button').find((b) => b.textContent === `Show all (${long.length} chars)`);
    s.click(more ?? null);
    expect(s.q('.dcp-http-detail pre').textContent?.length).toBe(long.length);
  });

  it('S05-10: Timing — start, end, duration and a bar against the slowest request in view', () => {
    const t = Date.UTC(2026, 9, 15, 14, 3, 27, 0);
    const s = open(http(1, { t, durationMs: 250 }), 'Timing', {
      entries: [http(2, { t: t + 10_000, durationMs: 1_000 })],
    });
    expect(kv(s)).toEqual({ Start: '14:03:27.000', End: '14:03:27.250', Duration: '250 ms' });
    const bar = s.q('.dcp-http-bar');
    expect(bar.getAttribute('aria-label')).toBe('250 ms of the slowest 1.00 s');
    expect(s.q('.dcp-http-bar__fill').style.width).toBe('25%');
    // A slower request arrives: the bar is measured again.
    s.apply({ type: 'entry', entry: http(3, { durationMs: 2_500 }) });
    expect(s.q('.dcp-http-bar__fill').style.width).toBe('10%');
    expect(getComputedStyle(s.q('.dcp-http-bar')).height).toBe('6px');

    s.view.applySettings({ time: { mode: 'relative', origin: t }, rowHeight: 22, dock: 'bottom' });
    expect(kv(s)['End']).toBe('+0.250 s');
  });

  it('S05-11, FR-HTTP-06, NFR-SEC-04: each Copy item copies through source.copyText into our shadow root', async () => {
    const hostile = http(1, {
      method: 'POST',
      url: "https://h/x?q=$(rm -rf /)&t=[redacted]'`",
      reqHeaders: { 'x-a': "it's `bad`\nline" },
      reqBody: '{"a":"$(whoami)"}',
      resBody: 'done',
    });
    const s = open(hostile);
    for (const label of ['Copy URL', 'Copy request body', 'Copy response body', 'Copy as cURL']) {
      s.click(s.q('.dcp-http-detail button[aria-haspopup="menu"]'));
      s.click(menuItem(s, label));
    }
    expect(s.copied.map((c) => c.text)).toEqual([
      hostile.url,
      hostile.reqBody ?? '',
      'done',
      toCurl(hostile, '[redacted]'),
    ]);
    expect(s.copied.every((c) => c.root === s.root)).toBeTrue();
    // POSIX single quotes: a quote inside becomes '\'' (FR-HTTP-06).
    expect(s.copied[3]?.text).toContain("it'\\''s");

    // A request in flight has no bodies to copy.
    s.click(s.all('.dcp-http-detail button[aria-label="Close detail"]')[0] ?? null);
    s.apply({ type: 'pending-start', request: pending(5) });
    s.click(s.rowEl(1));
    expect(menuItem(s, 'Copy request body').disabled).toBeTrue();
    expect(menuItem(s, 'Copy response body').disabled).toBeTrue();
    expect(menuItem(s, 'Copy as cURL').disabled).toBeFalse();
    await Promise.resolve();
    expect(s.reported).toEqual([]);
  });

  it('S05-11, ISO-12: a copy that fails goes to report, never to the page', async () => {
    const s = open(http(1), 'Headers', { copyResult: 'reject' });
    s.click(s.q('.dcp-http-detail button[aria-haspopup="menu"]'));
    s.click(menuItem(s, 'Copy URL'));
    await new Promise((done) => setTimeout(done));
    expect(s.reported.length).toBe(1);
  });

  it('S05-07, §4.12: Escape closes the open Copy menu first, then the detail', () => {
    const s = open(http(1));
    s.click(s.q('.dcp-http-detail button[aria-haspopup="menu"]'));
    expect(s.q('.dcp-http-detail [role="menu"]').hidden).toBeFalse();
    expect(s.view.handleEscape()).toBeTrue();
    expect(s.q('.dcp-http-detail [role="menu"]').hidden).toBeTrue();
    expect(detail(s).hidden).toBeFalse();
    expect(s.view.handleEscape()).toBeTrue();
    expect(detail(s).hidden).toBeTrue();
  });

  it('S05-12, §4.4: a selected entry that leaves the buffer keeps its detail with the note', () => {
    const s = open(http(1, { url: 'https://h/kept' }));
    expect(s.q('.dcp-http-removed').hidden).toBeTrue();
    s.apply({ type: 'cleared' });
    expect(detail(s).hidden).toBeFalse();
    expect(s.q('.dcp-http-removed').hidden).toBeFalse();
    expect(s.q('.dcp-http-removed').textContent).toBe('This entry was removed from the buffer.');
    expect(kv(s)['URL']).toBe('https://h/kept');
    expect(s.reported).toEqual([]);
  });

  it('S05-13, NFR-SEC-01, ISO-04: hostile strings stay text everywhere', () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const s = open(
      http(1, {
        url: `https://h/${evil}`,
        method: evil,
        reqHeaders: { [evil]: evil },
        resBody: evil,
      }),
    );
    tab(s, 'Response');
    expect(s.all('img, script, iframe, a')).toEqual([]);
    expect(s.q('.dcp-http-detail pre').textContent).toBe(evil);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(s.rows()[0]?.[1]).toBe(evil);
  });

  it('S05-14, NFR-PERF-04, D-22: 5,000 rows and an open detail with a big JSON body stay under 2,000 elements', () => {
    const big = JSON.stringify({ items: Array.from({ length: 5_000 }, (_, i) => ({ id: i, name: `n${i}` })) });
    const entries = Array.from({ length: 5_000 }, (_, i) => http(i + 1, i === 4_999 ? { resBody: big } : {}));
    const s = stage({ entries, height: 600 });
    s.click(s.rowEls()[s.rowEls().length - 1] ?? null);
    tab(s, 'Response');
    expect(s.q('.dcp-http-detail [role="tree"]')).not.toBeNull();
    expect(s.root.querySelectorAll('*').length).toBeLessThan(2_000);
  });
});
