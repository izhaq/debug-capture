import type { CaptureController } from '../views';
import { mountPanelUi } from './index';

describe('placeholder mountPanelUi (S02-15)', () => {
  let host: HTMLElement;
  let shadow: ShadowRoot;
  let panelRoot: HTMLElement;
  let onRequestClose: jasmine.Spy<() => void>;
  const controller = {} as CaptureController;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    // The loader's panel root (S02-10), handed over as `panelRoot` (S02-09, C3-2).
    panelRoot = document.createElement('div');
    panelRoot.className = 'dcp-root';
    panelRoot.tabIndex = -1;
    shadow.appendChild(panelRoot);
    onRequestClose = jasmine.createSpy('onRequestClose');
  });

  afterEach(() => host.remove());

  const mount = () =>
    mountPanelUi(shadow, controller, { document, panelRoot, storageKey: false, defaultDock: 'bottom', onRequestClose });

  it('renders a title and a named close button inside the panel root, as text only', () => {
    mount();

    expect(panelRoot.textContent).toContain('Debug');
    const close = panelRoot.querySelector('button') as HTMLButtonElement;
    expect(close.type).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('Close debug panel');
    expect(panelRoot.querySelectorAll('[style]').length).toBe(0);
  });

  it('builds in the panelRoot it is given, never in an element found by class (C3-2)', () => {
    const decoy = document.createElement('div');
    decoy.className = 'dcp-root';
    shadow.insertBefore(decoy, panelRoot);
    mount();

    expect(decoy.childNodes.length).toBe(0);
    expect(panelRoot.querySelector('button')).not.toBeNull();
  });

  it('asks the loader to close from the close button and from Escape, never by itself', () => {
    mount();
    expect(onRequestClose).not.toHaveBeenCalled();

    (shadow.querySelector('button') as HTMLButtonElement).click();
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    (shadow.querySelector('button') as HTMLButtonElement).dispatchEvent(other);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (shadow.querySelector('button') as HTMLButtonElement).dispatchEvent(escape);

    expect(onRequestClose).toHaveBeenCalledTimes(2);
    expect(escape.defaultPrevented).toBeTrue();
    expect(other.defaultPrevented).toBeFalse();
  });

  it('handles Escape pressed on the panel root itself (where the loader puts focus)', () => {
    const ui = mount();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    panelRoot.dispatchEvent(escape);
    ui.unmount();
    panelRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBeTrue();
  });

  it('unmount removes its nodes and listeners and leaves the loader’s root; twice is harmless', () => {
    const ui = mount();
    const close = shadow.querySelector('button') as HTMLButtonElement;
    ui.unmount();
    ui.unmount();
    close.click();

    expect(panelRoot.childNodes.length).toBe(0);
    expect(Array.from(shadow.childNodes)).toEqual([panelRoot]);
    expect(onRequestClose).not.toHaveBeenCalled();
  });
});
