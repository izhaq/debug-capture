import { AppMessageEntry } from '../../ui';
import { cleanup, log, stage } from './fakes.spec';

/** S-14b: app messages in the Console view (S14-09, S14-10, FR-MSG-05). */
describe('S-14 Console view: app messages', () => {
  afterEach(cleanup);

  const app = (
    seq: number,
    level: AppMessageEntry['level'],
    type: string,
    data: AppMessageEntry['data'],
  ): AppMessageEntry => Object.freeze({ kind: 'app', seq, t: 1_000 + seq, type, level, data });

  it('a row has its level icon, the word app, and the type with a data preview', () => {
    const s = stage({ entries: [log(1), app(2, 'info', 'order-saved', { id: 42 })] });
    const row = s.rowEl(1);
    const level = row.querySelector('.dcp-console-level') as HTMLElement;
    expect(level.textContent).toBe('app');
    expect(level.querySelector('svg')).not.toBeNull();
    expect(row.textContent).toContain('order-saved {"id":42}');
    expect(row.className).not.toMatch(/dcp-row--(error|warn)/);
  });

  it('error and warn app messages are tinted like log rows', () => {
    const s = stage({ entries: [app(1, 'error', 'payment-failed', null), app(2, 'warn', 'slow', null)] });
    expect(s.rowEl(0).className).toMatch(/dcp-row--error/);
    expect(s.rowEl(1).className).toMatch(/dcp-row--warn/);
    expect(s.rowEl(0).textContent).toContain('payment-failed');
  });

  it('the detail shows the type, the level and the data as a JSON tree', () => {
    const s = stage({ entries: [app(1, 'warn', 'order-saved', { id: 42, items: [1, 2] })] });
    s.click(s.rowEl(0));
    const detail = s.q('.dcp-console-detail');
    expect(s.all('.dcp-console-detail .dcp-console-pre').map((p) => p.textContent)).toEqual(['order-saved']);
    expect(s.q('.dcp-console-detail .dcp-console-info').textContent).toContain('app');
    expect(detail.querySelector('[aria-label="Data"]')).not.toBeNull();
    expect(detail.textContent).toContain('items');
  });

  it('the level chip group has App', () => {
    const s = stage({ entries: [log(1)] });
    const labels = s.all('.dcp-filter-bar [role="group"] button, .dcp-filter-bar .dcp-chip').map((b) => b.textContent);
    expect(labels).toContain('App');
  });
});
