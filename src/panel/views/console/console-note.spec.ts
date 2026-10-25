import { NoteEntry } from '../../ui';
import { cleanup, log, stage } from './fakes.spec';

/** S-11b: notes in the Console view (S11-15, FR-NOTE-02). */
describe('S-11 Console view: notes', () => {
  afterEach(cleanup);

  const note = (seq: number, title: string, text: string): NoteEntry =>
    Object.freeze({ kind: 'note', seq, t: 1_000 + seq, title, text });

  it('a note row has the icon and the word note, and the title — text as its message', () => {
    const s = stage({ entries: [log(1), note(2, 'Login', 'clicked Sign in')] });
    const row = s.rowEl(1);
    const level = row.querySelector('.dcp-console-level') as HTMLElement;
    expect(level.textContent).toBe('note');
    expect(level.querySelector('svg')).not.toBeNull();
    expect(row.textContent).toContain('Login — clicked Sign in');
    expect(row.className).not.toMatch(/dcp-row--(error|warn)/);
  });

  it('the detail shows the title and the whole text', () => {
    const s = stage({ entries: [note(1, 'Login', 'line one\nline two')] });
    s.click(s.rowEl(0));
    const pres = s.all('.dcp-console-detail .dcp-console-pre').map((p) => p.textContent);
    expect(pres).toEqual(['Login', 'line one\nline two']);
    expect(s.q('.dcp-console-detail .dcp-console-info').textContent).toContain('note');
  });

  it('a note without text shows only its title', () => {
    const s = stage({ entries: [note(1, 'Only a title', '')] });
    s.click(s.rowEl(0));
    expect(s.all('.dcp-console-detail .dcp-console-pre').map((p) => p.textContent)).toEqual(['Only a title']);
  });
});
