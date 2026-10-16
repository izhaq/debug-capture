import { ClipboardHost, copyText } from './clipboard.sink';
import { DownloadHost, downloadText } from './download.sink';

/**
 * C-5 / `ISO-04` / HLD `OPEN-04`, in a real browser: the page's own live
 * document (Karma runs in headless Chromium), a real open shadow root, real
 * focus, real `select()` and `execCommand('copy')`, a real anchor `click()`.
 * Only the clipboard API and the download itself are kept out — through the
 * injected host objects, never by patching `window`.
 *
 * The proof that nothing reaches the host page is a `MutationObserver` on
 * `<body>` with `subtree`: it would see any node the sinks add to the light
 * DOM, and it does not see into shadow trees, so it stays empty only if the
 * temporary node went inside the shadow root.
 */
describe('sinks with a real shadow root (C-5)', () => {
  let shadowHost: HTMLElement;
  let root: ShadowRoot;
  let input: HTMLInputElement;
  let bodyWatch: AddedNodes;
  let rootWatch: AddedNodes;

  /**
   * Every node added under `target`. Records are kept from the callback too:
   * after an `await`, the observer has already delivered them, so
   * `takeRecords()` alone would come back empty.
   */
  interface AddedNodes {
    names(): string[];
    stop(): void;
  }

  function watchAdded(target: Node, subtree: boolean): AddedNodes {
    const names: string[] = [];
    const collect = (records: MutationRecord[]): void =>
      records.forEach((record) => record.addedNodes.forEach((node) => names.push(node.nodeName)));
    const observer = new MutationObserver(collect);
    observer.observe(target, { childList: true, subtree });
    return {
      names: () => {
        collect(observer.takeRecords());
        return names;
      },
      stop: () => observer.disconnect(),
    };
  }

  beforeEach(() => {
    shadowHost = document.createElement('div');
    document.body.appendChild(shadowHost);
    root = shadowHost.attachShadow({ mode: 'open' });
    input = document.createElement('input');
    input.value = 'typing here';
    root.appendChild(input);
    input.focus();
    // Watches start after the fixture is built, so they see only the sinks.
    bodyWatch = watchAdded(document.body, true);
    rootWatch = watchAdded(root, false);
  });

  afterEach(() => {
    bodyWatch.stop();
    rootWatch.stop();
    shadowHost.remove();
  });

  /** What the fallback saw at the moment it asked the browser to copy. */
  interface CopyMoment {
    command: string;
    focusedInRoot: Element | null;
    selected: string;
    result: boolean;
  }

  /**
   * The live document, with `execCommand` passed through and observed. A
   * wrapper object (not a spy on `document`), so the page stays unpatched.
   */
  function liveClipboardHost(clipboard: ClipboardHost['navigator']['clipboard'], moments: CopyMoment[]): ClipboardHost {
    return {
      navigator: { clipboard },
      isSecureContext: true,
      document: {
        createElement: (tagName: string) => document.createElement(tagName),
        body: document.body,
        get activeElement() {
          return document.activeElement;
        },
        execCommand: (command: string) => {
          const focused = root.activeElement;
          const selected =
            focused instanceof HTMLTextAreaElement
              ? focused.value.slice(focused.selectionStart, focused.selectionEnd)
              : '';
          const result = document.execCommand(command);
          moments.push({ command, focusedInRoot: focused, selected, result });
          return result;
        },
      },
    };
  }

  function expectFocusBackOnInput(): void {
    expect(root.activeElement).toBe(input);
    expect(document.activeElement).toBe(shadowHost);
  }

  it('copy without a Clipboard API: textarea inside the shadow root, body untouched, focus back', async () => {
    const moments: CopyMoment[] = [];

    const copied = await copyText('from the panel', liveClipboardHost(undefined, moments), { root });

    expect(moments.length).toBe(1);
    const moment = moments[0];
    expect(moment.command).toBe('copy');
    expect(moment.focusedInRoot?.nodeName).toBe('TEXTAREA');
    expect(moment.selected).toBe('from the panel');
    // OPEN-04 for this Chromium: copyText resolves with what execCommand said.
    expect(copied).toBe(moment.result);
    expect(rootWatch.names()).toEqual(['TEXTAREA']);
    expect(bodyWatch.names()).toEqual([]);
    expect(root.querySelector('textarea')).toBeNull();
    expectFocusBackOnInput();
  });

  it('copy when navigator.clipboard rejects: same fallback, inside the shadow root', async () => {
    const moments: CopyMoment[] = [];
    const writeText = jasmine
      .createSpy<Clipboard['writeText']>('writeText')
      .and.rejectWith(new DOMException('Document is not focused.', 'NotAllowedError'));

    const copied = await copyText('from the panel', liveClipboardHost({ writeText }, moments), { root });

    expect(writeText).toHaveBeenCalledOnceWith('from the panel');
    expect(moments.length).toBe(1);
    expect(moments[0].selected).toBe('from the panel');
    expect(copied).toBe(moments[0].result);
    expect(rootWatch.names()).toEqual(['TEXTAREA']);
    expect(bodyWatch.names()).toEqual([]);
    expectFocusBackOnInput();
  });

  it('download: the anchor is clicked inside the shadow root, body untouched', () => {
    const deferred: Array<() => void> = [];
    const clicks: Array<{ inRoot: boolean; connected: boolean; download: string }> = [];
    // The real click() runs; cancelling its event stops the actual download.
    root.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof HTMLAnchorElement) {
        clicks.push({ inRoot: target.parentNode === root, connected: target.isConnected, download: target.download });
        event.preventDefault();
      }
    });
    const revokeObjectURL = jasmine
      .createSpy('revokeObjectURL')
      .and.callFake((url: string) => URL.revokeObjectURL(url));
    const host: DownloadHost = {
      document,
      URL: { createObjectURL: (blob: Blob) => URL.createObjectURL(blob), revokeObjectURL },
      defer: (fn) => deferred.push(fn),
    };

    downloadText('{}', 'capture.json', 'application/json', host, { root });

    expect(clicks).toEqual([{ inRoot: true, connected: true, download: 'capture.json' }]);
    expect(rootWatch.names()).toEqual(['A']);
    expect(bodyWatch.names()).toEqual([]);
    expect(root.querySelector('a')).toBeNull();
    deferred.forEach((fn) => fn());
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expectFocusBackOnInput();
  });
});
