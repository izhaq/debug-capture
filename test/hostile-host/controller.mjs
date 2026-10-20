/**
 * The real capture controller (S-01 `createCaptureController`), started the
 * way an app starts it (HLD §6.6), for the hostile host and the zone page
 * (S08-17). `*_KEYS` list the contract members; the e2e tests assert the
 * controller has them all.
 */
import { createCaptureController, systemClock } from '/dist/index.mjs';

export const CONTROLLER_KEYS = ['session', 'on', 'start', 'stop', 'onChange'];
export const SESSION_KEYS = ['recorder', 'policy', 'clock', 'active', 'toJson', 'download', 'copy', 'clear', 'dispose'];
export const RECORDER_KEYS = ['record', 'snapshot', 'clear', 'stats', 'onEntry', 'onChange', 'pending', 'onPending'];

export function createController() {
  const controller = createCaptureController();
  controller.start();
  return controller;
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
