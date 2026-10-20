import type { Schedule } from '../views';
import type { Run } from './zone';

/** The window parts the scheduler uses: the panel's window, or a fake in specs (AGENTS rule 8). */
export interface FrameScope {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

/** The frame's clock work: one animation frame at a time, and timers, all in the root zone. */
export interface Scheduler {
  /** Asks for the frame's own work (`onFrame`) in the next frame. Many calls, one frame. */
  invalidate(): void;
  /** `ViewDeps.requestFrame`: runs `callback` once in the next frame, after the frame's own work. */
  requestFrame(callback: () => void): void;
  /** `ViewDeps.schedule`: a timer that returns its cancel function. */
  readonly schedule: Schedule;
  /** Cancels the pending frame and every timer; later calls do nothing. */
  destroy(): void;
}

/**
 * One `requestAnimationFrame` at a time for everything the panel draws
 * (HLD §6.3, ISO-09, ISO-10): the data flush and the views' own frame work
 * share it. Everything is scheduled inside `run` (the root zone), because a
 * request can start from the host's code — a probe's entry, inside Angular's
 * zone. Every callback runs in `try/catch`; failures go to `report` (ISO-12).
 */
export function createScheduler(
  scope: FrameScope,
  run: Run,
  onFrame: () => void,
  report: (error: unknown) => void,
): Scheduler {
  let frame: number | null = null;
  let dirty = false;
  let callbacks: Array<() => void> = [];
  const timers = new Set<number>();
  let dead = false;

  const safely = (work: () => void): void => {
    try {
      work();
    } catch (error) {
      report(error);
    }
  };

  const tick = (): void => {
    frame = null;
    if (dead) return;
    // Work asked for during this frame waits for the next one.
    const due = callbacks;
    callbacks = [];
    if (dirty) {
      dirty = false;
      safely(onFrame);
    }
    for (const callback of due) safely(callback);
  };

  const request = (): void => {
    if (frame === null && !dead) frame = run(() => scope.requestAnimationFrame(tick));
  };

  const schedule: Schedule = (task, delayMs) => {
    if (dead) return () => undefined;
    let handle = 0;
    const fire = (): void => {
      timers.delete(handle);
      if (!dead) safely(task);
    };
    handle = run(() => scope.setTimeout(fire, delayMs));
    timers.add(handle);
    return () => {
      if (timers.delete(handle)) scope.clearTimeout(handle);
    };
  };

  return {
    invalidate(): void {
      dirty = true;
      request();
    },
    requestFrame(callback): void {
      if (dead) return;
      callbacks.push(callback);
      request();
    },
    schedule,
    destroy(): void {
      if (dead) return;
      dead = true;
      if (frame !== null) scope.cancelAnimationFrame(frame);
      frame = null;
      callbacks = [];
      timers.forEach((handle) => scope.clearTimeout(handle));
      timers.clear();
    },
  };
}
