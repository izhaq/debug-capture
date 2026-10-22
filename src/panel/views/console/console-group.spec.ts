import { cleanup, error, log, stage } from './fakes.spec';

/** S-07 Console view - repeated messages (S07-05, FR-CON-05 COULD). */
describe('S-07 Console view: repeated messages', () => {
  afterEach(cleanup);

  const counts = (s: ReturnType<typeof stage>): (string | null)[] =>
    s.cells(3).map((c) => c.querySelector('.dcp-console-count')?.textContent ?? null);

  it('S07-05, FR-CON-05: identical messages in a row are one row with a count; a different one ends the run', () => {
    const s = stage({
      entries: [
        log(1, 'log', ['tick']),
        log(2, 'log', ['tick']),
        log(3, 'log', ['tick']),
        log(4, 'warn', ['tick']),
        log(5, 'log', ['tock']),
        log(6, 'log', ['tick']),
      ],
    });
    expect(s.rows().map((r) => r[0])).toEqual(['log', 'warn', 'log', 'log']);
    expect(counts(s)).toEqual(['3\u00d7', null, null, null]);
    expect(s.q('.dcp-console-count').getAttribute('title')).toBe('Repeated 3 times');
    expect(s.cells(3)[0]?.textContent).toBe('3\u00d7tick');
  });

  it('S07-05: errors group only with the same source, stack and message; arguments compare as JSON', () => {
    const s = stage({
      entries: [
        error(1, { message: 'boom', stack: 's1' }),
        error(2, { message: 'boom', stack: 's1' }),
        error(3, { message: 'boom', stack: 's2' }),
        error(4, { message: 'boom', stack: 's2', source: 'angular' }),
        log(5, 'log', [{ a: 1 }]),
        log(6, 'log', [{ a: 1 }]),
      ],
    });
    expect(counts(s)).toEqual(['2\u00d7', null, null, '2\u00d7']);
    expect(s.cells(2).map((c) => c.textContent)).toEqual(['window', 'window', 'angular', '']);
  });

  it('S07-05: a new identical message raises the count in place; the row keeps its selection and the detail its entry', () => {
    const entries = [log(1, 'log', ['tick']), log(2, 'log', ['tick'])];
    const s = stage({ entries });
    s.click(s.rowEl(0));
    expect(s.store.getState().selection.console?.row).withContext('the first of the run').toBe(entries[0]);

    s.apply({ type: 'entry', entry: log(3, 'log', ['tick']) });
    expect(s.rowEls().length).toBe(1);
    expect(counts(s)).toEqual(['3\u00d7']);
    expect(s.rowEl(0).getAttribute('aria-selected')).toBe('true');
    expect(s.store.getState().selection.console?.row).toBe(entries[0]);

    s.apply({ type: 'entry', entry: log(4, 'log', ['tock']) });
    s.key(s.q('.dcp-vlist'), 'ArrowDown');
    expect(s.q('.dcp-console-detail .dcp-console-pre').textContent).toBe('tock');
    expect(s.reported).toEqual([]);
  });

  it('S07-05: grouping follows the filter - rows hidden between two identical messages let them join', () => {
    const s = stage({ entries: [log(1, 'log', ['tick']), log(2, 'warn', ['other']), log(3, 'log', ['tick'])] });
    expect(counts(s)).toEqual([null, null, null]);
    s.store.setFilter('console', { levels: ['log'] });
    expect(s.rowEls().length).toBe(1);
    expect(counts(s)).toEqual(['2\u00d7']);
  });
});
