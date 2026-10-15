import type { CaptureController } from '..';
import type { MountPanelUi, MountPanelUiOptions } from './app';
import * as panel from './index';
import { DebugPanelHandle, DebugPanelOptions, InstallDebugPanel, PANEL_ELEMENT_NAME } from './index';

/** `true` only when A and B are the same type (not merely assignable). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its type argument is `true`. */
function assertType<T extends true>(): T | undefined {
  return undefined;
}

describe('debug-capture/panel public API (P5 loader)', () => {
  it('exports only PANEL_ELEMENT_NAME at runtime today (types erase)', () => {
    // The loader must stay tiny (≤ 4 kB, NFR-SIZE-01) and must never pull the
    // UI chunk in eagerly: no `export *` from P4, no value import of it.
    expect(Object.keys(panel).sort()).toEqual(['PANEL_ELEMENT_NAME']);
  });

  it('PANEL_ELEMENT_NAME is the prefixed, versioned custom element name (D-11, ISO-14)', () => {
    assertType<Equals<typeof PANEL_ELEMENT_NAME, 'debug-capture-panel-v2'>>();

    expect(PANEL_ELEMENT_NAME).toBe('debug-capture-panel-v2');
    // Importing the entry registers nothing: only installDebugPanel() may (ISO-11).
    expect(customElements.get(PANEL_ELEMENT_NAME)).toBeUndefined();
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
    const installInert: InstallDebugPanel = () => ({
      open: (): void => undefined,
      close: (): void => undefined,
      isOpen: false,
      dispose: (): void => undefined,
    });
    const handle = installInert(null);
    handle.open();
    handle.close();
    handle.dispose();
    const writes = (): void => {
      // @ts-expect-error — only open() / close() change `isOpen`.
      handle.isOpen = true;
    };

    expect(handle.isOpen).toBeFalse();
    expect(typeof writes).toBe('function');
  });
});
