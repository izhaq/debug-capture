/**
 * L6 activate — entry point `debug-capture/activate-headless` (2.5, HLD §6.1, `D-56`):
 * the activation piece with no panel. It imports the L5 barrel ('..') only by
 * `import type` and the dynamic `import()` below, and the panel not at all —
 * not even a type — so a host that imports this entry bundles no panel code
 * (`FR-HL-02`; `npm run lint:layers` rule 9b, and the `npm run build` check).
 */
import {
  ActivationScope,
  createHeadlessActivation,
  DebugActivationHandle,
  DebugHeadlessActivationOptions,
} from './activate';

export type { DebugActivationHandle, DebugHeadlessActivationOptions } from './activate';
export { DEBUG_STORAGE_KEY } from './activate';

/**
 * `installDebugActivation(options)` (HLD §6.6), headless: the same chord and
 * flags as `debug-capture/activate`. Switched on, it loads the core only and
 * starts capture; `handle.panel` stays `null`. Never throws.
 */
export function installDebugActivation(options?: DebugHeadlessActivationOptions): DebugActivationHandle {
  return createHeadlessActivation(options, {
    scope: globalThis as unknown as ActivationScope,
    load: () => import('..').then((core) => ({ createCaptureController: core.createCaptureController })),
  });
}
