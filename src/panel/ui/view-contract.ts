import type { PanelDataSource, PanelState, PanelStore, TimeFormat } from '../model';
import type { Schedule } from './search-box';

/**
 * The view contract (wave 3, C3-1): what the frame (S-08, P4) gives each tab's
 * view, and what it calls on it. Fixed before the tracks start, so S-05…S-08
 * code against these names and never against each other.
 *
 * Types only, and in P2 rather than P3: a view track's folder
 * (`views/http/`…) may import only its own directory and the P2 barrel
 * (`lint:layers` rule 4), so this is the one place every track can reach.
 * The frame gets them through the P3 barrel, which re-exports P2.
 */

/** The settings a view renders with (§4.10); the frame owns and stores them (`D-20`). */
export interface ViewSettings {
  /** Clock or relative time (P1 `TimeFormat`: `{ mode: 'clock', utcOffsetMinutes }` or `{ mode: 'relative', origin }`). */
  readonly time: TimeFormat;
  /** List row height in whole px, 2n − 2 for the text size n (§5.3, `D-50`; was 20 · 22 · 26 until 2.3). */
  readonly rowHeight: number;
  /** Where the panel is docked: the detail pane goes beside the list (bottom) or below it (right) (§5.2). */
  readonly dock: 'bottom' | 'right';
}

/** What the frame gives each view. */
export interface ViewDeps {
  readonly document: Document;
  /** The panel's shadow root: sinks (`copyText(text, root)`, `download(root)`) and popovers live inside it. */
  readonly root: ShadowRoot;
  readonly source: PanelDataSource;
  readonly store: PanelStore;
  /** The settings at mount; later changes arrive by `applySettings`. */
  readonly settings: ViewSettings;
  /**
   * The frame's once-per-frame scheduler, already outside Angular's zone
   * (ISO-09): pass it as the virtual list's `requestFrame`.
   */
  requestFrame(callback: () => void): void;
  /** The frame's timer, outside Angular's zone: the search box's `schedule` (debounce). */
  readonly schedule: Schedule;
  /** A panel failure: counted in the status bar (§4.11). Never throws, never logs. */
  report(error: unknown): void;
}

/** A mounted view. The frame places `element`; the view never touches the frame. */
export interface PanelView {
  readonly element: HTMLElement;
  /** Called by the frame's scheduler, at most once per frame, only while this view is visible. */
  update(state: PanelState): void;
  applySettings(settings: ViewSettings): void;
  /** `Ctrl+F` (§4.12). */
  focusFilter(): void;
  /** `Escape`: closes the view's innermost open thing; `true` if it did (§4.12). */
  handleEscape(): boolean;
  /** Removes listeners and the element; safe to call twice. */
  destroy(): void;
}

/** Each view track exports one of these (`createHttpView`, `createWsView`, `createConsoleView`). */
export type CreateView = (deps: ViewDeps) => PanelView;
