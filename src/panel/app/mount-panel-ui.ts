import { CaptureController } from '../views';
import { defaultFrameDeps, mountFrame } from './frame';

/** What the loader (P5) passes to the UI chunk on first open. */
export interface MountPanelUiOptions {
  /** The host page's document; the UI reads no globals of its own. */
  readonly document: Document;
  /**
   * The loader's panel root (`.dcp-root`, the dialog) inside `root`: the UI
   * builds in it. Handed over so the UI never looks it up by class (C3-2).
   */
  readonly panelRoot: HTMLElement;
  /** `localStorage` key for settings and filter chips; `false` keeps nothing. */
  readonly storageKey: string | false;
  /** Where the panel docks when no stored setting says otherwise. */
  readonly defaultDock: 'bottom' | 'right';
  /** The UI asks the loader to close it (close button, `Escape`); the loader owns open/closed. */
  onRequestClose(): void;
}

/** The mounted UI. */
export interface PanelUiHandle {
  /** Unsubscribes and removes the UI's nodes from the shadow root; the host element stays. */
  unmount(): void;
}

/**
 * The UI chunk's entry (HLD §6.2, P4): builds the frame inside `root` and the
 * data source from `controller` (P1). The loader reaches it with one dynamic
 * `import()` on first open, so it stays out of the loader's bytes.
 */
export type MountPanelUi = (
  root: ShadowRoot,
  controller: CaptureController,
  options: MountPanelUiOptions,
) => PanelUiHandle;

/**
 * The panel frame (S-08) inside the loader's panel root, wired to the host
 * page's own window: its frames, timers, clock and `localStorage`.
 */
export const mountPanelUi: MountPanelUi = (root, controller, options) =>
  mountFrame(root, controller, options, defaultFrameDeps(options.document));
