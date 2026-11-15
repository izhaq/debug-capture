/**
 * Feature-flag test host (S-17a, HLD §3.15 `FR-HL-08…10`, `D-57`): the panel
 * ships as usual (`debug-capture/activate`), and a backend flag decides at
 * run time whether it may be installed. The "backend" here is `?panel=on`
 * read after a delay, as a real flag request would arrive after start-up.
 */
import { installDebugActivation } from 'debug-capture/activate';

const flag = new URLSearchParams(location.search).get('panel');
const debug = installDebugActivation({
  panel: () => new Promise((done) => setTimeout(() => done(flag === 'on' ? {} : false), 50)),
});
// For the e2e tests only.
window.__debug = debug;
debug.ready.then(() => {
  window.__hostReady = true;
});
