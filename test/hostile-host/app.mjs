/**
 * Installs the panel on the hostile host the way an app does (HLD §6.6).
 * Query switches: `?launcher=0`, `?foreign` (someone else owns our tag
 * first), `?nopanel` (host only, for baselines).
 */
import { installDebugPanel, PANEL_ELEMENT_NAME } from '/dist/panel.mjs';
import { CONTROLLER_KEYS, RECORDER_KEYS, SESSION_KEYS, createFakeController, recordEntry } from '/fake-controller.mjs';

const params = new URLSearchParams(location.search);
const controller = createFakeController();
const dc = {
  controller,
  handle: null,
  shape: { controller: CONTROLLER_KEYS, session: SESSION_KEYS, recorder: RECORDER_KEYS },
  record: (problem = true) => recordEntry(controller, problem),
  install: (options) => (dc.handle = installDebugPanel(controller, options)),
  /** Loads a second copy of the loader (a new module instance, as a second bundle would be). */
  async installSecondCopy() {
    const second = await import('/dist/panel.mjs?copy=2');
    return second.installDebugPanel(createFakeController());
  },
};
window.__dc = dc;

if (params.has('foreign')) customElements.define(PANEL_ELEMENT_NAME, class extends HTMLElement {});
if (!params.has('nopanel')) dc.install({ launcher: params.get('launcher') !== '0' });
window.__ready = true;
