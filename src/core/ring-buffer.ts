/**
 * A buffer that keeps the newest `capacity` items; `Infinity` keeps all
 * (No limit, HLD C-9). The capacity can change in place.
 *
 * Push is amortised O(1): eviction only moves `head`, and the dead prefix is
 * cut off once it is long and at least half the array — never a `shift()`
 * per push, which is O(n) and too slow at 5000 entries with a WebSocket
 * streaming many frames per second.
 */
export class RingBuffer<T> {
  /** `items[head…]`, oldest first. */
  private items: Array<T | undefined> = [];
  private head = 0;
  private max: number;

  constructor(capacity: number) {
    this.max = checked(capacity);
  }

  get capacity(): number {
    return this.max;
  }

  get size(): number {
    return this.items.length - this.head;
  }

  /** Appends `item`; once full, drops the oldest item and returns it. */
  push(item: T): T | undefined {
    this.items.push(item);
    return this.size > this.max ? this.dropOldest() : undefined;
  }

  /** A new size; returns the items that left (oldest first) when it shrinks. */
  setCapacity(capacity: number): T[] {
    this.max = checked(capacity);
    const left: T[] = [];
    while (this.size > this.max) left.push(this.dropOldest());
    return left;
  }

  /** Oldest first, as a new array the caller may keep or mutate. */
  toArray(): T[] {
    return this.items.slice(this.head) as T[];
  }

  clear(): void {
    // A new array drops the references too, so cleared entries can be garbage-collected.
    this.items = [];
    this.head = 0;
  }

  private dropOldest(): T {
    const old = this.items[this.head] as T;
    this.items[this.head++] = undefined;
    if (this.head >= 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return old;
  }
}

function checked(capacity: number): number {
  if (capacity !== Infinity && (!Number.isInteger(capacity) || capacity < 1)) {
    throw new RangeError(`RingBuffer capacity must be an integer >= 1 or Infinity, got ${capacity}`);
  }
  return capacity;
}
