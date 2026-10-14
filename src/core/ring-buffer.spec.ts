import { RingBuffer } from './ring-buffer';

describe('RingBuffer', () => {
  it('rejects a capacity below 1 or non-integer', () => {
    expect(() => new RingBuffer<number>(0)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(-3)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(1.5)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(Number.NaN)).toThrowError(RangeError);
    expect(() => new RingBuffer<number>(Number.POSITIVE_INFINITY)).toThrowError(RangeError);
    expect(new RingBuffer<number>(1).capacity).toBe(1);
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
