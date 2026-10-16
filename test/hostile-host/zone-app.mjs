/**
 * An Angular-like zone (research P1–P4, ISO-09): a child of the root zone that
 * records every task scheduled or run in it — what NgZone turns into change
 * detection. The panel is installed from inside it, as an Angular service
 * would; the test then drives the closed loader and the panel and expects
 * both lists to stay empty.
 */
import { installDebugPanel } from '/dist/panel.mjs';
import { createFakeController, recordEntry } from '/fake-controller.mjs';

const zone = { scheduled: [], invoked: [] };
const angular = window.Zone.root.fork({
  name: 'angular-like',
  onScheduleTask(delegate, _current, target, task) {
    zone.scheduled.push(`${task.type}:${task.source}`);
    return delegate.scheduleTask(target, task);
  },
  onInvokeTask(delegate, _current, target, task, applyThis, applyArgs) {
    zone.invoked.push(`${task.type}:${task.source}`);
    return delegate.invokeTask(target, task, applyThis, applyArgs);
  },
});
const controller = createFakeController();
const handle = angular.run(() => installDebugPanel(controller));
zone.run = (fn) => angular.run(fn);
zone.record = () => angular.run(() => recordEntry(controller, true));
zone.handle = handle;
zone.violations = [];
document.addEventListener('securitypolicyviolation', (e) => zone.violations.push(e.violatedDirective));
window.__zone = zone;
window.__ready = true;
