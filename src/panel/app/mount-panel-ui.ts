import { CaptureController } from '../views';

/** What the loader (P5) passes to the UI chunk on first open. */
export interface MountPanelUiOptions {
  /** The host page's document; the UI reads no globals of its own. */
  readonly document: Document;
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
 * Placeholder UI (S02-15) so the whole lazy path is real and testable: a
 * title and a close button inside the loader's panel root, plain DOM and
 * text only. S-08 replaces it with the frame. It lands in its own chunk.
 */
export const mountPanelUi: MountPanelUi = (root, _controller, options) => {
  const doc = options.document;
  const frame = doc.createElement('div');
  const title = doc.createElement('span');
  title.textContent = 'Debug';
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close debug panel');
  frame.append(title, ' ', close);

  const requestClose = (): void => {
    try {
      options.onRequestClose();
    } catch {
      // Never into the host (ISO-12).
    }
  };
  // Escape is the panel's own: handled here; the loader's event wall keeps it from the host (ISO-08).
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    requestClose();
  };
  // On the panel root, not the frame: the loader focuses the root itself, and
  // a key pressed there never passes through its children.
  const parent = root.querySelector('.dcp-root') ?? root;
  close.addEventListener('click', requestClose);
  parent.addEventListener('keydown', onKey as EventListener);
  parent.appendChild(frame);

  return {
    unmount(): void {
      close.removeEventListener('click', requestClose);
      parent.removeEventListener('keydown', onKey as EventListener);
      frame.remove();
    },
  };
};
