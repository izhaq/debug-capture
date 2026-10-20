import { createEventQueue, FRAME_BUDGET_MS } from './event-queue';
import { logEntry, ManualScope } from './fakes.spec';
import type { PanelDataEvent } from './index';
import { createScheduler } from './scheduler';

describe('S-08 scheduler (one frame, root zone)', () => {
  it('many invalidations, one animation frame and one onFrame; view callbacks run after it', () => {
    const scope = new ManualScope();
    const order: string[] = [];
    const scheduler = createScheduler(
      scope,
      (work) => work(),
      () => order.push('frame'),
      fail,
    );
    scheduler.invalidate();
    scheduler.requestFrame(() => order.push('view'));
    scheduler.invalidate();

    expect(scope.frames.size).toBe(1);
    scope.frame();
    expect(order).toEqual(['frame', 'view']);
    expect(scope.frame()).toBe(0);
  });

  it('work asked for during a frame waits for the next frame', () => {
    const scope = new ManualScope();
    const order: string[] = [];
    const scheduler = createScheduler(
      scope,
      (work) => work(),
      () => order.push('frame'),
      fail,
    );
    scheduler.requestFrame(() => {
      order.push('a');
      scheduler.requestFrame(() => order.push('b'));
      scheduler.invalidate();
    });
    scope.frame();
    expect(order).toEqual(['a']);
    scope.frame();
    expect(order).toEqual(['a', 'frame', 'b']);
  });

  it('ISO-09: frames and timers are requested inside run', () => {
    const scope = new ManualScope();
    let inside = false;
    const seen: boolean[] = [];
    spyOn(scope, 'requestAnimationFrame').and.callFake(() => (seen.push(inside), 1));
    spyOn(scope, 'setTimeout').and.callFake(() => (seen.push(inside), 2));
    const run = <T>(work: () => T): T => {
      inside = true;
      try {
        return work();
      } finally {
        inside = false;
      }
    };
    const scheduler = createScheduler(scope, run, () => undefined, fail);
    scheduler.invalidate();
    scheduler.schedule(() => undefined, 10);
    expect(seen).toEqual([true, true]);
  });

  it('S08-16: a throwing callback is reported, never thrown, and the others still run', () => {
    const scope = new ManualScope();
    const report = jasmine.createSpy('report');
    const ran: string[] = [];
    const scheduler = createScheduler(
      scope,
      (work) => work(),
      () => {
        throw new Error('frame');
      },
      report,
    );
    scheduler.invalidate();
    scheduler.requestFrame(() => {
      throw new Error('view');
    });
    scheduler.requestFrame(() => ran.push('next'));
    scheduler.schedule(() => {
      throw new Error('timer');
    }, 5);

    expect(() => scope.frame()).not.toThrow();
    expect(() => scope.tick()).not.toThrow();
    expect(ran).toEqual(['next']);
    expect(report.calls.allArgs().map(([e]) => (e as Error).message)).toEqual(['frame', 'view', 'timer']);
  });

  it('schedule returns a cancel; destroy cancels the frame and every timer, and later calls do nothing', () => {
    const scope = new ManualScope();
    const ran: string[] = [];
    const scheduler = createScheduler(
      scope,
      (work) => work(),
      () => ran.push('frame'),
      fail,
    );
    const cancel = scheduler.schedule(() => ran.push('cancelled'), 5);
    scheduler.schedule(() => ran.push('kept'), 5);
    cancel();
    scheduler.invalidate();
    scheduler.schedule(() => ran.push('dropped'), 5);
    scheduler.destroy();
    scheduler.invalidate();
    scheduler.requestFrame(() => ran.push('late'));

    expect(scope.frames.size).toBe(0);
    expect(scope.timers.size).toBe(0);
    expect(scheduler.schedule(() => ran.push('after'), 5)).toEqual(jasmine.any(Function));
    scope.frame();
    scope.tick();
    expect(ran).toEqual([]);
  });
});

describe('S-08 event queue (≤ 1 apply per frame, 8 ms budget)', () => {
  const events = (n: number, from = 1): PanelDataEvent[] =>
    Array.from({ length: n }, (_, i) => ({ type: 'entry', entry: logEntry(from + i) }));

  it('applies everything waiting in one batch when it fits, oldest first', () => {
    const batches: PanelDataEvent[][] = [];
    const queue = createEventQueue({ apply: (b) => batches.push(b.slice()) }, () => 0);
    events(3).forEach((e) => queue.push(e));

    expect(queue.flush()).toBeFalse();
    expect(batches.length).toBe(1);
    expect(batches[0]?.map((e) => (e.type === 'entry' ? e.entry.seq : 0))).toEqual([1, 2, 3]);
    expect(queue.flush()).toBeFalse();
    expect(batches.length).toBe(1);
  });

  it('S08-16: one bad event loses only itself; the rest of its batch is applied and the error is thrown once', () => {
    const applied: number[] = [];
    const queue = createEventQueue(
      {
        apply: (batch) => {
          if (batch.some((e) => e.type === 'entry' && e.entry.seq === 2)) throw new Error('bad event');
          batch.forEach((e) => e.type === 'entry' && applied.push(e.entry.seq));
        },
      },
      () => 0,
    );
    events(4).forEach((e) => queue.push(e));
    expect(() => queue.flush()).toThrowError('bad event');
    expect(applied).toEqual([1, 3, 4]);
  });

  it('a flush asked for inside apply waits, so newer events never jump ahead', () => {
    const seqs: number[] = [];
    let queue: ReturnType<typeof createEventQueue> | null = null;
    queue = createEventQueue(
      {
        apply: (batch) => {
          // The first apply emits a newer event and asks for a flush before it records its own batch.
          if (seqs.length === 0) {
            events(1, 9).forEach((e) => queue?.push(e));
            expect(queue?.flush()).toBeTrue();
          }
          batch.forEach((e) => e.type === 'entry' && seqs.push(e.entry.seq));
        },
      },
      () => 0,
    );
    events(2).forEach((e) => queue?.push(e));
    queue.flush();
    queue.flush();
    expect(seqs).toEqual([1, 2, 9]);
  });

  it('NFR-PERF-03: a slow batch halves the next one; the rest waits; order is kept across frames', () => {
    // 0.01 ms per event: 1024 events cost 10.24 ms (over 8), 512 cost 5.12 ms (fits, over half).
    let clock = 0;
    const sizes: number[] = [];
    const seqs: number[] = [];
    const queue = createEventQueue(
      {
        apply: (batch) => {
          sizes.push(batch.length);
          batch.forEach((e) => e.type === 'entry' && seqs.push(e.entry.seq));
          clock += batch.length * 0.01;
        },
      },
      () => clock,
    );
    events(3000).forEach((e) => queue.push(e));

    expect(queue.flush()).toBeTrue();
    expect(queue.flush()).toBeTrue();
    expect(queue.flush()).toBeTrue();
    expect(sizes).toEqual([1024, 512, 512]);
    expect(queue.length).toBe(3000 - 2048);
    while (queue.flush());
    expect(seqs).toEqual(Array.from({ length: 3000 }, (_, i) => i + 1));
    expect(FRAME_BUDGET_MS).toBe(8);
  });

  it('cheap full batches grow the next one, up to a cap', () => {
    const sizes: number[] = [];
    const queue = createEventQueue({ apply: (batch) => sizes.push(batch.length) }, () => 0);
    events(1024 + 2048 + 4096 + 100).forEach((e) => queue.push(e));
    while (queue.flush());
    expect(sizes).toEqual([1024, 2048, 4096, 100]);
  });
});

function fail(error: unknown): void {
  throw error;
}
