/**
 * L6 activate — entry point `debug-capture/activate` (2.2, HLD §6.1, `D-40`):
 * the only piece a station loads before the tool is switched on. It may
 * import the L5 barrel ('..') and the panel entry ('../panel') only by
 * `import type` and the dynamic `import()` below, so neither loads before
 * switch-on (`npm run lint:layers`, rule 9).
 */
import { ActivationScope, createActivation, DebugActivationHandle, DebugActivationOptions } from './activate';

export type { DebugActivationHandle, DebugActivationOptions } from './activate';
export { DEBUG_STORAGE_KEY } from './activate';

/**
 * `installDebugActivation(options)` (HLD §6.6): binds the activation chord
 * (`Ctrl+Alt+Shift+A`) and reads the flags (`?debug=1`, the stored
 * `debug-capture` = `1`). Switched on, it loads the core and the panel loader
 * and starts capture with the panel closed. Never throws.
 */
export function installDebugActivation(options?: DebugActivationOptions): DebugActivationHandle {
  return createActivation(options, {
    scope: globalThis as unknown as ActivationScope,
    load: () =>
      Promise.all([import('..'), import('../panel')]).then(([core, panel]) => ({
        createCaptureController: core.createCaptureController,
        installDebugPanel: panel.installDebugPanel,
      })),
  });
}
