import { createDom } from './dom';
import { createThemeSheet } from './index';
import { createSplitPane, SplitPaneControl, SplitPaneOptions } from './split-pane';

describe('split pane (S04-04, ISO-19)', () => {
  const dom = createDom(document);
  let host: HTMLElement;
  let root: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [createThemeSheet(document)];
    root = dom.el('div', { className: 'dcp-root', style: { display: 'flex', width: '1000px', height: '600px' } });
    shadow.appendChild(root);
  });

  afterEach(() => host.remove());

  function make(options: Partial<SplitPaneOptions> = {}): SplitPaneControl {
    const split = createSplitPane(dom, {
      direction: 'row',
      first: dom.el('div', null, ['list']),
      second: dom.el('div', null, ['detail']),
      ariaLabel: 'Resize detail',
      ...options,
    });
    root.appendChild(split.element);
    return split;
  }

  /** Stubs pointer capture: a synthetic pointer id has no real pointer behind it. */
  function stubCapture(handle: HTMLElement): { set: jasmine.Spy; release: jasmine.Spy } {
    let captured: number | null = null;
    const set = spyOn(handle, 'setPointerCapture').and.callFake((id: number) => {
      captured = id;
    });
    const release = spyOn(handle, 'releasePointerCapture').and.callFake(() => {
      captured = null;
    });
    spyOn(handle, 'hasPointerCapture').and.callFake((id: number) => captured === id);
    return { set, release };
  }

  function pointer(target: Element, type: string, init: PointerEventInit): PointerEvent {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 7, ...init });
    target.dispatchEvent(event);
    return event;
  }

  function key(target: Element, name: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  const width = (el: Element): number => Math.round(el.getBoundingClientRect().width);

  it('is a focusable, named separator with its range (row: a vertical line)', () => {
    const split = make();
    const second = split.element.lastElementChild as HTMLElement;

    expect(split.handle.getAttribute('role')).toBe('separator');
    expect(split.handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(split.handle.getAttribute('aria-label')).toBe('Resize detail');
    expect(split.handle.getAttribute('aria-valuemin')).toBe('240');
    expect(split.handle.tabIndex).toBe(0);
    expect(split.element.getAttribute('data-direction')).toBe('row');
    // HLD §5.3: the detail starts at 45 %; the divider is 1 px.
    expect(split.secondSize).toBeNull();
    expect(width(second)).toBe(450);
    expect(width(split.handle)).toBe(1);
    expect(getComputedStyle(second).minWidth).toBe('240px');
  });

  it('drags with pointer capture on its own handle, and clamps both panes to 240 px', () => {
    const onResize = jasmine.createSpy('onResize');
    const split = make({ onResize });
    const second = split.element.lastElementChild as HTMLElement;
    const capture = stubCapture(split.handle);

    const down = pointer(split.handle, 'pointerdown', { button: 0, clientX: 550 });
    expect(down.defaultPrevented).toBeTrue();
    expect(capture.set).toHaveBeenCalledOnceWith(7);
    pointer(split.handle, 'pointermove', { clientX: 450 });
    expect(split.secondSize).toBe(550);
    expect(width(second)).toBe(550);
    expect(split.handle.getAttribute('aria-valuenow')).toBe('550');
    pointer(split.handle, 'pointermove', { clientX: -500 });
    expect(split.secondSize).toBe(759);
    expect(width(split.element.firstElementChild as Element)).toBe(240);
    expect(split.handle.getAttribute('aria-valuemax')).toBe('759');
    pointer(split.handle, 'pointermove', { clientX: 5000 });
    expect(split.secondSize).toBe(240);
    pointer(split.handle, 'pointermove', { clientX: 6000 });
    expect(onResize.calls.allArgs()).toEqual([[550], [759], [240]]);

    pointer(split.handle, 'pointerup', { clientX: 5000 });
    expect(capture.release).toHaveBeenCalledOnceWith(7);
    pointer(split.handle, 'pointermove', { clientX: 400 });
    expect(split.secondSize).toBe(240);
  });

  it('ignores other buttons, other pointers, and a pointer whose capture was lost', () => {
    const split = make();
    const capture = stubCapture(split.handle);
    pointer(split.handle, 'pointerdown', { button: 2, clientX: 550 });
    pointer(split.handle, 'pointerdown', { button: 0, clientX: 550, isPrimary: false });
    expect(capture.set).not.toHaveBeenCalled();

    pointer(split.handle, 'pointerdown', { button: 0, clientX: 550 });
    pointer(split.handle, 'pointermove', { clientX: 500, pointerId: 8 });
    pointer(split.handle, 'pointerup', { clientX: 500, pointerId: 8 });
    expect(split.secondSize).toBeNull();
    pointer(split.handle, 'lostpointercapture', { pointerId: 8 });
    pointer(split.handle, 'lostpointercapture', {});
    pointer(split.handle, 'pointermove', { clientX: 500 });
    expect(split.secondSize).toBeNull();

    pointer(split.handle, 'pointerdown', { button: 0, clientX: 550 });
    pointer(split.handle, 'pointercancel', {});
    expect(capture.release).toHaveBeenCalledTimes(1);
    pointer(split.handle, 'pointermove', { clientX: 500 });
    expect(split.secondSize).toBeNull();
  });

  it('never listens on the document or window, even while dragging (ISO-19)', () => {
    const onDocument = spyOn(document, 'addEventListener').and.callThrough();
    const onWindow = spyOn(window, 'addEventListener').and.callThrough();
    const split = make();
    stubCapture(split.handle);
    pointer(split.handle, 'pointerdown', { button: 0, clientX: 550 });
    pointer(split.handle, 'pointermove', { clientX: 500 });
    pointer(split.handle, 'pointerup', { clientX: 500 });

    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('keyboard (row): ← grows the detail, → shrinks it, Home / End go to the limits', () => {
    const onResize = jasmine.createSpy('onResize');
    const split = make({ secondSize: 300, step: 10, onResize });
    expect(split.secondSize).toBe(300);

    expect(key(split.handle, 'ArrowLeft').defaultPrevented).toBeTrue();
    expect(split.secondSize).toBe(310);
    key(split.handle, 'ArrowRight');
    key(split.handle, 'ArrowRight');
    expect(split.secondSize).toBe(290);
    key(split.handle, 'End');
    expect(split.secondSize).toBe(759);
    key(split.handle, 'Home');
    expect(split.secondSize).toBe(240);
    key(split.handle, 'Home');
    expect(key(split.handle, 'ArrowUp').defaultPrevented).toBeFalse();
    expect(onResize.calls.allArgs()).toEqual([[310], [300], [290], [759], [240]]);
  });

  it('has aria-valuenow / min / max from the start, refreshed on focus (review S-04 #12)', () => {
    const sized = createSplitPane(dom, {
      direction: 'row',
      first: dom.el('div'),
      second: dom.el('div'),
      secondSize: 300,
      ariaLabel: 'x',
    });
    expect(sized.handle.getAttribute('aria-valuenow')).toBe('300');
    expect(sized.handle.getAttribute('aria-valuemin')).toBe('240');

    // The 45 % default has no px size until it is laid out: the values are
    // measured when the handle gets focus (when assistive tech reads them).
    const split = make();
    expect(split.handle.getAttribute('aria-valuemin')).toBe('240');
    split.handle.focus();
    expect(split.handle.getAttribute('aria-valuenow')).toBe('450');
    expect(split.handle.getAttribute('aria-valuemax')).toBe('759');
    split.handle.blur();
    root.style.width = '800px';
    split.handle.focus();
    expect(split.handle.getAttribute('aria-valuenow')).toBe('360');
    expect(split.handle.getAttribute('aria-valuemax')).toBe('559');
    expect(split.secondSize).toBeNull();
  });

  it('ignores arrows with Alt, Ctrl or Meta', () => {
    const split = make({ secondSize: 300 });
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    split.handle.dispatchEvent(event);
    expect(event.defaultPrevented).toBeFalse();
    expect(split.secondSize).toBe(300);
  });

  it('keyboard from the 45 % default starts at the measured size', () => {
    const split = make();
    key(split.handle, 'ArrowLeft');
    expect(split.secondSize).toBe(466);
  });

  it('column: stacked panes, a horizontal line, ↑ grows; setDirection switches; setSecondSize does not report', () => {
    root.style.flexDirection = 'column';
    const onResize = jasmine.createSpy('onResize');
    const split = make({ direction: 'column', secondSize: 250, onResize });
    const second = split.element.lastElementChild as HTMLElement;

    expect(split.handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(Math.round(second.getBoundingClientRect().height)).toBe(250);
    expect(getComputedStyle(second).minHeight).toBe('240px');
    key(split.handle, 'ArrowUp');
    expect(split.secondSize).toBe(266);
    key(split.handle, 'ArrowDown');
    expect(split.secondSize).toBe(250);
    expect(key(split.handle, 'ArrowLeft').defaultPrevented).toBeFalse();

    split.setDirection('row');
    expect(split.element.getAttribute('data-direction')).toBe('row');
    expect(getComputedStyle(second).minHeight).toBe('0px');
    split.setSecondSize(10);
    expect(split.secondSize).toBe(240);
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it('a pane too small for both minimums keeps the detail at its minimum', () => {
    root.style.width = '300px';
    const split = make();
    key(split.handle, 'End');
    expect(split.secondSize).toBe(240);
  });

  it('destroy() during a drag releases the capture and stops listening', () => {
    const split = make();
    const capture = stubCapture(split.handle);
    pointer(split.handle, 'pointerdown', { button: 0, clientX: 550 });
    split.destroy();
    pointer(split.handle, 'pointermove', { clientX: 400 });
    key(split.handle, 'Home');

    expect(capture.release).toHaveBeenCalledOnceWith(7);
    expect(split.secondSize).toBeNull();
    split.destroy();
  });
});
