import { systemClock } from './clock';

describe('systemClock', () => {
  it('systemClock returns epoch milliseconds', () => {
    const before = new Date().getTime();
    const now = systemClock.now();
    const after = new Date().getTime();

    expect(Number.isInteger(now)).toBeTrue();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
