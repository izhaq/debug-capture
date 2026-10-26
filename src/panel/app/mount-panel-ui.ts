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
  /**
   * "Show DBG button" (`FR-ACT-10`) as the loader has it now; `null` when the
   * host passed `launcher: false` — then Settings hides the switch (the host wins, `D-32`).
   */
  readonly launcher: boolean | null;
  /** The switch changed: the loader shows or hides the launcher (it is hidden anyway while open). */
  setLauncher(show: boolean): void;
  /**
   * Which warning banners to show now (`FR-BUF-04`, `FR-BUF-05`). The loader
   * keeps what was dismissed, because that must outlive a close and reopen.
   */
  warnings(): PanelWarnings;
  /** The user dismissed a banner; it comes back only at the next crossing or step. */
  dismissWarning(kind: 'nearFull' | 'memory'): void;
  /** 2.2 (`FR-BG-09`): the loader's chords, for Settings › About; `false` = none bound. */
  readonly shortcuts: { readonly toggle: string | false; readonly activation: string | false };
}

/** The banners the loader says to show. */
export interface PanelWarnings {
  /** The near-full banner (`FR-BUF-04`). */
  readonly nearFull: boolean;
  /** The memory banner's estimate in bytes (`FR-BUF-05`); `0` = no banner. */
  readonly memoryBytes: number;
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
