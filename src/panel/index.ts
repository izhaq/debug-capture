/**
 * P5 panel loader — entry point `debug-capture/panel` (L6, a sibling of the
 * Angular and React seams). May import the L5 barrel ('..') and P4 ('./app')
 * only by `import type` and one dynamic `import()`, so the UI chunk stays
 * lazy; never `export *` from P4. No packages. Kept tiny (≤ 4 kB, NFR-SIZE-01).
 */
import type { CaptureController } from '..';

/** Options for `installDebugPanel()` (HLD §6.4). Every field is optional. */
export interface DebugPanelOptions {
  /** Show the launcher button. Default `true`. */
  readonly launcher?: boolean;
  /** Toggle chord, matched on `KeyboardEvent.code`. Default `'ctrl+alt+shift+p'`; `false` binds none. */
  readonly shortcut?: string | false;
  /** Default `'bottom'`. */
  readonly defaultDock?: 'bottom' | 'right';
  /** `localStorage` key for settings and filter chips. Default `'debug-capture:panel'`; `false` keeps nothing. */
  readonly storageKey?: string | false;
}

/** What `installDebugPanel()` returns (HLD §6.4). Inert when installed with `null`. */
export interface DebugPanelHandle {
  open(): void;
  /** Closes; focus returns to where it was (ISO-16). */
  close(): void;
  readonly isOpen: boolean;
  /** Closes (focus returns), unsubscribes, removes the launcher, the shortcut listener and the element. */
  dispose(): void;
}

/**
 * `installDebugPanel(controller, options)` — mounts the host element, the
 * launcher and the shortcut; loads the UI chunk on first open (`FR-ACT-02`).
 * `null` (capture not requested) returns an inert handle. S-02 implements it.
 */
export type InstallDebugPanel = (controller: CaptureController | null, options?: DebugPanelOptions) => DebugPanelHandle;

/** The host element's tag: prefixed and versioned so it never clashes with v1 or the host (D-11, ISO-14). */
export const PANEL_ELEMENT_NAME = 'debug-capture-panel-v2';
