import { createListeners, Dom, ErrorReporter, setAttr, setStyle } from './dom';

/** `row`: panes side by side (docked bottom); `column`: stacked (docked right). */
export type SplitDirection = 'row' | 'column';

/** Options for `createSplitPane`. */
export interface SplitPaneOptions {
  readonly direction: SplitDirection;
  /** The list side. */
  readonly first: HTMLElement;
  /** The detail side; its size is the one that changes. */
  readonly second: HTMLElement;
  /** Start size of `second` in px; without it, 45 % of the split (HLD §5.3). */
  readonly secondSize?: number;
  /** Smallest size of either pane in px; default 240 (HLD §5.3). */
  readonly minSize?: number;
  /** Arrow-key step in px; default 16. */
  readonly step?: number;
  /** Names the separator, e.g. "Resize detail". */
  readonly ariaLabel: string;
  /** The user resized (drag or keys); e.g. to remember the size. */
  readonly onResize?: (secondSize: number) => void;
  readonly onError?: ErrorReporter;
}

/** A split pane built by `createSplitPane`. */
export interface SplitPaneControl {
  readonly element: HTMLElement;
  /** The separator: focusable, draggable. */
  readonly handle: HTMLElement;
  /** Size of `second` in px once set or resized; `null` while it is the 45 % default. */
  readonly secondSize: number | null;
  /** Sets the size of `second` (clamped), without calling `onResize`. */
  setSecondSize(px: number): void;
  setDirection(direction: SplitDirection): void;
  destroy(): void;
}

/**
 * Two panes and a draggable separator (HLD §5.3, ISO-19). Dragging uses
 * pointer capture on the handle itself, so every move event comes to our own
 * element and no listener is ever put on the host's document or window.
 * Keyboard (`role="separator"`): arrows resize by `step`, Home / End go to the
 * smallest / largest detail. Both panes keep at least `minSize`.
 */
export function createSplitPane(dom: Dom, options: SplitPaneOptions): SplitPaneControl {
  const min = options.minSize ?? 240;
  const step = options.step ?? 16;
  let direction = options.direction;
  let size: number | null = null;

  const handle = dom.el('div', {
    className: 'dcp-split__handle',
    attrs: { role: 'separator', tabindex: 0, 'aria-label': options.ariaLabel, 'aria-valuemin': min },
  });
  options.first.classList.add('dcp-split__first');
  options.second.classList.add('dcp-split__second');
  const element = dom.el('div', { className: 'dcp-split' }, [options.first, handle, options.second]);

  const total = (): number => {
    const rect = element.getBoundingClientRect();
    return direction === 'row' ? rect.width : rect.height;
  };
  const current = (): number => {
    if (size !== null) return size;
    const rect = options.second.getBoundingClientRect();
    return direction === 'row' ? rect.width : rect.height;
  };
  /**
   * The largest detail that still leaves `min` (and the 1 px line) for the
   * list, never below `min`; `null` before the split is laid out (not yet in
   * the page), when no upper bound is known.
   */
  const max = (): number | null => {
    const all = total();
    return all > 0 ? Math.max(min, Math.floor(all - min - 1)) : null;
  };
  const apply = (px: number): number => {
    const upper = max();
    const next = Math.round(Math.min(upper ?? Infinity, Math.max(min, px)));
    size = next;
    setStyle(options.second, 'flex', `0 0 ${next}px`);
    setAttr(handle, 'aria-valuenow', next);
    setAttr(handle, 'aria-valuemax', upper);
    return next;
  };
  const resize = (px: number): void => {
    const before = size;
    const next = apply(px);
    if (next !== before) options.onResize?.(next);
  };
  const setDirection = (next: SplitDirection): void => {
    direction = next;
    setAttr(element, 'data-direction', next);
    setAttr(handle, 'aria-orientation', next === 'row' ? 'vertical' : 'horizontal');
    const minName = next === 'row' ? 'min-width' : 'min-height';
    setStyle(options.second, next === 'row' ? 'min-height' : 'min-width', null);
    setStyle(options.second, minName, `${min}px`);
    if (size !== null) apply(size);
  };
  setDirection(direction);
  if (options.secondSize !== undefined) apply(options.secondSize);

  const listeners = createListeners(options.onError);
  let drag: { readonly pointerId: number; readonly start: number; readonly startSize: number } | null = null;
  const position = (event: PointerEvent): number => (direction === 'row' ? event.clientX : event.clientY);
  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  listeners.on(handle, 'pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, start: position(event), startSize: current() };
  });
  listeners.on(handle, 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // The detail is after the handle: moving the handle forward shrinks it.
    resize(drag.startSize - (position(event) - drag.start));
  });
  listeners.on(handle, 'pointerup', endDrag);
  listeners.on(handle, 'pointercancel', endDrag);
  listeners.on(handle, 'lostpointercapture', (event) => {
    if (drag && event.pointerId === drag.pointerId) drag = null;
  });
  listeners.on(handle, 'keydown', (event) => {
    const [grow, shrink] = direction === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    let next: number;
    if (event.key === grow) next = current() + step;
    else if (event.key === shrink) next = current() - step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max() ?? current();
    else return;
    event.preventDefault();
    resize(next);
  });

  return {
    element,
    handle,
    get secondSize() {
      return size;
    },
    setSecondSize: (px) => {
      apply(px);
    },
    setDirection,
    destroy: () => {
      if (drag && handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
      drag = null;
      listeners.removeAll();
    },
  };
}
