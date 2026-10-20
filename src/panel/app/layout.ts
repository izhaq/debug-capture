import { createListeners, Dom, ErrorReporter, setAttr, setStyle } from '../views';
import type { Dock } from './settings';

/** HLD §5.3: bottom 40 % (min 160 px), right 520 px (min 360 px); both at most 90 % of the window. */
export const PANEL_SIZES = {
  bottom: { min: 160, fallback: '40%' },
  right: { min: 360, fallback: '520px' },
  maxRatio: 0.9,
} as const;

/** Arrow-key step on the resize edge, px. */
const STEP = 16;

/** Every inline property the frame sets on the panel root; `destroy()` removes them all. */
const GEOMETRY = [
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
] as const;

export interface LayoutOptions {
  /** The loader's panel root: the frame owns its size and dock by inline styles (C3-3). */
  readonly panelRoot: HTMLElement;
  readonly dock: Dock;
  /** Stored sizes in px, or `null` for the defaults. */
  readonly height: number | null;
  readonly width: number | null;
  /** The window's size, for the 90 % limit. */
  readonly viewport: () => { readonly width: number; readonly height: number };
  /** The user finished a resize (pointer released, or a key): e.g. to remember it. */
  readonly onResize: (dock: Dock, px: number) => void;
  readonly onError?: ErrorReporter;
}

export interface LayoutControl {
  /** The inner edge (`role="separator"`): focusable, draggable. The frame places it. */
  readonly handle: HTMLElement;
  readonly dock: Dock;
  readonly maximized: boolean;
  setDock(dock: Dock): void;
  setMaximized(maximized: boolean): void;
  /** Removes the listeners and every inline property it set. */
  destroy(): void;
}

/**
 * Dock, size and maximize of the panel root (FR-WIN-01…04). The panel always
 * overlays the page (ISO-13): only our own root moves, never the page.
 * Resizing drags the inner edge with pointer capture on the edge itself, so
 * every move comes to our element and no listener ever goes on the host's
 * document or window (ISO-19). Keys on the edge: arrows by 16 px, Home / End
 * to the limits.
 */
export function createLayout(dom: Dom, options: LayoutOptions): LayoutControl {
  const root = options.panelRoot;
  let dock = options.dock;
  let height = options.height;
  let width = options.width;
  let maximized = false;

  const handle = dom.el('div', {
    className: 'dcp-resize',
    attrs: { role: 'separator', tabindex: 0, 'aria-label': 'Resize panel' },
  });

  const limits = (): [min: number, max: number] => {
    const view = options.viewport();
    const min = PANEL_SIZES[dock].min;
    const max = Math.floor((dock === 'bottom' ? view.height : view.width) * PANEL_SIZES.maxRatio);
    return [min, Math.max(min, max)];
  };
  const clamp = (px: number): number => {
    const [min, max] = limits();
    return Math.round(Math.min(max, Math.max(min, px)));
  };
  const current = (): number => {
    const rect = root.getBoundingClientRect();
    return dock === 'bottom' ? rect.height : rect.width;
  };

  const style = (values: Readonly<Record<(typeof GEOMETRY)[number], string>>): void => {
    for (const name of GEOMETRY) setStyle(root, name, values[name]);
  };
  const apply = (): void => {
    if (maximized) {
      style({
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
        width: 'auto',
        height: 'auto',
        'min-width': '0',
        'min-height': '0',
        'max-width': 'none',
        'max-height': 'none',
      });
    } else if (dock === 'bottom') {
      style({
        top: 'auto',
        right: '0',
        bottom: '0',
        left: '0',
        width: 'auto',
        height: height === null ? PANEL_SIZES.bottom.fallback : `${height}px`,
        'min-width': '0',
        'min-height': `${PANEL_SIZES.bottom.min}px`,
        'max-width': 'none',
        'max-height': '90%',
      });
    } else {
      style({
        top: '0',
        right: '0',
        bottom: '0',
        left: 'auto',
        width: width === null ? PANEL_SIZES.right.fallback : `${width}px`,
        height: 'auto',
        'min-width': `${PANEL_SIZES.right.min}px`,
        'min-height': '0',
        'max-width': '90%',
        'max-height': 'none',
      });
    }
    setAttr(root, 'data-dock', dock);
    setAttr(root, 'data-maximized', maximized);
    handle.hidden = maximized;
    // The separator line runs across the panel when docked bottom.
    setAttr(handle, 'aria-orientation', dock === 'bottom' ? 'horizontal' : 'vertical');
    const size = dock === 'bottom' ? height : width;
    setAttr(handle, 'aria-valuemin', PANEL_SIZES[dock].min);
    setAttr(handle, 'aria-valuenow', size);
  };

  const set = (px: number): number => {
    const next = clamp(px);
    if (dock === 'bottom') height = next;
    else width = next;
    apply();
    return next;
  };

  const listeners = createListeners(options.onError);
  let drag: { readonly pointerId: number; readonly start: number; readonly size: number; moved: boolean } | null = null;
  const position = (event: PointerEvent): number => (dock === 'bottom' ? event.clientY : event.clientX);
  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (moved) options.onResize(dock, (dock === 'bottom' ? height : width) ?? Math.round(current()));
  };
  listeners.on(handle, 'pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || maximized) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, start: position(event), size: current(), moved: false };
  });
  listeners.on(handle, 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // The edge is at the start of the panel: moving it up (or left) grows the panel.
    set(drag.size + (drag.start - position(event)));
    drag.moved = true;
  });
  listeners.on(handle, 'pointerup', endDrag);
  listeners.on(handle, 'pointercancel', endDrag);
  listeners.on(handle, 'lostpointercapture', endDrag);
  listeners.on(handle, 'focus', () => {
    setAttr(handle, 'aria-valuemax', limits()[1]);
    setAttr(handle, 'aria-valuenow', Math.round(current()));
  });
  listeners.on(handle, 'keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || maximized) return;
    const [grow, shrink] = dock === 'bottom' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    let next: number;
    if (event.key === grow) next = current() + STEP;
    else if (event.key === shrink) next = current() - STEP;
    else if (event.key === 'Home') next = limits()[0];
    else if (event.key === 'End') next = limits()[1];
    else return;
    event.preventDefault();
    options.onResize(dock, set(next));
  });

  apply();

  return {
    handle,
    get dock() {
      return dock;
    },
    get maximized() {
      return maximized;
    },
    setDock(next): void {
      dock = next;
      apply();
    },
    setMaximized(next): void {
      maximized = next;
      apply();
    },
    destroy(): void {
      if (drag && handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
      drag = null;
      listeners.removeAll();
      for (const name of GEOMETRY) setStyle(root, name, null);
      // Leave the loader's root as it was given: no empty `style=""` behind. Chrome writes
      // inline-style changes to the attribute lazily; reading it first flushes that, or
      // the pending write would bring `style=""` back after the removal.
      if (root.style.length === 0 && root.getAttribute('style') !== null) root.removeAttribute('style');
      setAttr(root, 'data-dock', null);
      setAttr(root, 'data-maximized', null);
    },
  };
}
