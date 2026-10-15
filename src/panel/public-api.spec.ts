import type { CaptureController, LiveRecorder } from '..';
import type { MountPanelUi, MountPanelUiOptions } from './app';
import * as panel from './index';
import { DebugPanelHandle, DebugPanelOptions, InstallDebugPanel, PANEL_ELEMENT_NAME, installDebugPanel } from './index';

// Read while the spec bundle loads, before any spec runs (other specs install
// panels): importing the entry must define nothing (ISO-11).
const definedAtImport = customElements.get(PANEL_ELEMENT_NAME);

/** `true` only when A and B are the same type (not merely assignable). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its type argument is `true`. */
function assertType<T extends true>(): T | undefined {
  return undefined;
}

describe('debug-capture/panel public API (P5 loader)', () => {
  it('exports only installDebugPanel and PANEL_ELEMENT_NAME at runtime (types erase)', () => {
    // The loader must stay tiny (≤ 4 kB, NFR-SIZE-01) and must never pull the
    // UI chunk in eagerly: no `export *` from P4, no value import of it.
    expect(Object.keys(panel).sort()).toEqual(['PANEL_ELEMENT_NAME', 'installDebugPanel']);
    assertType<Equals<typeof installDebugPanel, InstallDebugPanel>>();
  });

  it('PANEL_ELEMENT_NAME is the prefixed, versioned custom element name (D-11, ISO-14)', () => {
    assertType<Equals<typeof PANEL_ELEMENT_NAME, 'debug-capture-panel-v2'>>();

    expect(PANEL_ELEMENT_NAME).toBe('debug-capture-panel-v2');
    // Importing the entry registers nothing: only installDebugPanel() may (ISO-11).
    expect(definedAtImport).toBeUndefined();
  });

  it('DebugPanelOptions are all optional and match what the UI chunk is mounted with', () => {
    assertType<Equals<NonNullable<DebugPanelOptions['defaultDock']>, MountPanelUiOptions['defaultDock']>>();
    assertType<Equals<NonNullable<DebugPanelOptions['storageKey']>, MountPanelUiOptions['storageKey']>>();
    assertType<Equals<DebugPanelOptions['shortcut'], string | false | undefined>>();
    assertType<Equals<DebugPanelOptions['launcher'], boolean | undefined>>();
    assertType<
      Equals<Parameters<MountPanelUi>, [root: ShadowRoot, controller: CaptureController, options: MountPanelUiOptions]>
    >();

    const defaults: DebugPanelOptions = {};
    const all: DebugPanelOptions = {
      launcher: false,
      shortcut: 'ctrl+alt+shift+p',
      defaultDock: 'right',
      storageKey: false,
    };

    expect(Object.keys(defaults).length).toBe(0);
    expect(all.defaultDock).toBe('right');
  });

  it('InstallDebugPanel takes a controller or null and returns a handle', () => {
    assertType<
      Equals<Parameters<InstallDebugPanel>, [controller: CaptureController | null, options?: DebugPanelOptions]>
    >();
    assertType<Equals<ReturnType<InstallDebugPanel>, DebugPanelHandle>>();

    // null → an inert handle (HLD §6.4): every method is safe to call.
    assertType<Equals<DebugPanelHandle['loadError'], unknown>>();
    const handle = installDebugPanel(null);
    handle.open();
    handle.close();
    handle.dispose();
    const writes = (): void => {
      // @ts-expect-error — only open() / close() change `isOpen`.
      handle.isOpen = true;
    };

    expect(handle.isOpen).toBeFalse();
    expect(handle.loadError).toBeNull();
    expect(typeof writes).toBe('function');
  });

  it('installDebugPanel(controller) mounts the real element and loads the real UI chunk on open', async () => {
    // Only what the loader and the placeholder UI read; S-01's controller replaces it later.
    const recorder: Pick<LiveRecorder, 'onEntry' | 'onChange'> = {
      onEntry: () => () => undefined,
      onChange: () => () => undefined,
    };
    const controller = { session: { recorder }, on: true } as unknown as CaptureController;
    const handle = installDebugPanel(controller);
    try {
      const host = document.documentElement.querySelector(`:scope > ${PANEL_ELEMENT_NAME}`) as HTMLElement;
      expect(host).not.toBeNull();
      expect(customElements.get(PANEL_ELEMENT_NAME)).toBeDefined();

      handle.open();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(handle.isOpen).toBeTrue();
      expect(handle.loadError).toBeNull();
      expect(host.shadowRoot?.querySelector('.dcp-root')?.textContent).toContain('Debug');
    } finally {
      handle.dispose();
    }
  });
});
