import { EMPTY_FILTERS } from '../../ui';
import { cleanup, http, pending, stage, Stage } from './fakes.spec';

/** S-05 HTTP view — filter bar and list states (S05-05, S05-06; FR-HTTP-03, FR-COM-04, §4.5, §4.11). */
describe('S-05 HTTP view: filter bar and states', () => {
  afterEach(cleanup);

  const names = (s: Stage): string[] => s.rows().map((r) => r[3] ?? '');
  const search = (s: Stage, text: string): void => {
    const input = s.q<HTMLInputElement>('.dcp-filter-bar input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  const chip = (s: Stage, group: string, label: string): HTMLElement | null =>
    s.all(`.dcp-filter-bar [role="group"][aria-label="${group}"] button`).find((b) => b.textContent === label) ?? null;
  const shownEmpty = (s: Stage): string[] =>
    s
      .all('.dcp-empty')
      .filter((e) => !e.hidden)
      .map((e) => e.textContent ?? '');

  it('S05-05, FR-HTTP-03: search waits for the typing pause, then filters URL, method and status and marks matches', () => {
    const s = stage({
      entries: [
        http(1, { url: 'https://h/api/users' }),
        http(2, { url: 'https://h/api/orders', method: 'POST' }),
        http(3, { url: 'https://h/x', status: 404 }),
      ],
    });
    search(s, 'USERS');
    expect(names(s)).withContext('not before the pause').toEqual(['users', 'orders', 'x']);
    s.runTimers();
    expect(names(s)).toEqual(['users']);
    expect(s.cells(3)[0]?.querySelector('mark.dcp-match')?.textContent).toBe('users');

    search(s, 'post');
    s.runTimers();
    expect(names(s)).toEqual(['orders']);
    expect(s.cells(1)[0]?.querySelector('mark.dcp-match')?.textContent).toBe('POST');

    search(s, '404');
    s.runTimers();
    expect(names(s)).toEqual(['x']);
    expect(s.cells(2)[0]?.querySelector('mark.dcp-match')?.textContent).toBe('404');
    expect(s.store.getState().filters.http.text).toBe('404');
  });

  it('S05-05, FR-HTTP-03: chips — OR inside a group, AND across groups and search; "All" resets its group', () => {
    const s = stage({
      entries: [
        http(1, { transport: 'xhr', status: 200, url: 'https://h/a' }),
        http(2, { transport: 'fetch', status: 500, url: 'https://h/b' }),
        http(3, { transport: 'xhr', status: 404, url: 'https://h/c' }),
        http(4, { transport: 'fetch', status: null, error: 'network', url: 'https://h/d' }),
      ],
      pending: [pending(9, { transport: 'fetch', url: 'https://h/e' })],
    });
    expect(chip(s, 'Type', 'All')?.getAttribute('aria-pressed')).toBe('true');

    s.click(chip(s, 'Status', '4xx'));
    s.click(chip(s, 'Status', '5xx'));
    expect(names(s)).toEqual(['b', 'c']);
    s.click(chip(s, 'Type', 'XHR'));
    expect(names(s)).toEqual(['c']);
    s.click(chip(s, 'Status', 'All'));
    expect(names(s)).toEqual(['a', 'c']);
    s.click(chip(s, 'Type', 'All'));
    s.click(chip(s, 'Status', 'Failed'));
    s.click(chip(s, 'Status', 'Pending'));
    expect(names(s)).toEqual(['d', 'e']);
    expect(s.store.getState().filters.http).toEqual({ text: '', type: [], status: ['failed', 'pending'] });
    for (const label of ['2xx', '3xx', 'Fetch'])
      expect(chip(s, label === 'Fetch' ? 'Type' : 'Status', label)).not.toBeNull();
  });

  it('S05-06, FR-COM-04: "No requests yet."; no match shows the message and Clear filters, which resets search and chips', () => {
    const s = stage();
    expect(shownEmpty(s)).toEqual(['No requests yet.']);
    expect(s.all('.dcp-empty button').filter((b) => !b.closest('[hidden]'))).toEqual([]);

    s.apply({ type: 'entry', entry: http(1) });
    expect(shownEmpty(s)).toEqual([]);
    expect(s.q('.dcp-vlist').hidden).toBeFalse();

    s.click(chip(s, 'Status', '5xx'));
    search(s, 'items');
    s.runTimers();
    expect(shownEmpty(s)).toEqual(['No entries match the filter.Clear filters']);
    expect(s.q('.dcp-vlist').hidden).toBeTrue();

    s.click(s.all('.dcp-empty button').find((b) => b.textContent === 'Clear filters') ?? null);
    expect(s.store.getState().filters.http).toEqual(EMPTY_FILTERS.http);
    expect(s.q<HTMLInputElement>('.dcp-filter-bar input').value).toBe('');
    expect(chip(s, 'Status', 'All')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip(s, 'Status', '5xx')?.getAttribute('aria-pressed')).toBe('false');
    expect(names(s)).toEqual(['1?page=1']);
    expect(shownEmpty(s)).toEqual([]);
  });

  it('§4.5, D-20: chips start from the stored filters and follow the store; focusFilter (Ctrl+F) focuses the search', () => {
    const s = stage({ entries: [http(1), http(2, { status: 503 })], filters: { status: ['5xx'] } });
    expect(chip(s, 'Status', '5xx')?.getAttribute('aria-pressed')).toBe('true');
    expect(s.rows().map((r) => r[2])).toEqual(['503']);

    s.store.setFilter('http', { type: ['xhr'] });
    expect(chip(s, 'Type', 'XHR')?.getAttribute('aria-pressed')).toBe('true');

    s.view.focusFilter();
    expect(s.root.activeElement).toBe(s.q('.dcp-filter-bar input'));
  });
});
