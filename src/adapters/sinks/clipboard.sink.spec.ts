import { ClipboardHost, copyText } from './clipboard.sink';

/** What the fallback's textarea looked like while `execCommand('copy')` ran. */
interface CopySnapshot {
  value: string;
  readOnly: boolean;
  position: string;
  top: string;
  opacity: string;
  selected: string;
}

describe('copyText', () => {
  let doc: Document;
  let execCommand: jasmine.Spy<Document['execCommand']>;
  let writeText: jasmine.Spy<Clipboard['writeText']>;
  let snapshot: CopySnapshot | undefined;

  beforeEach(() => {
    // An inert document (no browsing context): execCommand is spied, and the
    // real page's DOM, focus and clipboard are never touched.
    doc = document.implementation.createHTMLDocument('clipboard-sink-spec');
    snapshot = undefined;
    execCommand = spyOn(doc, 'execCommand').and.callFake(() => {
      snapshot = snapshotTextarea();
      return true;
    });
    writeText = jasmine.createSpy<Clipboard['writeText']>('writeText').and.resolveTo();
  });

  function snapshotTextarea(): CopySnapshot | undefined {
    const textarea = doc.body.querySelector('textarea');
    if (!textarea) {
      return undefined;
    }
    return {
      value: textarea.value,
      readOnly: textarea.readOnly,
      position: textarea.style.position,
      top: textarea.style.top,
      opacity: textarea.style.opacity,
      selected: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
    };
  }

  /** A plain-HTTP intranet page: not a secure context, no Clipboard API. */
  function plainHttpHost(): ClipboardHost {
    return { navigator: {}, document: doc, isSecureContext: false };
  }

  function secureHost(): ClipboardHost {
    return { navigator: { clipboard: { writeText } }, document: doc, isSecureContext: true };
  }

  function fakeActiveElement(element: Element | null): void {
    Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => element });
  }

  it('uses navigator.clipboard in a secure context', async () => {
    await expectAsync(copyText('hello', secureHost())).toBeResolvedTo(true);

    expect(writeText).toHaveBeenCalledOnceWith('hello');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when not in a secure context', async () => {
    // Even if a browser exposes the API on HTTP, it must not be trusted there.
    const host: ClipboardHost = { ...secureHost(), isSecureContext: false };

    await expectAsync(copyText('hello', host)).toBeResolvedTo(true);

    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledOnceWith('copy');
  });

  it('copies on a plain-HTTP host with no Clipboard API, via a selected off-screen textarea', async () => {
    const text = 'line 1\nline 2 — éà';

    await expectAsync(copyText(text, plainHttpHost())).toBeResolvedTo(true);

    expect(execCommand).toHaveBeenCalledOnceWith('copy');
    expect(snapshot).toEqual({
      value: text,
      readOnly: true,
      position: 'fixed',
      top: '-9999px',
      opacity: '0',
      selected: text,
    });
  });

  it("resolves with execCommand's result when the browser refuses the copy", async () => {
    execCommand.and.returnValue(false);

    await expectAsync(copyText('hello', plainHttpHost())).toBeResolvedTo(false);

    expect(doc.body.querySelector('textarea')).toBeNull();
  });

  it('falls back when navigator.clipboard rejects', async () => {
    writeText.and.rejectWith(new DOMException('Document is not focused.', 'NotAllowedError'));

    await expectAsync(copyText('hello', secureHost())).toBeResolvedTo(true);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledOnceWith('copy');
    expect(snapshot?.value).toBe('hello');
  });

  it('resolves false instead of rejecting when everything fails', async () => {
    writeText.and.rejectWith(new Error('denied'));
    execCommand.and.throwError('execCommand unsupported');

    await expectAsync(copyText('hello', secureHost())).toBeResolvedTo(false);

    expect(doc.body.querySelector('textarea')).toBeNull();
  });

  it('resolves false when the fallback cannot even build its textarea', async () => {
    spyOn(doc, 'createElement').and.throwError('no DOM');

    await expectAsync(copyText('hello', plainHttpHost())).toBeResolvedTo(false);
  });

  it('removes the textarea and restores focus afterwards', async () => {
    const input = doc.createElement('input');
    doc.body.appendChild(input);
    fakeActiveElement(input);
    const focus = spyOn(input, 'focus');
    let focusedBeforeCopy = true;
    execCommand.and.callFake(() => {
      focusedBeforeCopy = focus.calls.count() > 0;
      snapshot = snapshotTextarea();
      return true;
    });

    await expectAsync(copyText('hello', plainHttpHost())).toBeResolvedTo(true);

    expect(snapshot?.value).toBe('hello');
    expect(focusedBeforeCopy).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(doc.body.querySelector('textarea')).toBeNull();
    expect(doc.body.childNodes.length).toBe(1);
  });

  it('restores focus even when the copy throws', async () => {
    const input = doc.createElement('input');
    doc.body.appendChild(input);
    fakeActiveElement(input);
    const focus = spyOn(input, 'focus');
    execCommand.and.throwError('execCommand unsupported');

    await expectAsync(copyText('hello', plainHttpHost())).toBeResolvedTo(false);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(doc.body.querySelector('textarea')).toBeNull();
  });

  describe('with options.root (C-5)', () => {
    let shadowHost: HTMLElement;
    let root: ShadowRoot;

    beforeEach(() => {
      shadowHost = doc.createElement('div');
      doc.body.appendChild(shadowHost);
      root = shadowHost.attachShadow({ mode: 'open' });
    });

    it('puts the fallback textarea inside root, never in body, and removes it', async () => {
      const seen: { parent: ParentNode | null } = { parent: null };
      execCommand.and.callFake(() => {
        seen.parent = root.querySelector('textarea')?.parentNode ?? null;
        snapshot = snapshotTextarea();
        return true;
      });

      await expectAsync(copyText('hello', plainHttpHost(), { root })).toBeResolvedTo(true);

      expect(seen.parent).toBe(root);
      expect(snapshot).toBeUndefined();
      expect(root.childNodes.length).toBe(0);
      expect(doc.body.childNodes.length).toBe(1);
    });

    it('keeps the same textarea setup inside root', async () => {
      let selected = '';
      let style = '';
      execCommand.and.callFake(() => {
        const textarea = root.querySelector('textarea');
        selected = textarea ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) : '';
        style = textarea
          ? `${textarea.readOnly} ${textarea.style.position} ${textarea.style.top} ${textarea.style.opacity}`
          : '';
        return true;
      });

      await expectAsync(copyText('hello', plainHttpHost(), { root })).toBeResolvedTo(true);

      expect(selected).toBe('hello');
      expect(style).toBe('true fixed -9999px 0');
    });

    it('gives focus back to the element focused inside the shadow root', async () => {
      // From inside a shadow root, document.activeElement is only the shadow
      // host; the element to re-focus is the one the root itself reports.
      const input = doc.createElement('input');
      root.appendChild(input);
      fakeActiveElement(shadowHost);
      Object.defineProperty(root, 'activeElement', { configurable: true, get: () => input });
      const focusInput = spyOn(input, 'focus');
      const focusHost = spyOn(shadowHost, 'focus');

      await expectAsync(copyText('hello', plainHttpHost(), { root })).toBeResolvedTo(true);

      expect(focusInput).toHaveBeenCalledTimes(1);
      expect(focusHost).not.toHaveBeenCalled();
    });

    it('falls back to the document focus when nothing inside root was focused', async () => {
      const input = doc.createElement('input');
      doc.body.appendChild(input);
      fakeActiveElement(input);
      const focus = spyOn(input, 'focus');

      await expectAsync(copyText('hello', plainHttpHost(), { root })).toBeResolvedTo(true);

      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('does not touch root when navigator.clipboard works', async () => {
      const appendChild = spyOn(root, 'appendChild').and.callThrough();

      await expectAsync(copyText('hello', secureHost(), { root })).toBeResolvedTo(true);

      expect(writeText).toHaveBeenCalledOnceWith('hello');
      expect(appendChild).not.toHaveBeenCalled();
    });

    it('resolves false, and leaves nothing behind, when root refuses the node', async () => {
      spyOn(root, 'appendChild').and.throwError('detached');

      await expectAsync(copyText('hello', plainHttpHost(), { root })).toBeResolvedTo(false);

      expect(execCommand).not.toHaveBeenCalled();
      expect(doc.body.childNodes.length).toBe(1);
    });
  });

  it('uses document.body when options has no root', async () => {
    await expectAsync(copyText('hello', plainHttpHost(), {})).toBeResolvedTo(true);

    expect(snapshot?.value).toBe('hello');
  });

  it('does not try to restore focus when nothing was focused', async () => {
    fakeActiveElement(null);

    await expectAsync(copyText('hello', plainHttpHost())).toBeResolvedTo(true);

    expect(doc.body.querySelector('textarea')).toBeNull();
  });
});
