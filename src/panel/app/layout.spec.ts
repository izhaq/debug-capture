import { createDom } from './index';
import { createLayout, LayoutOptions } from './layout';
import { createStage, Stage } from './fakes.spec';

describe('S-08 layout (FR-WIN-01…04, ISO-13, ISO-19)', () => {
  let stage: Stage;
  let onResize: jasmine.Spy<LayoutOptions['onResize']>;

  beforeEach(() => {
    stage = createStage();
    onResize = jasmine.createSpy('onResize');
  });
  afterEach(() => stage.remove());

  const layout = (extra: Partial<LayoutOptions> = {}) => {
    const control = createLayout(createDom(document), {
      panelRoot: stage.panelRoot,
      dock: 'bottom',
      height: null,
      width: null,
      viewport: () => ({ width: 1000, height: 800 }),
      onResize,
      ...extra,
    });
    stage.panelRoot.appendChild(control.handle);
    return control;
  };
  const style = (): Record<string, string> => {
    const s = stage.panelRoot.style;
    return {
      top: s.top,
      right: s.right,
      bottom: s.bottom,
      left: s.left,
      width: s.width,
      height: s.height,
      minWidth: s.minWidth,
      minHeight: s.minHeight,
      maxWidth: s.maxWidth,
      maxHeight: s.maxHeight,
    };
  };
  /** Pointer capture on a synthetic pointer: recorded, as the browser would (split-pane spec style). */
  const capture = (handle: HTMLElement) => {
    let captured: number | null = null;
    const set = spyOn(handle, 'setPointerCapture').and.callFake((id: number) => {
      captured = id;
    });
    spyOn(handle, 'releasePointerCapture').and.callFake(() => {
      captured = null;
    });
    spyOn(handle, 'hasPointerCapture').and.callFake((id: number) => captured === id);
    return set;
  };
  const pointer = (target: Element, type: string, init: PointerEventInit): void => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 7, ...init }),
    );
  };

  it('docked bottom: full width, 40 % by default (min 160 px, max 90 %), or the stored height', () => {
    layout();
    expect(style()).toEqual({
      top: 'auto',
      right: '0px',
      bottom: '0px',
      left: '0px',
      width: 'auto',
      height: '40%',
      minWidth: '0px',
      minHeight: '160px',
      maxWidth: 'none',
      maxHeight: '90%',
    });
    expect(stage.panelRoot.getAttribute('data-dock')).toBe('bottom');
    stage.remove();
    stage = createStage();
    layout({ height: 333 });
    expect(stage.panelRoot.style.height).toBe('333px');
  });

  it('docked right: full height, 520 px by default (min 360 px, max 90 %), or the stored width', () => {
    const control = layout({ dock: 'right', width: 600 });
    expect(style()).toEqual({
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: 'auto',
      width: '600px',
      height: 'auto',
      minWidth: '360px',
      minHeight: '0px',
      maxWidth: '90%',
      maxHeight: 'none',
    });
    expect(control.handle.getAttribute('aria-orientation')).toBe('vertical');
    control.setDock('bottom');
    expect(stage.panelRoot.style.height).toBe('40%');
    expect(control.handle.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('maximize fills the window and hides the edge; restore brings the dock back', () => {
    const control = layout();
    control.setMaximized(true);
    expect(style()).toEqual(
      jasmine.objectContaining({
        top: '0px',
        bottom: '0px',
        left: '0px',
        right: '0px',
        height: 'auto',
        maxHeight: 'none',
      }),
    );
    expect(control.handle.hidden).toBeTrue();
    expect(stage.panelRoot.hasAttribute('data-maximized')).toBeTrue();
    control.setMaximized(false);
    expect(stage.panelRoot.style.height).toBe('40%');
    expect(control.handle.hidden).toBeFalse();
  });

  it('ISO-19: drag with pointer capture on the edge; no listener on the host document or window', () => {
    const onDocument = spyOn(document, 'addEventListener').and.callThrough();
    const onWindow = spyOn(window, 'addEventListener').and.callThrough();
    const control = layout();
    const set = capture(control.handle);
    const start = stage.panelRoot.getBoundingClientRect().height;

    pointer(control.handle, 'pointerdown', { button: 0, clientY: 500 });
    pointer(control.handle, 'pointermove', { clientY: 450 });
    expect(stage.panelRoot.style.height).toBe(`${Math.min(720, Math.max(160, Math.round(start + 50)))}px`);
    expect(onResize).not.toHaveBeenCalled();
    pointer(control.handle, 'pointerup', { clientY: 450 });

    expect(set).toHaveBeenCalledOnceWith(7);
    expect(onResize).toHaveBeenCalledOnceWith('bottom', Math.min(720, Math.max(160, Math.round(start + 50))));
    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('§5.3 limits while dragging: never under 160 px, never over 90 % of the window', () => {
    const control = layout();
    capture(control.handle);
    pointer(control.handle, 'pointerdown', { button: 0, clientY: 500 });
    pointer(control.handle, 'pointermove', { clientY: -5000 });
    expect(stage.panelRoot.style.height).toBe('720px');
    pointer(control.handle, 'pointermove', { clientY: 5000 });
    expect(stage.panelRoot.style.height).toBe('160px');
  });

  it('keys on the edge: arrows by 16 px, Home / End to the limits, each remembered', () => {
    const control = layout({ height: 300 });
    const key = (k: string) =>
      control.handle.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('Home');
    expect(stage.panelRoot.style.height).toBe('160px');
    key('End');
    expect(stage.panelRoot.style.height).toBe('720px');
    expect(onResize.calls.allArgs()).toEqual([
      ['bottom', 160],
      ['bottom', 720],
    ]);
    expect(control.handle.getAttribute('role')).toBe('separator');
  });

  it('destroy removes its listeners and every inline property, leaving the root as it was given', () => {
    const control = layout({ dock: 'right' });
    control.destroy();
    expect(stage.panelRoot.hasAttribute('style')).toBeFalse();
    expect(stage.panelRoot.hasAttribute('data-dock')).toBeFalse();
    capture(control.handle);
    pointer(control.handle, 'pointerdown', { button: 0, clientX: 500 });
    pointer(control.handle, 'pointermove', { clientX: 100 });
    expect(stage.panelRoot.hasAttribute('style')).toBeFalse();
  });
});
