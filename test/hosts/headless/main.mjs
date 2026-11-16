/**
 * Headless test host (S-17a, HLD §3.15 `FR-HL-01…05`, `D-56`): starts debug
 * capture as HLD §6.6 shows for a host with no panel — the one import line is
 * `debug-capture/activate-headless`. test/hosts/build.mjs bundles it with
 * esbuild and writes the metafile next to it, so the e2e can prove the
 * output holds no panel code.
 */
import { installDebugActivation } from 'debug-capture/activate-headless';

const debug = installDebugActivation();
// For the e2e tests only.
window.__debug = debug;
debug.ready.then(() => {
  window.__hostReady = true;
});
