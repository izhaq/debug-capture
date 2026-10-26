import { EMPTY_FILTERS } from '../../ui';
import { cleanup, error, log, stage, Stage } from './fakes.spec';

/** S-07 Console view - filter bar and list states (S07-04, S07-06; FR-CON-04, FR-COM-04, 4.5, 4.11). */
describe('S-07 Console view: filter bar and states', () => {
  afterEach(cleanup);

  const messages = (s: Stage): string[] => s.rows().map((r) => r[3] ?? '');
  const search = (s: Stage, text: string): void => {
    const input = s.q<HTMLInputElement>('.dcp-filter-bar input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  const chips = (s: Stage): HTMLElement[] => s.all('.dcp-filter-bar [role="group"][aria-label="Level"] button');
  const chip = (s: Stage, label: string): HTMLElement | null => chips(s).find((b) => b.textContent === label) ?? null;
  const shownEmpty = (s: Stage): string[] =>
    s
      .all('.dcp-empty')
      .filter((e) => !e.hidden)
      .map((e) => e.textContent ?? '');

  it('S07-04, FR-CON-04: search waits for the typing pause, then looks in the message and the error source and marks matches', () => {
    const s = stage({
      entries: [
        log(1, 'log', ['user saved']),
        error(2, { source: 'angular', message: 'TypeError: x' }),
        log(3, 'warn', ['Angular is running']),
        error(4, { source: 'window', message: 'boom' }),
      ],
    });
    search(s, 'ANGULAR');
    expect(messages(s))
      .withContext('not before the pause')
      .toEqual(['user saved', 'TypeError: x', 'Angular is running', 'boom']);
    s.runTimers();
    expect(messages(s)).toEqual(['TypeError: x', 'Angular is running']);
    expect(s.cells(2)[0]?.querySelector('mark.dcp-match')?.textContent).toBe('angular');
    expect(s.cells(3)[1]?.querySelector('mark.dcp-match')?.textContent).toBe('Angular');

    search(s, 'boom');
    s.runTimers();
    expect(messages(s)).toEqual(['boom']);
    expect(s.cells(3)[0]?.querySelector('mark.dcp-match')?.textContent).toBe('boom');
    expect(s.store.getState().filters.console.text).toBe('boom');
  });

  it('S07-04, FR-CON-04: level toggles - OR between levels, AND with the search; errors count as Errors; All resets', () => {
    const s = stage({
      entries: [
        log(1, 'error', ['a']),
        log(2, 'warn', ['b']),
        log(3, 'info', ['c']),
        log(4, 'log', ['d']),
        log(5, 'debug', ['e']),
        error(6, { message: 'f' }),
      ],
    });
    expect(chips(s).map((b) => b.textContent)).toEqual(['All', 'Errors', 'Warnings', 'Info', 'Log', 'Debug', 'App']);
    expect(chip(s, 'All')?.getAttribute('aria-pressed')).toBe('true');

    s.click(chip(s, 'Errors'));
    expect(messages(s)).toEqual(['a', 'f']);
    s.click(chip(s, 'Debug'));
    expect(messages(s)).toEqual(['a', 'e', 'f']);
    search(s, 'f');
    s.runTimers();
    expect(messages(s)).toEqual(['f']);
    search(s, '');
    s.runTimers();
    s.click(chip(s, 'All'));
    s.click(chip(s, 'Warnings'));
    s.click(chip(s, 'Info'));
    s.click(chip(s, 'Log'));
    expect(messages(s)).toEqual(['b', 'c', 'd']);
    expect(s.store.getState().filters.console).toEqual({ text: '', levels: ['warn', 'info', 'log'] });
  });

  it('S09-05: a restored filter that excludes every message shows no-match on the first paint', () => {
    const s = stage({ skipInitialUpdate: true, entries: [log(1, 'log', ['hello'])], filters: { levels: ['error'] } });
    expect(shownEmpty(s)).toEqual(['No entries match the filter.Clear filters']);
    expect(s.q('.dcp-vlist').hidden).toBeTrue();
  });

  it('S07-06, FR-COM-04: "No console messages yet."; no match shows the message and Clear filters, which resets both', () => {
    const s = stage();
    expect(shownEmpty(s)).toEqual(['No console messages yet.']);

    s.apply({ type: 'entry', entry: log(1) });
    expect(shownEmpty(s)).toEqual([]);
    expect(s.q('.dcp-vlist').hidden).toBeFalse();

    s.click(chip(s, 'Errors'));
    search(s, 'message');
    s.runTimers();
    expect(shownEmpty(s)).toEqual(['No entries match the filter.Clear filters']);
    expect(s.q('.dcp-vlist').hidden).toBeTrue();

    s.click(s.all('.dcp-empty button').find((b) => b.textContent === 'Clear filters') ?? null);
    expect(s.store.getState().filters.console).toEqual(EMPTY_FILTERS.console);
    expect(s.q<HTMLInputElement>('.dcp-filter-bar input').value).toBe('');
    expect(chip(s, 'All')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip(s, 'Errors')?.getAttribute('aria-pressed')).toBe('false');
    expect(messages(s)).toEqual(['message 1']);
    expect(shownEmpty(s)).toEqual([]);
  });

  it('4.5, D-20: chips start from the stored filters and follow the store; focusFilter (Ctrl+F) focuses the search', () => {
    const s = stage({ entries: [log(1, 'log', ['a']), log(2, 'warn', ['b'])], filters: { levels: ['warn'] } });
    expect(chip(s, 'Warnings')?.getAttribute('aria-pressed')).toBe('true');
    expect(messages(s)).toEqual(['b']);

    s.store.setFilter('console', { levels: ['log'] });
    expect(chip(s, 'Log')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip(s, 'Warnings')?.getAttribute('aria-pressed')).toBe('false');
    expect(messages(s)).toEqual(['a']);

    s.view.focusFilter();
    expect(s.root.activeElement).toBe(s.q('.dcp-filter-bar input'));
    expect(s.q('.dcp-filter-bar input').getAttribute('aria-label')).toBe('Filter console messages');
  });
});
