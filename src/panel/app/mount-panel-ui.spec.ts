import type { CaptureController } from '../views';
import { mountPanelUi } from './index';

describe('placeholder mountPanelUi (S02-15)', () => {
  let host: HTMLElement;
  let shadow: ShadowRoot;
  let onRequestClose: jasmine.Spy<() => void>;
  const controller = {} as CaptureController;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    onRequestClose = jasmine.createSpy('onRequestClose');
  });

  afterEach(() => host.remove());

  const mount = () =>
    mountPanelUi(shadow, controller, { document, storageKey: false, defaultDock: 'bottom', onRequestClose });

  it('renders a title and a named close button inside the loader’s panel root, as text only', () => {
    const root = document.createElement('div');
    root.className = 'dcp-root';
    shadow.appendChild(root);
    mount();

    expect(root.textContent).toContain('Debug');
    const close = root.querySelector('button') as HTMLButtonElement;
    expect(close.type).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('Close debug panel');
    expect(root.querySelectorAll('[style]').length).toBe(0);
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

  it('unmount removes its nodes and listeners; twice is harmless', () => {
    const ui = mount();
    const close = shadow.querySelector('button') as HTMLButtonElement;
    ui.unmount();
    ui.unmount();
    close.click();

    expect(shadow.childNodes.length).toBe(0);
    expect(onRequestClose).not.toHaveBeenCalled();
  });
});
