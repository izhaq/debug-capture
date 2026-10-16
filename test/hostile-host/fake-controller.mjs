/**
 * A stand-in `CaptureController` (contract: src/contract/capture-contract.ts)
 * until S-01's `createCaptureController` is in the wave branch. The buffer is
 * a real core recorder; the v2 read side (`onChange`, `pending`,
 * `onPending`) is added here. `CONTROLLER_KEYS` lists every member the
 * contract has, and the e2e tests assert the fake has them all.
 */
import { createRecorder, resolvePolicy, systemClock } from '/dist/index.mjs';

export const CONTROLLER_KEYS = ['session', 'on', 'start', 'stop', 'onChange'];
export const SESSION_KEYS = ['recorder', 'policy', 'clock', 'active', 'toJson', 'download', 'copy', 'clear', 'dispose'];
export const RECORDER_KEYS = ['record', 'snapshot', 'clear', 'stats', 'onEntry', 'onChange', 'pending', 'onPending'];

export function createFakeController() {
  const policy = resolvePolicy();
  const base = createRecorder(policy);
  const changeListeners = new Set();
  const recorder = {
    record: (draft) => base.record(draft),
    snapshot: () => base.snapshot(),
    stats: () => base.stats(),
    onEntry: (listener) => base.onEntry(listener),
    clear() {
      base.clear();
      changeListeners.forEach((l) => l({ type: 'cleared' }));
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    pending: () => [],
    onPending: () => () => undefined,
  };
  let on = true;
  const session = {
    recorder,
    policy,
    clock: systemClock,
    get active() {
      return on;
    },
    toJson: () => JSON.stringify(base.snapshot()),
    download: () => undefined,
    copy: async () => false,
    clear: () => recorder.clear(),
    dispose: () => (on = false),
  };
  return {
    session,
    get on() {
      return on;
    },
    start: () => (on = true),
    stop: () => (on = false),
    onChange: () => () => undefined,
  };
}

/** Records a problem (an error entry) or an ordinary entry, as a probe would. */
export function recordEntry(controller, problem) {
  const t = systemClock.now();
  controller.session.recorder.record(
    problem
      ? { kind: 'error', t, source: 'window', message: 'boom', stack: null }
      : { kind: 'log', t, level: 'log', args: ['hello'] },
  );
}
