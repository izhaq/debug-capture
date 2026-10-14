import { truncate, truncateThen } from './truncate';

describe('truncate', () => {
  it('leaves short text unchanged', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abc', 10)).toBe('abc');
    expect(truncate('', 0)).toBe('');
  });

  it('truncates and reports the removed count', () => {
    expect(truncate('abcdefghij', 4)).toBe('abcd…[truncated 6 chars]');
    expect(truncate('abc', 0)).toBe('…[truncated 3 chars]');
  });
  it('truncateThen transforms only the kept part, then adds the marker', () => {
    const upper = (kept: string): string => kept.toUpperCase();

    expect(truncateThen('abc', 3, upper)).toBe('ABC');
    expect(truncateThen('abcdefghij', 4, upper)).toBe('ABCD…[truncated 6 chars]');
  });
});
