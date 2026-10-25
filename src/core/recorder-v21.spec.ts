import { CaptureEntry, ENTRY_COST_BYTES, EntryDraft, NoteEntry, RecorderChange } from '../contract';
import { resolvePolicy } from './policy';
import { createRecorder } from './recorder';

/**
 * 2.1 (HLD C-9, C-10): a buffer whose size changes live, O(1) usage numbers,
 * and the `note` entry kind. The 2.0 behaviour stays covered by
 * `recorder.spec.ts` and `recorder-live.spec.ts`.
 */

const log = (text: string): EntryDraft => ({ kind: 'log', t: 1, level: 'log', args: [text] });
const problem = (message = 'boom'): EntryDraft => ({ kind: 'error', t: 1, source: 'window', message, stack: null });
const note = (title: string, text: string): EntryDraft => ({ kind: 'note', t: 1, title, text });

/** The C-9 estimate, worked by hand: 160 B + 2 B per character of every string and key. */
function weigh(value: unknown): number {
  if (typeof value === 'string') return value.length * 2;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + weigh(v), 0);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).reduce((n, k) => n + k.length * 2 + weigh((value as Record<string, unknown>)[k]), 0);
  }
  return 0;
}
const cost = (entry: CaptureEntry): number => ENTRY_COST_BYTES + weigh(entry);

function recorder(maxEntries = 5) {
  return createRecorder(resolvePolicy({ maxEntries }));
}

describe('recorder — 2.1 resizable buffer (C-9)', () => {
  it('setCapacity shrinks at once: the oldest leave, evicted counts them, one capacity change fires', () => {
    const r = recorder(5);
    const changes: RecorderChange[] = [];
    r.onChange((c) => changes.push(c));
    for (let i = 1; i <= 5; i++) r.record(log(`m${i}`));

    r.setCapacity(2);

    expect(r.snapshot().map((e) => e.seq)).toEqual([4, 5]);
    expect(r.stats().evicted).toBe(3);
    expect(r.usage().capacity).toBe(2);
    expect(r.usage().entries).toBe(2);
    expect(changes).toEqual([{ type: 'capacity' }]);
    r.record(log('m6'));
    expect(r.snapshot().map((e) => e.seq)).toEqual([5, 6]);
  });

  it('setCapacity grows: nothing leaves, seq keeps counting (C-2)', () => {
    const r = recorder(2);
    for (let i = 1; i <= 3; i++) r.record(log(`m${i}`));
    r.setCapacity(10);
    expect(r.snapshot().map((e) => e.seq)).toEqual([2, 3]);
    r.record(log('m4'));
    expect(r.snapshot().map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(r.stats().evicted).toBe(1);
  });

  it('Infinity is No limit: nothing is ever evicted (FR-BUF-03)', () => {
    const r = recorder(3);
    r.setCapacity(Number.POSITIVE_INFINITY);
    for (let i = 0; i < 50; i++) r.record(log('x'));
    expect(r.usage().entries).toBe(50);
    expect(r.usage().capacity).toBe(Number.POSITIVE_INFINITY);
    expect(r.stats().evicted).toBe(0);
  });

  it('ignores a bad or unchanged capacity, and never throws', () => {
    const r = recorder(5);
    const changes: RecorderChange[] = [];
    r.onChange((c) => changes.push(c));
    for (const bad of [0, -1, 2.5, Number.NaN, Number.NEGATIVE_INFINITY, '10' as unknown as number, 5]) {
      expect(() => r.setCapacity(bad)).not.toThrow();
    }
    expect(r.usage().capacity).toBe(5);
    expect(changes).toEqual([]);
  });
});

describe('recorder — 2.1 usage (C-9)', () => {
  it('starts empty, with the policy capacity', () => {
    expect(recorder(7).usage()).toEqual({ entries: 0, capacity: 7, bytes: 0, problems: 0 });
  });

  it('bytes is 160 B plus 2 B per character of every string and key, per stored entry', () => {
    const r = recorder(5);
    r.record(log('hello'));
    r.record(problem('kaput'));
    const [a, b] = r.snapshot() as [CaptureEntry, CaptureEntry];
    expect(r.usage().bytes).toBe(cost(a) + cost(b));
    expect(cost(a)).toBeGreaterThan(ENTRY_COST_BYTES + 10);
  });

  it('bytes and problems follow evictions, a shrink and clear', () => {
    const r = recorder(3);
    r.record(problem());
    r.record(log('a'));
    r.record(problem());
    expect(r.usage().problems).toBe(2);
    r.record(log('b')); // evicts the first problem
    expect(r.usage().problems).toBe(1);
    const sum = (): number => r.snapshot().reduce((n, e) => n + cost(e), 0);
    expect(r.usage().bytes).toBe(sum());

    r.setCapacity(1); // evicts the second problem too
    expect(r.usage()).toEqual({ entries: 1, capacity: 1, bytes: sum(), problems: 0 });

    r.record(problem());
    r.clear();
    expect(r.usage()).toEqual({ entries: 0, capacity: 1, bytes: 0, problems: 0 });
  });

  it('a fresh object each call', () => {
    const r = recorder();
    expect(r.usage()).not.toBe(r.usage());
  });
});

describe('recorder — 2.1 notes (C-10)', () => {
  it('stores a frozen note with title and text', () => {
    const r = recorder();
    r.record(note('Login', 'clicked Sign in'));
    const entry = r.snapshot()[0] as NoteEntry;
    expect(entry).toEqual({ kind: 'note', seq: 1, t: 1, title: 'Login', text: 'clicked Sign in' });
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('polices title and text like an error message: secrets redacted, long text truncated', () => {
    const r = createRecorder(resolvePolicy({ maxBodyLength: 40 }));
    r.record(note('see http://x/?token=abc', '{"password":"hunter2"}'));
    r.record(note('t', 'y'.repeat(100)));
    const [secret, long] = r.snapshot() as [NoteEntry, NoteEntry];
    expect(secret.title).not.toContain('abc');
    expect(secret.title).toContain('[redacted]');
    expect(secret.text).not.toContain('hunter2');
    expect(long.text.length).toBeLessThan(100);
    expect(long.text).toContain('truncated');
  });

  it('two notes with the same title are two entries (FR-NOTE-03)', () => {
    const r = recorder();
    r.record(note('Step', 'one'));
    r.record(note('Step', 'two'));
    expect(r.snapshot().map((e) => (e as NoteEntry).text)).toEqual(['one', 'two']);
  });

  it('a note is not a problem', () => {
    const r = recorder();
    r.record(note('error 500', 'boom'));
    expect(r.usage().problems).toBe(0);
  });
});
