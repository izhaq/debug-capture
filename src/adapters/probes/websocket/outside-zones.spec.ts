import { outsideZones } from './outside-zones';

describe('outsideZones (websocket)', () => {
  it('runs the work in the root zone when zone.js is present', () => {
    const run = jasmine.createSpy('run').and.callFake((work: () => unknown) => work());
    const root = { run };
    expect(outsideZones(() => 'done', { Zone: { root } })).toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.calls.mostRecent().object).toBe(root);
  });

  it('just runs the work without zone.js', () => {
    expect(outsideZones(() => 42, {})).toBe(42);
    expect(outsideZones(() => 43, { Zone: {} })).toBe(43);
  });

  it('uses the real root zone by default', () => {
    const zones = (globalThis as unknown as { Zone: { current: { name: string } } }).Zone;
    expect(outsideZones(() => zones.current.name)).toBe('<root>');
  });
});
