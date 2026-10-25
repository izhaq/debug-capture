import { RingBuffer } from './ring-buffer';

describe('RingBuffer', () => {
  it('rejects a capacity below 1 or non-integer', () => {
    expect(() => new RingBuffer<number>(0)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(-3)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(1.5)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(Number.NaN)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(Number.NEGATIVE_INFINITY)).toThrowError(RangeError);
    expect(new RingBuffer<number>(1).capacity).toBe(1);
  });

  it('C-9: Infinity is a buffer that never evicts (No limit, FR-BUF-03)', () => {
    const buffer = new RingBuffer<number>(Number.POSITIVE_INFINITY);
    for (let i = 0; i < 10_000; i++) expect(buffer.push(i)).toBeUndefined();
    expect(buffer.size).toBe(10_000);
    expect(buffer.capacity).toBe(Number.POSITIVE_INFINITY);
    const all = buffer.toArray();
    expect(all[0]).toBe(0);
    expect(all[9_999]).toBe(9_999);
  });

  it('C-9: setCapacity shrinks in place, returning the oldest items that left, in order', () => {
    const buffer = new RingBuffer<number>(5);
    for (let i = 1; i <= 7; i++) buffer.push(i);
    expect(buffer.setCapacity(2)).toEqual([3, 4, 5]);
    expect(buffer.capacity).toBe(2);
    expect(buffer.toArray()).toEqual([6, 7]);
    expect(buffer.push(8)).toBe(6);
    expect(buffer.toArray()).toEqual([7, 8]);
  });

  it('C-9: setCapacity grows without losing anything, then evicts at the new size', () => {
    const buffer = new RingBuffer<number>(2);
    for (let i = 1; i <= 3; i++) buffer.push(i);
    expect(buffer.setCapacity(4)).toEqual([]);
    expect(buffer.toArray()).toEqual([2, 3]);
    buffer.push(4);
    buffer.push(5);
    expect(buffer.push(6)).toBe(2);
    expect(buffer.toArray()).toEqual([3, 4, 5, 6]);
    expect(buffer.setCapacity(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(buffer.push(7)).toBeUndefined();
  });

  it('C-9: setCapacity rejects what the constructor rejects', () => {
    const buffer = new RingBuffer<number>(2);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => buffer.setCapacity(bad)).toThrowError(RangeError);
    }
    expect(buffer.capacity).toBe(2);
  });

  it('keeps order across many evictions (the dead prefix is cut off now and then)', () => {
    const buffer = new RingBuffer<number>(3);
    const wrong: number[] = [];
    for (let i = 1; i <= 5_000; i++) {
      buffer.push(i);
      const kept = buffer.toArray();
      if (i >= 3 && (kept.length !== 3 || kept[0] !== i - 2 || kept[2] !== i)) wrong.push(i);
    }
    expect(wrong).toEqual([]);
    expect(buffer.size).toBe(3);
  });

  it('keeps insertion order below capacity', () => {
    const buffer = new RingBuffer<string>(3);

    expect(buffer.push('a')).toBeUndefined();
    expect(buffer.push('b')).toBeUndefined();

    expect(buffer.size).toBe(2);
    expect(buffer.toArray()).toEqual(['a', 'b']);
  });

  it('evicts the oldest and returns it once full', () => {
    const buffer = new RingBuffer<string>(2);
    buffer.push('a');
    buffer.push('b');

    expect(buffer.push('c')).toBe('a');
    expect(buffer.push('d')).toBe('b');
    expect(buffer.size).toBe(2);
    expect(buffer.toArray()).toEqual(['c', 'd']);
  });

  it('toArray returns oldest first after wrapping', () => {
    const buffer = new RingBuffer<number>(3);
    for (let i = 1; i <= 7; i++) {
      buffer.push(i);
    }

    const first = buffer.toArray();
    expect(first).toEqual([5, 6, 7]);

    // A new array each call: the caller may mutate it without touching the buffer.
    (first as number[]).push(99);
    expect(buffer.toArray()).toEqual([5, 6, 7]);
    expect(buffer.toArray()).not.toBe(buffer.toArray());
  });

  it('clear empties it and keeps the capacity', () => {
    const buffer = new RingBuffer<number>(2);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.toArray()).toEqual([]);
    expect(buffer.capacity).toBe(2);
    expect(buffer.push(4)).toBeUndefined();
    expect(buffer.push(5)).toBeUndefined();
    expect(buffer.push(6)).toBe(4);
    expect(buffer.toArray()).toEqual([5, 6]);
  });
});
