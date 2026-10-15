import { CaptureEntry } from '../..';
import { fakeSource, httpEntry, problemRule } from './fakes.spec';
import { PanelDataEvent } from './panel-data-source';
import { selectHttpRows } from './selectors';
import { createPanelStore } from './store';

/**
 * NFR-PERF-03 (S03-14): one frame's model work — `apply` a batch of 1,000
 * events and recompute the visible HTTP list with a text filter over the
 * 5,000 entries now in the buffer, haystacks cold (the worst case: nothing
 * filtered before).
 *
 * LIMIT_MS = 150, measured in headless Chromium 141 with coverage on, on a
 * 4-CPU box at load average ~12 (other agents' browsers): this code 3.9–30.8 ms
 * per round over 3 runs × 5 rounds (typical 5–20 ms) — the worst is ~5× under
 * the limit. The regression it guards against, re-filtering the list once
 * per event instead of once per batch, measured 854–1,353 ms — ~6× over it.
 * (A whole 1,000-event batch is more than one frame holds; S-08 slices
 * batches to the 8 ms frame budget.)
 */
const LIMIT_MS = 150;
const ROUNDS = 5;

describe('panel model performance (S03-14)', () => {
  it(`apply(1,000) + text-filtered HTTP list over 5,000 entries stays under ${LIMIT_MS} ms`, () => {
    const timings: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const snapshot: CaptureEntry[] = [];
      for (let seq = 1; seq <= 4_000; seq++) snapshot.push(sample(seq));
      const batch: PanelDataEvent[] = [];
      for (let seq = 4_001; seq <= 5_000; seq++) batch.push({ type: 'entry', entry: sample(seq) });
      const store = createPanelStore({
        source: fakeSource({ entries: snapshot, capacity: 5_000 }),
        isProblemEntry: problemRule,
      });
      store.setFilter('http', { text: 'ORDERS/12' });

      const start = performance.now();
      store.apply(batch);
      const rows = selectHttpRows(store.getState());
      timings.push(performance.now() - start);

      // orders/12 and orders/120…129: 11 in every 1,000 entries.
      expect(rows.length).toBe(55);
    }
    const worst = Math.max(...timings);
    // Reported so the numbers in the comment above can be checked on any machine.
    expect(worst)
      .withContext(`timings ms: ${timings.map((t) => t.toFixed(2)).join(', ')}`)
      .toBeLessThan(LIMIT_MS);
  });
});

function sample(seq: number): CaptureEntry {
  return httpEntry(seq, {
    url: `https://app.test/api/orders/${seq % 1_000}?page=${seq}`,
    method: seq % 3 === 0 ? 'POST' : 'GET',
    status: seq % 17 === 0 ? 500 : 200,
    t: seq,
  });
}
