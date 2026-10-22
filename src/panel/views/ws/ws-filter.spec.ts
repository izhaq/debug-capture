import { EMPTY_FILTERS } from '../../ui';
import { cleanup, closed, opened, stage, Stage, ws } from './fakes.spec';

/** S-06 WebSocket view — filter bar (S06-04, S06-05; FR-WS-03, FR-COM-04, §4.5, D-20). */
describe('S-06 WebSocket view: filter bar', () => {
  afterEach(cleanup);

  const data = (s: Stage): string[] => s.rows().map((r) => r[4] ?? '');
  const dirs = (s: Stage): string[] => s.rows().map((r) => r[0] ?? '');
  const search = (s: Stage, text: string): void => {
    const input = s.q<HTMLInputElement>('.dcp-filter-bar input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  const chip = (s: Stage, group: string, label: string): HTMLElement | null =>
    s.all(`.dcp-filter-bar [role="group"][aria-label="${group}"] button`).find((b) => b.textContent === label) ?? null;
  const pressed = (s: Stage, group: string): string[] =>
    s
      .all(`.dcp-filter-bar [role="group"][aria-label="${group}"] button`)
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent ?? '');

  it('S06-04, FR-WS-03: search waits for the typing pause, then looks in message data and marks the matches', () => {
    const s = stage({
      entries: [
        opened(1),
        ws(2, { data: '{"cmd":"apply"}' }),
        ws(3, { event: 'send', data: 'ping' }),
        // base64 of "APPLY": the search looks at the data as stored.
        ws(4, { opcode: 'binary', data: 'QVBQTFk=', bytes: 5 }),
        closed(5, 1, 1000, 'apply done'),
      ],
    });
    expect(s.q<HTMLInputElement>('.dcp-filter-bar input').getAttribute('aria-label')).toBe('Filter messages');
    search(s, 'APPLY');
    expect(data(s).length).withContext('not before the pause').toBe(5);
    s.runTimers();

    expect(data(s)).toEqual(['{"cmd":"apply"}', '1000 "apply done"']);
    expect(s.cells(4).map((c) => c.querySelector('mark.dcp-match')?.textContent)).toEqual(['apply', 'apply']);
    expect(s.store.getState().filters.ws.text).toBe('APPLY');

    search(s, 'qvbq');
    s.runTimers();
    expect(data(s)).toEqual(['[Binary 5 bytes]']);
  });

  it('S06-04, FR-WS-03: Direction and Type chips — OR inside a group, AND across; a set chip hides lifecycle rows', () => {
    const s = stage({
      entries: [
        opened(1),
        ws(2, { event: 'send', data: 'out' }),
        ws(3, { data: 'in' }),
        ws(4, { event: 'send', opcode: 'binary', data: 'AA==', bytes: 1 }),
        ws(5, { opcode: 'binary', data: 'AQ==', bytes: 1 }),
        closed(6),
      ],
    });
    expect(pressed(s, 'Direction')).toEqual(['All']);
    expect(s.all('.dcp-filter-bar [aria-label="Type"] button').map((b) => b.textContent)).toEqual([
      'All',
      'Text',
      'Binary',
    ]);

    s.click(chip(s, 'Direction', 'Sent'));
    expect(data(s)).toEqual(['out', '[Binary 1 bytes]']);
    s.click(chip(s, 'Type', 'Binary'));
    expect(data(s)).toEqual(['[Binary 1 bytes]']);
    expect(dirs(s)).toEqual(['sent']);
    s.click(chip(s, 'Direction', 'Received'));
    expect(dirs(s)).toEqual(['sent', 'received']);
    expect(s.store.getState().filters.ws).toEqual({ text: '', direction: ['sent', 'received'], data: ['binary'] });

    s.click(chip(s, 'Direction', 'All'));
    // Binary off again, then Text on.
    s.click(chip(s, 'Type', 'Binary'));
    s.click(chip(s, 'Type', 'Text'));
    expect(data(s)).toEqual(['out', 'in']);
    s.click(chip(s, 'Type', 'All'));
    expect(dirs(s)).toEqual(['opened', 'sent', 'received', 'sent', 'received', 'closed']);
    expect(s.reported).toEqual([]);
  });

  it('S06-05, FR-COM-04: Clear filters resets the search box (even a search still waiting), the chips and the store', () => {
    const s = stage({ entries: [ws(1, { data: 'abc' })] });
    s.click(chip(s, 'Direction', 'Sent'));
    search(s, 'zzz');
    s.runTimers();
    expect(
      s
        .all('.dcp-empty')
        .filter((e) => !e.hidden)
        .map((e) => e.textContent),
    ).toEqual(['No entries match the filter.Clear filters']);
    // Typed but not applied yet: Clear must drop it too.
    search(s, 'more');

    s.click(s.all('.dcp-empty button').find((b) => b.textContent === 'Clear filters') ?? null);
    s.runTimers();
    expect(s.store.getState().filters.ws).toEqual(EMPTY_FILTERS.ws);
    expect(s.q<HTMLInputElement>('.dcp-filter-bar input').value).toBe('');
    expect(pressed(s, 'Direction')).toEqual(['All']);
    expect(data(s)).toEqual(['abc']);
  });

  it('§4.5, D-20: chips start from the stored filter and follow the store; focusFilter (Ctrl+F) focuses the search', () => {
    const s = stage({
      entries: [ws(1, { event: 'send', data: 'out' }), ws(2, { data: 'in' })],
      filters: { direction: ['received'] },
    });
    expect(pressed(s, 'Direction')).toEqual(['Received']);
    expect(data(s)).toEqual(['in']);

    s.store.setFilter('ws', { data: ['binary'] });
    expect(pressed(s, 'Type')).toEqual(['Binary']);

    s.view.focusFilter();
    expect(s.root.activeElement).toBe(s.q('.dcp-filter-bar input'));
  });
});
