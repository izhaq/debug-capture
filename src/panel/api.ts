/**
 * The loader's public types and its one constant (HLD §6.4). Kept apart from
 * `index.ts` so the loader's own files can import them without a cycle.
 */
import type { CaptureController, Unsubscribe } from '..';

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
  /** 2.1 (`FR-BUF-04`): the near-full banner shows from this share of the capacity, in (0, 1]. Default `0.9`. */
  readonly nearFullAt?: number;
  /** 2.1 (`FR-BUF-05`): the memory warning repeats at each multiple of this many bytes. Default 26,214,400 (25 MB). */
  readonly memoryStep?: number;
}

/** 2.1 (`FR-STAT-01`, `D-31`): what `handle.onStatus` reports. A fresh object per call. */
export interface DebugPanelStatus {
  readonly open: boolean;
  /** Capture on (`controller.on`). */
  readonly capture: boolean;
  /** Entries in the buffer now. */
  readonly entries: number;
  /** The buffer size; `Infinity` = No limit. */
  readonly capacity: number;
  /** Problems in the buffer (`FR-ACT-04` rule). */
  readonly problems: number;
  /** `entries ≥ nearFullAt × capacity` (`FR-BUF-04`). */
  readonly nearFull: boolean;
  /** The recorder's size estimate (`C-9`). */
  readonly bytes: number;
  /** `floor(bytes / memoryStep)`: 0 below the first step (`FR-BUF-05`). */
  readonly memoryStep: number;
}

/** What `installDebugPanel()` returns (HLD §6.4). Inert when installed with `null`. */
export interface DebugPanelHandle {
  /** Opens for a host's own user action (a menu item); focus stays where it is (ISO-16). */
  open(): void;
  /** Closes; focus returns to where it was (ISO-16). */
  close(): void;
  /** `true` from `open()` until `close()`, also while the UI chunk is still loading. */
  readonly isOpen: boolean;
  /**
   * Why the last open failed (the UI chunk did not load, or threw while
   * mounting); `null` when it did not. The panel never logs or throws
   * (ISO-12), so this is the only place such a failure shows.
   */
  readonly loadError: unknown;
  /** Closes (focus returns), unsubscribes, removes the launcher, the shortcut listener and the element. */
  dispose(): void;
  /**
   * 2.1 (`FR-STAT-01`): calls `listener` now, then after a change — at most
   * once per frame, only when a field changed, also while closed. A throwing
   * listener is isolated. Returns the unsubscribe function.
   */
  onStatus(listener: (status: DebugPanelStatus) => void): Unsubscribe;
}

/**
 * `installDebugPanel(controller, options)` — mounts the host element, the
 * launcher and the shortcut; loads the UI chunk on first open (`FR-ACT-02`).
 * `null` (capture not requested) returns an inert handle.
 */
export type InstallDebugPanel = (controller: CaptureController | null, options?: DebugPanelOptions) => DebugPanelHandle;

/** The host element's tag: prefixed and versioned so it never clashes with v1 or the host (D-11, ISO-14). */
export const PANEL_ELEMENT_NAME = 'debug-capture-panel-v2';
