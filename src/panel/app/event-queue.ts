import type { PanelDataEvent, PanelStore } from '../views';

/** Work per frame for applying data (NFR-PERF-03, ISO-10, HLD §4.4). */
export const FRAME_BUDGET_MS = 8;

const FIRST_BATCH = 1024;
const MIN_BATCH = 64;
const MAX_BATCH = 16384;

/** The source's events, waiting for the next frame. */
export interface EventQueue {
  push(event: PanelDataEvent): void;
  /** Events still waiting. */
  readonly length: number;
  /**
   * One `store.apply` with the oldest events, as many as the budget allows.
   * Returns `true` when some are left for the next frame.
   */
  flush(): boolean;
}

/**
 * Applies at most one batch per frame and sizes the batches to the budget:
 * a batch that took longer than `budgetMs` halves the next one, a full batch
 * that took under half of it doubles the next one. Under a flood the view
 * lags a little instead of the page stuttering (§4.4). The time is measured
 * with `now` (a monotonic clock in the page, a fake in specs).
 */
export function createEventQueue(
  store: Pick<PanelStore, 'apply'>,
  now: () => number,
  budgetMs: number = FRAME_BUDGET_MS,
): EventQueue {
  let queue: PanelDataEvent[] = [];
  let head = 0;
  let limit = FIRST_BATCH;

  return {
    push(event): void {
      queue.push(event);
    },
    get length(): number {
      return queue.length - head;
    },
    flush(): boolean {
      const waiting = queue.length - head;
      if (waiting === 0) return false;
      const end = head + Math.min(waiting, limit);
      const batch = queue.slice(head, end);
      head = end;
      // Drop the applied prefix now and then, so the array never only grows.
      if (head === queue.length) {
        queue = [];
        head = 0;
      } else if (head >= MAX_BATCH && head * 2 >= queue.length) {
        queue = queue.slice(head);
        head = 0;
      }
      const start = now();
      try {
        store.apply(batch);
      } finally {
        const spent = now() - start;
        if (spent > budgetMs) limit = Math.max(MIN_BATCH, Math.floor(limit / 2));
        else if (spent * 2 < budgetMs && batch.length === limit) limit = Math.min(MAX_BATCH, limit * 2);
      }
      return queue.length - head > 0;
    },
  };
}
