/**
 * P5 panel loader — entry point `debug-capture/panel` (L6, a sibling of the
 * Angular and React seams). May import the L5 barrel ('..') and P4 ('./app')
 * only by `import type` and the one dynamic `import()` below, so the UI chunk
 * stays lazy; never `export *` from P4. No packages. Kept tiny (≤ 5.5 kB,
 * NFR-SIZE-01).
 */
import { isProblemEntry } from '..';
import type { DebugPanelHandle, DebugPanelOptions, InstallDebugPanel } from './api';
import { createDebugPanel, inertHandle } from './loader';

export type { DebugPanelHandle, DebugPanelOptions, DebugPanelStatus, InstallDebugPanel } from './api';
export { PANEL_ELEMENT_NAME } from './api';

/**
 * `installDebugPanel(controller, options)` (HLD §6.6): the launcher, the
 * toggle shortcut and the badge now; the UI chunk on first open. `null`
 * (capture not requested) returns an inert handle and touches nothing. Never
 * throws: a host page that cannot hold the panel gets the inert handle.
 */
export const installDebugPanel: InstallDebugPanel = (controller, options?: DebugPanelOptions): DebugPanelHandle =>
  controller === null || typeof window === 'undefined'
    ? inertHandle()
    : createDebugPanel(controller, options, {
        scope: window,
        isProblemEntry,
        // The one dynamic import(): the UI chunk loads on first open only (FR-ACT-02, D-10).
        loadUi: () => import('./app'),
      });
