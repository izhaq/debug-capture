/**
 * Fixed-size circular buffer that keeps the newest `capacity` items.
 *
 * Push is O(1): a full buffer overwrites its oldest slot instead of
 * `shift()`-ing a growing array, which would be O(n) per push — too slow at
 * 5000 entries with a WebSocket streaming many frames per second.
 */
export class RingBuffer<T> {
  readonly capacity: number;

  private readonly slots: Array<T | undefined>;
  /** Index of the oldest item. */
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`RingBuffer capacity must be an integer >= 1, got ${capacity}`);
    }
    this.capacity = capacity;
    this.slots = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Appends `item`; once full, overwrites the oldest item and returns it. */
  push(item: T): T | undefined {
    if (this.count < this.capacity) {
      this.slots[(this.head + this.count) % this.capacity] = item;
      this.count++;
      return undefined;
    }
    const evicted = this.slots[this.head];
    this.slots[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    return evicted;
  }

  /** Oldest first, as a new array the caller may keep or mutate. */
  toArray(): T[] {
    const out = new Array<T>(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = this.slots[(this.head + i) % this.capacity] as T;
    }
    return out;
  }

  clear(): void {
    // Drop the references too, so cleared entries can be garbage-collected.
    this.slots.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
